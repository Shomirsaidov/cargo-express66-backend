/**
 * Backfill: link historical orphan parcels to the customer who registered them.
 *
 * WHY: these parcels were created before the tolerant matcher existed, so the
 * registration and the parcel never met. The matcher would link them today, but
 * the parcels are already `arrived_in_dushanbe`, so no new scan will ever happen.
 *
 * SAFETY:
 *   - DRY RUN by default. Nothing is written unless you pass --apply.
 *   - Touches only `parcels.customer_id` and `tracking_numbers.is_linked`.
 *     Status, costs and status-history are left untouched, so no notifications fire.
 *   - Rows whose stored value holds SEVERAL numbers are skipped: the parts may
 *     belong to different customers, so a human must decide.
 *
 * Usage:
 *   node scripts/backfill_orphan_links.js           # show the diff
 *   node scripts/backfill_orphan_links.js --apply   # write it
 */
require('dotenv').config();
const https = require('https');
const { buildTrackingCandidates, buildTrackingContains, normalizeTracking } =
  require('../src/utils/tracking');

const APPLY = process.argv.includes('--apply');
const URL_BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_KEY;

const call = (method, p, body) =>
  new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const u = new URL(URL_BASE + p);
    const req = https.request(
      { hostname: u.hostname, port: 443, path: u.pathname + u.search, method,
        headers: Object.assign(
          { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' },
          payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}
        ),
        timeout: 30000 },
      (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, body: d })); }
    );
    req.on('error', (e) => resolve({ status: 0, body: 'ERR ' + e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: 'TIMEOUT' }); });
    if (payload) req.write(payload);
    req.end();
  });

const j = (s) => { try { return JSON.parse(s); } catch { return null; } };

const predicate = (input, stored) => {
  const raw = String(stored ?? '');
  if (buildTrackingCandidates(input).includes(raw)) return true;
  const storedNorm = normalizeTracking(raw);
  for (const needle of buildTrackingContains(input)) {
    if (needle.length < 8) continue;
    if (storedNorm.includes(needle)) return true;
  }
  return false;
};

/** A stored value with a separator, or an absurdly long code, holds >1 number. */
const isAmbiguous = (v) => /[,;/|]/.test(String(v ?? '')) || normalizeTracking(v).length > 34;

(async () => {
  const parcels = j((await call('GET', '/rest/v1/parcels?select=id,tracking_number,customer_id,status&limit=10000')).body) || [];
  const regs = j((await call('GET', '/rest/v1/tracking_numbers?select=id,tracking_number,customer_id,is_linked&limit=10000')).body) || [];

  const plan = [], skipped = [];

  for (const p of parcels.filter((x) => !x.customer_id)) {
    const hit = regs.find((r) => predicate(p.tracking_number, r.tracking_number));
    if (!hit) continue;
    if (!hit.customer_id) { skipped.push({ p, hit, why: 'у регистрации нет customer_id' }); continue; }
    if (isAmbiguous(p.tracking_number)) { skipped.push({ p, hit, why: 'в строке несколько номеров — проверить вручную' }); continue; }
    plan.push({ parcel: p, reg: hit });
  }

  console.log(APPLY ? '=== APPLY MODE ===\n' : '=== DRY RUN (ничего не записывается) ===\n');
  console.log(`К привязке: ${plan.length}\n`);

  for (const { parcel, reg } of plan) {
    console.log(`  parcel ${parcel.id}`);
    console.log(`    код    : ${parcel.tracking_number}   [${parcel.status}]`);
    console.log(`    клиент : ${reg.customer_id}`);
    console.log(`    по рег.: ${reg.tracking_number}  (is_linked=${reg.is_linked})`);
    console.log(`    -> customer_id + is_linked=true  (статус НЕ меняем)\n`);
  }

  if (skipped.length) {
    console.log(`Пропущено (нужен человек): ${skipped.length}`);
    for (const { p, hit, why } of skipped) console.log(`  ${p.tracking_number}  <-  ${hit.tracking_number}   (${why})`);
    console.log('');
  }

  if (!APPLY) {
    console.log('Это был dry run. Для записи: node scripts/backfill_orphan_links.js --apply');
    return;
  }

  let ok = 0, fail = 0;
  for (const { parcel, reg } of plan) {
    const r1 = await call('PATCH', `/rest/v1/parcels?id=eq.${parcel.id}`, { customer_id: reg.customer_id });
    const r2 = await call('PATCH', `/rest/v1/tracking_numbers?id=eq.${reg.id}`, { is_linked: true });
    const good = (r1.status === 200 || r1.status === 204) && (r2.status === 200 || r2.status === 204);
    if (good) { ok++; console.log(`  OK   ${parcel.tracking_number}`); }
    else { fail++; console.log(`  FAIL ${parcel.tracking_number}  parcels=${r1.status} regs=${r2.status} ${r1.body.slice(0, 120)}`); }
  }
  console.log(`\nГотово: ${ok} привязано, ${fail} ошибок.`);
})();
