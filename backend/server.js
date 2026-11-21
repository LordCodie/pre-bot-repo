const env = require('./src/config/env');   // validates env first (exits on problems)
const app = require('./src/app');
const supabase = require('./src/config/supabase');

const server = app.listen(env.port, async () => {
  console.log(`API listening on :${env.port} (${env.isTest ? 'TEST' : 'production'} mode)`);
  const { error } = await supabase.from('leagues').select('id').limit(1);
  console.log(error ? `[warn] Supabase connectivity check failed: ${error.message}` : 'Supabase connectivity OK');
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
