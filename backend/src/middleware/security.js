const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const env = require('../config/env');
const { ApiError } = require('./errors');

const corsMiddleware = cors({
  origin(origin, cb) {
    if (!origin || env.corsOrigins.includes(origin)) return cb(null, true);
    cb(new ApiError(403, 'cors_forbidden', 'Origin not allowed'));
  },
});

const limiter = rateLimit({
  windowMs: 60_000, limit: env.rateLimitPerMin, standardHeaders: true, legacyHeaders: false,
  handler: (_req, _res, next) => next(new ApiError(429, 'rate_limited', 'Too many requests')),
});

const requireAdmin = (req, _res, next) => {
  const given = Buffer.from(String(req.get('x-api-key') || ''));
  const want = Buffer.from(env.adminApiKey);
  if (!env.adminApiKey || given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
    return next(new ApiError(401, 'unauthorized', 'Missing or invalid API key'));
  }
  next();
};

module.exports = { helmet: helmet(), corsMiddleware, limiter, requireAdmin };
