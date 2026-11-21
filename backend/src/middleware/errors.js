class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message); this.status = status; this.code = code; this.details = details;
  }
}

const notFound = (req, _res, next) =>
  next(new ApiError(404, 'route_not_found', `No route for ${req.method} ${req.originalUrl}`));

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, _req, res, _next) => {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'invalid_json', message: 'Malformed JSON body' } });
  }
  console.error('[unhandled]', err); // server-side only; never leak internals
  res.status(500).json({ error: { code: 'internal_error', message: 'Internal server error' } });
};

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Supabase returns { data, error }: convert DB failure to a safe 503.
const unwrap = ({ data, error }) => {
  if (error) {
    console.error('[supabase]', error.message);
    throw new ApiError(503, 'database_error', 'Database request failed');
  }
  return data;
};

module.exports = { ApiError, notFound, errorHandler, asyncHandler, unwrap };
