const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  throw new Error('SUPABASE_URL is required');
}
if (!supabaseServiceKey) {
  console.warn('SUPABASE_SERVICE_KEY not set — using anon key (limited privileges)');
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
