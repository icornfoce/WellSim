/**
 * WellSim Backend — Device Service
 * 
 * Business logic for managing ESP32 device data.
 * Uses an in-memory Map for temporary storage.
 * 
 * FUTURE: Replace the in-memory store with a database adapter
 *         (see placeholders/database.js).
 */

const config = require('../../config');
const { placeholder: dbPlaceholder } = require('../placeholders/database');
const { placeholder: aiPlaceholder } = require('../placeholders/aiAnalysis');

// ─── In-Memory Store ────────────────────────────────────────────────
// Key: device_id  →  Value: { latest, history[], firstSeen, lastSeen }
const deviceStore = new Map();

/**
 * Store incoming device data.
 * Accepts any JSON fields — future-proof for expanding ESP32 payloads.
 * 
 * @param {Object} data - Raw JSON from ESP32
 * @returns {Object} Stored record with server-side metadata
 */
function storeDeviceData(data) {
  const deviceId = data.device_id || 'unknown';
  const receivedAt = new Date().toISOString();

  // Enrich with server-side metadata
  const record = {
    ...data,
    _receivedAt: receivedAt,
    _serverTimestamp: Date.now(),
  };

  // Get or initialise device entry
  let device = deviceStore.get(deviceId);
  if (!device) {
    device = {
      latest: null,
      history: [],
      firstSeen: receivedAt,
      lastSeen: receivedAt,
    };
    deviceStore.set(deviceId, device);
  }

  // Update latest and history
  device.latest = record;
  device.lastSeen = receivedAt;
  device.history.push(record);

  // Trim history to configured maximum
  if (device.history.length > config.MAX_HISTORY_PER_DEVICE) {
    device.history = device.history.slice(-config.MAX_HISTORY_PER_DEVICE);
  }

  // FUTURE: Persist to database
  dbPlaceholder.save(record);

  // FUTURE: Trigger AI analysis pipeline
  aiPlaceholder.analyze(record);

  return record;
}

/**
 * Retrieve the most recent reading for a device.
 * If no deviceId is specified, returns latest from all devices.
 * 
 * @param {string} [deviceId] - Optional device ID filter
 * @returns {Object|Object[]|null}
 */
function getLatestData(deviceId) {
  if (deviceId) {
    const device = deviceStore.get(deviceId);
    return device ? device.latest : null;
  }

  // Return latest from all devices
  const allLatest = [];
  for (const [id, device] of deviceStore) {
    if (device.latest) {
      allLatest.push({ device_id: id, ...device.latest });
    }
  }
  return allLatest.length > 0 ? allLatest : null;
}

/**
 * Determine device connection status.
 * Online if data received within DEVICE_OFFLINE_THRESHOLD_MS, otherwise Offline.
 * 
 * @param {string} [deviceId] - Optional device ID filter
 * @returns {Object|Object[]|null}
 */
function getDeviceStatus(deviceId) {
  const now = Date.now();

  const buildStatus = (id, device) => {
    const lastTimestamp = device.latest?._serverTimestamp || 0;
    const elapsed = now - lastTimestamp;
    const isOnline = elapsed <= config.DEVICE_OFFLINE_THRESHOLD_MS;

    return {
      device_id: id,
      status: isOnline ? 'online' : 'offline',
      last_seen: device.lastSeen,
      first_seen: device.firstSeen,
      readings_count: device.history.length,
      elapsed_ms: elapsed,
      threshold_ms: config.DEVICE_OFFLINE_THRESHOLD_MS,
    };
  };

  if (deviceId) {
    const device = deviceStore.get(deviceId);
    return device ? buildStatus(deviceId, device) : null;
  }

  // Return status for all devices
  const statuses = [];
  for (const [id, device] of deviceStore) {
    statuses.push(buildStatus(id, device));
  }
  return statuses.length > 0 ? statuses : null;
}

/**
 * Clear all stored data (useful for testing).
 */
function clearAll() {
  deviceStore.clear();
}

module.exports = {
  storeDeviceData,
  getLatestData,
  getDeviceStatus,
  clearAll,
};
