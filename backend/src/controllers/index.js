const { asyncHandler, ApiError } = require('../middleware/errors');
const { parsePagination, parseDate, parseIntQuery, safeSearch } = require('../middleware/validate');
const matches = require('../services/matchService');
const catalog = require('../services/catalogService');
const predictions = require('../services/predictionService');
const status = require('../services/statusService');
const ml = require('../services/mlClient');

const meta = (pg, total) => ({ page: pg.page, limit: pg.limit, total, total_pages: Math.ceil(total / pg.limit) });

exports.upcoming = asyncHandler(async (req, res) => {
  const pg = parsePagination(req.query);
  const { rows, total } = await matches.upcoming({
    leagueId: parseIntQuery(req.query.league, 'league', { min: 1, max: 1e12 }),
    date: parseDate(req.query.date), windowDays: parseIntQuery(req.query.window, 'window', { min: 1, max: 60 }) ?? 14,
    search: safeSearch(req.query.search), from: pg.from, to: pg.to,
  });
  res.json({ data: rows, meta: meta(pg, total ?? rows.length) });
});

exports.recent = asyncHandler(async (req, res) => {
  const pg = parsePagination(req.query);
  const { rows, total } = await matches.recent({
    leagueId: parseIntQuery(req.query.league, 'league', { min: 1, max: 1e12 }), from: pg.from, to: pg.to });
  res.json({ data: rows, meta: meta(pg, total ?? rows.length) });
});

exports.matchDetails = asyncHandler(async (req, res) => res.json({ data: await matches.details(Number(req.params.id)) }));
exports.leagues = asyncHandler(async (_req, res) => res.json({ data: await catalog.leagues() }));
exports.teamStats = asyncHandler(async (req, res) => res.json({ data: await catalog.teamStats(Number(req.params.id)) }));

exports.prediction = asyncHandler(async (req, res) =>
  res.json({ data: await predictions.getForMatch(Number(req.params.matchId), { live: req.query.live === 'true' }) }));

exports.refreshPredictions = asyncHandler(async (req, res) =>
  res.json({ data: await predictions.refreshUpcoming({
    windowDays: parseIntQuery(req.body?.window, 'window', { min: 1, max: 60 }) ?? 14 }) }));

exports.retrain = asyncHandler(async (_req, res) => {
  if (!require('../config/env').mlAdminKey) throw new ApiError(500, 'not_configured', 'ML_ADMIN_KEY is not configured');
  res.status(202).json({ data: await ml.retrain() });
});

exports.accuracy = asyncHandler(async (_req, res) => res.json({ data: await status.accuracy() }));
exports.scraperStatus = asyncHandler(async (_req, res) => res.json({ data: await status.scraper() }));
exports.health = asyncHandler(async (req, res) => res.json(await status.health({ deep: req.query.deep === 'true' })));
