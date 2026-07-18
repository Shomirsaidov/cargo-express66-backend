const { validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/supabase');
const { uploadToCloudinary } = require('../utils/cloudinaryUtils');
const parcelService = require('../services/parcelService');
const notificationService = require('../services/notificationService');

const VALID_STATUSES = [
  'awaiting_arrival',
  'received_at_warehouse',
  'processing',
  'assigned_to_flight',
  'dispatched',
  'in_transit',
  'arrived_in_dushanbe',
  'customs_clearance',
  'ready_for_pickup',
  'delivered',
  'unknown_recipient',
  'cancelled',
];

/**
 * GET /api/parcels — list parcels
 * Admin/warehouse: all parcels with filters
 * Customer: own parcels only
 */
const list = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '20', 10);
    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('parcels')
      .select(
        `*,
        customers(id, customer_code, first_name, last_name, email),
        warehouses(id, name, country),
        airway_bills(id, awb_number, status),
        parcel_services(id, cost, additional_services(id, name, description))`,
        { count: 'exact' }
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Non-admin: only own parcels
    if (req.user.role === 'customer') {
      query = query.eq('customer_id', req.user.id);
    }

    // Filters
    if (req.query.status) query = query.eq('status', req.query.status);
    if (req.query.warehouse_id) query = query.eq('warehouse_id', req.query.warehouse_id);
    if (req.query.customer_id && req.user.role === 'admin') {
      query = query.eq('customer_id', req.query.customer_id);
    }
    if (req.query.search) {
      query = query.ilike('tracking_number', `%${req.query.search}%`);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    res.json({ data, pagination: { page, limit, total: count } });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/parcels/:id
 */
const getById = async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('parcels')
      .select(
        `*,
        customers(id, customer_code, first_name, last_name, email, phone),
        warehouses(id, name, country, city, address),
        airway_bills(id, awb_number, status, departure_country),
        parcel_status_history(id, status, notes, changed_by, created_at),
        parcel_services(id, cost, additional_services(id, name, description))`
      )
      .eq('id', req.params.id)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Parcel not found' });

    // Non-admin: only own parcels
    if (req.user.role === 'customer' && data.customer_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json({ data });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/parcels — warehouse/admin create parcel
 */
const create = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ error: 'Validation failed', details: errors.array() });
    }

    const {
      tracking_number,
      customer_id,
      warehouse_id,
      weight,
      dimensions,
      declared_value,
      notes,
      service_ids,
    } = req.body;

    // Upload photos if provided
    const photoUrls = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const base64 = file.buffer.toString('base64');
        const dataUri = `data:${file.mimetype};base64,${base64}`;
        const result = await uploadToCloudinary(dataUri, 'parcels');
        photoUrls.push(result.secure_url);
      }
    }

    const parcel = await parcelService.createParcel({
      tracking_number: tracking_number.trim(),
      customer_id: customer_id || null,
      warehouse_id,
      weight: weight ? parseFloat(weight) : null,
      dimensions: dimensions || null,
      declared_value: declared_value ? parseFloat(declared_value) : null,
      notes: notes || null,
      photos: photoUrls,
      service_ids: service_ids ? JSON.parse(service_ids) : [],
      changed_by: req.user.id,
    });

    res.status(201).json({ data: parcel });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/parcels/:id
 */
const update = async (req, res, next) => {
  try {
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('parcels')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !existing) return res.status(404).json({ error: 'Parcel not found' });

    const {
      tracking_number,
      customer_id,
      warehouse_id,
      weight,
      dimensions,
      declared_value,
      notes,
      arrival_date,
      shipment_date,
      delivery_date,
    } = req.body;

    const updates = {};
    if (tracking_number !== undefined) updates.tracking_number = tracking_number.trim();
    if (customer_id !== undefined) updates.customer_id = customer_id;
    if (warehouse_id !== undefined) updates.warehouse_id = warehouse_id;
    if (weight !== undefined) updates.weight = parseFloat(weight);
    if (dimensions !== undefined) updates.dimensions = dimensions;
    if (declared_value !== undefined) updates.declared_value = parseFloat(declared_value);
    if (notes !== undefined) updates.notes = notes;
    if (arrival_date !== undefined) updates.arrival_date = arrival_date;
    if (shipment_date !== undefined) updates.shipment_date = shipment_date;
    if (delivery_date !== undefined) updates.delivery_date = delivery_date;

    // Handle new photos
    let existingPhotos = existing.photos || [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const base64 = file.buffer.toString('base64');
        const dataUri = `data:${file.mimetype};base64,${base64}`;
        const result = await uploadToCloudinary(dataUri, 'parcels');
        existingPhotos.push(result.secure_url);
      }
      updates.photos = existingPhotos;
    }

    // Remove photos if specified
    if (req.body.remove_photos) {
      const toRemove = JSON.parse(req.body.remove_photos);
      updates.photos = existingPhotos.filter((p) => !toRemove.includes(p));
    }

    // Auto-transition status if customer is assigned to unknown recipient
    let autoLinked = false;
    if (customer_id && !existing.customer_id && existing.status === 'unknown_recipient') {
      updates.status = 'received_at_warehouse';
      autoLinked = true;
    }

    // Recalculate costs if weight, declared_value, or warehouse_id changed
    if (weight !== undefined || declared_value !== undefined || warehouse_id !== undefined || req.body.service_ids !== undefined) {
      let serviceIds = [];
      if (req.body.service_ids !== undefined) {
        serviceIds = Array.isArray(req.body.service_ids) ? req.body.service_ids : JSON.parse(req.body.service_ids);
      } else {
        const { data: currentServices } = await supabaseAdmin
          .from('parcel_services')
          .select('service_id')
          .eq('parcel_id', req.params.id);
        if (currentServices) {
          serviceIds = currentServices.map(s => s.service_id);
        }
      }

      const pWeight = weight !== undefined ? parseFloat(weight) : existing.weight;
      const pDeclaredValue = declared_value !== undefined ? parseFloat(declared_value) : existing.declared_value;
      const pWarehouseId = warehouse_id !== undefined ? warehouse_id : existing.warehouse_id;

      const parcelService = require('../services/parcelService');
      try {
        const costs = await parcelService.computeCosts({
          warehouse_id: pWarehouseId,
          weight: pWeight,
          declared_value: pDeclaredValue,
          service_ids: serviceIds
        });

        updates.insurance_cost = costs.insurance_cost;
        updates.additional_services_cost = costs.additional_services_cost;
        updates.total_cost = costs.total_cost;

        // If service_ids was passed, update the parcel_services relation
        if (req.body.service_ids !== undefined) {
          await supabaseAdmin
            .from('parcel_services')
            .delete()
            .eq('parcel_id', req.params.id);

          if (costs.service_details.length > 0) {
            const serviceRows = costs.service_details.map((s) => ({
              parcel_id: req.params.id,
              service_id: s.service_id,
              cost: s.cost,
            }));
            await supabaseAdmin.from('parcel_services').insert(serviceRows);
          }
        }
      } catch (costErr) {
        console.error('Failed to recalculate parcel costs on update:', costErr);
      }
    }

    const { data, error } = await supabaseAdmin
      .from('parcels')
      .update(updates)
      .eq('id', req.params.id)
      .select('*, customers(id, customer_code, first_name, last_name), warehouses(id, name, country)')
      .single();

    if (error) throw error;

    if (autoLinked) {
      // Clean up previous unknown recipient history entries
      await supabaseAdmin
        .from('parcel_status_history')
        .update({ status: 'received_at_warehouse' })
        .eq('parcel_id', req.params.id)
        .eq('status', 'unknown_recipient');

      // Add a status history entry for the assignment
      await supabaseAdmin.from('parcel_status_history').insert({
        parcel_id: req.params.id,
        status: 'received_at_warehouse',
        notes: 'Customer assigned by admin',
        changed_by: req.user.id
      });
    }

    res.json({ data });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/parcels/:id/status
 */
const updateStatus = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ error: 'Validation failed', details: errors.array() });
    }

    const { status, notes } = req.body;

    if (!VALID_STATUSES.includes(status)) {
      return res.status(422).json({ error: `Invalid status. Valid: ${VALID_STATUSES.join(', ')}` });
    }

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('parcels')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !existing) return res.status(404).json({ error: 'Parcel not found' });

    // If the parcel has a customer, its status cannot be "unknown_recipient"
    let targetStatus = status;
    if (targetStatus === 'unknown_recipient' && existing.customer_id) {
      targetStatus = 'received_at_warehouse';
    }

    // If previous status was unknown_recipient and new status is different, clean up history
    const isTransitioningFromUnknown = existing.status === 'unknown_recipient' && targetStatus !== 'unknown_recipient';

    // Update parcel status
    const statusUpdates = { status: targetStatus };
    if (targetStatus === 'delivered') statusUpdates.delivery_date = new Date().toISOString();
    if (targetStatus === 'received_at_warehouse') statusUpdates.arrival_date = new Date().toISOString();
    if (targetStatus === 'dispatched') statusUpdates.shipment_date = new Date().toISOString();

    const { data: updatedParcel, error: updateError } = await supabaseAdmin
      .from('parcels')
      .update(statusUpdates)
      .eq('id', req.params.id)
      .select('*, customers(id, customer_code, first_name, last_name, email)')
      .single();

    if (updateError) throw updateError;

    if (isTransitioningFromUnknown) {
      // Clean up previous unknown recipient history entries
      await supabaseAdmin
        .from('parcel_status_history')
        .update({ status: 'received_at_warehouse' })
        .eq('parcel_id', req.params.id)
        .eq('status', 'unknown_recipient');
    }

    // Record in history
    await supabaseAdmin.from('parcel_status_history').insert({
      parcel_id: req.params.id,
      status: targetStatus,
      notes: notes || null,
      changed_by: req.user.id,
    });

    // Send notification if customer is assigned
    if (updatedParcel.customer_id) {
      await notificationService.notifyParcelStatus(updatedParcel, targetStatus);
    }

    res.json({ data: updatedParcel });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/parcels/scan/:tracking_number — warehouse fast scan
 */
const scan = async (req, res, next) => {
  try {
    const { tracking_number } = req.params;
    const result = await parcelService.handleScan(tracking_number.trim(), req.user);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/parcels/track/:tracking_number — public tracking
 */
const getByTrackingNumber = async (req, res, next) => {
  try {
    const { tracking_number } = req.params;
    const { data: parcel, error } = await supabaseAdmin
      .from('parcels')
      .select(`
        *,
        customers(id, customer_code, first_name, last_name),
        warehouses(name),
        parcel_status_history(status, notes, created_at)
      `)
      .eq('tracking_number', tracking_number.trim())
      .single();

    if (error || !parcel) {
      return res.status(404).json({ error: 'Parcel not found' });
    }

    // Format response to match what the frontend expects
    const formattedParcel = {
      id: parcel.id,
      tracking_number: parcel.tracking_number,
      status: parcel.status,
      weight: parcel.weight,
      warehouse_name: parcel.warehouses ? parcel.warehouses.name : null,
      arrival_date: parcel.arrival_date,
      updated_at: parcel.updated_at,
      customer: parcel.customers ? {
        id: parcel.customers.id,
        customer_code: parcel.customers.customer_code,
        first_name: parcel.customers.first_name,
        last_name: parcel.customers.last_name
      } : null,
      status_history: (parcel.parcel_status_history || []).map(h => ({
        status: h.status,
        note: h.notes,
        created_at: h.created_at
      })).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    };

    res.json(formattedParcel);
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/parcels/:id — admin only
 */
const remove = async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin
      .from('parcels')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ message: 'Parcel deleted' });
  } catch (err) {
    next(err);
  }
};

module.exports = { list, getById, create, update, updateStatus, scan, getByTrackingNumber, remove };
