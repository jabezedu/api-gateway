'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../lib/api';

interface Route {
  id: number;
  name: string;
  path: string;
  method: string;
  upstream_type: 'echo' | 'time' | 'users' | 'flaky';
  upstream_latency_ms: number;
  require_api_key: boolean;
  rate_limit_per_min: number | null;
  cache_ttl_seconds: number;
  created_at: string;
}

interface ApiKey {
  id: number;
  name: string;
  key_prefix: string;
  plan: 'free' | 'pro' | 'custom';
  rate_limit_per_min: number;
  is_active: boolean;
  created_at: string;
}

interface Analytics {
  statusBreakdown: { status: number; count: number }[];
  cacheStats: { total: number; hits: number; hitRatePct: number };
  routeStats: { route_path: string; count: number; avgLatencyMs: number }[];
  keyStats: { key_prefix: string; count: number }[];
  rpm: { minute: string; count: number }[];
  recentLogs: {
    id: number;
    route_path: string;
    method: string;
    key_prefix: string;
    status: number;
    latency_ms: number;
    cache_hit: boolean;
    created_at: string;
  }[];
}

export default function GatewayPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'routes' | 'keys' | 'test' | 'analytics'>('routes');
  const [routes, setRoutes] = useState<Route[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);

  // New Route Form
  const [routeName, setRouteName] = useState('');
  const [routePath, setRoutePath] = useState('/demo');
  const [routeMethod, setRouteMethod] = useState('GET');
  const [routeUpstream, setRouteUpstream] = useState<'echo' | 'time' | 'users' | 'flaky'>('echo');
  const [routeLatency, setRouteLatency] = useState(50);
  const [routeRequireKey, setRouteRequireKey] = useState(false);
  const [routeRateLimit, setRouteRateLimit] = useState<string>('');
  const [routeCacheTTL, setRouteCacheTTL] = useState(0);

  // New Key Form & Modal
  const [keyName, setKeyName] = useState('');
  const [keyPlan, setKeyPlan] = useState<'free' | 'pro' | 'custom'>('free');
  const [keyCustomLimit, setKeyCustomLimit] = useState(50);
  const [createdRawKey, setCreatedRawKey] = useState<string | null>(null);

  // Test Console
  const [testPath, setTestPath] = useState('');
  const [testMethod, setTestMethod] = useState('GET');
  const [testApiKey, setTestApiKey] = useState('');
  const [testBody, setTestBody] = useState('{\n  "message": "Hello API Gateway"\n}');
  const [testLoading, setTestLoading] = useState(false);
  const [testResponse, setTestResponse] = useState<any>(null);
  const [rapidResults, setRapidResults] = useState<{ total: number; s2xx: number; s429: number; s5xx: number; other: number } | null>(null);

  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4009';

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
      return;
    }
    loadRoutes();
    loadKeys();
  }, []);

  useEffect(() => {
    if (activeTab === 'analytics') {
      loadAnalytics();
    }
  }, [activeTab]);

  const loadRoutes = async () => {
    try {
      const res = await apiFetch('/api/routes');
      const data = await res.json();
      setRoutes(data);
      if (data.length > 0 && !testPath) {
        setTestPath(data[0].path);
        setTestMethod(data[0].method === 'ANY' ? 'GET' : data[0].method);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const loadKeys = async () => {
    try {
      const res = await apiFetch('/api/keys');
      const data = await res.json();
      setKeys(data);
    } catch (err) {
      console.error(err);
    }
  };

  const loadAnalytics = async () => {
    try {
      const res = await apiFetch('/api/analytics');
      const data = await res.json();
      setAnalytics(data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    router.push('/login');
  };

  const handleCreateRoute = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch('/api/routes', {
        method: 'POST',
        body: JSON.stringify({
          name: routeName,
          path: routePath.startsWith('/') ? routePath : `/${routePath}`,
          method: routeMethod,
          upstream_type: routeUpstream,
          upstream_latency_ms: Number(routeLatency),
          require_api_key: routeRequireKey,
          rate_limit_per_min: routeRateLimit ? Number(routeRateLimit) : null,
          cache_ttl_seconds: Number(routeCacheTTL),
        }),
      });
      if (!res.ok) throw new Error('Failed to create route');
      setRouteName('');
      setRoutePath('/demo');
      loadRoutes();
      setMessage({ type: 'success', text: 'Route created successfully' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const handleDeleteRoute = async (id: number) => {
    try {
      const res = await apiFetch(`/api/routes/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete route');
      loadRoutes();
      setMessage({ type: 'success', text: 'Route removed' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch('/api/keys', {
        method: 'POST',
        body: JSON.stringify({
          name: keyName,
          plan: keyPlan,
          rate_limit_per_min: keyPlan === 'custom' ? Number(keyCustomLimit) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create key');
      setCreatedRawKey(data.apiKey);
      setTestApiKey(data.apiKey);
      setKeyName('');
      loadKeys();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const handleRevokeKey = async (id: number) => {
    try {
      const res = await apiFetch(`/api/keys/${id}/revoke`, { method: 'PATCH' });
      if (!res.ok) throw new Error('Failed to revoke key');
      loadKeys();
      setMessage({ type: 'success', text: 'Key revoked' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const handleSendTest = async () => {
    setTestLoading(true);
    setTestResponse(null);
    const start = performance.now();
    try {
      const targetUrl = `${apiUrl}/gw${testPath.startsWith('/') ? testPath : `/${testPath}`}`;
      const headers: Record<string, string> = {};
      if (testApiKey.trim()) {
        headers['x-api-key'] = testApiKey.trim();
      }
      const fetchOpts: RequestInit = {
        method: testMethod === 'ANY' ? 'GET' : testMethod,
        headers,
      };
      if (testMethod === 'POST') {
        headers['Content-Type'] = 'application/json';
        fetchOpts.body = testBody;
      }

      const res = await fetch(targetUrl, fetchOpts);
      const latency = Math.round(performance.now() - start);

      const resHeaders: Record<string, string> = {};
      res.headers.forEach((val, key) => {
        resHeaders[key] = val;
      });

      let resBody: any;
      const text = await res.text();
      try {
        resBody = JSON.parse(text);
      } catch {
        resBody = text;
      }

      setTestResponse({
        status: res.status,
        statusText: res.statusText,
        latency,
        headers: resHeaders,
        body: resBody,
      });
    } catch (err: any) {
      setTestResponse({
        status: 0,
        statusText: 'Network Error',
        latency: Math.round(performance.now() - start),
        headers: {},
        body: { error: err.message },
      });
    } finally {
      setTestLoading(false);
    }
  };

  const handleRapidRequests = async () => {
    setTestLoading(true);
    setRapidResults(null);
    const targetUrl = `${apiUrl}/gw${testPath.startsWith('/') ? testPath : `/${testPath}`}`;
    const headers: Record<string, string> = {};
    if (testApiKey.trim()) {
      headers['x-api-key'] = testApiKey.trim();
    }
    const promises = Array.from({ length: 20 }).map(() =>
      fetch(targetUrl, {
        method: testMethod === 'ANY' ? 'GET' : testMethod,
        headers,
        body: testMethod === 'POST' ? testBody : undefined,
      }).catch((err) => ({ status: 0 }))
    );

    const responses = await Promise.all(promises);
    let s2xx = 0;
    let s429 = 0;
    let s5xx = 0;
    let other = 0;

    responses.forEach((r) => {
      if (r.status >= 200 && r.status < 300) s2xx++;
      else if (r.status === 429) s429++;
      else if (r.status >= 500) s5xx++;
      else other++;
    });

    setRapidResults({ total: 20, s2xx, s429, s5xx, other });
    setTestLoading(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 pb-16">
      {/* Header */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-600 flex items-center justify-center text-white font-bold shadow-md shadow-cyan-600/30">
              GW
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 dark:text-white leading-tight">
                API Gateway Manager
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Reverse Proxy, Mock Upstreams, Rate Limiter
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <div className="hidden sm:flex text-xs px-2.5 py-1 rounded-full bg-cyan-50 dark:bg-cyan-950/60 border border-cyan-200 dark:border-cyan-800 text-cyan-700 dark:text-cyan-300">
              Public GW: <span className="font-mono ml-1 font-semibold">{apiUrl}/gw/*</span>
            </div>
            <button
              onClick={handleLogout}
              className="text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-200 dark:border-slate-700 mb-6 space-x-8">
          {[
            { id: 'routes', label: 'Routes & Upstreams' },
            { id: 'keys', label: 'API Keys' },
            { id: 'test', label: 'Test Console' },
            { id: 'analytics', label: 'Analytics' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`py-3 font-medium text-sm border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Global Toast Message */}
        {message && (
          <div
            className={`mb-6 p-4 rounded-xl text-sm flex justify-between items-center ${
              message.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                : 'bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300'
            }`}
          >
            <span>{message.text}</span>
            <button onClick={() => setMessage(null)} className="font-bold ml-4">
              &times;
            </button>
          </div>
        )}

        {/* TAB 1: ROUTES */}
        {activeTab === 'routes' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1">
              <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm">
                <h2 className="text-base font-bold text-slate-900 dark:text-white mb-4">
                  Create Gateway Route
                </h2>
                <form onSubmit={handleCreateRoute} className="space-y-4 text-sm">
                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">
                      Route Name
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. User Profile Service"
                      value={routeName}
                      onChange={(e) => setRouteName(e.target.value)}
                      required
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">
                        Path
                      </label>
                      <input
                        type="text"
                        placeholder="/users"
                        value={routePath}
                        onChange={(e) => setRoutePath(e.target.value)}
                        required
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">
                        Method
                      </label>
                      <select
                        value={routeMethod}
                        onChange={(e) => setRouteMethod(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      >
                        <option value="GET">GET</option>
                        <option value="POST">POST</option>
                        <option value="ANY">ANY</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">
                      Mock Upstream Type
                    </label>
                    <select
                      value={routeUpstream}
                      onChange={(e) => setRouteUpstream(e.target.value as any)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    >
                      <option value="echo">echo (returns headers, query, body)</option>
                      <option value="time">time (current server ISO timestamp)</option>
                      <option value="users">users (mock list of 5 users)</option>
                      <option value="flaky">flaky (simulates 30% 500 error rate)</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">
                        Latency (ms)
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="2000"
                        value={routeLatency}
                        onChange={(e) => setRouteLatency(Number(e.target.value))}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">
                        Cache TTL (s)
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="60"
                        value={routeCacheTTL}
                        onChange={(e) => setRouteCacheTTL(Number(e.target.value))}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">
                      Rate Limit Override (req/min)
                    </label>
                    <input
                      type="number"
                      placeholder="Optional (defaults to API key plan)"
                      value={routeRateLimit}
                      onChange={(e) => setRouteRateLimit(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    />
                  </div>

                  <div className="pt-2">
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={routeRequireKey}
                        onChange={(e) => setRouteRequireKey(e.target.checked)}
                        className="rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
                      />
                      <span className="text-slate-700 dark:text-slate-300 text-xs font-medium">
                        Require API Key (<code className="text-cyan-600 font-mono">x-api-key</code>)
                      </span>
                    </label>
                  </div>

                  <button
                    type="submit"
                    className="w-full py-2.5 bg-cyan-600 hover:bg-cyan-700 text-white font-medium rounded-lg shadow-md shadow-cyan-600/30 transition-colors"
                  >
                    Add Route
                  </button>
                </form>
              </div>
            </div>

            <div className="lg:col-span-2">
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                  <div>
                    <h2 className="text-base font-bold text-slate-900 dark:text-white">
                      Configured Routes
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Total routes registered: {routes.length}
                    </p>
                  </div>
                  <button
                    onClick={loadRoutes}
                    className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline"
                  >
                    Refresh
                  </button>
                </div>

                <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
                  {routes.length === 0 ? (
                    <div className="p-8 text-center text-sm text-slate-500">
                      No routes found. Create one on the left.
                    </div>
                  ) : (
                    routes.map((r) => (
                      <div
                        key={r.id}
                        className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-slate-50/50 dark:hover:bg-slate-700/20"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center space-x-2">
                            <span
                              className={`px-2 py-0.5 rounded text-xs font-mono font-bold ${
                                r.method === 'GET'
                                  ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                                  : r.method === 'POST'
                                  ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                                  : 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300'
                              }`}
                            >
                              {r.method}
                            </span>
                            <span className="font-mono font-semibold text-slate-900 dark:text-white">
                              /gw{r.path}
                            </span>
                            <span className="text-xs text-slate-400">({r.name})</span>
                          </div>
                          <div className="flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
                            <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 font-mono">
                              upstream: {r.upstream_type} ({r.upstream_latency_ms}ms)
                            </span>
                            {r.require_api_key && (
                              <span className="px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                                Key Required
                              </span>
                            )}
                            {r.cache_ttl_seconds > 0 && (
                              <span className="px-2 py-0.5 rounded bg-cyan-100 dark:bg-cyan-950/60 text-cyan-800 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-800">
                                Cache TTL: {r.cache_ttl_seconds}s
                              </span>
                            )}
                            {r.rate_limit_per_min && (
                              <span className="px-2 py-0.5 rounded bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                                Limit: {r.rate_limit_per_min}/min
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center space-x-3">
                          <button
                            onClick={() => {
                              setTestPath(r.path);
                              setTestMethod(r.method === 'ANY' ? 'GET' : r.method);
                              setActiveTab('test');
                            }}
                            className="px-3 py-1.5 rounded-lg border border-cyan-300 dark:border-cyan-700 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-50 dark:hover:bg-cyan-950/40 text-xs font-medium"
                          >
                            Test in Console
                          </button>
                          <button
                            onClick={() => handleDeleteRoute(r.id)}
                            className="px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 text-xs font-medium"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: API KEYS */}
        {activeTab === 'keys' && (
          <div className="space-y-6">
            {/* Modal / Banner for newly created key */}
            {createdRawKey && (
              <div className="p-6 bg-cyan-50 dark:bg-cyan-950/80 border-2 border-cyan-500 rounded-2xl shadow-lg relative">
                <button
                  onClick={() => setCreatedRawKey(null)}
                  className="absolute top-4 right-4 text-cyan-700 dark:text-cyan-300 text-lg font-bold"
                >
                  &times;
                </button>
                <div className="flex items-center space-x-2 text-cyan-800 dark:text-cyan-300 font-bold mb-2">
                  <span className="text-xl">🔑</span>
                  <span>API Key Generated Successfully</span>
                </div>
                <p className="text-xs text-cyan-700 dark:text-cyan-300 mb-3">
                  Please copy this key now. For security purposes, it will never be displayed again.
                </p>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    readOnly
                    value={createdRawKey}
                    className="w-full font-mono text-sm px-3 py-2 bg-white dark:bg-slate-900 border border-cyan-400 rounded-lg select-all text-slate-900 dark:text-white"
                  />
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(createdRawKey);
                      setMessage({ type: 'success', text: 'Key copied to clipboard' });
                    }}
                    className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-sm font-semibold whitespace-nowrap shadow"
                  >
                    Copy Key
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-1">
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm">
                  <h2 className="text-base font-bold text-slate-900 dark:text-white mb-4">
                    Issue New API Key
                  </h2>
                  <form onSubmit={handleCreateKey} className="space-y-4 text-sm">
                    <div>
                      <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">
                        Client / Key Name
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Mobile App Client"
                        value={keyName}
                        onChange={(e) => setKeyName(e.target.value)}
                        required
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">
                        Usage Plan
                      </label>
                      <select
                        value={keyPlan}
                        onChange={(e) => setKeyPlan(e.target.value as any)}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      >
                        <option value="free">Free (10 req/min)</option>
                        <option value="pro">Pro (100 req/min)</option>
                        <option value="custom">Custom Rate Limit</option>
                      </select>
                    </div>

                    {keyPlan === 'custom' && (
                      <div>
                        <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">
                          Custom Limit (req/min)
                        </label>
                        <input
                          type="number"
                          min="1"
                          value={keyCustomLimit}
                          onChange={(e) => setKeyCustomLimit(Number(e.target.value))}
                          required
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                        />
                      </div>
                    )}

                    <button
                      type="submit"
                      className="w-full py-2.5 bg-cyan-600 hover:bg-cyan-700 text-white font-medium rounded-lg shadow-md shadow-cyan-600/30 transition-colors"
                    >
                      Generate Key
                    </button>
                  </form>
                </div>
              </div>

              <div className="lg:col-span-2">
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                    <div>
                      <h2 className="text-base font-bold text-slate-900 dark:text-white">
                        Registered API Keys
                      </h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Keys are hashed with SHA-256 at rest
                      </p>
                    </div>
                    <button
                      onClick={loadKeys}
                      className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline"
                    >
                      Refresh
                    </button>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 dark:bg-slate-700/50 text-slate-500 dark:text-slate-400 text-xs uppercase font-medium">
                        <tr>
                          <th className="py-3 px-4">Name</th>
                          <th className="py-3 px-4">Prefix</th>
                          <th className="py-3 px-4">Plan / Limit</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                        {keys.map((k) => (
                          <tr key={k.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-700/20">
                            <td className="py-3.5 px-4 font-semibold text-slate-900 dark:text-white">
                              {k.name}
                            </td>
                            <td className="py-3.5 px-4 font-mono text-xs text-cyan-600 dark:text-cyan-400">
                              {k.key_prefix}...
                            </td>
                            <td className="py-3.5 px-4">
                              <span className="capitalize font-medium">{k.plan}</span>{' '}
                              <span className="text-xs text-slate-400">
                                ({k.rate_limit_per_min}/min)
                              </span>
                            </td>
                            <td className="py-3.5 px-4">
                              <span
                                className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                  k.is_active
                                    ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                                    : 'bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300'
                                }`}
                              >
                                {k.is_active ? 'Active' : 'Revoked'}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-right">
                              {k.is_active ? (
                                <button
                                  onClick={() => handleRevokeKey(k.id)}
                                  className="text-xs text-rose-600 hover:underline font-medium"
                                >
                                  Revoke
                                </button>
                              ) : (
                                <span className="text-xs text-slate-400">Inactive</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: TEST CONSOLE */}
        {activeTab === 'test' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Request Builder */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Live Gateway Request Tester
              </h2>
              <p className="text-xs text-slate-500">
                Dispatches direct HTTP requests from your browser to the public Gateway endpoint{' '}
                <code className="text-cyan-600 font-mono">{apiUrl}/gw</code>
              </p>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-1">
                  <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">
                    Method
                  </label>
                  <select
                    value={testMethod}
                    onChange={(e) => setTestMethod(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono text-sm"
                  >
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">
                    Gateway Route Path
                  </label>
                  <input
                    type="text"
                    value={testPath}
                    onChange={(e) => setTestPath(e.target.value)}
                    placeholder="/users"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">
                  API Key Header (<code className="font-mono text-cyan-600">x-api-key</code>)
                </label>
                <input
                  type="text"
                  placeholder="Paste gw_... or leave empty if route is public"
                  value={testApiKey}
                  onChange={(e) => setTestApiKey(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono text-sm"
                />
              </div>

              {testMethod === 'POST' && (
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">
                    JSON Body
                  </label>
                  <textarea
                    rows={5}
                    value={testBody}
                    onChange={(e) => setTestBody(e.target.value)}
                    className="w-full p-3 font-mono text-xs rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-900 text-emerald-400 focus:outline-none"
                  />
                </div>
              )}

              <div className="pt-2 flex flex-col sm:flex-row gap-3">
                <button
                  onClick={handleSendTest}
                  disabled={testLoading}
                  className="flex-1 py-2.5 bg-cyan-600 hover:bg-cyan-700 text-white font-semibold rounded-lg shadow-md shadow-cyan-600/30 transition-colors disabled:opacity-50 text-sm"
                >
                  {testLoading ? 'Sending...' : 'Send Request'}
                </button>
                <button
                  onClick={handleRapidRequests}
                  disabled={testLoading}
                  className="py-2.5 px-4 bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50"
                >
                  Send 20 Rapid Requests
                </button>
              </div>

              {rapidResults && (
                <div className="p-4 bg-slate-100 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
                  <div className="font-semibold text-xs uppercase text-slate-500">
                    Rapid Test Results (20 requests)
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-2 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg">
                      <div className="text-xl font-bold text-emerald-600">{rapidResults.s2xx}</div>
                      <div className="text-[10px] text-emerald-700 dark:text-emerald-400 font-medium">
                        2xx Success
                      </div>
                    </div>
                    <div className="p-2 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-lg">
                      <div className="text-xl font-bold text-rose-600">{rapidResults.s429}</div>
                      <div className="text-[10px] text-rose-700 dark:text-rose-400 font-medium">
                        429 Rate Limited
                      </div>
                    </div>
                    <div className="p-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg">
                      <div className="text-xl font-bold text-amber-600">
                        {rapidResults.s5xx + rapidResults.other}
                      </div>
                      <div className="text-[10px] text-amber-700 dark:text-amber-400 font-medium">
                        Errors
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Response Viewer */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Response Inspector
                </h2>
                {testResponse && (
                  <div className="flex items-center space-x-2">
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-mono font-bold ${
                        testResponse.status >= 200 && testResponse.status < 300
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : testResponse.status === 429
                          ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                          : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                      }`}
                    >
                      {testResponse.status} {testResponse.statusText}
                    </span>
                    <span className="text-xs text-slate-400">{testResponse.latency}ms</span>
                  </div>
                )}
              </div>

              {!testResponse ? (
                <div className="flex-1 flex items-center justify-center p-12 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl text-slate-400 text-xs text-center">
                  Send a request from the left panel to inspect response status, headers, and payload.
                </div>
              ) : (
                <div className="space-y-4 flex-1 flex flex-col text-xs">
                  <div>
                    <span className="font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                      Gateway Response Headers
                    </span>
                    <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 font-mono text-[11px] max-h-36 overflow-y-auto space-y-1">
                      {Object.keys(testResponse.headers).length === 0 ? (
                        <div className="text-slate-400">No headers returned</div>
                      ) : (
                        Object.entries(testResponse.headers).map(([k, v]) => (
                          <div key={k} className="flex">
                            <span className="text-cyan-600 dark:text-cyan-400 mr-2">{k}:</span>
                            <span className="text-slate-700 dark:text-slate-300 break-all">
                              {String(v)}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="flex-1 flex flex-col">
                    <span className="font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                      Response Body
                    </span>
                    <pre className="flex-1 p-3 bg-slate-950 text-slate-200 rounded-lg font-mono text-[11px] overflow-auto border border-slate-800">
                      {typeof testResponse.body === 'object'
                        ? JSON.stringify(testResponse.body, null, 2)
                        : testResponse.body}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: ANALYTICS */}
        {activeTab === 'analytics' && analytics && (
          <div className="space-y-6">
            {/* Top Metric Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
                <div className="text-xs uppercase font-medium text-slate-500 mb-1">
                  Cache Hit Rate
                </div>
                <div className="text-2xl font-bold text-cyan-600 dark:text-cyan-400">
                  {analytics.cacheStats.hitRatePct}%
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  {analytics.cacheStats.hits} / {analytics.cacheStats.total} total hits
                </div>
              </div>

              <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
                <div className="text-xs uppercase font-medium text-slate-500 mb-1">
                  Total Logged Requests
                </div>
                <div className="text-2xl font-bold text-slate-900 dark:text-white">
                  {analytics.cacheStats.total}
                </div>
                <div className="text-xs text-slate-400 mt-1">Gateway lifetime logs</div>
              </div>

              <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
                <div className="text-xs uppercase font-medium text-slate-500 mb-1">
                  Active Routes
                </div>
                <div className="text-2xl font-bold text-slate-900 dark:text-white">
                  {routes.length}
                </div>
                <div className="text-xs text-slate-400 mt-1">Live routing endpoints</div>
              </div>

              <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
                <div className="text-xs uppercase font-medium text-slate-500 mb-1">
                  Active API Keys
                </div>
                <div className="text-2xl font-bold text-slate-900 dark:text-white">
                  {keys.filter((k) => k.is_active).length}
                </div>
                <div className="text-xs text-slate-400 mt-1">Provisioned clients</div>
              </div>
            </div>

            {/* SVG Line Chart: Requests Per Minute (Last 30 Min) */}
            <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                    Traffic Volume (Requests per Minute - Last 30m)
                  </h3>
                  <p className="text-xs text-slate-400">Real-time gateway request throughput</p>
                </div>
                <button
                  onClick={loadAnalytics}
                  className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline"
                >
                  Refresh
                </button>
              </div>

              <div className="w-full h-48">
                {analytics.rpm.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-xs text-slate-400 border border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
                    No requests recorded in the last 30 minutes. Send some from the Test Console.
                  </div>
                ) : (
                  <svg className="w-full h-full" viewBox="0 0 500 150">
                    {(() => {
                      const points = analytics.rpm;
                      const maxCount = Math.max(...points.map((p) => p.count), 5);
                      const width = 500;
                      const height = 150;
                      const padding = 20;

                      const pts = points.map((p, i) => {
                        const x =
                          padding + (i / Math.max(points.length - 1, 1)) * (width - 2 * padding);
                        const y =
                          height - padding - (p.count / maxCount) * (height - 2 * padding);
                        return `${x},${y}`;
                      });

                      const polyPoints = `${padding},${height - padding} ${pts.join(
                        ' '
                      )} ${width - padding},${height - padding}`;

                      return (
                        <>
                          <line
                            x1={padding}
                            y1={height - padding}
                            x2={width - padding}
                            y2={height - padding}
                            stroke="currentColor"
                            className="text-slate-200 dark:text-slate-700"
                            strokeWidth="1"
                          />
                          <polygon
                            points={polyPoints}
                            className="fill-cyan-500/10 dark:fill-cyan-500/20"
                          />
                          <polyline
                            fill="none"
                            stroke="#06b6d4"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            points={pts.join(' ')}
                          />
                          {points.map((p, i) => {
                            const x =
                              padding +
                              (i / Math.max(points.length - 1, 1)) * (width - 2 * padding);
                            const y =
                              height - padding - (p.count / maxCount) * (height - 2 * padding);
                            return (
                              <circle
                                key={i}
                                cx={x}
                                cy={y}
                                r="3.5"
                                className="fill-white stroke-cyan-500 stroke-2"
                              />
                            );
                          })}
                        </>
                      );
                    })()}
                  </svg>
                )}
              </div>
            </div>

            {/* Breakdown Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Status Code Breakdown */}
              <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
                <h4 className="font-bold text-sm text-slate-900 dark:text-white mb-3">
                  Status Code Breakdown
                </h4>
                <div className="space-y-2">
                  {analytics.statusBreakdown.map((sb) => (
                    <div key={sb.status} className="flex justify-between items-center text-xs">
                      <span
                        className={`font-mono font-bold px-2 py-0.5 rounded ${
                          sb.status < 300
                            ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400'
                            : sb.status === 429
                            ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400'
                            : 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400'
                        }`}
                      >
                        {sb.status}
                      </span>
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        {sb.count} reqs
                      </span>
                    </div>
                  ))}
                  {analytics.statusBreakdown.length === 0 && (
                    <div className="text-xs text-slate-400">No status logs yet</div>
                  )}
                </div>
              </div>

              {/* Average Latency Per Route */}
              <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
                <h4 className="font-bold text-sm text-slate-900 dark:text-white mb-3">
                  Average Latency per Route
                </h4>
                <div className="space-y-2">
                  {analytics.routeStats.map((rs) => (
                    <div
                      key={rs.route_path}
                      className="flex justify-between items-center text-xs"
                    >
                      <span className="font-mono text-slate-800 dark:text-slate-200">
                        {rs.route_path}
                      </span>
                      <span className="font-semibold text-cyan-600 dark:text-cyan-400">
                        {rs.avgLatencyMs} ms ({rs.count})
                      </span>
                    </div>
                  ))}
                  {analytics.routeStats.length === 0 && (
                    <div className="text-xs text-slate-400">No route logs yet</div>
                  )}
                </div>
              </div>

              {/* Requests Per Key Prefix */}
              <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
                <h4 className="font-bold text-sm text-slate-900 dark:text-white mb-3">
                  Requests per API Key
                </h4>
                <div className="space-y-2">
                  {analytics.keyStats.map((ks) => (
                    <div key={ks.key_prefix} className="flex justify-between items-center text-xs">
                      <span className="font-mono text-slate-800 dark:text-slate-200">
                        {ks.key_prefix}
                      </span>
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        {ks.count} reqs
                      </span>
                    </div>
                  ))}
                  {analytics.keyStats.length === 0 && (
                    <div className="text-xs text-slate-400">No key-based requests yet</div>
                  )}
                </div>
              </div>
            </div>

            {/* Last 50 Requests Log Table */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
              <div className="p-5 border-b border-slate-200 dark:border-slate-700">
                <h4 className="font-bold text-sm text-slate-900 dark:text-white">
                  Recent Request Logs (Last 50)
                </h4>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-700/50 text-slate-500 uppercase">
                    <tr>
                      <th className="py-2.5 px-4">Time</th>
                      <th className="py-2.5 px-4">Method & Route</th>
                      <th className="py-2.5 px-4">Key</th>
                      <th className="py-2.5 px-4">Status</th>
                      <th className="py-2.5 px-4">Latency</th>
                      <th className="py-2.5 px-4">Cache</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60 font-mono">
                    {analytics.recentLogs.map((log) => (
                      <tr
                        key={log.id}
                        className="hover:bg-slate-50/50 dark:hover:bg-slate-700/20"
                      >
                        <td className="py-2 px-4 text-slate-500">
                          {new Date(log.created_at).toLocaleTimeString()}
                        </td>
                        <td className="py-2 px-4 font-semibold text-slate-900 dark:text-white">
                          <span className="text-cyan-600 mr-1.5">{log.method}</span>
                          {log.route_path}
                        </td>
                        <td className="py-2 px-4 text-slate-400">{log.key_prefix || 'none'}</td>
                        <td className="py-2 px-4">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${
                              log.status < 300
                                ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/60'
                                : log.status === 429
                                ? 'text-rose-600 bg-rose-50 dark:bg-rose-950/60'
                                : 'text-amber-600 bg-amber-50 dark:bg-amber-950/60'
                            }`}
                          >
                            {log.status}
                          </span>
                        </td>
                        <td className="py-2 px-4 text-slate-500">{log.latency_ms}ms</td>
                        <td className="py-2 px-4">
                          {log.cache_hit ? (
                            <span className="text-cyan-600 font-semibold">HIT</span>
                          ) : (
                            <span className="text-slate-400">MISS</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
