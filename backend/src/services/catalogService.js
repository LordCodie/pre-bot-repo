const supabase = require('../config/supabase');
const { ApiError, unwrap } = require('../middleware/errors');
const { recentFinished, latestStats } = require('./matchService');
const { formString, record } = require('./formUtil');

const leagues = async () =>
  unwrap(await supabase.from('leagues').select('id,name,country').order('name'));

async function teamStats(teamId) {
  const team = unwrap(await supabase.from('teams').select('id,name,normalized_name,league:leagues(id,name,country)')
    .eq('id', teamId).maybeSingle());
  if (!team) throw new ApiError(404, 'team_not_found', `Team ${teamId} not found`);
  const [snapshot, matches] = await Promise.all([latestStats(teamId), recentFinished(teamId, 40)]);
  return {
    team, snapshot,                                   // snapshot = scraped source values (may be null)
    recent_form: formString(matches, teamId, 5),
    recent_matches: matches.slice(0, 5),
    computed: {                                       // derived from stored results, last <=40 matches
      sample_size: matches.length,
      overall: record(matches, teamId), home: record(matches, teamId, 'home'), away: record(matches, teamId, 'away'),
    },
  };
}

module.exports = { leagues, teamStats };
