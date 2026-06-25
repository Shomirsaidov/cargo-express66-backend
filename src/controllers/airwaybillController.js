const { validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/supabase');
const notificationService = require('../services/notificationService');

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

    if (status !== undefined) {
      await syncParcelsStatus(req.params.id, status, data.awb_number, req.user?.id);
    }

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
      .select('id, status, awb_number')
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

    // Determine parcel status based on current AWB status
    let parcelStatus = 'assigned_to_flight';
    let notes = `Parcel assigned to flight ${awb.awb_number}`;

    if (awb.status === 'departed' || awb.status === 'in_transit') {
      parcelStatus = 'in_transit';
      notes = `Parcel assigned to departed flight ${awb.awb_number}`;
    } else if (awb.status === 'arrived') {
      parcelStatus = 'arrived_in_dushanbe';
      notes = `Parcel assigned to arrived flight ${awb.awb_number}`;
    } else if (awb.status === 'completed') {
      parcelStatus = 'arrived_in_dushanbe';
      notes = `Parcel assigned to completed flight ${awb.awb_number}`;
    } else if (awb.status === 'cancelled') {
      parcelStatus = 'received_at_warehouse';
      notes = `Parcel assigned to cancelled flight ${awb.awb_number}`;
    }

    // Update parcel airway_bill_id and status
    const { data: updatedParcel, error: updateParcelErr } = await supabaseAdmin
      .from('parcels')
      .update({ 
        airway_bill_id: req.params.id, 
        status: parcelStatus,
        ...(parcelStatus === 'in_transit' ? { shipment_date: new Date().toISOString() } : {}),
        ...(parcelStatus === 'arrived_in_dushanbe' ? { arrival_date: new Date().toISOString() } : {})
      })
      .eq('id', parcel_id)
      .select('*, customers(id, first_name, last_name, email)')
      .single();

    if (updateParcelErr) throw updateParcelErr;

    // Log status history
    await supabaseAdmin.from('parcel_status_history').insert({
      parcel_id,
      status: parcelStatus,
      notes,
      changed_by: req.user?.id || null
    });

    // Send notification
    if (updatedParcel.customer_id) {
      updatedParcel.awb_number = awb.awb_number;
      await notificationService.notifyParcelStatus(updatedParcel, parcelStatus);
    }

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
    const { data: awb } = await supabaseAdmin
      .from('airway_bills')
      .select('awb_number')
      .eq('id', req.params.id)
      .single();

    await supabaseAdmin
      .from('airway_bill_parcels')
      .delete()
      .eq('airway_bill_id', req.params.id)
      .eq('parcel_id', req.params.parcel_id);

    // Reset parcel airway_bill_id and set status back to received_at_warehouse
    await supabaseAdmin
      .from('parcels')
      .update({ airway_bill_id: null, status: 'received_at_warehouse' })
      .eq('id', req.params.parcel_id);

    // Log status history
    await supabaseAdmin.from('parcel_status_history').insert({
      parcel_id: req.params.parcel_id,
      status: 'received_at_warehouse',
      notes: `Parcel removed from flight ${awb?.awb_number || ''}`,
      changed_by: req.user?.id || null
    });

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

    // Sync status of all assigned parcels
    await syncParcelsStatus(req.params.id, status, data.awb_number, req.user?.id);

    res.json({ data });
  } catch (err) {
    next(err);
  }
};

/**
 * Helper to sync all assigned parcels status with AWB status
 */
const syncParcelsStatus = async (awbId, awbStatus, awbNumber, changedByUserId) => {
  try {
    const { data: awbParcels } = await supabaseAdmin
      .from('airway_bill_parcels')
      .select('parcel_id')
      .eq('airway_bill_id', awbId);

    if (!awbParcels || awbParcels.length === 0) return;

    const parcelIds = awbParcels.map((r) => r.parcel_id);

    let parcelStatus = null;
    let notes = null;

    if (awbStatus === 'scheduled' || awbStatus === 'pending' || awbStatus === 'active') {
      parcelStatus = 'assigned_to_flight';
      notes = `Flight ${awbNumber} scheduled`;
    } else if (awbStatus === 'departed' || awbStatus === 'in_transit') {
      parcelStatus = 'in_transit';
      notes = `Flight ${awbNumber} departed in transit`;
    } else if (awbStatus === 'arrived') {
      parcelStatus = 'arrived_in_dushanbe';
      notes = `Flight ${awbNumber} arrived in Dushanbe`;
    } else if (awbStatus === 'completed') {
      parcelStatus = 'arrived_in_dushanbe';
      notes = `Flight ${awbNumber} completed`;
    } else if (awbStatus === 'cancelled') {
      parcelStatus = 'received_at_warehouse';
      notes = `Flight ${awbNumber} cancelled`;
    }

    if (!parcelStatus) return;

    const statusUpdates = { status: parcelStatus };
    if (parcelStatus === 'in_transit') {
      statusUpdates.shipment_date = new Date().toISOString();
    } else if (parcelStatus === 'arrived_in_dushanbe') {
      statusUpdates.arrival_date = new Date().toISOString();
    }

    // Update all parcels
    const { error: updateError } = await supabaseAdmin
      .from('parcels')
      .update(statusUpdates)
      .in('id', parcelIds);

    if (updateError) throw updateError;

    // Log history for all parcels
    const historyRecords = parcelIds.map((id) => ({
      parcel_id: id,
      status: parcelStatus,
      notes: notes,
      changed_by: changedByUserId || null,
    }));

    await supabaseAdmin
      .from('parcel_status_history')
      .insert(historyRecords);

    // Fetch full parcel and customer info to send notifications
    const { data: parcelsToNotify } = await supabaseAdmin
      .from('parcels')
      .select('*, customers(id, first_name, last_name, email)')
      .in('id', parcelIds);

    if (parcelsToNotify && parcelsToNotify.length > 0) {
      for (const p of parcelsToNotify) {
        if (p.customer_id) {
          p.awb_number = awbNumber;
          await notificationService.notifyParcelStatus(p, parcelStatus);
        }
      }
    }
  } catch (err) {
    console.error('syncParcelsStatus error:', err);
  }
};

module.exports = { list, getById, create, update, remove, assignParcel, removeParcel, updateStatus };
