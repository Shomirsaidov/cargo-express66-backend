const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/shomirsaidov/Desktop/cargo-express66/backend/.env' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function main() {
  const { data, error } = await supabase.from('parcels').select('*').limit(1);
  if (data && data.length > 0) {
    console.log('Columns in parcels table:', Object.keys(data[0]));
  } else {
    console.log('No data or error in parcels:', error);
  }

  const { data: tData, error: tError } = await supabase.from('tracking_numbers').select('*').limit(1);
  if (tData && tData.length > 0) {
    console.log('Columns in tracking_numbers table:', Object.keys(tData[0]));
  } else {
    console.log('No data or error in tracking_numbers:', tError);
  }
}

main();
