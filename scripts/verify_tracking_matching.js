/**
 * Read-only verification of the new tracking-number matching against LIVE data.
 *
 * Replays the exact predicate used by parcelService.findFirstByTracking:
 *   1. exact match against any canonical candidate of the input
 *   2. substring match (input shorter than the stored value)
 *
 * Reports:
 *   - how many orphan parcels (customer_id IS NULL) would now resolve to a client
 *   - how many registered numbers would now find their parcel
 *   - the reverse direction (stored shorter than input) — to see if it matters
 *
 * Run:  node scripts/verify_tracking_matching.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const { buildTrackingCandidates, buildTrackingContains, normalizeTracking } = require('../src/utils/tracking');

const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const read = (key) => {
  const match = env.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return match ? match[1].trim().replace(/^"|"$/g, '') : null;
};

const URL = read('SUPABASE_URL');
const KEY = read('SUPABASE_SERVICE_KEY');
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const fetchAll = async (table, select) => {
  const res = await fetch(`${URL}/rest/v1/${table}?select=${select}&limit=5000`, { headers });
  if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
};

/** Same predicate as the backend, given an input value and a stored value. */
const matches = (input, stored) => {
  if (!input || !stored) return false;
  const normStored = normalizeTracking(stored);
  if (!normStored) return false;

  // 1) exact against candidates of the input
  if (buildTrackingCandidates(input).includes(normStored)) return true;
  // also raw comparison (stored may contain separators)
  if (String(input).trim() === String(stored).trim()) return true;

  // 2) substring: input is contained in the (longer) stored value
  for (const needle of buildTrackingContains(input)) {
    if (normStored.includes(needle)) return true;
  }
  return false;
};

(async () => {
  const parcels = await fetchAll('parcels', 'id,tracking_number,customer_id,status');
  const tracks = await fetchAll('tracking_numbers', 'id,tracking_number,customer_id,is_linked');
  console.log(`parcels: ${parcels.length}, tracking_numbers: ${tracks.length}\n`);

  // ── Direction A: warehouse scan (long) → client's registered number (short) ──
  const resolvable = [];
  for (const p of parcels) {
    if (p.customer_id) continue; // already assigned
    const hit = tracks.find((t) => matches(p.tracking_number, t.tracking_number));
    if (hit) resolvable.push({ parcel: p, track: hit });
  }

  console.log(`A) Orphan parcels that would now resolve to a client: ${resolvable.length}`);
  const byCustomer = new Map();
  for (const r of resolvable) {
    byCustomer.set(r.track.customer_id, (byCustomer.get(r.track.customer_id) || 0) + 1);
  }
  console.log(`   distinct clients affected: ${byCustomer.size}`);
  for (const r of resolvable.slice(0, 25)) {
    console.log(`   parcel ${String(r.parcel.tracking_number).slice(0, 40).padEnd(42)} len=${String(r.parcel.tracking_number).length}  <-  client ${r.track.tracking_number}`);
  }

  // ── Direction B: client's number (short) → parcel stored longer ──
  const unlinked = tracks.filter((t) => !t.is_linked);
  const nowFindable = [];
  for (const t of unlinked) {
    const hit = parcels.find((p) => matches(t.tracking_number, p.tracking_number));
    if (hit) nowFindable.push({ track: t, parcel: hit });
  }
  console.log(`\nB) Unlinked registered numbers that would now find a parcel: ${nowFindable.length} of ${unlinked.length}`);
  for (const r of nowFindable.slice(0, 15)) {
    console.log(`   client ${String(r.track.tracking_number).padEnd(26)} -> parcel ${String(r.parcel.tracking_number).slice(0, 40)}`);
  }

  // ── Direction C: reverse (stored shorter than the input) ──
  let reverseCases = 0;
  const reverseSamples = [];
  for (const p of parcels) {
    const np = normalizeTracking(p.tracking_number);
    for (const t of tracks) {
      const nt = normalizeTracking(t.tracking_number);
      if (!np || !nt || np === nt) continue;
      if (nt.length < np.length && np.length >= 8 && np.includes(nt)) {
        reverseCases++;
        if (reverseSamples.length < 10) reverseSamples.push(`${p.tracking_number} (${np.length})  contains  ${t.tracking_number} (${nt.length})`);
      }
    }
  }
  console.log(`\nC) Reverse direction (stored shorter, contained in a longer value): ${reverseCases} pair(s)`);
  for (const s of reverseSamples) console.log(`   ${s}`);

  // ── Direction D: still-orphan parcels (no client registration at all) ──
  const resolvedIds = new Set(resolvable.map((r) => r.parcel.id));
  const stillOrphan = parcels.filter((p) => !p.customer_id && !resolvedIds.has(p.id));
  console.log(`\nD) Parcels that stay orphan (no matching registration): ${stillOrphan.length}`);
  const lenHist = new Map();
  for (const p of stillOrphan) {
    const len = String(p.tracking_number).length;
    lenHist.set(len, (lenHist.get(len) || 0) + 1);
  }
  console.log('   lengths:', JSON.stringify([...lenHist.entries()].sort((a, b) => a[0] - b[0])));
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
