const supabase = require('../config/supabase');
const { ApiError, unwrap } = require('../middleware/errors');
const { latestForMatches } = require('./predictionService');
const { formString } = require('./formUtil');

const strip = (p) => p && {
  home_win_prob: p.home_win_prob, draw_prob: p.draw_prob, away_win_prob: p.away_win_prob,
  predicted_outcome: p.predicted_outcome, model_version: p.model_version, created_at: p.created_at,
};

async function upcoming({ leagueId, date, windowDays, search, from, to }) {
  const start = date ? `${date}T00:00:00Z` : new Date().toISOString();
  const end = date ? `${date}T23:59:59.999Z` : new Date(Date.now() + windowDays * 864e5).toISOString();
  let q = supabase.from('v_upcoming_matches').select('*', { count: 'exact' })
    .gte('match_date', start).lte('match_date', end).order('match_date').range(from, to);
  if (leagueId) q = q.eq('league_id', leagueId);
  if (search) q = q.or(`home_team.ilike.%${search}%,away_team.ilike.%${search}%`);
  const { data, error, count } = await q;
  unwrap({ data, error });
  const preds = await latestForMatches(data.map((m) => m.id));
  return { rows: data.map((m) => ({ ...m, prediction: strip(preds.get(m.id)?.[0]) || null })), total: count };
}

const MATCH_SELECT = `id,match_date,status,home_goals,away_goals,
  league:leagues(id,name,country),
  home_team:teams!home_team_id(id,name), away_team:teams!away_team_id(id,name)`;

async function recent({ leagueId, from, to }) {
  let q = supabase.from('matches').select(MATCH_SELECT, { count: 'exact' }).eq('status', 'finished')
    .order('match_date', { ascending: false }).range(from, to);
  if (leagueId) q = q.eq('league_id', leagueId);
  const { data, error, count } = await q;
  unwrap({ data, error });
  const preds = await latestForMatches(data.map((m) => m.id));
  const rows = data.map((m) => {
    // only predictions made before kickoff count as genuine predictions
    const p = (preds.get(m.id) || []).find((x) => new Date(x.created_at) < new Date(m.match_date));
    const actual = m.home_goals > m.away_goals ? 'H' : m.home_goals === m.away_goals ? 'D' : 'A';
    return { ...m, actual_outcome: actual, prediction: strip(p) || null,
      prediction_correct: p ? p.predicted_outcome === actual : null };
  });
  return { rows, total: count };
}

async function recentFinished(teamId, n = 5) {
  return unwrap(await supabase.from('matches').select('id,match_date,home_team_id,away_team_id,home_goals,away_goals')
    .eq('status', 'finished').or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .order('match_date', { ascending: false }).limit(n));
}

async function latestStats(teamId) {
  return unwrap(await supabase.from('team_stats').select('*').eq('team_id', teamId)
    .order('as_of_date', { ascending: false }).limit(1).maybeSingle());
}

async function details(id) {
  const match = unwrap(await supabase.from('matches').select(MATCH_SELECT).eq('id', id).maybeSingle());
  if (!match) throw new ApiError(404, 'match_not_found', `Match ${id} not found`);
  const [hStats, aStats, hRecent, aRecent, preds] = await Promise.all([
    latestStats(match.home_team.id), latestStats(match.away_team.id),
    recentFinished(match.home_team.id), recentFinished(match.away_team.id),
    latestForMatches([id]),
  ]);
  const all = preds.get(id) || [];
  const result = match.status === 'finished'
    ? { home_goals: match.home_goals, away_goals: match.away_goals } : null;
  return {
    ...match, final_score: result,
    home: { team: match.home_team, stats: hStats, recent_form: formString(hRecent, match.home_team.id) },
    away: { team: match.away_team, stats: aStats, recent_form: formString(aRecent, match.away_team.id) },
    prediction: strip(all[0]) || null,
    prediction_history: all.map(strip),
  };
}

module.exports = { upcoming, recent, details, recentFinished, latestStats };
