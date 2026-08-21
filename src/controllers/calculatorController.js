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

    const { country, weight, service_ids = [], item_type = 'regular' } = req.body;
    const weightKg = parseFloat(weight || 0);

    // Fetch tariff for the country for display info (fallback is USA if not found)
    let tariff = null;
    const { data: tariffData } = await supabaseAdmin
      .from('tariffs')
      .select('*')
      .eq('is_active', true)
      .ilike('country', country)
      .single();
    if (tariffData) {
      tariff = tariffData;
    } else {
      // Fallback tariff
      tariff = { 
        id: 'd6f43e01-6b24-4893-bc24-be2ef2f94567', 
        price_per_kg: 16.00, 
        minimum_charge: 10.00, 
        delivery_time: '7-10 days',
        tech_rates: {}
      };
    }

    const baseRate = parseFloat(tariff.price_per_kg || 16.00);
    const minimumCharge = parseFloat(tariff.minimum_charge || 0.00);

    // Merge default tech rates with database-configured tech rates
    let techRates = {
      macbook: 100,
      laptop: 100,
      iphone: 100,
      watch: 30,
      ipad: 70,
      airpods: 20,
      meta_glasses: 20,
      airpods_max: 25,
      ebook: 15
    };

    if (tariff.tech_rates && typeof tariff.tech_rates === 'object') {
      techRates = { ...techRates, ...tariff.tech_rates };
    }

    // Base delivery cost calculation
    let baseCost = 0;
    if (item_type && techRates[item_type]) {
      baseCost = techRates[item_type];
    } else {
      const calculatedWeight = weightKg < 1.0 ? 1.0 : weightKg;
      let rate = baseRate;
      if (calculatedWeight >= 1000) {
        rate = Math.max(1, baseRate - 5); // Example: $16 -> $11 ($5 discount)
      } else if (calculatedWeight >= 100) {
        rate = Math.max(1, baseRate - 1); // Example: $16 -> $15 ($1 discount)
      }
      baseCost = calculatedWeight * rate;
      if (baseCost < minimumCharge) {
        baseCost = minimumCharge;
      }
    }

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
