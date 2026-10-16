/**
 * READ-ONLY orphan-parcel analysis (corrected).
 *
 * Answers one question precisely: for the parcels that have no customer, WHY?
 *
 * Direction matters. When the warehouse scans a parcel the app calls
 * findPreRegisteredTracking(scan) — i.e. INPUT = parcel scan, STORED = the
 * client's registered number. So we evaluate the predicate in that direction.
 *
 * Categories:
 *   LINKABLE  – a registration matches today (historical rows, fixable by backfill)
 *   CORE      – the parcel code embeds a registered number (>=12 digits) but the
 *               predicate missed it  ==> would be a real matcher bug
 *   NO_REG    – no registration relates to this parcel at all (needs manual work)
 */
require('dotenv').config();
const https = require('https');
const fs = require('fs');
const path = require('path');
const { buildTrackingCandidates, buildTrackingContains, normalizeTracking, digitsOnly, trackingMatches } =
  require('../src/utils/tracking');

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

/**
 * The matching rule now lives in ONE place — `trackingMatches` in
 * src/utils/tracking.js — and mirrors parcelService.findFirstByTracking exactly:
 *   1. exact, 2. SAME ENDING (the main rule), 3. contains.
 */
const predicate = trackingMatches;

(async () => {
  const parcels = j((await get('/rest/v1/parcels?select=id,tracking_number,customer_id,status,created_at&limit=10000')).body) || [];
  const regs = j((await get('/rest/v1/tracking_numbers?select=id,tracking_number,customer_id,is_linked&limit=10000')).body) || [];

  const orphans = parcels.filter((p) => !p.customer_id);
  console.log(`parcels=${parcels.length}  registrations=${regs.length}  orphans=${orphans.length}\n`);

  const LINKABLE = [], CORE = [], NO_REG = [];

  for (const p of orphans) {
    const pNorm = normalizeTracking(p.tracking_number);
    const pDigits = digitsOnly(p.tracking_number);

    const hit = regs.find((r) => predicate(p.tracking_number, r.tracking_number));
    if (hit) { LINKABLE.push({ p, hit }); continue; }

    // Independent safety net: is a registered number embedded in the parcel code?
    const core = regs.find((r) => {
      const rd = digitsOnly(r.tracking_number);
      return rd.length >= 12 && pDigits.includes(rd);
    });
    if (core) { CORE.push({ p, core }); continue; }

    NO_REG.push({ p });
  }

  console.log(`LINKABLE (совпадение есть, строка историческая) : ${LINKABLE.length}`);
  console.log(`CORE     (номер клиента внутри кода, матчер промахнулся): ${CORE.length}`);
  console.log(`NO_REG   (регистрации нет вообще)                : ${NO_REG.length}`);

  if (CORE.length) {
    console.log('\n!! CORE > 0 — это реальный баг матчера:');
    for (const { p, core } of CORE.slice(0, 10))
      console.log(`   parcel "${p.tracking_number}"  embeds  "${core.tracking_number}"`);
  } else {
    console.log('\nOK: матчер не пропускает ни одного случая, где номер клиента вложен в код посылки.');
  }

  console.log('\n--- LINKABLE (привяжутся автоматически после фикса) ---');
  for (const { p, hit } of LINKABLE)
    console.log(`   parcel ${p.tracking_number}\n     -> reg ${hit.tracking_number} (linked=${hit.is_linked})`);

  const shape = (s) => {
    const n = normalizeTracking(s);
    if (/^1Z/.test(n)) return 'UPS 1Z';
    if (/^TBA/.test(n)) return 'Amazon TBA';
    if (/^[0-9]{34}$/.test(n)) return 'USPS/FedEx 34-digit (prefix+IMpb)';
    if (/^[0-9]{22}$/.test(n)) return 'USPS IMpb 22';
    if (/^[0-9]{20}$/.test(n)) return 'FedEx SmartPost 20';
    if (/^[0-9]{15}$/.test(n)) return 'FedEx Ground 15';
    if (/^[0-9]{12}$/.test(n)) return 'FedEx Express 12';
    if (/^[A-Z0-9]{15}$/.test(n)) return 'TBA-ish 15';
    return `other (${n.length})`;
  };

  const hist = {};
  for (const { p } of NO_REG) {
    const k = shape(p.tracking_number);
    hist[k] = (hist[k] || 0) + 1;
  }
  console.log('\n--- NO_REG по форматам ---');
  Object.entries(hist).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`   ${String(v).padStart(4)}  ${k}`));

  // CSV
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = ['category,parcel_id,tracking_number,status,created_at,hint'];
  for (const { p, hit } of LINKABLE) lines.push(['LINKABLE', p.id, p.tracking_number, p.status, p.created_at, `= ${hit.tracking_number}`].map(esc).join(','));
  for (const { p, core } of CORE) lines.push(['CORE_BUG', p.id, p.tracking_number, p.status, p.created_at, `embeds ${core.tracking_number}`].map(esc).join(','));
  for (const { p } of NO_REG) lines.push(['NO_REG', p.id, p.tracking_number, p.status, p.created_at, 'нет регистрации — привязать вручную'].map(esc).join(','));

  const out = path.join(__dirname, 'orphans_report.csv');
  fs.writeFileSync(out, lines.join('\n'), 'utf8');
  console.log(`\nCSV: ${out} (${lines.length - 1} строк)`);
})();
