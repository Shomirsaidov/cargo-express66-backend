const { supabaseAdmin } = require('./src/config/supabase');

async function seedUser(email, password, role, firstName, lastName, phone, address, customerCode) {
  console.log(`Seeding user: ${email} (${role})...`);
  
  // Check if exists
  const { data: existing } = await supabaseAdmin
    .from('customers')
    .select('id')
    .eq('email', email.toLowerCase())
    .single();

  if (existing) {
    console.log(`User ${email} already exists.`);
    return;
  }

  // Create auth user
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email: email.toLowerCase(),
    password: password,
    email_confirm: true,
  });

  if (authError) {
    console.error(`Auth creation error for ${email}:`, authError);
    return;
  }

  const userId = authData.user.id;

  // Insert customer profile
  const { data, error } = await supabaseAdmin
    .from('customers')
    .insert({
      user_id: userId,
      customer_code: customerCode,
      first_name: firstName,
      last_name: lastName,
      phone: phone,
      email: email.toLowerCase(),
      delivery_address: address,
      role: role,
      is_active: true,
    })
    .select()
    .single();

  if (error) {
    console.error(`DB insert error for ${email}:`, error);
    // clean up auth user
    await supabaseAdmin.auth.admin.deleteUser(userId);
    return;
  }

  console.log(`Successfully seeded ${email} with role ${role}!`);
}

async function run() {
  try {
    // 1. Admin
    await seedUser(
      'admin@cargo66.com',
      'adminpassword123',
      'admin',
      'Admin',
      'Director',
      '+992000000001',
      'Dushanbe, Tajikistan',
      'CX66-000001'
    );

    // 2. Warehouse Employee
    await seedUser(
      'warehouse@cargo66.com',
      'warehousepassword123',
      'warehouse_employee',
      'Иван',
      'Складов',
      '+992000000002',
      'Munich, Germany',
      'CX66-000002'
    );

    // 3. Customer
    await seedUser(
      'customer@cargo66.com',
      'customerpassword123',
      'customer',
      'Алишер',
      'Каримов',
      '+992938888888',
      'ул. Рудаки 12, Душанбе',
      'CX66-000003'
    );

    console.log('Seeding completed successfully!');
  } catch (err) {
    console.error('Seeding crashed:', err);
  } finally {
    process.exit(0);
  }
}

run();
