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
const fs = require('fs');
const path = require('path');
const deviceService = require('../services/deviceService');
const dbService = require('../services/dbService');
const { getPatientById } = require('../services/dbService');
const { validateDeviceData } = require('../middleware/validation');
const { requireAuth } = require('../middleware/auth');

// In-memory store for device commands
// Key: device_id -> Value: { command, patient_id, type }
const deviceCommands = new Map();

// ─── POST /api/device/command ────────────────────────────────────────
// Called by Web UI to issue a command (e.g. record)
router.post('/command', (req, res) => {
  const { device_id, command, patient_id, type } = req.body;
  if (!device_id || !command) {
    return res.status(400).json({ success: false, error: 'Missing device_id or command' });
  }

  deviceCommands.set(device_id, {
    command,
    patient_id: patient_id || 'p1',
    type: type || 'lung',
    timestamp: Date.now()
  });

  res.status(200).json({ success: true, message: `Command '${command}' set for device '${device_id}'` });
});

// ─── GET /api/device/command ─────────────────────────────────────────
// Polled by ESP32 to check for pending commands
router.get('/command', (req, res) => {
  const { device_id } = req.query;
  if (!device_id) {
    return res.status(400).json({ success: false, error: 'Missing device_id parameter' });
  }

  const cmd = deviceCommands.get(device_id);
  if (cmd) {
    // Clear command immediately so it is only executed once
    deviceCommands.delete(device_id);
    return res.status(200).json(cmd);
  }

  res.status(200).json({ command: 'none' });
});

router.post('/audio', (req, res) => {
  try {
    console.log('📥 Incoming /audio request headers:', req.headers);
    
    let body = req.body;
    // If the body is a string (e.g. text/plain), try parsing it as JSON first
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        // Not a JSON string, keep it as raw text
      }
    }

    console.log('📥 Incoming /audio request parsed body type:', typeof body);

    let device_id, patient_id, audio_base64, type, duration, mime_type;

    if (body && typeof body === 'object') {
      device_id = body.device_id;
      patient_id = body.patient_id;
      audio_base64 = body.audio_base64;
      type = body.type;
      duration = body.duration;
      mime_type = body.mime_type;
    } else if (typeof body === 'string') {
      // Fallback: If body is a raw base64 string
      audio_base64 = body;
    }

    // Clear any pending commands for this device on audio upload
    if (device_id) {
      deviceCommands.delete(device_id);
    }

    if (!audio_base64) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: "audio_base64".',
        debug_body_type: typeof body,
        debug_body_preview: typeof body === 'string' ? body.substring(0, 100) : (body ? Object.keys(body) : null)
      });
    }

    const audioType = type || 'lung'; // 'lung' | 'heart' | 'cough'
    const deviceId = device_id || 'unknown';
    
    // Auto-associate with selected patient (e.g. 'p1' if none provided)
    const targetPatientId = patient_id || 'p1';

    // Decode Base64 string to buffer
    const audioBuffer = Buffer.from(audio_base64, 'base64');

    // Create uploads directory if not exists
    const uploadsDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    // Determine extension based on mime_type
    let ext = 'wav';
    if (mime_type && typeof mime_type === 'string') {
      if (mime_type.includes('webm')) ext = 'webm';
      else if (mime_type.includes('mp4') || mime_type.includes('aac')) ext = 'mp4';
      else if (mime_type.includes('ogg')) ext = 'ogg';
    }

    // Save audio file to uploads folder
    const filename = `audio_${deviceId}_${audioType}_${Date.now()}.${ext}`;
    const filePath = path.join(uploadsDir, filename);
    fs.writeFileSync(filePath, audioBuffer);

    const audioUrl = `/uploads/${filename}`;
    const playDuration = duration || '0:10';

    // Update patient record with new audio log
    const updatedPatient = dbService.savePatientAudio(targetPatientId, audioType, audioUrl, playDuration);

    if (!updatedPatient) {
      return res.status(404).json({
        success: false,
        error: `Patient with ID "${targetPatientId}" not found.`,
      });
    }

    console.log(`🔊 Audio file saved: ${audioUrl} for patient ${targetPatientId}`);

    // ── Layer 1: screen the recording immediately ──
    // Running this on upload rather than on demand means a field worker
    // gets a triage level before they have even put the device down.
    // The result is stored as "awaiting physician confirmation".
    let analysis = null;
    try {
      const { runAnalysisFor } = require('./analysis');
      const result = runAnalysisFor(targetPatientId, audioType);
      if (result.ok) {
        analysis = result.analysis;
        console.log(
          `🧠 Auto-analysis (${audioType}): ${analysis.label} @ ${analysis.confidence} ` +
          `→ triage ${analysis.triage?.level}`
        );
      } else {
        console.warn(`⚠️ Auto-analysis skipped: ${result.message}`);
      }
    } catch (e) {
      // A failure here must never lose the recording itself
      console.error('⚠️ Auto-analysis failed (audio was still saved):', e.message);
    }

    res.status(200).json({
      success: true,
      message: analysis
        ? 'Audio received, saved, and screened. Awaiting physician confirmation.'
        : 'Audio received and saved successfully.',
      audioUrl,
      patient: analysis ? getPatientById(targetPatientId) : updatedPatient,
      analysis,
    });
  } catch (error) {
    console.error('❌ Error saving audio data:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error while processing audio data.',
    });
  }
});

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
