const { validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/supabase');
const notificationService = require('../services/notificationService');

/**
 * GET /api/tracking — list customer's tracking numbers
 */
const list = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '50', 10);
    const offset = (page - 1) * limit;

    const { data, error, count } = await supabaseAdmin
      .from('tracking_numbers')
      .select('*, warehouses(name, country)', { count: 'exact' })
      .eq('customer_id', req.user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    res.json({ data, pagination: { page, limit, total: count } });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/tracking — add tracking number
 */
const create = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ error: 'Validation failed', details: errors.array() });
    }

    const { tracking_number, store_name, country_of_origin, warehouse_id, notes, additional_services, declared_value } = req.body;

    // Check for duplicate tracking number for this customer
    const { data: existing } = await supabaseAdmin
      .from('tracking_numbers')
      .select('id')
      .eq('customer_id', req.user.id)
      .eq('tracking_number', tracking_number.trim())
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Tracking number already added' });
    }

    // Check if a parcel with this tracking number already exists in the system without a customer
    const { data: existingParcel } = await supabaseAdmin
      .from('parcels')
      .select('*')
      .eq('tracking_number', tracking_number.trim())
      .single();

    let isLinked = false;

    if (existingParcel && !existingParcel.customer_id) {
      isLinked = true;
      const newStatus = existingParcel.status === 'unknown_recipient' ? 'received_at_warehouse' : existingParcel.status;

      // Update parcel with the customer ID and correct status
      const { data: updatedParcel, error: updateError } = await supabaseAdmin
        .from('parcels')
        .update({
          customer_id: req.user.id,
          status: newStatus,
          declared_value: declared_value || 0
        })
        .eq('id', existingParcel.id)
        .select('*, customers(id, customer_code, first_name, last_name, email), warehouses(id, name, country)')
        .single();

      if (!updateError && updatedParcel) {
        // Recalculate costs and attach services selected by the customer
        const parcelService = require('../services/parcelService');
        try {
          await parcelService.updateParcelServicesAndCosts(
            updatedParcel.id,
            additional_services || [],
            declared_value || 0,
            updatedParcel.weight,
            updatedParcel.warehouse_id
          );
        } catch (costErr) {
          console.error('Failed to update parcel costs on auto-link:', costErr);
        }

        // Add to status history
        await supabaseAdmin.from('parcel_status_history').insert({
          parcel_id: updatedParcel.id,
          status: newStatus,
          notes: 'Parcel linked to customer account',
          changed_by: req.user.id
        });

        // Notify customer
        try {
          await notificationService.notifyParcelStatus(updatedParcel, newStatus);
        } catch (notifErr) {
          console.error('Failed to notify customer on auto-link:', notifErr);
        }
      }
    }

    const { data, error } = await supabaseAdmin
      .from('tracking_numbers')
      .insert({
        customer_id: req.user.id,
        tracking_number: tracking_number.trim(),
        store_name: store_name || null,
        country_of_origin: country_of_origin || null,
        warehouse_id: warehouse_id || null,
        notes: notes || null,
        is_linked: isLinked,
        additional_services: additional_services || [],
        declared_value: declared_value || 0
      })
      .select('*, warehouses(name, country)')
      .single();

    if (error) throw error;
    res.status(201).json({ data });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/tracking/:id
 */
const update = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ error: 'Validation failed', details: errors.array() });
    }

    // Ensure ownership
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('tracking_numbers')
      .select('id, customer_id')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !existing) return res.status(404).json({ error: 'Tracking number not found' });

    if (req.user.role !== 'admin' && existing.customer_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { tracking_number, store_name, country_of_origin, warehouse_id, notes, additional_services, declared_value } = req.body;
    const updates = {};
    if (tracking_number !== undefined) updates.tracking_number = tracking_number.trim();
    if (store_name !== undefined) updates.store_name = store_name;
    if (country_of_origin !== undefined) updates.country_of_origin = country_of_origin;
    if (warehouse_id !== undefined) updates.warehouse_id = warehouse_id;
    if (notes !== undefined) updates.notes = notes;
    if (additional_services !== undefined) updates.additional_services = additional_services;
    if (declared_value !== undefined) updates.declared_value = declared_value;

    const { data, error } = await supabaseAdmin
      .from('tracking_numbers')
      .update(updates)
      .eq('id', req.params.id)
      .select('*, warehouses(name, country)')
      .single();

    if (error) throw error;

    // If already linked, sync services and costs with the parcel
    if (data.is_linked && (additional_services !== undefined || declared_value !== undefined)) {
      const { data: parcel } = await supabaseAdmin
        .from('parcels')
        .select('id, weight, warehouse_id')
        .eq('tracking_number', data.tracking_number)
        .single();
      if (parcel) {
        const parcelService = require('../services/parcelService');
        try {
          await parcelService.updateParcelServicesAndCosts(
            parcel.id,
            additional_services !== undefined ? additional_services : data.additional_services,
            declared_value !== undefined ? declared_value : data.declared_value,
            parcel.weight,
            parcel.warehouse_id
          );
        } catch (costErr) {
          console.error('Failed to sync parcel costs on update:', costErr);
        }
      }
    }

    res.json({ data });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/tracking/:id
 */
const remove = async (req, res, next) => {
  try {
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('tracking_numbers')
      .select('id, customer_id')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !existing) return res.status(404).json({ error: 'Tracking number not found' });

    if (req.user.role !== 'admin' && existing.customer_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { error } = await supabaseAdmin
      .from('tracking_numbers')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ message: 'Tracking number deleted' });
  } catch (err) {
    next(err);
  }
};

module.exports = { list, create, update, remove };
