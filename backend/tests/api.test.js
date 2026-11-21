// Offline route tests: no DB/ML needed for validation, 404 and auth paths.  npm test
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = 'test-key';
process.env.ML_SERVICE_URL = 'http://localhost:8000';
process.env.ADMIN_API_KEY = 'secret';
process.env.APP_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert');
const app = require('../src/app');

let server, base;
test.before(() => new Promise((r) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); }));
test.after(() => server.close());
const get = async (p, o) => { const r = await fetch(base + p, o); return [r.status, await r.json()]; };

test('health', async () => { const [s, b] = await get('/api/health'); assert.equal(s, 200); assert.equal(b.status, 'ok'); });
test('unknown route -> 404 json', async () => { const [s, b] = await get('/api/nope'); assert.equal(s, 404); assert.equal(b.error.code, 'route_not_found'); });
test('bad match id -> 400', async () => { const [s] = await get('/api/matches/abc'); assert.equal(s, 400); });
test('bad pagination -> 400', async () => { const [s] = await get('/api/matches/upcoming?limit=9999'); assert.equal(s, 400); });
test('bad date -> 400', async () => { const [s] = await get('/api/matches/upcoming?date=21-11-2026'); assert.equal(s, 400); });
test('refresh requires key', async () => { const [s] = await get('/api/predictions/refresh', { method: 'POST' }); assert.equal(s, 401); });
