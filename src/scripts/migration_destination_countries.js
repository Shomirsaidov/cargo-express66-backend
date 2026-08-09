const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Error: SUPABASE_URL or SUPABASE_SERVICE_KEY not set in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
  console.log('========================================================================');
  console.log('1. RUNNING DATABASE SCHEMA PROGRAMMATIC UPDATES...');
  console.log('========================================================================');

  // Update Delaware Warehouse address
  console.log('Updating Delaware Warehouse address to: 1680 Porter Rd, Suite A-3, Bear, DE 19701');
  const { data: wData, error: wError } = await supabase
    .from('warehouses')
    .update({ address: '1680 Porter Rd, Suite A-3, Bear, DE 19701' })
    .eq('id', '78a0de0e-8596-404b-921e-a982c7fb3910')
    .select();

  if (wError) {
    console.error('Error updating Delaware warehouse address:', wError);
  } else {
    console.log('Delaware warehouse address updated successfully! Row:', wData);
  }

  // Seed two new services in additional_services table
  console.log('\nSeeding new services starting Sept 1st...');
  const newServices = [
    {
      id: '55555555-5555-5555-5555-555555555555',
      name: 'Складское обслуживание для карго и транспортных компаний',
      description: 'Предоставляем складские и фулфилмент-услуги для карго и транспортных компаний. Принимаем и храним посылки ваших клиентов на нашем складе в США, консолидируем грузы, проверяем и переупаковываем посылки, подготавливаем их к отправке и передаём для дальнейшей доставки по США или за границу.',
      price: 0,
      price_type: 'fixed',
      percentage: 0,
      minimum_fee: 0,
      is_active: true
    },
    {
      id: '66666666-6666-6666-6666-666666666666',
      name: 'Хранение и фулфилмент для онлайн-селлеров',
      description: 'Предоставляем услуги хранения и обработки товаров для онлайн-селлеров и интернет-магазинов. Принимаем товар на наш склад в США, организуем хранение, ведём учёт остатков, комплектуем и упаковываем заказы и подготавливаем их к отправке покупателям.',
      price: 0,
      price_type: 'fixed',
      percentage: 0,
      minimum_fee: 0,
      is_active: true
    }
  ];

  for (const s of newServices) {
    const { data: sData, error: sError } = await supabase
      .from('additional_services')
      .upsert(s, { onConflict: 'id' })
      .select();

    if (sError) {
      console.error(`Error seeding service "${s.name}":`, sError);
    } else {
      console.log(`Service seeded successfully: "${s.name}"`);
    }
  }

  console.log('\n========================================================================');
  console.log('2. PASTE THE FOLLOWING SQL IN THE SUPABASE SQL EDITOR TO INITALIZE TABLES:');
  console.log('========================================================================\n');
  
  const sqlPath = path.join(__dirname, 'migration_destination_countries.sql');
  if (fs.existsSync(sqlPath)) {
    console.log(fs.readFileSync(sqlPath, 'utf8'));
  } else {
    console.log('-- (SQL file not found on disk)');
  }
  
  console.log('========================================================================');
}

run();
