/**
 * WellSim Backend — Device Routes
 * 
 * REST API endpoints for ESP32 device communication.
 * 
 * Routes:
 *   POST /api/device/data    — Receive sensor data from ESP32
 *   GET  /api/device/latest  — Retrieve latest reading(s)
 *   GET  /api/device/status  — Check device connection status
 */

const express = require('express');
const router = express.Router();
const deviceService = require('../services/deviceService');
const { validateDeviceData } = require('../middleware/validation');
const { requireAuth } = require('../middleware/auth');

// ─── POST /api/device/data ──────────────────────────────────────────
// Receive sensor data from ESP32.
// The validation middleware ensures payload integrity before processing.
router.post('/data', validateDeviceData, (req, res) => {
  try {
    const record = deviceService.storeDeviceData(req.body);

    console.log(`📡 Data received from ${record.device_id} at ${record._receivedAt}`);

    res.status(200).json({
      success: true,
      message: 'Data received successfully.',
      device_id: record.device_id,
      received_at: record._receivedAt,
    });
  } catch (error) {
    console.error('❌ Error storing device data:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error while processing device data.',
    });
  }
});

// ─── GET /api/device/latest ─────────────────────────────────────────
// Retrieve the latest sensor reading.
// Optional query param: ?device_id=ESP32-001
router.get('/latest', requireAuth, (req, res) => {
  try {
    const { device_id } = req.query;
    const data = deviceService.getLatestData(device_id);

    if (!data) {
      return res.status(404).json({
        success: false,
        error: device_id
          ? `No data found for device "${device_id}".`
          : 'No device data available yet.',
      });
    }

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('❌ Error retrieving latest data:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error while retrieving data.',
    });
  }
});

// ─── GET /api/device/status ─────────────────────────────────────────
// Check device connection status (online/offline).
// Optional query param: ?device_id=ESP32-001
router.get('/status', requireAuth, (req, res) => {
  try {
    const { device_id } = req.query;
    const status = deviceService.getDeviceStatus(device_id);

    if (!status) {
      return res.status(404).json({
        success: false,
        error: device_id
          ? `No device found with ID "${device_id}".`
          : 'No devices registered yet.',
      });
    }

    res.status(200).json({
      success: true,
      ...( Array.isArray(status) ? { devices: status } : status ),
    });
  } catch (error) {
    console.error('❌ Error retrieving device status:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error while checking device status.',
    });
  }
});

module.exports = router;
