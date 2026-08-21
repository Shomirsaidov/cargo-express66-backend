const { supabaseAdmin } = require('../config/supabase');
const { uploadToCloudinary } = require('../utils/cloudinaryUtils');
const notificationService = require('./notificationService');
const { filterPayload } = require('../utils/schema');

/**
 * Find a customer by tracking number (from tracking_numbers table)
 */
const linkTrackingNumber = async (trackingNumber) => {
  const { data: trackingRecord, error } = await supabaseAdmin
    .from('tracking_numbers')
    .select('*, customers(*)')
    .eq('tracking_number', trackingNumber)
    .eq('is_linked', false)
    .single();

  if (error || !trackingRecord) return null;

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

  let baseRate = 16.00;
  let minimumCharge = 10.00;

  // Fetch warehouse to get country
  const { data: warehouse } = await supabaseAdmin
    .from('warehouses')
    .select('country')
    .eq('id', warehouse_id)
    .single();

  if (warehouse && warehouse.country) {
    const { data: tariff } = await supabaseAdmin
      .from('tariffs')
      .select('price_per_kg, minimum_charge')
      .eq('is_active', true)
      .ilike('country', warehouse.country)
      .single();
    if (tariff) {
      baseRate = parseFloat(tariff.price_per_kg || 16.00);
      minimumCharge = parseFloat(tariff.minimum_charge || 0.00);
    }
  }

  if (weight) {
    const weightKg = parseFloat(weight);
    const calculatedWeight = weightKg < 1.0 ? 1.0 : weightKg;
    let rate = baseRate;
    if (calculatedWeight >= 1000) {
      rate = Math.max(1, baseRate - 5); // Example: $16 -> $11 ($5 discount)
    } else if (calculatedWeight >= 100) {
      rate = Math.max(1, baseRate - 1); // Example: $16 -> $15 ($1 discount)
    }
    deliveryCost = calculatedWeight * rate;
    if (deliveryCost < minimumCharge) {
      deliveryCost = minimumCharge;
    }
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
  const { data: trackingRecord } = await supabaseAdmin
    .from('tracking_numbers')
    .select('*')
    .eq('tracking_number', tracking_number.trim())
    .eq('is_linked', false)
    .single();

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
  // Check if parcel already exists
  const { data: existingParcel } = await supabaseAdmin
    .from('parcels')
    .select(
      `*,
      customers(id, customer_code, first_name, last_name, email, phone),
      warehouses(id, name, country)`
    )
    .eq('tracking_number', tracking_number)
    .single();

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

module.exports = { linkTrackingNumber, computeCosts, createParcel, handleScan, updateParcelServicesAndCosts };
