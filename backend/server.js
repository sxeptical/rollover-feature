const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const express = require('express');
const session = require('express-session');
const rolloverRoutes = require('./routes/rolloverRoutes');
const authRoutes = require('./routes/authRoutes');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;

// Session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
  },
}));

// Middleware
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, { ip: req.ip });
  next();
});

// Routes
app.use('/api', rolloverRoutes);
app.use('/auth', authRoutes);

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
