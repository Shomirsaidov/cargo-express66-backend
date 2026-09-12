/**
 * Find (and optionally remove) orphaned Supabase Auth users.
 *
 * Background: register() creates the auth user before inserting the customers
 * row. When next_customer_code() threw "function chr(bigint) does not exist",
 * the rollback never ran, leaving auth users with no matching customers row.
 * Those emails cannot log in and cannot re-register (createUser -> 409).
 *
 * Usage:
 *   node src/scripts/find_orphaned_auth_users.js            # dry run, list only
 *   node src/scripts/find_orphaned_auth_users.js --delete   # remove them
 */
const { supabaseAdmin } = require('../config/supabase');

const DELETE = process.argv.includes('--delete');

async function listAllAuthUsers() {
  const users = [];
  let page = 1;
  const perPage = 1000;

  for (;;) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const batch = data?.users || [];
    users.push(...batch);

    if (batch.length < perPage) break;
    page += 1;
  }

  return users;
}

async function main() {
  const { data: customers, error } = await supabaseAdmin
    .from('customers')
    .select('user_id');

  if (error) throw error;

  const linked = new Set((customers || []).map((c) => c.user_id).filter(Boolean));
  const authUsers = await listAllAuthUsers();
  const orphans = authUsers.filter((u) => !linked.has(u.id));

  console.log(`Auth users:      ${authUsers.length}`);
  console.log(`Customer rows:   ${linked.size}`);
  console.log(`Orphaned:        ${orphans.length}\n`);

  if (orphans.length === 0) {
    console.log('Nothing to clean up.');
    return;
  }

  for (const u of orphans) {
    console.log(`  ${u.email}  ${u.id}  created ${u.created_at}`);
  }

  if (!DELETE) {
    console.log('\nDry run. Re-run with --delete to remove these auth users.');
    return;
  }

  console.log('');
  for (const u of orphans) {
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(u.id);
    if (deleteError) {
      console.log(`  FAILED   ${u.email}: ${deleteError.message}`);
    } else {
      console.log(`  deleted  ${u.email}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Script failed:', err.message || err);
    process.exit(1);
  });
