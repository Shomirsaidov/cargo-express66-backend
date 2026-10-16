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

module.exports = {
  normalizeTracking,
  digitsOnly,
  buildTrackingCandidates,
  buildTrackingContains,
  TRACKING_LENGTHS,
};
