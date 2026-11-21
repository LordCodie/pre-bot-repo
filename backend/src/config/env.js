const path = require('path');
require('dotenv').config({ path: path.resolve(process.cwd(), process.env.ENV_FILE || '.env') });

const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'ML_SERVICE_URL'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const isTest = process.env.APP_ENV === 'test';
if (isTest) {
  const local = new Set(['localhost', '127.0.0.1', 'host.docker.internal']);
  for (const k of ['SUPABASE_URL', 'ML_SERVICE_URL']) {
    if (!local.has(new URL(process.env[k]).hostname)) {
      console.error(`APP_ENV=test but ${k} is not local. Refusing to start.`);
      process.exit(1);
    }
  }
}

module.exports = {
  isTest,
  port: Number(process.env.PORT || 5000),
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY,
  mlServiceUrl: process.env.ML_SERVICE_URL.replace(/\/$/, ''),
  mlTimeoutMs: Number(process.env.ML_TIMEOUT_MS || 8000),
  mlAdminKey: process.env.ML_ADMIN_KEY || '',
  adminApiKey: process.env.ADMIN_API_KEY || '',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173').split(',').map((s) => s.trim()),
  rateLimitPerMin: Number(process.env.RATE_LIMIT_PER_MIN || 120),
};
