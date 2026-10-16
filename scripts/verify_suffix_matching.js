/**
 * Measure the NEW "same ending" pairing rule against live data (READ-ONLY).
 *
 * Compares three generations of the algorithm on the same rows:
 *   OLD  — strict equality            (tracking_number == tracking_number)
 *   v1   — exact + substring          (previous tolerant matcher)
 *   v2   — exact + SAME ENDING + substring  (current: suffix rule added)
 *
 * Direction = warehouse scan time: INPUT is the parcel's scanned code, STORED
 * is the number the client registered. That is how a parcel finds its owner.
 */
require('dotenv').config();
const https = require('https');
const {
  buildTrackingCandidates, buildTrackingContains, buildTrackingSuffixes, normalizeTracking,
} = require('../src/utils/tracking');

const URL_BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_KEY;

const get = (p) =>
  new Promise((resolve) => {
    const u = new URL(URL_BASE + p);
    const req = https.request(
      { hostname: u.hostname, port: 443, path: u.pathname + u.search, method: 'GET',
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: 'application/json', Range: '0-9999' },
        timeout: 30000 },
      (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, body: d })); }
    );
    req.on('error', (e) => resolve({ status: 0, body: 'ERR ' + e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: 'TIMEOUT' }); });
    req.end();
  });
const j = (s) => { try { return JSON.parse(s); } catch { return null; } };

const oldRule = (input, stored) => String(input) === String(stored);

const v1Rule = (input, stored) => {
  const raw = String(stored ?? '');
  if (buildTrackingCandidates(input).includes(raw)) return true;
  const sn = normalizeTracking(raw);
  return buildTrackingContains(input).some((n) => n.length >= 8 && sn.includes(n));
};

const v2Rule = (input, stored) => {
  if (v1Rule(input, stored)) return true;
  const sn = normalizeTracking(stored);
  return buildTrackingSuffixes(input).some((s) => s.length >= 8 && sn.endsWith(s));
};

(async () => {
  const parcels = j((await get('/rest/v1/parcels?select=id,tracking_number,customer_id&limit=10000')).body) || [];
  const regs = j((await get('/rest/v1/tracking_numbers?select=id,tracking_number,customer_id,is_linked&limit=10000')).body) || [];

  console.log(`parcels=${parcels.length}  registrations=${regs.length}\n`);

  const orphans = parcels.filter((p) => !p.customer_id);
  const unlinked = regs.filter((r) => !r.is_linked);

  const count = (rule) => orphans.filter((p) => regs.some((r) => rule(p.tracking_number, r.tracking_number))).length;
  const countUnlinked = (rule) => unlinked.filter((r) => parcels.some((p) => rule(p.tracking_number, r.tracking_number))).length;

  console.log('=== A. Посылки без клиента, которые найдут своего владельца ===');
  console.log(`  OLD (строгое равенство) : ${count(oldRule)}`);
  console.log(`  v1  (exact+подстрока)   : ${count(v1Rule)}`);
  console.log(`  v2  (+ СОВПАДЕНИЕ ОКОНЧАНИЙ): ${count(v2Rule)}   <-- новый алгоритм`);

  console.log('\n=== B. Незалинкованные регистрации, которые найдут посылку ===');
  console.log(`  OLD : ${countUnlinked(oldRule)}`);
  console.log(`  v1  : ${countUnlinked(v1Rule)}`);
  console.log(`  v2  : ${countUnlinked(v2Rule)}`);

  // What the suffix rule adds beyond v1
  console.log('\n=== C. Что добавляет именно правило окончаний (новые пары) ===');
  let added = 0;
  for (const p of orphans) {
    const before = regs.some((r) => v1Rule(p.tracking_number, r.tracking_number));
    const after = regs.some((r) => v2Rule(p.tracking_number, r.tracking_number));
    if (!before && after) {
      const hit = regs.find((r) => v2Rule(p.tracking_number, r.tracking_number));
      if (added < 15) console.log(`  parcel ${p.tracking_number}\n    -> reg ${hit.tracking_number}`);
      added++;
    }
  }
  console.log(`  Итого новых пар за счёт окончаний: ${added}`);

  // Safety: do the two rules ever disagree on the SAME pair in a dangerous way?
  console.log('\n=== D. Проверка ложных срабатываний окончаний ===');
  let fp = 0;
  for (const p of parcels) {
    for (const r of regs) {
      if (!v2Rule(p.tracking_number, r.tracking_number)) continue;
      if (v1Rule(p.tracking_number, r.tracking_number)) continue;
      const pn = normalizeTracking(p.tracking_number), rn = normalizeTracking(r.tracking_number);
      // a suffix match should mean the shorter value is a genuine tail of the longer
      const [sh, lg] = pn.length <= rn.length ? [pn, rn] : [rn, pn];
      if (!lg.endsWith(sh)) { fp++; if (fp <= 10) console.log(`  suspicious: ${pn}  vs  ${rn}`); }
    }
  }
  console.log(`  Подозрительных пар: ${fp}`);
})();
