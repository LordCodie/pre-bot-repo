const supabase = require('../config/supabase');
const ml = require('./mlClient');
const { unwrap } = require('../middleware/errors');

async function accuracy() {
  const rows = unwrap(await supabase.from('v_prediction_accuracy').select('*'));
  return {
    overall: rows.filter((r) => r.league_id === null).map(({ league_id, league_name, ...r }) => r),
    per_league: rows.filter((r) => r.league_id !== null),
    note: 'Only predictions stored before kickoff are counted.',
  };
}

async function scraper() {
  const [latest, lastOk, errors] = await Promise.all([
    supabase.from('v_latest_scrape_status').select('*').order('ran_at', { ascending: false }),
    supabase.from('scrape_logs').select('ran_at,source_url,rows_upserted').eq('status', 'success')
      .order('ran_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('scrape_logs').select('ran_at,source_url,status,error_message').neq('status', 'success')
      .order('ran_at', { ascending: false }).limit(10),
  ]);
  return { latest_per_source: unwrap(latest), last_successful_update: unwrap(lastOk), recent_errors: unwrap(errors) };
}

async function health({ deep }) {
  const out = { status: 'ok', timestamp: new Date().toISOString() };
  if (deep) {
    const { error } = await supabase.from('leagues').select('id').limit(1);
    out.database = error ? 'down' : 'up';
    out.ml_service = await ml.health().then((h) => (h.model_loaded ? 'up' : 'up_no_model')).catch(() => 'down');
    if (out.database === 'down') out.status = 'degraded';
  }
  return out;
}

module.exports = { accuracy, scraper, health };
