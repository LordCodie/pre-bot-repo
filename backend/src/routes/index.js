const { Router } = require('express');
const c = require('../controllers');
const { intParam } = require('../middleware/validate');
const { requireAdmin } = require('../middleware/security');

const r = Router();
r.get('/health', c.health);
r.get('/status/scraper', c.scraperStatus);

r.get('/matches/upcoming', c.upcoming);          // keep static routes before '/:id'
r.get('/matches/recent', c.recent);
r.get('/matches/:id', intParam('id'), c.matchDetails);

r.get('/leagues', c.leagues);
r.get('/teams/:id/stats', intParam('id'), c.teamStats);
r.get('/teams/:id', intParam('id'), c.teamStats);

r.get('/accuracy', c.accuracy);
r.post('/predictions/refresh', requireAdmin, c.refreshPredictions);
r.get('/predictions/:matchId', intParam('matchId'), c.prediction);
r.post('/admin/retrain', requireAdmin, c.retrain);

module.exports = r;
