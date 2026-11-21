const { createClient } = require('@supabase/supabase-js');
const env = require('./env');

// Initialised once; the service-role key never leaves the backend.
module.exports = createClient(env.supabaseUrl, env.supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
