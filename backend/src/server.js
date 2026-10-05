const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

const db = require('./db');
const { seedAdminUser, login, authMiddleware } = require('./auth');

const app = express();
const PORT = process.env.PORT || 4009;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3009';

// Gateway public endpoint needs full open CORS so browser test console can invoke ANY /gw/*
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
  exposedHeaders: ['X-Cache', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'Retry-After']
}));

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ==========================================
// 1. GATEWAY EXECUTION ENGINE (PUBLIC /gw/*)
// ==========================================
app.all('/gw*', async (req, res) => {
  const startTime = process.hrtime();

  // Extract path after /gw
  let subPath = req.path.slice(3) || '/';
  if (!subPath.startsWith('/')) subPath = '/' + subPath;

  try {
    // 1. Route Matching
    const routeRes = await db.query(
      `SELECT * FROM routes 
       WHERE path = $1 AND (method = $2 OR method = 'ANY')
       LIMIT 1`,
      [subPath, req.method]
    );

    if (routeRes.rows.length === 0) {
      return res.status(404).json({
        error: `404 Not Found: No upstream configured for ${req.method} ${subPath}`
      });
    }

    const route = routeRes.rows[0];

    // 2. Authentication Check
    let apiKeyRecord = null;
    const incomingApiKey = req.headers['x-api-key'] || req.headers['X-Api-Key'];

    if (route.require_api_key) {
      if (!incomingApiKey) {
        return res.status(401).json({
          error: '401 Unauthorized: Route requires x-api-key header'
        });
      }

      const hash = crypto.createHash('sha256').update(incomingApiKey).digest('hex');
      const keyRes = await db.query('SELECT * FROM api_keys WHERE key_hash = $1', [hash]);

      if (keyRes.rows.length === 0 || keyRes.rows[0].is_revoked) {
        return res.status(403).json({
          error: '403 Forbidden: Invalid or revoked API key'
        });
      }
      apiKeyRecord = keyRes.rows[0];
    } else if (incomingApiKey) {
      const hash = crypto.createHash('sha256').update(incomingApiKey).digest('hex');
      const keyRes = await db.query('SELECT * FROM api_keys WHERE key_hash = $1', [hash]);
      if (keyRes.rows.length > 0 && !keyRes.rows[0].is_revoked) {
        apiKeyRecord = keyRes.rows[0];
      }
    }

    // 3. Rate Limiting Check (1-minute fixed window)
    const rateLimit = route.rate_limit_per_min || (apiKeyRecord ? apiKeyRecord.rate_limit_per_min : 60);
    const clientIdentifier = apiKeyRecord ? `key:${apiKeyRecord.key_prefix}` : `ip:${req.ip || '127.0.0.1'}`;
    const windowMinute = new Date().toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm
    const windowKey = `${clientIdentifier}:r${route.id}:${windowMinute}`;
    const expiresAt = new Date(Date.now() + 65 * 1000);

    const windowRes = await db.query(
      `INSERT INTO rate_limit_windows (window_key, request_count, expires_at)
       VALUES ($1, 1, $2)
       ON CONFLICT (window_key)
       DO UPDATE SET request_count = rate_limit_windows.request_count + 1
       RETURNING request_count`,
      [windowKey, expiresAt]
    );

    const currentCount = windowRes.rows[0].request_count;
    const remaining = Math.max(0, rateLimit - currentCount);

    res.setHeader('X-RateLimit-Limit', rateLimit);
    res.setHeader('X-RateLimit-Remaining', remaining);

    if (currentCount > rateLimit) {
      res.setHeader('Retry-After', 60);
      const diff = process.hrtime(startTime);
      const durationMs = Number(((diff[0] * 1000) + (diff[1] / 1e6)).toFixed(2));

      await db.query(
        `INSERT INTO gateway_logs (route_id, route_path, method, key_prefix, status_code, latency_ms, cache_hit)
         VALUES ($1, $2, $3, $4, 429, $5, false)`,
        [route.id, subPath, req.method, apiKeyRecord ? apiKeyRecord.key_prefix : null, durationMs]
      );

      return res.status(429).json({
        error: `429 Too Many Requests: Rate limit of ${rateLimit} requests/min exceeded. Retry after 60s.`
      });
    }

    // 4. Cache Check (GET only and cache_ttl_seconds > 0)
    let cacheKey = null;
    if (req.method === 'GET' && route.cache_ttl_seconds > 0) {
      cacheKey = `route:${route.id}:${subPath}:${JSON.stringify(req.query)}`;
      const cacheRes = await db.query(
        'SELECT response_body, content_type FROM gateway_cache WHERE cache_key = $1 AND expires_at > CURRENT_TIMESTAMP',
        [cacheKey]
      );

      if (cacheRes.rows.length > 0) {
        res.setHeader('X-Cache', 'HIT');
        const diff = process.hrtime(startTime);
        const durationMs = Number(((diff[0] * 1000) + (diff[1] / 1e6)).toFixed(2));

        await db.query(
          `INSERT INTO gateway_logs (route_id, route_path, method, key_prefix, status_code, latency_ms, cache_hit)
           VALUES ($1, $2, $3, $4, 200, $5, true)`,
          [route.id, subPath, req.method, apiKeyRecord ? apiKeyRecord.key_prefix : null, durationMs]
        );

        res.setHeader('Content-Type', cacheRes.rows[0].content_type);
        return res.send(cacheRes.rows[0].response_body);
      }
    }

    // 5. Upstream Latency Simulation
    if (route.upstream_latency_ms > 0) {
      await new Promise(r => setTimeout(r, route.upstream_latency_ms));
    }

    // 6. Execute Mock Upstream
    let statusCode = 200;
    let responseData = null;

    if (route.upstream_type === 'echo') {
      responseData = {
        upstream: 'echo',
        method: req.method,
        path: subPath,
        query: req.query,
        headers: {
          'user-agent': req.headers['user-agent'],
          'content-type': req.headers['content-type'],
          'x-api-key': incomingApiKey ? `${incomingApiKey.slice(0, 8)}...` : undefined
        },
        body: req.body
      };
    } else if (route.upstream_type === 'time') {
      responseData = {
        upstream: 'time',
        server_time: new Date().toISOString(),
        epoch_ms: Date.now(),
        timezone: 'UTC'
      };
    } else if (route.upstream_type === 'users') {
      responseData = {
        upstream: 'users',
        count: 5,
        users: [
          { id: 1, name: 'Alice Admin', role: 'Platform Admin', email: 'alice@cloud.internal' },
          { id: 2, name: 'Bob Builder', role: 'DevOps Lead', email: 'bob@cloud.internal' },
          { id: 3, name: 'Charlie Coder', role: 'Backend Engineer', email: 'charlie@cloud.internal' },
          { id: 4, name: 'Diana Designer', role: 'Frontend Lead', email: 'diana@cloud.internal' },
          { id: 5, name: 'Evan Evaluator', role: 'QA Automation', email: 'evan@cloud.internal' }
        ]
      };
    } else if (route.upstream_type === 'flaky') {
      // 30% chance of returning 500
      if (Math.random() < 0.3) {
        statusCode = 500;
        responseData = {
          upstream: 'flaky',
          error: '500 Internal Server Error (Simulated 30% Flaky Failure)'
        };
      } else {
        responseData = {
          upstream: 'flaky',
          status: 'ok',
          message: 'Upstream call succeeded under normal load condition'
        };
      }
    } else {
      responseData = { message: 'Upstream handled' };
    }

    // 7. Store in Cache if Missed
    if (req.method === 'GET' && route.cache_ttl_seconds > 0 && statusCode === 200 && cacheKey) {
      res.setHeader('X-Cache', 'MISS');
      const cacheExpires = new Date(Date.now() + route.cache_ttl_seconds * 1000);
      await db.query(
        `INSERT INTO gateway_cache (cache_key, response_body, expires_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (cache_key)
         DO UPDATE SET response_body = EXCLUDED.response_body, expires_at = EXCLUDED.expires_at`,
        [cacheKey, JSON.stringify(responseData), cacheExpires]
      );
    } else if (route.cache_ttl_seconds > 0) {
      res.setHeader('X-Cache', 'BYPASS');
    }

    // 8. Log Request Execution
    const diff = process.hrtime(startTime);
    const durationMs = Number(((diff[0] * 1000) + (diff[1] / 1e6)).toFixed(2));

    await db.query(
      `INSERT INTO gateway_logs (route_id, route_path, method, key_prefix, status_code, latency_ms, cache_hit)
       VALUES ($1, $2, $3, $4, $5, $6, false)`,
      [route.id, subPath, req.method, apiKeyRecord ? apiKeyRecord.key_prefix : null, statusCode, durationMs]
    );

    return res.status(statusCode).json(responseData);
  } catch (err) {
    console.error('Gateway processing error:', err);
    return res.status(500).json({ error: 'Gateway internal processing error: ' + err.message });
  }
});

// ==========================================
// 2. MANAGEMENT API (JWT PROTECTED UNDER /api)
// ==========================================
app.post('/api/auth/login', login);

app.use('/api', authMiddleware);

// Routes CRUD
app.get('/api/routes', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM routes ORDER BY created_at ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('List routes error:', err);
    res.status(500).json({ error: 'Failed to list routes' });
  }
});

app.post('/api/routes', async (req, res) => {
  const {
    name,
    path,
    method = 'ANY',
    upstream_type = 'echo',
    upstream_latency_ms = 50,
    require_api_key = false,
    rate_limit_per_min = null,
    cache_ttl_seconds = 0
  } = req.body;

  if (!name || !path) {
    return res.status(400).json({ error: 'Route name and path are required' });
  }

  let formattedPath = path.trim();
  if (!formattedPath.startsWith('/')) formattedPath = '/' + formattedPath;

  try {
    const result = await db.query(
      `INSERT INTO routes 
       (user_id, name, path, method, upstream_type, upstream_latency_ms, require_api_key, rate_limit_per_min, cache_ttl_seconds)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        req.user.userId,
        name.trim(),
        formattedPath,
        method,
        upstream_type,
        parseInt(upstream_latency_ms, 10) || 0,
        Boolean(require_api_key),
        rate_limit_per_min ? parseInt(rate_limit_per_min, 10) : null,
        parseInt(cache_ttl_seconds, 10) || 0
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create route error:', err);
    res.status(500).json({ error: 'Failed to create route: ' + err.message });
  }
});

app.put('/api/routes/:id', async (req, res) => {
  const { id } = req.params;
  const {
    name,
    path,
    method,
    upstream_type,
    upstream_latency_ms,
    require_api_key,
    rate_limit_per_min,
    cache_ttl_seconds
  } = req.body;

  let formattedPath = path ? path.trim() : undefined;
  if (formattedPath && !formattedPath.startsWith('/')) formattedPath = '/' + formattedPath;

  try {
    const result = await db.query(
      `UPDATE routes 
       SET name = COALESCE($1, name),
           path = COALESCE($2, path),
           method = COALESCE($3, method),
           upstream_type = COALESCE($4, upstream_type),
           upstream_latency_ms = COALESCE($5, upstream_latency_ms),
           require_api_key = COALESCE($6, require_api_key),
           rate_limit_per_min = $7,
           cache_ttl_seconds = COALESCE($8, cache_ttl_seconds)
       WHERE id = $9
       RETURNING *`,
      [
        name,
        formattedPath,
        method,
        upstream_type,
        upstream_latency_ms !== undefined ? parseInt(upstream_latency_ms, 10) : undefined,
        require_api_key !== undefined ? Boolean(require_api_key) : undefined,
        rate_limit_per_min ? parseInt(rate_limit_per_min, 10) : null,
        cache_ttl_seconds !== undefined ? parseInt(cache_ttl_seconds, 10) : undefined,
        id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Route not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update route error:', err);
    res.status(500).json({ error: 'Failed to update route' });
  }
});

app.delete('/api/routes/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query('DELETE FROM routes WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Route not found' });
    }
    res.json({ message: 'Route deleted successfully' });
  } catch (err) {
    console.error('Delete route error:', err);
    res.status(500).json({ error: 'Failed to delete route' });
  }
});

// API Keys CRUD
app.get('/api/keys', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, user_id, name, key_prefix, plan, rate_limit_per_min, is_revoked, created_at
       FROM api_keys
       ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List keys error:', err);
    res.status(500).json({ error: 'Failed to list API keys' });
  }
});

app.post('/api/keys', async (req, res) => {
  const { name, plan = 'free', custom_rate_limit } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Key name is required' });
  }

  let rateLimit = 10;
  if (plan === 'pro') rateLimit = 100;
  else if (plan === 'custom' && custom_rate_limit) rateLimit = parseInt(custom_rate_limit, 10);

  // Generate random key: gw_ + 32 hex chars
  const secretHex = crypto.randomBytes(16).toString('hex');
  const fullApiKey = `gw_${secretHex}`;
  const keyPrefix = fullApiKey.slice(0, 8);
  const keyHash = crypto.createHash('sha256').update(fullApiKey).digest('hex');

  try {
    const result = await db.query(
      `INSERT INTO api_keys (user_id, name, key_prefix, key_hash, plan, rate_limit_per_min)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, user_id, name, key_prefix, plan, rate_limit_per_min, is_revoked, created_at`,
      [req.user.userId, name.trim(), keyPrefix, keyHash, plan, rateLimit]
    );

    // Return the full raw key ONCE for user modal display
    res.status(201).json({
      ...result.rows[0],
      raw_api_key: fullApiKey
    });
  } catch (err) {
    console.error('Create key error:', err);
    res.status(500).json({ error: 'Failed to generate API key' });
  }
});

app.patch('/api/keys/:id/revoke', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      'UPDATE api_keys SET is_revoked = true WHERE id = $1 RETURNING id, is_revoked',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'API key not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Revoke key error:', err);
    res.status(500).json({ error: 'Failed to revoke API key' });
  }
});

// Analytics API
app.get('/api/analytics', async (req, res) => {
  try {
    // 1. Last 30 minutes RPM (requests per minute)
    const rpmRes = await db.query(
      `SELECT 
         TO_CHAR(created_at, 'HH24:MI') AS minute_slot,
         COUNT(*)::int AS count
       FROM gateway_logs
       WHERE created_at >= NOW() - INTERVAL '30 minutes'
       GROUP BY TO_CHAR(created_at, 'HH24:MI')
       ORDER BY minute_slot ASC`
    );

    // 2. Status code breakdown
    const statusRes = await db.query(
      `SELECT 
         CASE 
           WHEN status_code = 429 THEN '429 Rate Limited'
           WHEN status_code >= 200 AND status_code < 300 THEN '2xx Success'
           WHEN status_code >= 400 AND status_code < 500 THEN '4xx Client Error'
           WHEN status_code >= 500 THEN '5xx Server Error'
           ELSE 'Other'
         END AS status_category,
         COUNT(*)::int AS count
       FROM gateway_logs
       GROUP BY status_category`
    );

    // 3. Requests per key prefix
    const keyRes = await db.query(
      `SELECT COALESCE(key_prefix, 'Anonymous / None') AS key_prefix, COUNT(*)::int AS count
       FROM gateway_logs
       GROUP BY key_prefix
       ORDER BY count DESC
       LIMIT 5`
    );

    // 4. Cache hit rate
    const cacheStatsRes = await db.query(
      `SELECT 
         COUNT(*)::int AS total,
         COALESCE(SUM(CASE WHEN cache_hit = true THEN 1 ELSE 0 END), 0)::int AS hits
       FROM gateway_logs`
    );
    const totalReqs = cacheStatsRes.rows[0].total;
    const cacheHits = cacheStatsRes.rows[0].hits;
    const cacheHitRate = totalReqs > 0 ? Number(((cacheHits / totalReqs) * 100).toFixed(1)) : 0;

    // 5. Average latency per route
    const latencyRes = await db.query(
      `SELECT route_path, AVG(latency_ms)::numeric(8,2) as avg_latency
       FROM gateway_logs
       GROUP BY route_path
       ORDER BY avg_latency DESC`
    );

    // 6. Last 50 requests log
    const logsRes = await db.query(
      `SELECT id, route_path, method, key_prefix, status_code, latency_ms, cache_hit, created_at
       FROM gateway_logs
       ORDER BY created_at DESC
       LIMIT 50`
    );

    res.json({
      rpm: rpmRes.rows,
      status_breakdown: statusRes.rows,
      requests_per_key: keyRes.rows,
      cache_hit_rate: cacheHitRate,
      latency_per_route: latencyRes.rows,
      recent_logs: logsRes.rows
    });
  } catch (err) {
    console.error('Analytics error:', err);
    res.status(500).json({ error: 'Failed to retrieve analytics' });
  }
});

async function start() {
  await db.connectWithRetry();
  await seedAdminUser();
  app.listen(PORT, () => {
    console.log(`API Gateway Backend running on port ${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
