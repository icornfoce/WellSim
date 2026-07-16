/**
 * WellSim Backend — Express Server
 * 
 * Main entry point for the IoT Healthcare API.
 * Receives sensor data from ESP32 devices and serves it
 * to the Next.js dashboard via REST endpoints.
 * 
 * Architecture:
 *   ESP32  →  POST /api/device/data  →  In-Memory Store
 *   Dashboard  ←  GET /api/device/latest  ←  In-Memory Store
 *   Dashboard  ←  GET /api/device/status  ←  In-Memory Store
 */

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const config = require('./config');
const deviceRoutes = require('./src/routes/device');
const authRoutes = require('./src/routes/auth');
const patientRoutes = require('./src/routes/patients');

// ─── Create Express App ─────────────────────────────────────────────
const app = express();

// ─── Middleware ──────────────────────────────────────────────────────

// CORS — allow frontend to communicate with the API from any domain
app.use(cors({
  origin: true, // อนุญาตทุก Origin เพื่อป้องกันปัญหา CORS กับ Cloudflare
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Request logging
app.use(morgan('dev'));

// Parse JSON request bodies (with 1MB limit for future audio data)
app.use(express.json({ limit: '1mb' }));

// ─── Routes ─────────────────────────────────────────────────────────

// Device API routes
app.use('/api/device', deviceRoutes);

// Authentication routes
app.use('/api/auth', authRoutes);

// Patient management routes
app.use('/api/patients', patientRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    service: 'WellSim IoT Healthcare API',
    version: '1.0.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ─── 404 Handler ────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// ─── Global Error Handler ───────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('🔥 Unhandled error:', err.stack);
  res.status(500).json({
    success: false,
    error: 'An unexpected error occurred.',
  });
});

// ─── Start Server ───────────────────────────────────────────────────
app.listen(config.PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║       WellSim IoT Healthcare API Server             ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  🚀 Running on:    http://localhost:${config.PORT}            ║`);
  console.log(`║  🌍 Environment:   ${config.NODE_ENV.padEnd(30)}  ║`);
  console.log(`║  📡 CORS Origins:  ${config.CORS_ORIGINS.join(', ').padEnd(30)}  ║`);
  console.log('║                                                      ║');
  console.log('║  Endpoints:                                          ║');
  console.log('║  POST /api/device/data    — Receive ESP32 data       ║');
  console.log('║  GET  /api/device/latest  — Latest reading           ║');
  console.log('║  GET  /api/device/status  — Device status            ║');
  console.log('║  POST /api/auth/login     — User authentication      ║');
  console.log('║  GET  /api/auth/me        — Verify session           ║');
  console.log('║  GET  /api/patients       — Patient list (auth)      ║');
  console.log('║  PUT  /api/patients/:id   — Update vitals (auth)     ║');
  console.log('║  GET  /api/health         — Health check             ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');
});

module.exports = app;
