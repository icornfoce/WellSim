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
const analysisRoutes = require('./src/routes/analysis');

const path = require('path');

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

// Serve uploaded audio files statically with proper MIME types and CORS
app.use('/uploads', (req, res, next) => {
  // Ensure CORS headers are set for audio file requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  next();
}, express.static(path.join(__dirname, 'uploads'), {
  setHeaders: (res, filePath) => {
    // Set correct Content-Type based on file extension
    if (filePath.endsWith('.webm')) res.setHeader('Content-Type', 'audio/webm');
    else if (filePath.endsWith('.mp4')) res.setHeader('Content-Type', 'audio/mp4');
    else if (filePath.endsWith('.ogg')) res.setHeader('Content-Type', 'audio/ogg');
    else if (filePath.endsWith('.wav')) res.setHeader('Content-Type', 'audio/wav');
  }
}));

// Force Content-Type to JSON for device API if Content-Type is text/plain or missing
app.use('/api/device', (req, res, next) => {
  if (req.method === 'POST') {
    const ct = req.headers['content-type'];
    if (!ct || ct.includes('text/plain')) {
      req.headers['content-type'] = 'application/json';
    }
  }
  next();
});

// Parse JSON, URL-encoded, and raw text request bodies (with 15MB limit for audio data)
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ limit: '15mb', extended: true }));
app.use(express.text({ limit: '15mb', type: ['text/*', 'application/octet-stream', 'application/json'] }));

// ─── Routes ─────────────────────────────────────────────────────────

// Device API routes
app.use('/api/device', deviceRoutes);

// Authentication routes
app.use('/api/auth', authRoutes);

// Patient management routes
app.use('/api/patients', patientRoutes);

// AI analysis (layer 1) & physician review (layer 2) routes
app.use('/api/analysis', analysisRoutes);

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
  console.log('║  POST /api/device/audio   — Upload & auto-screen     ║');
  console.log('║  DEL  /api/device/audio/:pid/:type — Delete audio    ║');
  console.log('║  GET  /api/device/latest  — Latest reading           ║');
  console.log('║  GET  /api/device/status  — Device status            ║');
  console.log('║  POST /api/auth/login     — User authentication      ║');
  console.log('║  GET  /api/auth/me        — Verify session           ║');
  console.log('║  GET    /api/patients     — Patient list (auth)      ║');
  console.log('║  POST   /api/patients     — Create patient (auth)    ║');
  console.log('║  PUT    /api/patients/:id — Update patient (auth)    ║');
  console.log('║  DELETE /api/patients/:id — Delete patient (auth)    ║');
  console.log('║                                                      ║');
  console.log('║  AI screening (layer 1) & review (layer 2):          ║');
  console.log('║  POST /api/analysis/run              — Screen audio  ║');
  console.log('║  GET  /api/analysis/:pid             — Get results   ║');
  console.log('║  POST /api/analysis/:pid/:type/review — DOCTOR ONLY  ║');
  console.log('║  GET  /api/analysis/stats/agreement  — AI vs doctor  ║');
  console.log('║  GET  /api/analysis/feedback/export  — Retrain data  ║');
  console.log('║  GET    /api/health       — Health check             ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');
});

module.exports = app;
