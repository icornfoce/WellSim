/**
 * WellSim Backend — Configuration
 * 
 * Centralized configuration for the Express server.
 * All environment-specific values are managed here.
 */

require('dotenv').config();

module.exports = {
  // Server
  PORT: process.env.PORT || 3001,
  NODE_ENV: process.env.NODE_ENV || 'development',

  // CORS — allowed frontend origins
  CORS_ORIGINS: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',')
    : ['http://localhost:3000', 'https://wellsim.pages.dev'],

  // Device status threshold (milliseconds)
  // If no data received within this window, device is considered offline
  DEVICE_OFFLINE_THRESHOLD_MS: parseInt(process.env.DEVICE_OFFLINE_THRESHOLD_MS, 10) || 30000,

  // Maximum number of historical readings to keep per device (in-memory)
  MAX_HISTORY_PER_DEVICE: parseInt(process.env.MAX_HISTORY_PER_DEVICE, 10) || 100,
};
