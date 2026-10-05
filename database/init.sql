CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS routes (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    path VARCHAR(200) NOT NULL,
    method VARCHAR(10) NOT NULL DEFAULT 'ANY',
    upstream_type VARCHAR(50) NOT NULL, -- 'echo', 'time', 'users', 'flaky'
    upstream_latency_ms INTEGER NOT NULL DEFAULT 50 CHECK (upstream_latency_ms >= 0 AND upstream_latency_ms <= 2000),
    require_api_key BOOLEAN NOT NULL DEFAULT false,
    rate_limit_per_min INTEGER,
    cache_ttl_seconds INTEGER NOT NULL DEFAULT 0 CHECK (cache_ttl_seconds >= 0 AND cache_ttl_seconds <= 60),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_route_path_method UNIQUE(path, method)
);

CREATE TABLE IF NOT EXISTS api_keys (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    key_prefix VARCHAR(12) NOT NULL,
    key_hash VARCHAR(64) NOT NULL UNIQUE,
    plan VARCHAR(20) NOT NULL DEFAULT 'free',
    rate_limit_per_min INTEGER NOT NULL DEFAULT 10,
    is_revoked BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rate_limit_windows (
    id SERIAL PRIMARY KEY,
    window_key VARCHAR(150) NOT NULL UNIQUE,
    request_count INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE IF NOT EXISTS gateway_cache (
    id SERIAL PRIMARY KEY,
    cache_key VARCHAR(255) NOT NULL UNIQUE,
    response_body TEXT NOT NULL,
    content_type VARCHAR(100) NOT NULL DEFAULT 'application/json',
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE IF NOT EXISTS gateway_logs (
    id SERIAL PRIMARY KEY,
    route_id INTEGER REFERENCES routes(id) ON DELETE SET NULL,
    route_path VARCHAR(200) NOT NULL,
    method VARCHAR(10) NOT NULL,
    key_prefix VARCHAR(12),
    status_code INTEGER NOT NULL,
    latency_ms NUMERIC(8, 2) NOT NULL,
    cache_hit BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gateway_logs_created ON gateway_logs(created_at DESC);

-- Seed default user
INSERT INTO users (id, email, password_hash)
VALUES (1, 'admin@demo.com', '$2a$10$7799R5m76cQdK9f9B2Qp7OF7y15O9wL2uFqK4p1U0m7GgP8L6lG.G')
ON CONFLICT (id) DO NOTHING;

-- Seed default routes
INSERT INTO routes (id, user_id, name, path, method, upstream_type, upstream_latency_ms, require_api_key, rate_limit_per_min, cache_ttl_seconds) VALUES
(1, 1, 'Users Directory', '/users', 'GET', 'users', 40, false, 60, 15),
(2, 1, 'Server Time Service', '/time', 'GET', 'time', 20, false, 100, 5),
(3, 1, 'Secure Echo Endpoint', '/echo', 'ANY', 'echo', 50, true, 30, 0),
(4, 1, 'Flaky Microservice (500 demo)', '/flaky', 'ANY', 'flaky', 100, false, 20, 0)
ON CONFLICT (id) DO NOTHING;

-- Seed default API keys
-- Key 1: raw key is gw_demo_free_key_1234567890abcdef
-- sha256: 7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069
INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash, plan, rate_limit_per_min, is_revoked) VALUES
(1, 1, 'Demo Free Plan Key', 'gw_demo_', '7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069', 'free', 10, false),
(2, 1, 'Demo Pro Plan Key', 'gw_pro12', '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08', 'pro', 100, false)
ON CONFLICT (id) DO NOTHING;
