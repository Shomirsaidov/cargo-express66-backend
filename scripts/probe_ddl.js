/**
 * Probe: can we execute arbitrary SQL (DDL) against the remote Supabase project
 * using only the service-role key?
 *
 * We try, in order:
 *   1. POST {url}/pg/query                  (legacy pg-meta endpoint)
 *   2. POST {url}/pg-meta/default/query     (newer pg-meta path)
 *   3. POST {url}/rest/v1/rpc/exec_sql      (in case a helper function exists)
 *   4. POST {url}/rest/v1/rpc/exec           (ditto)
 *   5. GET  {url}/rest/v1/rpc/...  list     (what RPCs actually exist)
 *
 * READ-ONLY with respect to data: the probe query is `select 1 as ok`.
 */
require('dotenv').config();
const https = require('https');

const URL_BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_KEY;

if (!URL_BASE || !KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const request = (method, path, body) =>
  new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const u = new URL(URL_BASE + path);
    const req = https.request(
      {
        hostname: u.hostname,
        port: 443,
        path: u.pathname + u.search,
        method,
        headers: Object.assign(
          {
            apikey: KEY,
            Authorization: `Bearer ${KEY}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}
        ),
        timeout: 20000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () =>
          resolve({ status: res.statusCode, body: data.slice(0, 600) })
        );
      }
    );
    req.on('error', (e) => resolve({ status: 0, body: 'ERR ' + e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: 'TIMEOUT' }); });
    if (payload) req.write(payload);
    req.end();
  });

(async () => {
  const attempts = [
    ['POST', '/pg/query', { query: 'select 1 as ok' }],
    ['POST', '/pg-meta/default/query', { query: 'select 1 as ok' }],
    ['POST', '/rest/v1/rpc/exec_sql', { sql: 'select 1 as ok' }],
    ['POST', '/rest/v1/rpc/exec', { sql: 'select 1 as ok' }],
    ['POST', '/rest/v1/rpc/execute_sql', { query: 'select 1 as ok' }],
  ];

  console.log('Probing DDL-capable endpoints on', URL_BASE);
  console.log('');

  for (const [m, p, b] of attempts) {
    const r = await request(m, p, b);
    const verdict =
      r.status === 200 || r.status === 201
        ? '*** WORKS ***'
        : r.status === 404
        ? 'not found'
        : r.status === 401 || r.status === 403
        ? 'exists but denied'
        : 'other';
    console.log(`${m} ${p}\n   -> ${r.status} (${verdict})\n   ${r.body.replace(/\s+/g, ' ').slice(0, 300)}\n`);
  }
})();
