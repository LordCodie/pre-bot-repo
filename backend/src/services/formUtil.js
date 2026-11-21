// Team-perspective helpers shared by match and team services.
const outcome = (m, teamId) => {
  const home = m.home_team_id === teamId || m.home_team?.id === teamId;
  const gf = home ? m.home_goals : m.away_goals;
  const ga = home ? m.away_goals : m.home_goals;
  return { venue: home ? 'home' : 'away', gf, ga, result: gf > ga ? 'W' : gf === ga ? 'D' : 'L' };
};

const formString = (matches, teamId, n = 5) =>
  matches.slice(0, n).map((m) => outcome(m, teamId).result).join('');

function record(matches, teamId, venue) {
  const r = { played: 0, wins: 0, draws: 0, losses: 0, goals_for: 0, goals_against: 0, ppg: null };
  for (const m of matches) {
    const o = outcome(m, teamId);
    if (venue && o.venue !== venue) continue;
    r.played++; r.goals_for += o.gf; r.goals_against += o.ga;
    if (o.result === 'W') r.wins++; else if (o.result === 'D') r.draws++; else r.losses++;
  }
  if (r.played) r.ppg = Number(((r.wins * 3 + r.draws) / r.played).toFixed(2));
  return r;
}

module.exports = { outcome, formString, record };
