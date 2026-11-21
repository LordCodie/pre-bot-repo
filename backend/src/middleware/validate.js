const { ApiError } = require('./errors');
const bad = (msg) => new ApiError(400, 'invalid_parameter', msg);

const intParam = (name) => (req, _res, next) => {
  if (!/^\d{1,15}$/.test(String(req.params[name])) || Number(req.params[name]) < 1) {
    return next(bad(`'${name}' must be a positive integer`));
  }
  next();
};

function parsePagination(query, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const page = query.page === undefined ? 1 : Number(query.page);
  const limit = query.limit === undefined ? defaultLimit : Number(query.limit);
  if (!Number.isInteger(page) || page < 1) throw bad("'page' must be a positive integer");
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) throw bad(`'limit' must be 1-${maxLimit}`);
  return { page, limit, from: (page - 1) * limit, to: page * limit - 1 };
}

function parseDate(value, name = 'date') {
  if (value === undefined) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) throw bad(`'${name}' must be YYYY-MM-DD`);
  return value;
}

function parseIntQuery(value, name, { min, max }) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`'${name}' must be an integer ${min}-${max}`);
  return n;
}

// strip characters that are meaningful inside PostgREST filter strings
const safeSearch = (s) =>
  s === undefined ? undefined : (String(s).replace(/[,()%*\\.:]/g, ' ').trim().slice(0, 50) || undefined);

module.exports = { intParam, parsePagination, parseDate, parseIntQuery, safeSearch };
