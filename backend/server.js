const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const express = require('express');
const rolloverRoutes = require('./routes/rolloverRoutes');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, { ip: req.ip });
  next();
});

// Routes
app.use('/api', rolloverRoutes);

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Endpoint not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ success: false, message: 'Internal server error' });
});

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});
