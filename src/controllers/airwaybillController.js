const { validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/supabase');

const VALID_AWB_STATUSES = ['pending', 'active', 'in_transit', 'arrived', 'completed', 'cancelled'];

/**
 * GET /api/airwaybills
 */
const list = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '20', 10);
    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('airway_bills')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (req.query.status) query = query.eq('status', req.query.status);
    if (req.query.departure_country) query = query.eq('departure_country', req.query.departure_country);

    const { data, error, count } = await query;
    if (error) throw error;
    res.json({ data, pagination: { page, limit, total: count } });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/airwaybills/:id
 */
const getById = async (req, res, next) => {
  try {
    const { data: awb, error } = await supabaseAdmin
      .from('airway_bills')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !awb) return res.status(404).json({ error: 'Air waybill not found' });

    // Fetch associated parcels
    const { data: parcelsJoin } = await supabaseAdmin
      .from('airway_bill_parcels')
      .select('parcel_id, parcels(*, customers(id, customer_code, first_name, last_name))')
      .eq('airway_bill_id', req.params.id);

    const parcels = (parcelsJoin || []).map((row) => row.parcels).filter(Boolean);

    res.json({ data: { ...awb, parcels } });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/airwaybills
 */
const create = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ error: 'Validation failed', details: errors.array() });
    }

    const { awb_number, departure_country, departure_date, arrival_date, status = 'pending' } = req.body;

    // Check unique awb_number
    const { data: existing } = await supabaseAdmin
      .from('airway_bills')
      .select('id')
      .eq('awb_number', awb_number)
      .single();

    if (existing) return res.status(409).json({ error: 'AWB number already exists' });

    const { data, error } = await supabaseAdmin
      .from('airway_bills')
      .insert({ awb_number, departure_country, departure_date, arrival_date, status })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ data });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/airwaybills/:id
 */
const update = async (req, res, next) => {
  try {
    const { awb_number, departure_country, departure_date, arrival_date, status } = req.body;
    const updates = {};
    if (awb_number !== undefined) updates.awb_number = awb_number;
    if (departure_country !== undefined) updates.departure_country = departure_country;
    if (departure_date !== undefined) updates.departure_date = departure_date;
    if (arrival_date !== undefined) updates.arrival_date = arrival_date;
    if (status !== undefined) updates.status = status;

    const { data, error } = await supabaseAdmin
      .from('airway_bills')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Air waybill not found' });
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/airwaybills/:id
 */
const remove = async (req, res, next) => {
  try {
    // Remove all parcel associations first
    await supabaseAdmin
      .from('airway_bill_parcels')
      .delete()
      .eq('airway_bill_id', req.params.id);

    const { error } = await supabaseAdmin
      .from('airway_bills')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ message: 'Air waybill deleted' });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/airwaybills/:id/parcels — assign parcel to AWB
 */
const assignParcel = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ error: 'Validation failed', details: errors.array() });
    }

    const { parcel_id } = req.body;

    // Verify AWB exists
    const { data: awb, error: awbError } = await supabaseAdmin
      .from('airway_bills')
      .select('id, status')
      .eq('id', req.params.id)
      .single();

    if (awbError || !awb) return res.status(404).json({ error: 'Air waybill not found' });

    // Verify parcel exists
    const { data: parcel, error: parcelError } = await supabaseAdmin
      .from('parcels')
      .select('id')
      .eq('id', parcel_id)
      .single();

    if (parcelError || !parcel) return res.status(404).json({ error: 'Parcel not found' });

    // Check if already assigned
    const { data: existing } = await supabaseAdmin
      .from('airway_bill_parcels')
      .select('airway_bill_id')
      .eq('parcel_id', parcel_id)
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Parcel already assigned to an air waybill' });
    }

    // Assign parcel
    const { error: insertError } = await supabaseAdmin
      .from('airway_bill_parcels')
      .insert({ airway_bill_id: req.params.id, parcel_id });

    if (insertError) throw insertError;

    // Update parcel airway_bill_id and status
    await supabaseAdmin
      .from('parcels')
      .update({ airway_bill_id: req.params.id, status: 'assigned_to_flight' })
      .eq('id', parcel_id);

    res.status(201).json({ message: 'Parcel assigned to air waybill' });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/airwaybills/:id/parcels/:parcel_id — remove parcel from AWB
 */
const removeParcel = async (req, res, next) => {
  try {
    await supabaseAdmin
      .from('airway_bill_parcels')
      .delete()
      .eq('airway_bill_id', req.params.id)
      .eq('parcel_id', req.params.parcel_id);

    // Reset parcel airway_bill_id
    await supabaseAdmin
      .from('parcels')
      .update({ airway_bill_id: null })
      .eq('id', req.params.parcel_id);

    res.json({ message: 'Parcel removed from air waybill' });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/airwaybills/:id/status
 */
const updateStatus = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ error: 'Validation failed', details: errors.array() });
    }

    const { status } = req.body;

    const { data, error } = await supabaseAdmin
      .from('airway_bills')
      .update({ status })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Air waybill not found' });

    // If AWB is in_transit, update all assigned parcels
    if (status === 'in_transit') {
      const { data: awbParcels } = await supabaseAdmin
        .from('airway_bill_parcels')
        .select('parcel_id')
        .eq('airway_bill_id', req.params.id);

      if (awbParcels && awbParcels.length > 0) {
        const parcelIds = awbParcels.map((r) => r.parcel_id);
        await supabaseAdmin
          .from('parcels')
          .update({ status: 'in_transit' })
          .in('id', parcelIds);
      }
    }

    res.json({ data });
  } catch (err) {
    next(err);
  }
};

module.exports = { list, getById, create, update, remove, assignParcel, removeParcel, updateStatus };
