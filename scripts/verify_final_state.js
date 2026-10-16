/**
 * Final live-state verification (READ-ONLY).
 *  1. Confirm site_* CMS settings are present and parseable.
 *  2. Confirm whether tracking_number_norm exists yet (migration applied or not).
 *  3. Report column types of tracking_number in both tables.
 */
require('dotenv').config();
const https = require('https');

const URL_BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_KEY;

const get = (path) =>
  new Promise((resolve) => {
    const u = new URL(URL_BASE + path);
    const req = https.request(
      { hostname: u.hostname, port: 443, path: u.pathname + u.search, method: 'GET',
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: 'application/json' },
        timeout: 20000 },
      (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, body: d })); }
    );
    req.on('error', (e) => resolve({ status: 0, body: 'ERR ' + e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: 'TIMEOUT' }); });
    req.end();
  });

const safeJson = (s) => { try { return JSON.parse(s); } catch { return null; } };

(async () => {
  console.log('=== 1. CMS settings ===');
  const r1 = await get('/rest/v1/settings?select=key,value&order=key.asc');
  const rows = safeJson(r1.body) || [];
  const cms = rows.filter((r) => r.key.startsWith('site_'));
  console.log(`total settings rows: ${rows.length}`);
  console.log(`site_* rows: ${cms.length}`);
  for (const r of cms) {
    let shape = 'raw-string';
    const v = String(r.value ?? '');
    if (v.trim().startsWith('{')) { const p = safeJson(v); shape = p ? `object(${Object.keys(p).length} keys)` : 'BROKEN JSON'; }
    else if (v.trim().startsWith('[')) { const p = safeJson(v); shape = p ? `array(${p.length} items)` : 'BROKEN JSON'; }
    console.log(`  ${r.key.padEnd(16)} ${String(v.length).padStart(5)} B  ${shape}`);
  }

  console.log('\n=== 2. tracking_number_norm column ===');
  for (const t of ['parcels', 'tracking_numbers']) {
    const r = await get(`/rest/v1/${t}?select=tracking_number_norm&limit=1`);
    const exists = r.status === 200;
    console.log(`  ${t.padEnd(18)} tracking_number_norm: ${exists ? 'EXISTS' : 'NOT PRESENT (migration pending)'}   [HTTP ${r.status}]`);
  }

  console.log('\n=== 3. row counts ===');
  for (const t of ['parcels', 'tracking_numbers', 'settings', 'customers']) {
    const r = await get(`/rest/v1/${t}?select=id&limit=1`);
    const hdr = r.status;
    const cr = await get(`/rest/v1/${t}?select=*&limit=1`);
    console.log(`  ${t.padEnd(18)} reachable: ${hdr === 200 ? 'yes' : 'no'} (HTTP ${hdr})`);
  }
})();
