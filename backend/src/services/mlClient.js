const env = require('../config/env');
const { ApiError } = require('../middleware/errors');

const OUTCOMES = new Set(['H', 'D', 'A']);

async function request(method, path, body, headers = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), env.mlTimeoutMs);
  try {
    const res = await fetch(`${env.mlServiceUrl}${path}`, {
      method, signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(502, 'ml_service_error', json?.error?.message || `ML service returned ${res.status}`);
    return json;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(503, 'ml_service_unavailable', e.name === 'AbortError' ? 'ML service timed out' : 'ML service unreachable');
  } finally {
    clearTimeout(timer);
  }
}

// Reject malformed ML output before it can reach the database.
function validatePrediction(p) {
  const probs = [p?.home_win_prob, p?.draw_prob, p?.away_win_prob];
  const ok = Number.isInteger(p?.match_id) && probs.every((x) => typeof x === 'number' && x >= 0 && x <= 1)
    && Math.abs(probs.reduce((a, b) => a + b, 0) - 1) <= 0.001
    && OUTCOMES.has(p.predicted_outcome) && typeof p.model_version === 'string' && p.model_version.length > 0;
  if (!ok) throw new ApiError(502, 'ml_invalid_response', 'ML service returned an invalid prediction');
  return {
    match_id: p.match_id, model_version: p.model_version, home_win_prob: p.home_win_prob,
    draw_prob: p.draw_prob, away_win_prob: p.away_win_prob, predicted_outcome: p.predicted_outcome,
  };
}

module.exports = {
  health: () => request('GET', '/health'),
  predict: async (matchId) => validatePrediction(await request('POST', '/predict', { match_id: matchId })),
  predictBatch: async (matchIds) => {
    const out = await request('POST', '/predict/batch', { match_ids: matchIds });
    if (!Array.isArray(out?.predictions)) throw new ApiError(502, 'ml_invalid_response', 'Invalid batch response');
    return out.predictions.map(validatePrediction);
  },
  retrain: () => request('POST', '/retrain', undefined, { 'X-Admin-Key': env.mlAdminKey }),
};
