const supabase = require('../config/supabase');
const ml = require('./mlClient');
const { ApiError, unwrap } = require('../middleware/errors');

const COLS = 'match_id,model_version,home_win_prob,draw_prob,away_win_prob,predicted_outcome,created_at';

async function latestForMatches(matchIds) {
  if (!matchIds.length) return new Map();
  const rows = unwrap(await supabase.from('predictions').select(COLS).in('match_id', matchIds)
    .order('created_at', { ascending: false }));
  const byMatch = new Map();
  for (const r of rows) (byMatch.get(r.match_id) || byMatch.set(r.match_id, []).get(r.match_id)).push(r);
  return byMatch; // each list is newest-first
}

async function store(predictions) {
  if (!predictions.length) return 0;
  const rows = unwrap(await supabase.from('predictions')
    .upsert(predictions, { onConflict: 'match_id,model_version' }).select('id'));
  return rows.length;
}

async function getForMatch(matchId, { live = false } = {}) {
  const match = unwrap(await supabase.from('matches').select('id,status,match_date').eq('id', matchId).maybeSingle());
  if (!match) throw new ApiError(404, 'match_not_found', `Match ${matchId} not found`);
  const stored = (await latestForMatches([matchId])).get(matchId)?.[0];
  const canGenerate = match.status === 'scheduled';

  if (canGenerate && (live || !stored)) {
    try {
      const fresh = await ml.predict(matchId);
      await store([fresh]);
      return { ...fresh, created_at: new Date().toISOString(), source: 'live' };
    } catch (e) {
      if (!stored) throw e;                     // nothing cached: surface the ML failure
      return { ...stored, source: 'cache', warning: 'Live prediction unavailable; returning stored prediction' };
    }
  }
  if (!stored) throw new ApiError(404, 'prediction_not_found', `No prediction stored for match ${matchId}`);
  return { ...stored, source: 'database' };
}

async function refreshUpcoming({ windowDays = 14 } = {}) {
  const end = new Date(Date.now() + windowDays * 864e5).toISOString();
  const rows = unwrap(await supabase.from('matches').select('id').eq('status', 'scheduled')
    .gte('match_date', new Date().toISOString()).lte('match_date', end).limit(500));
  if (!rows.length) return { requested: 0, stored: 0, model_versions: [] };
  const preds = await ml.predictBatch(rows.map((r) => r.id));
  const stored = await store(preds);
  return { requested: rows.length, stored, model_versions: [...new Set(preds.map((p) => p.model_version))] };
}

module.exports = { latestForMatches, getForMatch, refreshUpcoming };
