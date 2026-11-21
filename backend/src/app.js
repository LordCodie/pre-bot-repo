const express = require('express');
const { helmet, corsMiddleware, limiter } = require('./middleware/security');
const { notFound, errorHandler } = require('./middleware/errors');
const routes = require('./routes');

const app = express();
app.disable('x-powered-by');
app.use(helmet);
app.use(corsMiddleware);
app.use(express.json({ limit: '100kb' }));
app.use('/api', limiter, routes);
app.use(notFound);
app.use(errorHandler);

module.exports = app;
