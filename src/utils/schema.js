const { supabaseAdmin } = require('../config/supabase');

let parcelsColumnsCache = null;
let trackingNumbersColumnsCache = null;

const getParcelsColumns = async () => {
  if (parcelsColumnsCache) return parcelsColumnsCache;
  
  const baseCols = [
    'id', 'tracking_number', 'customer_id', 'warehouse_id', 'airway_bill_id', 
    'weight', 'dimensions', 'declared_value', 'insurance_cost', 
    'additional_services_cost', 'total_cost', 'status', 'arrival_date', 
    'shipment_date', 'delivery_date', 'notes', 'photos', 'created_at', 'updated_at'
  ];
  
  const optional = ['recipient_name', 'product_description', 'product_link', 'destination_country', 'recipient_is_customer'];
  for (const col of optional) {
    try {
      const { error } = await supabaseAdmin.from('parcels').select(col).limit(1);
      if (!error) {
        baseCols.push(col);
      }
    } catch (e) {
      // Ignore query errors
    }
  }
  
  parcelsColumnsCache = baseCols;
  return baseCols;
};

const getTrackingNumbersColumns = async () => {
  if (trackingNumbersColumnsCache) return trackingNumbersColumnsCache;
  
  const baseCols = [
    'id', 'customer_id', 'tracking_number', 'store_name', 'country_of_origin', 
    'warehouse_id', 'notes', 'is_linked', 'created_at', 'updated_at', 
    'additional_services', 'declared_value'
  ];
  
  const optional = ['recipient_name', 'product_description', 'product_link', 'destination_country', 'recipient_is_customer'];
  for (const col of optional) {
    try {
      const { error } = await supabaseAdmin.from('tracking_numbers').select(col).limit(1);
      if (!error) {
        baseCols.push(col);
      }
    } catch (e) {
      // Ignore query errors
    }
  }
  
  trackingNumbersColumnsCache = baseCols;
  return baseCols;
};

/**
 * Filters the input payload to only include keys that actually exist in the table's schema.
 */
const filterPayload = async (tableName, payload) => {
  const allowedCols = tableName === 'parcels' 
    ? await getParcelsColumns() 
    : await getTrackingNumbersColumns();
    
  const filtered = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined && allowedCols.includes(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
};

module.exports = {
  getParcelsColumns,
  getTrackingNumbersColumns,
  filterPayload
};
