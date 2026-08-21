const { supabaseAdmin } = require('../config/supabase');

let parcelsColumnsCache = null;
let trackingNumbersColumnsCache = null;

const getParcelsColumns = async () => {
  return [
    'id', 'tracking_number', 'customer_id', 'warehouse_id', 'airway_bill_id', 
    'weight', 'dimensions', 'declared_value', 'insurance_cost', 
    'additional_services_cost', 'total_cost', 'status', 'arrival_date', 
    'shipment_date', 'delivery_date', 'notes', 'photos', 'created_at', 'updated_at',
    'recipient_name', 'product_description', 'product_link', 'destination_country', 'recipient_is_customer'
  ];
};

const getTrackingNumbersColumns = async () => {
  return [
    'id', 'customer_id', 'tracking_number', 'store_name', 'country_of_origin', 
    'warehouse_id', 'notes', 'is_linked', 'created_at', 'updated_at', 
    'additional_services', 'declared_value',
    'recipient_name', 'product_description', 'product_link', 'destination_country', 'recipient_is_customer'
  ];
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
