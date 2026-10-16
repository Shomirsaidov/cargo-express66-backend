/**
 * End-to-end test of the REAL service functions against the live database.
 *
 * Unlike the other scripts, this does not re-implement the matching predicate —
 * it calls parcelService.findParcelByTracking / findPreRegisteredTracking, so it
 * proves the actual shipped code path works, including the graceful fallback
 * when `tracking_number_tail` does not exist yet.
 *
 * READ-ONLY.
 */
require('dotenv').config();
const parcelService = require('../src/services/parcelService');

const cases = [
  // [label, value to look up, expect to find something]
  ['user example: short client vs prefixed scan', 'XX52325236', false],
  ['client 12-digit inside long parcel', '534514656376', true],
  ['client 22-digit inside long parcel', '9400108106244565934324', true],
  ['client 12-digit, parcel 34-digit', '543652641761', true],
  ['exact 34-digit', '9632080400572820920200542404600389', true],
  ['multi-number stored value', '1LSCZ3N00069963', true],
];

(async () => {
  for (const [label, value, expect] of cases) {
    let parcel = null, reg = null, err = null;
    try {
      parcel = await parcelService.findParcelByTracking(value, 'id, tracking_number, customer_id');
      reg = await parcelService.findPreRegisteredTracking(value);
    } catch (e) {
      err = e;
    }

    const found = !!(parcel || reg);
    const mark = err ? 'ERROR' : found === expect ? 'PASS ' : expect ? 'MISS ' : 'NOTE ';
    console.log(`${mark} ${label}`);
    console.log(`       input   : ${value}`);
    console.log(`       parcel  : ${parcel ? parcel.tracking_number + (parcel.customer_id ? ' [linked]' : ' [orphan]') : '—'}`);
    console.log(`       pre-reg : ${reg ? reg.tracking_number + ' -> customer ' + (reg.customer_id || '—') : '—'}`);
    if (err) console.log(`       error   : ${err.message}`);
    console.log('');
  }

  console.log('If "pre-reg" rows show up above, the scan→client pairing now works');
  console.log('for numbers whose beginnings differ but whose endings agree.');
})();
