const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/shomirsaidov/Desktop/cargo-express66/backend/.env' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function main() {
  console.log('Testing exec_sql RPC...');
  const { data: d1, error: e1 } = await supabase.rpc('exec_sql', { sql: 'SELECT 1;' });
  console.log('exec_sql result:', d1, e1);
  
  const { data: d2, error: e2 } = await supabase.rpc('execute_sql', { sql: 'SELECT 1;' });
  console.log('execute_sql result:', d2, e2);

  const { data: d3, error: e3 } = await supabase.rpc('run_sql', { sql: 'SELECT 1;' });
  console.log('run_sql result:', d3, e3);
}

main();
