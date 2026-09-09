const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

const missingSupabaseSettings = [];
if (!supabaseUrl || /your-project\.supabase\.co|your-project/i.test(supabaseUrl)) {
  missingSupabaseSettings.push('SUPABASE_URL');
}
if (!supabaseAnonKey || /your-anon-key/i.test(supabaseAnonKey)) {
  missingSupabaseSettings.push('SUPABASE_ANON_KEY');
}
if (!supabaseServiceKey || /your-service-role-key/i.test(supabaseServiceKey)) {
  missingSupabaseSettings.push('SUPABASE_SERVICE_KEY');
}

if (missingSupabaseSettings.length > 0) {
  throw new Error(`Supabase environment is not configured. Set: ${missingSupabaseSettings.join(', ')}`);
}

// Admin client with service role — bypasses RLS
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Public client with anon key
const supabase = createClient(supabaseUrl, supabaseAnonKey);

module.exports = { supabaseAdmin, supabase };
