/**
 * Read-only inspection of the live Supabase project.
 *
 * Uses PostgREST (service role key) to dump:
 *   - the real column types / lengths for tracking-related columns
 *   - whether `tracking_number_norm` (migration_tracking_fix.sql) is applied
 *   - which RPC functions exist (to know if DDL can be executed remotely)
 *
 * Run:  node scripts/inspect_supabase.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
const env = fs.readFileSync(envPath, 'utf8');
const read = (key) => {
  const match = env.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return match ? match[1].trim().replace(/^"|"$/g, '') : null;
};

const URL = read('SUPABASE_URL');
const KEY = read('SUPABASE_SERVICE_KEY');

if (!URL || !KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY in .env');
  process.exit(1);
}

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };

(async () => {
  console.log('Project:', URL);

  // ── 1. OpenAPI spec → real schema ────────────────────────────────────────
  const specRes = await fetch(`${URL}/rest/v1/`, { headers });
  console.log('OpenAPI status:', specRes.status);
  const spec = await specRes.json();
  const defs = spec.definitions || {};

  const TABLES = ['parcels', 'tracking_numbers', 'settings', 'cms_pages', 'customers', 'warehouses'];
  for (const table of TABLES) {
    const def = defs[table];
    if (!def) {
      console.log(`\n[${table}] NOT FOUND in schema`);
      continue;
    }
    console.log(`\n[${table}]`);
    for (const [col, meta] of Object.entries(def.properties || {})) {
      const type = meta.format || meta.type;
      const maxLen = meta.maxLength ? ` maxLength=${meta.maxLength}` : '';
      if (/tracking|key|slug|value|status|country|phone|address|email|name/i.test(col)) {
        console.log(`  ${col.padEnd(28)} ${type}${maxLen}`);
      }
    }
  }

  // ── 2. RPC functions available ──────────────────────────────────────────
  const rpcPaths = Object.keys(spec.paths || {}).filter((p) => p.startsWith('/rpc/'));
  console.log('\n[RPC functions]', rpcPaths.length ? rpcPaths.join(', ') : '(none)');

  // ── 3. Live data lengths ────────────────────────────────────────────────
  const fetchAll = async (table, select) => {
    const res = await fetch(`${URL}/rest/v1/${table}?select=${select}&limit=2000`, { headers });
    if (!res.ok) {
      console.log(`  ! ${table} -> HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return [];
    }
    return res.json();
  };

  const parcels = await fetchAll('parcels', 'id,tracking_number,customer_id,status,created_at');
  const tracks = await fetchAll('tracking_numbers', 'id,tracking_number,customer_id,is_linked');

  const histogram = (rows) => {
    const map = new Map();
    for (const r of rows) {
      const len = (r.tracking_number || '').length;
      map.set(len, (map.get(len) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  };

  console.log('\n[parcels] rows:', parcels.length, 'lengths:', JSON.stringify(histogram(parcels)));
  console.log('[tracking_numbers] rows:', tracks.length, 'lengths:', JSON.stringify(histogram(tracks)));

  console.log('\n[parcels] samples:');
  for (const p of parcels.slice(0, 15)) {
    console.log(`  ${String(p.tracking_number).padEnd(24)} len=${String(p.tracking_number).length} status=${p.status} customer=${p.customer_id ? 'yes' : 'NULL'}`);
  }
  console.log('\n[tracking_numbers] samples:');
  for (const t of tracks.slice(0, 15)) {
    console.log(`  ${String(t.tracking_number).padEnd(24)} len=${String(t.tracking_number).length} linked=${t.is_linked}`);
  }

  // ── 4. Cross-match: does a short client number sit inside a long scan? ──
  const digits = (v) => String(v || '').replace(/\D/g, '');
  const mismatches = [];
  for (const p of parcels) {
    for (const t of tracks) {
      if (p.tracking_number === t.tracking_number) continue;
      const a = digits(p.tracking_number);
      const b = digits(t.tracking_number);
      if (!a || !b || a.length === b.length) continue;
      const short = a.length < b.length ? a : b;
      const long = a.length < b.length ? b : a;
      if (short.length >= 8 && long.includes(short)) {
        mismatches.push({ parcel: p.tracking_number, client: t.tracking_number, short, long, parcel_customer: p.customer_id, tn_customer: t.customer_id });
      }
    }
  }
  console.log('\n[potential matches]  short number is a substring of the long one:', mismatches.length);
  for (const m of mismatches.slice(0, 20)) {
    console.log(`  parcel=${m.parcel} (len ${m.long.length})  ~  client=${m.client} (len ${m.short.length})`);
  }

  // ── 5. Orphan parcels (no customer) ─────────────────────────────────────
  const orphans = parcels.filter((p) => !p.customer_id);
  console.log('\n[parcels without customer]:', orphans.length);
  for (const p of orphans.slice(0, 15)) {
    console.log(`  ${String(p.tracking_number).padEnd(24)} len=${String(p.tracking_number).length} status=${p.status}`);
  }

  // ── 6. Settings rows (for the site-content part) ────────────────────────
  const settings = await fetchAll('settings', 'key,value,description');
  console.log('\n[settings] rows:', settings.length);
  for (const s of settings) {
    console.log(`  ${String(s.key).padEnd(20)} ${String(s.value).slice(0, 60).replace(/\s+/g, ' ')}`);
  }
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
