const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/shomirsaidov/Desktop/cargo-express66/backend/.env' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function main() {
  const { data, error } = await supabase.from('additional_services').select('*');
  console.log('Services in DB:', data, error);
}

main();
