const fs = require('fs');
const path = require('path');

console.log('========================================================================');
console.log('DATABASE SCHEMA MIGRATION REQUIRED FOR DYNAMIC TARIFFS & TECH RATES');
console.log('========================================================================');
console.log('Please copy and paste the following SQL query into the Supabase SQL Editor');
console.log('to add the tech_rates column to the tariffs table:');
console.log('\n');

const sqlPath = path.join(__dirname, 'migration_tariffs_tech_rates.sql');
if (fs.existsSync(sqlPath)) {
  console.log(fs.readFileSync(sqlPath, 'utf8'));
} else {
  console.log('-- (SQL file not found on disk)');
}

console.log('========================================================================');
