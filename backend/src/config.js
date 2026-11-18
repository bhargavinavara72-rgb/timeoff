const path = require('path');

module.exports = {
  PORT: Number(process.env.PORT) || 3000,
  DATA_DIR: path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data')),
  FRONTEND_DIR: path.resolve(process.env.FRONTEND_DIR || path.join(__dirname, '..', '..', 'frontend')),
  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
  TOKEN_TTL_HOURS: Number(process.env.TOKEN_TTL_HOURS) || 8,
  JWT_SECRET: process.env.JWT_SECRET || null
};
