const fs = require('fs');
const path = require('path');

console.log('========================================================================');
2. PASTE THE FOLLOWING SQL IN THE SUPABASE SQL EDITOR TO INITALIZE TABLES:
console.log('========================================================================\n');

const sqlPath = path.join(__dirname, 'migration_recipient_is_customer.sql');
if (fs.existsSync(sqlPath)) {
  console.log(fs.readFileSync(sqlPath, 'utf8'));
} else {
  console.log('-- (SQL file not found on disk)');
}

console.log('========================================================================');
