const { supabaseAdmin } = require('../config/supabase');
const { uploadToCloudinary } = require('../utils/cloudinaryUtils');
const notificationService = require('./notificationService');
const { filterPayload } = require('../utils/schema');
const { buildTrackingCandidates, buildTrackingContains, buildTrackingSuffixes, trackingTail } = require('../utils/tracking');

const DEFAULT_PARCEL_TRACKING_SELECT = `*,
  customers(id, customer_code, first_name, last_name, email, phone),
  warehouses(id, name, country)`;

const TRACKING_RECORD_SELECT = '*, customers(*)';

// `tracking_number_norm` / `tracking_number_tail` only exist after
// migration_tracking_fix.sql. We probe each once and remember the answer so we
// don't repeat failing queries.
let trackingNormColumnSupported = null;
let trackingTailColumnSupported = null;

/**
 * Fetch the first row matching a tracking number.
 *
 * Matching runs in three widening passes, because the client's record and the
 * warehouse scan almost never look identical:
 *
 *   1. EXACT — the stored value equals a canonical spelling of the input.
 *   2. SAME ENDING — the stored value ends with the input's tail. This is the
 *      main rule: the scanner picks up extra LEADING characters (routing
 *      prefix, zip, padding) that the client's record does not have, so the
 *      beginnings differ while the endings are identical.
 *   3. CONTAINS — the stored value merely contains the input (loosest).
 *
 * Prefers the normalized column and silently falls back to the raw column so the
 * app keeps working before the migration is applied.
 */
const findFirstByTracking = async ({
  table,
  select,
  candidates,
  suffixes = [],
  contains = [],
  tail = '',
  extra = [],
}) => {
  if (!candidates.length) return null;

  const baseQuery = () => {
    let query = supabaseAdmin.from(table).select(select);
    for (const [op, col, val] of extra) {
      query = query[op](col, val);
    }
    return query;
  };

  const columns = trackingNormColumnSupported === false
    ? ['tracking_number']
    : ['tracking_number_norm', 'tracking_number'];

  const noteColumnError = (error) => {
    if (error && error.code === '42703') trackingNormColumnSupported = false;
  };
  const noteTailError = (error) => {
    if (error && error.code === '42703') trackingTailColumnSupported = false;
  };

  // 1) Exact match against any candidate spelling.
  for (const column of columns) {
    const { data, error } = await baseQuery().in(column, candidates).limit(1);
    noteColumnError(error);
    if (!error && data && data.length > 0) return data[0];
  }

  // 2) SAME ENDING — the primary rule. The scanner picks up extra LEADING
  //    characters, so the beginnings differ while the endings are identical.
  //    Prefer the indexed tail column; otherwise scan with a `%tail` pattern.
  if (tail && tail.length >= 8) {
    if (trackingTailColumnSupported !== false) {
      const { data, error } = await baseQuery().in('tracking_number_tail', [tail]).limit(1);
      noteTailError(error);
      if (!error && data && data.length > 0) return data[0];
    }
    for (const column of columns) {
      const { data, error } = await baseQuery().ilike(column, `%${tail}`).limit(1);
      noteColumnError(error);
      if (!error && data && data.length > 0) return data[0];
    }
  }

  // 2b) Longer endings (15/20/22 chars) for long-vs-long code pairs.
  for (const suffix of suffixes) {
    if (!suffix || suffix.length < 8 || suffix === tail) continue;
    for (const column of columns) {
      const { data, error } = await baseQuery().ilike(column, `%${suffix}`).limit(1);
      noteColumnError(error);
      if (!error && data && data.length > 0) return data[0];
    }
  }

  // 3) Loose substring match: the stored value is the longer scanned code.
  for (const needle of contains) {
    if (!needle || needle.length < 8) continue;
    for (const column of columns) {
      const { data, error } = await baseQuery().ilike(column, `%${needle}%`).limit(1);
      noteColumnError(error);
      if (!error && data && data.length > 0) return data[0];
    }
  }

  return null;
};

/**
 * Find a parcel by tracking number using tolerant matching.
 * Accepts an optional custom select for lighter/joined responses.
 */
const findParcelByTracking = async (trackingNumber, select = DEFAULT_PARCEL_TRACKING_SELECT) => {
  const candidates = buildTrackingCandidates(trackingNumber);
  return findFirstByTracking({
    table: 'parcels',
    select,
    candidates,
    suffixes: buildTrackingSuffixes(trackingNumber),
    contains: buildTrackingContains(trackingNumber),
    tail: trackingTail(trackingNumber),
  });
};

/**
 * Find a tracking_numbers row with tolerant matching.
 * `onlyUnlinked` restricts the search to numbers the customer registered that the
 * warehouse has not received yet.
 */
const findTrackingRecord = async (trackingNumber, { onlyUnlinked = false, select = TRACKING_RECORD_SELECT } = {}) =>
  findFirstByTracking({
    table: 'tracking_numbers',
    select,
    candidates: buildTrackingCandidates(trackingNumber),
    suffixes: buildTrackingSuffixes(trackingNumber),
    contains: buildTrackingContains(trackingNumber),
    tail: trackingTail(trackingNumber),
    extra: onlyUnlinked ? [['eq', 'is_linked', false]] : [],
  });

/** Find a pre-registered (not yet linked) tracking record with its customer. */
const findPreRegisteredTracking = (trackingNumber) =>
  findTrackingRecord(trackingNumber, { onlyUnlinked: true });

const normalizeCountry = (country) => String(country || '').trim().toLowerCase();

const EUROPE_COUNTRIES = ['spain', 'испания', 'italy', 'италия', 'france', 'франция', 'germany', 'германия'];

const getActiveTariffByCountry = async (country) => {
  const { data: tariffs, error } = await supabaseAdmin
    .from('tariffs')
    .select('id, country, price_per_kg, minimum_charge, delivery_time, tech_rates')
    .eq('is_active', true);

  if (error) throw error;

  const target = normalizeCountry(country);
  let tariff = (tariffs || []).find(
    (item) => normalizeCountry(item.country) === target
  );

  // Fallback: if European country, match Germany (Europe transit hub)
  if (!tariff && EUROPE_COUNTRIES.includes(target)) {
    tariff = (tariffs || []).find((item) => normalizeCountry(item.country).includes('german') || normalizeCountry(item.country).includes('герман'));
  }

  // General fallback: first active tariff
  if (!tariff && tariffs && tariffs.length > 0) {
    tariff = tariffs[0];
  }

  if (!tariff) {
    const errorWithStatus = new Error(`No active tariff configured for warehouse country: ${country}`);
    errorWithStatus.statusCode = 422;
    throw errorWithStatus;
  }

  const pricePerKg = Number(tariff.price_per_kg);
  if (!Number.isFinite(pricePerKg) || pricePerKg < 0) {
    const errorWithStatus = new Error(`Invalid price per kg configured for ${country}`);
    errorWithStatus.statusCode = 422;
    throw errorWithStatus;
  }

  return tariff;
};

/**
 * Find a customer by tracking number (from tracking_numbers table).
 * Uses tolerant matching so a 12-digit FedEx number matches a longer scan.
 */
const linkTrackingNumber = async (trackingNumber) => {
  const trackingRecord = await findPreRegisteredTracking(trackingNumber);
  if (!trackingRecord) return null;

  return {
    customer: trackingRecord.customers,
    tracking_record: trackingRecord,
  };
};

/**
 * Compute parcel costs based on warehouse country tariff and selected services
 */
const computeCosts = async ({ warehouse_id, weight, declared_value, service_ids = [] }) => {
  let deliveryCost = 0;
  let insuranceCost = 0;
  let servicesCost = 0;

  // Fetch warehouse to get country
  const { data: warehouse, error: warehouseError } = await supabaseAdmin
    .from('warehouses')
    .select('country')
    .eq('id', warehouse_id)
    .single();

  if (warehouseError || !warehouse?.country) {
    const errorWithStatus = new Error('Warehouse country is required to calculate parcel cost');
    errorWithStatus.statusCode = 422;
    throw errorWithStatus;
  }

  const tariff = await getActiveTariffByCountry(warehouse.country);
  const baseRate = Number(tariff.price_per_kg);

  if (weight) {
    const weightKg = parseFloat(weight);
    let rate = baseRate;
    if (weightKg >= 1000) {
      rate = Math.max(1, baseRate - 5); // Example: $16 -> $11 ($5 discount)
    } else if (weightKg >= 100) {
      rate = Math.max(1, baseRate - 1); // Example: $16 -> $15 ($1 discount)
    }
    // Calculate strictly by gram without artificial 1kg floor or minimum charge
    deliveryCost = weightKg * rate;
  }

  // Calculate services
  const serviceDetails = [];
  if (service_ids.length > 0) {
    const { data: services } = await supabaseAdmin
      .from('additional_services')
      .select('*')
      .in('id', service_ids)
      .eq('is_active', true);

    if (services) {
      for (const service of services) {
        let cost = 0;
        if (service.price_type === 'fixed') {
          cost = parseFloat(service.price || 0);
        } else if (service.price_type === 'percentage') {
          const pct = parseFloat(service.percentage || 0);
          cost = (deliveryCost * pct) / 100;
          if (service.minimum_fee && cost < parseFloat(service.minimum_fee)) {
            cost = parseFloat(service.minimum_fee);
          }
        }

        // Separate insurance cost
        if (service.name.toLowerCase().includes('insurance') && declared_value) {
          insuranceCost += cost;
        } else {
          servicesCost += cost;
        }
        serviceDetails.push({ service_id: service.id, cost: parseFloat(cost.toFixed(2)) });
      }
    }
  }

  const totalCost = deliveryCost + insuranceCost + servicesCost;

  return {
    delivery_cost: parseFloat(deliveryCost.toFixed(2)),
    insurance_cost: parseFloat(insuranceCost.toFixed(2)),
    additional_services_cost: parseFloat(servicesCost.toFixed(2)),
    total_cost: parseFloat(totalCost.toFixed(2)),
    service_details: serviceDetails,
  };
};

/**
 * Create a parcel with auto-linking and cost computation
 */
const createParcel = async ({
  tracking_number,
  customer_id,
  warehouse_id,
  weight,
  dimensions,
  declared_value,
  notes,
  photos = [],
  service_ids = [],
  changed_by,
  recipient_name,
  product_description,
  product_link,
  destination_country,
  recipient_is_customer,
}) => {
  // Try to find pre-registered tracking number in all cases
  // (tolerant matching: client's 12-digit number vs. longer warehouse scan)
  const trackingRecord = await findPreRegisteredTracking(tracking_number);

  let linkedCustomerId = customer_id;
  let finalDescription = product_description;
  let finalLink = product_link;
  let finalDestination = destination_country;
  let finalRecipientIsCustomer = recipient_is_customer;

  if (trackingRecord) {
    if (!linkedCustomerId) {
      linkedCustomerId = trackingRecord.customer_id;
    }
    // Merge pre-registered additional services
    if (Array.isArray(trackingRecord.additional_services)) {
      const uniqueServices = new Set([...service_ids, ...trackingRecord.additional_services]);
      service_ids = Array.from(uniqueServices);
    }
    // Inherit declared value if not provided
    if (declared_value === undefined || declared_value === null) {
      declared_value = trackingRecord.declared_value;
    }
    // Inherit recipient name if not provided
    if (!recipient_name) {
      recipient_name = trackingRecord.recipient_name;
    }
    // Inherit description and link if not provided
    if (!finalDescription) {
      finalDescription = trackingRecord.product_description;
    }
    if (!finalLink) {
      finalLink = trackingRecord.product_link;
    }
    if (!finalDestination) {
      finalDestination = trackingRecord.destination_country;
    }
    if (finalRecipientIsCustomer === undefined || finalRecipientIsCustomer === null) {
      finalRecipientIsCustomer = trackingRecord.recipient_is_customer;
    }
  }

  // Determine initial status
  let status = linkedCustomerId ? 'received_at_warehouse' : 'unknown_recipient';

  // Compute costs
  const costs = await computeCosts({
    warehouse_id,
    weight,
    declared_value,
    service_ids,
  });

  // Create parcel
  const insertPayload = await filterPayload('parcels', {
    tracking_number,
    customer_id: linkedCustomerId || null,
    warehouse_id,
    weight,
    dimensions,
    declared_value,
    insurance_cost: costs.insurance_cost,
    additional_services_cost: costs.additional_services_cost,
    total_cost: costs.total_cost,
    status,
    arrival_date: new Date().toISOString(),
    notes,
    photos,
    recipient_name,
    product_description: finalDescription || null,
    product_link: finalLink || null,
    destination_country: finalDestination || 'Таджикистан',
    recipient_is_customer: !!finalRecipientIsCustomer,
  });

  const { data: parcel, error } = await supabaseAdmin
    .from('parcels')
    .insert(insertPayload)
    .select('*, customers(id, customer_code, first_name, last_name, email), warehouses(id, name, country)')
    .single();

  if (error) throw error;

  // Record initial status in history
  await supabaseAdmin.from('parcel_status_history').insert({
    parcel_id: parcel.id,
    status,
    notes: 'Parcel received at warehouse',
    changed_by,
  });

  // Insert parcel services
  if (costs.service_details.length > 0) {
    const serviceRows = costs.service_details.map((s) => ({
      parcel_id: parcel.id,
      service_id: s.service_id,
      cost: s.cost,
    }));
    await supabaseAdmin.from('parcel_services').insert(serviceRows);
  }

  // Mark tracking number as linked
  if (trackingRecord) {
    await supabaseAdmin
      .from('tracking_numbers')
      .update({ is_linked: true })
      .eq('id', trackingRecord.id);
  }

  // Send notification if customer is linked
  if (linkedCustomerId) {
    await notificationService.notifyParcelStatus(parcel, 'received_at_warehouse');
  }

  return parcel;
};

/**
 * Handle warehouse fast scan
 * Returns: existing parcel OR creates new one, with customer info
 */
const handleScan = async (tracking_number, scanningUser) => {
  // Check if parcel already exists (tolerant matching against the scan)
  const existingParcel = await findParcelByTracking(tracking_number);

  if (existingParcel) {
    return {
      action: 'found',
      parcel: existingParcel,
      message: 'Parcel found in system',
    };
  }

  // Not found — check tracking_numbers for a pre-registered tracking
  const linkResult = await linkTrackingNumber(tracking_number);

  if (linkResult) {
    return {
      action: 'pre_registered',
      customer: linkResult.customer,
      tracking_record: {
        id: linkResult.tracking_record.id,
        tracking_number,
        store_name: linkResult.tracking_record.store_name,
        country_of_origin: linkResult.tracking_record.country_of_origin,
        warehouse_id: linkResult.tracking_record.warehouse_id,
        notes: linkResult.tracking_record.notes,
        declared_value: linkResult.tracking_record.declared_value,
        additional_services: linkResult.tracking_record.additional_services,
        recipient_name: linkResult.tracking_record.recipient_name,
        product_description: linkResult.tracking_record.product_description,
        product_link: linkResult.tracking_record.product_link,
        destination_country: linkResult.tracking_record.destination_country,
        recipient_is_customer: linkResult.tracking_record.recipient_is_customer,
      },
      message: 'Tracking number found — customer pre-registered. Enter weight to complete.',
    };
  }

  // Unknown — no pre-registration
  return {
    action: 'unknown',
    tracking_number,
    message: 'Tracking number not found. Parcel will be created with unknown recipient.',
  };
};

/**
 * Helper to update and recalculate services & costs for a parcel
 */
const updateParcelServicesAndCosts = async (parcelId, serviceIds, declaredValue, weight, warehouseId) => {
  try {
    let pWeight = weight;
    let pDeclaredValue = declaredValue;
    let pWarehouseId = warehouseId;

    if (pWeight === undefined || pDeclaredValue === undefined || pWarehouseId === undefined) {
      const { data: parcel } = await supabaseAdmin
        .from('parcels')
        .select('weight, declared_value, warehouse_id')
        .eq('id', parcelId)
        .single();
      if (parcel) {
        if (pWeight === undefined) pWeight = parcel.weight;
        if (pDeclaredValue === undefined) pDeclaredValue = parcel.declared_value;
        if (pWarehouseId === undefined) pWarehouseId = parcel.warehouse_id;
      }
    }

    const costs = await computeCosts({
      warehouse_id: pWarehouseId,
      weight: pWeight,
      declared_value: pDeclaredValue,
      service_ids: serviceIds,
    });

    await supabaseAdmin
      .from('parcels')
      .update({
        declared_value: pDeclaredValue,
        insurance_cost: costs.insurance_cost,
        additional_services_cost: costs.additional_services_cost,
        total_cost: costs.total_cost,
      })
      .eq('id', parcelId);

    // Update parcel_services
    await supabaseAdmin
      .from('parcel_services')
      .delete()
      .eq('parcel_id', parcelId);

    if (costs.service_details.length > 0) {
      const serviceRows = costs.service_details.map((s) => ({
        parcel_id: parcelId,
        service_id: s.service_id,
        cost: s.cost,
      }));
      await supabaseAdmin.from('parcel_services').insert(serviceRows);
    }

    return costs;
  } catch (err) {
    console.error('updateParcelServicesAndCosts error:', err);
    throw err;
  }
};

module.exports = {
  linkTrackingNumber,
  findParcelByTracking,
  findPreRegisteredTracking,
  findTrackingRecord,
  DEFAULT_PARCEL_TRACKING_SELECT,
  computeCosts,
  createParcel,
  handleScan,
  updateParcelServicesAndCosts,
  getActiveTariffByCountry,
};
