/**
 * Tracking-number helpers.
 *
 * Carriers (FedEx, UPS, DHL …) print several barcodes on a single label. The
 * barcode the warehouse scanner reads frequently carries MORE characters than
 * the "public" tracking number the customer types into the portal
 * (FedEx Express = 12 digits, FedEx Ground = 15, SmartPost = 20–22).
 *
 * Because the app matched tracking numbers with strict equality, a 12-digit
 * customer value and a 16–17 digit scanned value never found each other.
 * We now compare a small set of canonical candidates instead.
 */

/** Strip every non-alphanumeric character and uppercase the rest. */
const normalizeTracking = (value) => String(value ?? '')
  .toUpperCase()
  .replace(/[^A-Z0-9]/g, '');

/** Keep digits only. */
const digitsOnly = (value) => String(value ?? '').replace(/\D/g, '');

/** Public tracking-number lengths used by major carriers. */
const TRACKING_LENGTHS = [12, 15, 20, 22];

/** Anything longer than this is not a tracking number — skip windowing. */
const MAX_SCAN_LENGTH = 40;

/**
 * Build every plausible spelling of a tracking number so that a short value and
 * a longer scanned value can still be matched:
 *
 *   "99794512345678"  ->  [..., "99794512345678", "794512345678", ...]
 *
 * A label barcode can carry extra digits before, after, or on both sides of the
 * public number, so for every known carrier length we add the leading slice, the
 * trailing slice, and every window in between.
 */
const buildTrackingCandidates = (value) => {
  const raw = String(value ?? '').trim();
  const norm = normalizeTracking(raw);
  const digits = digitsOnly(raw);

  const out = new Set();
  if (raw) out.add(raw);
  if (norm) out.add(norm);
  if (digits) out.add(digits);

  for (const source of [digits, norm]) {
    if (!source || source.length > MAX_SCAN_LENGTH) continue;
    for (const len of TRACKING_LENGTHS) {
      if (source.length <= len) continue;
      out.add(source.slice(0, len));
      out.add(source.slice(-len));
      for (let i = 1; i + len <= source.length; i++) {
        out.add(source.slice(i, i + len));
      }
    }
  }

  out.delete('');
  return Array.from(out);
};

/**
 * Canonical "needle" values for substring matching. Used when the STORED value
 * is longer than what the user typed — e.g. the customer enters the public
 * 12-digit FedEx number while the warehouse stored a 16–17 digit scan.
 */
const buildTrackingContains = (value) => {
  const norm = normalizeTracking(value);
  const digits = digitsOnly(value);

  const out = new Set();
  if (norm.length >= 8) out.add(norm);
  if (digits.length >= 8 && digits !== norm) out.add(digits);
  return Array.from(out);
};

/**
 * Suffixes for the "same ending" rule.
 *
 * The warehouse scanner routinely picks up EXTRA leading characters (routing
 * prefix, zip, barcode padding) that the customer's own record does not have,
 * so comparing whole strings fails even though the tail is identical:
 *
 *   client record   534514656376
 *   scanned value   9632080400677914238600534514656376
 *                   └──────────── same ending ────────┘
 *
 * We therefore compare only the trailing characters. Every carrier length is
 * emitted so the caller can look for the longest (most specific) tail first.
 * A value shorter than the smallest carrier length is used as-is: it *is* the
 * tail.
 */
const SUFFIX_LENGTHS = [12, 15, 20, 22];

const buildTrackingSuffixes = (value) => {
  const norm = normalizeTracking(value);
  const digits = digitsOnly(value);

  const out = new Set();
  for (const source of [norm, digits]) {
    if (!source) continue;
    if (source.length <= SUFFIX_LENGTHS[0]) {
      out.add(source);
      continue;
    }
    for (const len of SUFFIX_LENGTHS) {
      if (source.length >= len) out.add(source.slice(-len));
    }
  }

  out.delete('');
  // Longest first → most specific tail wins.
  return Array.from(out).sort((a, b) => b.length - a.length);
};

/**
 * The single canonical 12-character ending.
 *
 * Mirrors the SQL expression `right(normalize_tracking_code(tracking_number), 12)`
 * so that, once the migration adds an indexed `tracking_number_tail` column, the
 * "same ending" rule can be answered with an index lookup instead of a full scan.
 * A value shorter than 12 characters is its own tail.
 */
const TAIL_LENGTH = 12;

const trackingTail = (value) => {
  const norm = normalizeTracking(value);
  return norm.length <= TAIL_LENGTH ? norm : norm.slice(-TAIL_LENGTH);
};

/**
 * Pure-JS mirror of the rule set used by `parcelService.findFirstByTracking`.
 *
 * Scripts and tests evaluate candidate pairs locally, so they need the same
 * logic without hitting the database. Keeping it here means the rule lives in
 * exactly one place and cannot silently drift from the SQL-side query.
 *
 *   1. EXACT       — stored value equals one of the input's candidate spellings
 *   2. SAME ENDING — stored value ends with the input's tail (the main rule)
 *   3. CONTAINS    — stored value merely contains the input (loosest)
 */
const trackingMatches = (input, stored) => {
  const raw = String(stored ?? '');
  if (!raw) return false;

  // 1) exact
  if (buildTrackingCandidates(input).includes(raw)) return true;

  const norm = normalizeTracking(raw);

  // 2) same ending
  const tail = trackingTail(input);
  if (tail.length >= 8 && norm.endsWith(tail)) return true;
  for (const suffix of buildTrackingSuffixes(input)) {
    if (suffix.length >= 8 && norm.endsWith(suffix)) return true;
  }

  // 3) contains
  for (const needle of buildTrackingContains(input)) {
    if (needle.length >= 8 && norm.includes(needle)) return true;
  }

  return false;
};

module.exports = {
  normalizeTracking,
  digitsOnly,
  buildTrackingCandidates,
  buildTrackingContains,
  buildTrackingSuffixes,
  trackingTail,
  trackingMatches,
  TRACKING_LENGTHS,
  SUFFIX_LENGTHS,
  TAIL_LENGTH,
};
