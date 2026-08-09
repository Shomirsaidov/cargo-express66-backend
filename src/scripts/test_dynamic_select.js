const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/shomirsaidov/Desktop/cargo-express66/backend/.env' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function main() {
  let hasRecipientName = false;
  let hasProductDescription = false;
  let hasProductLink = false;
  let hasDestinationCountry = false;

  const { error: err1 } = await supabase.from('parcels').select('recipient_name').limit(1);
  if (!err1) hasRecipientName = true;

  const { error: err2 } = await supabase.from('parcels').select('product_description').limit(1);
  if (!err2) hasProductDescription = true;

  const { error: err3 } = await supabase.from('parcels').select('product_link').limit(1);
  if (!err3) hasProductLink = true;

  const { error: err4 } = await supabase.from('parcels').select('destination_country').limit(1);
  if (!err4) hasDestinationCountry = true;

  console.log('Checks:', {
    hasRecipientName,
    hasProductDescription,
    hasProductLink,
    hasDestinationCountry
  });

  const selectFields = ['id', 'tracking_number'];
  if (hasRecipientName) selectFields.push('recipient_name');
  if (hasProductDescription) selectFields.push('product_description');
  if (hasProductLink) selectFields.push('product_link');
  if (hasDestinationCountry) selectFields.push('destination_country');

  console.log('Executing dynamically built select query:', selectFields.join(', '));
  const { data, error } = await supabase.from('parcels').select(selectFields.join(', ')).limit(1);
  console.log('Result:', data, error);
}

main();
