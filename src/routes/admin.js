const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../config/supabase');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

// GET /api/admin/dashboard — admin statistics
router.get('/dashboard', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    // 1. Total customers
    const { count: totalCustomers, error: errCust } = await supabaseAdmin
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'customer');

    if (errCust) throw errCust;

    // 2. Active shipments (not delivered, not cancelled)
    const { count: activeShipments, error: errAct } = await supabaseAdmin
      .from('parcels')
      .select('id', { count: 'exact', head: true })
      .not('status', 'in', '("delivered","cancelled")');

    if (errAct) throw errAct;

    // 3. Delivered shipments
    const { count: deliveredShipments, error: errDel } = await supabaseAdmin
      .from('parcels')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'delivered');

    if (errDel) throw errDel;

    // 4. Unknown recipients
    const { count: unknownRecipients, error: errUnk } = await supabaseAdmin
      .from('parcels')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'unknown_recipient');

    if (errUnk) throw errUnk;

    // 5. Total revenue (sum of total_cost)
    const { data: revenueData, error: errRev } = await supabaseAdmin
      .from('parcels')
      .select('total_cost');

    if (errRev) throw errRev;
    const revenue = (revenueData || []).reduce((sum, p) => sum + (parseFloat(p.total_cost) || 0), 0);

    // 6. Weekly volume (created in the last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const { count: weeklyVolume, error: errVol } = await supabaseAdmin
      .from('parcels')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', sevenDaysAgo.toISOString());

    if (errVol) throw errVol;

    // 7. Recent activity (last 5 parcels)
    const { data: recentParcels, error: errRec } = await supabaseAdmin
      .from('parcels')
      .select('id, tracking_number, status, created_at')
      .order('created_at', { ascending: false })
      .limit(5);

    if (errRec) throw errRec;

    const recentActivity = (recentParcels || []).map((p) => {
      let icon = 'package';
      let text = `Посылка ${p.tracking_number} в статусе: ${p.status}`;
      if (p.status === 'delivered') icon = 'check';
      if (p.status === 'received_at_warehouse') icon = 'download';
      return {
        id: p.id,
        icon,
        text,
        time: new Date(p.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
      };
    });

    // 8. Status breakdown counts
    const { data: statusData, error: errStat } = await supabaseAdmin
      .from('parcels')
      .select('status');

    if (errStat) throw errStat;

    const breakdown = {
      awaiting_arrival: 0,
      received_at_warehouse: 0,
      in_transit: 0,
      delivered: 0,
      cancelled: 0
    };

    (statusData || []).forEach(p => {
      if (p.status in breakdown) {
        breakdown[p.status]++;
      } else if (['processing', 'assigned_to_flight', 'dispatched'].includes(p.status)) {
        breakdown.received_at_warehouse++;
      } else if (['arrived_in_dushanbe', 'customs_clearance', 'ready_for_pickup'].includes(p.status)) {
        breakdown.in_transit++;
      }
    });

    res.json({
      data: {
        total_customers: totalCustomers || 0,
        active_shipments: activeShipments || 0,
        delivered_shipments: deliveredShipments || 0,
        unknown_recipients: unknownRecipients || 0,
        revenue: parseFloat(revenue.toFixed(2)),
        weekly_volume: weeklyVolume || 0,
        recent_activity: recentActivity,
        // Mock weekly/monthly chart series if no historical database aggregator
        weekly_shipments: [10, 15, 8, 12, 20, 4, 2],
        monthly_revenue: [1000, 1500, 1200, 2000, 1800, 2400],
        status_breakdown: breakdown
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
