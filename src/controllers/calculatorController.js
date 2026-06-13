const { validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/supabase');

/**
 * POST /api/calculator/calculate
 * Body: { country, weight, service_ids: [] }
 */
const calculate = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ error: 'Validation failed', details: errors.array() });
    }

    const { country, weight, service_ids = [] } = req.body;
    const weightKg = parseFloat(weight);

    // Fetch tariff for the country
    const { data: tariff, error: tariffError } = await supabaseAdmin
      .from('tariffs')
      .select('*')
      .eq('is_active', true)
      .ilike('country', country)
      .single();

    if (tariffError || !tariff) {
      return res.status(404).json({ error: `No active tariff found for country: ${country}` });
    }

    // Base delivery cost
    const baseCost = Math.max(weightKg * tariff.price_per_kg, tariff.minimum_charge);

    // Calculate additional services cost
    let servicesCost = 0;
    const serviceDetails = [];

    if (service_ids.length > 0) {
      const { data: services, error: serviceError } = await supabaseAdmin
        .from('additional_services')
        .select('*')
        .in('id', service_ids)
        .eq('is_active', true);

      if (!serviceError && services) {
        for (const service of services) {
          let cost = 0;
          if (service.price_type === 'fixed') {
            cost = parseFloat(service.price || 0);
          } else if (service.price_type === 'percentage') {
            const pct = parseFloat(service.percentage || 0);
            cost = (baseCost * pct) / 100;
            if (service.minimum_fee && cost < parseFloat(service.minimum_fee)) {
              cost = parseFloat(service.minimum_fee);
            }
          }
          servicesCost += cost;
          serviceDetails.push({ service_id: service.id, name: service.name, cost: parseFloat(cost.toFixed(2)) });
        }
      }
    }

    const totalCost = baseCost + servicesCost;

    res.json({
      data: {
        country,
        weight: weightKg,
        tariff: {
          id: tariff.id,
          price_per_kg: tariff.price_per_kg,
          minimum_charge: tariff.minimum_charge,
          delivery_time: tariff.delivery_time,
        },
        delivery_cost: parseFloat(baseCost.toFixed(2)),
        services_cost: parseFloat(servicesCost.toFixed(2)),
        services: serviceDetails,
        total_cost: parseFloat(totalCost.toFixed(2)),
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { calculate };
