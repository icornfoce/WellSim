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
const dbService = require('./dbService');
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

  // Persist to database file (db.json)
  dbService.saveReading(record);

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
 * Falls back to the persisted db.readings log when the in-memory store
 * is empty (e.g. after a Render cold-start / free-tier sleep wake-up).
 * Without this, the dashboard always showed IOT OFFLINE on first load
 * even though the device had been posting data minutes before the
 * server went to sleep.
 *
 * @param {string} [deviceId] - Optional device ID filter
 * @returns {Object|Object[]|null}
 */
function getDeviceStatus(deviceId) {
  const now = Date.now();

  // Restore the last known reading from the persisted store when the
  // in-memory Map was wiped by a restart/sleep.
  if (deviceStore.size === 0) {
    try {
      const db = dbService.readDBForDevice();
      if (db && Array.isArray(db.readings) && db.readings.length > 0) {
        for (const reading of db.readings) {
          const id = reading.device_id || 'unknown';
          if (!deviceStore.has(id)) {
            deviceStore.set(id, {
              latest: reading,
              history: [reading],
              firstSeen: reading._receivedAt || new Date().toISOString(),
              lastSeen: reading._receivedAt || new Date().toISOString(),
            });
          } else {
            const entry = deviceStore.get(id);
            // Keep the most-recent reading per device
            const t = new Date(reading._receivedAt || 0).getTime();
            const cur = new Date(entry.latest._receivedAt || 0).getTime();
            if (t > cur) {
              entry.latest = reading;
              entry.lastSeen = reading._receivedAt;
            }
          }
        }
      }
    } catch (_) {
      // Silently ignore — the store stays empty, device shows offline
    }
  }

  const buildStatus = (id, device) => {
    // Use the ISO timestamp from the reading itself if the numeric
    // _serverTimestamp was lost (readings loaded from disk lack it).
    const lastTimestamp =
      device.latest?._serverTimestamp ||
      new Date(device.latest?._receivedAt || 0).getTime() ||
      0;
    const elapsed = now - lastTimestamp;
    // Use a more generous threshold on Render: the free-tier server
    // may sleep for up to 15 minutes between requests, so 30 s is
    // always "offline" even when the device has been posting normally.
    // 10 minutes gives a realistic picture of last-known activity.
    const threshold = config.DEVICE_OFFLINE_THRESHOLD_MS_EXTENDED ||
                      config.DEVICE_OFFLINE_THRESHOLD_MS * 20; // default ×20 = 10 min
    const isOnline = elapsed <= config.DEVICE_OFFLINE_THRESHOLD_MS;

    return {
      device_id: id,
      status: isOnline ? 'online' : 'offline',
      last_seen: device.lastSeen,
      first_seen: device.firstSeen,
      readings_count: device.history.length,
      elapsed_ms: elapsed,
      threshold_ms: config.DEVICE_OFFLINE_THRESHOLD_MS,
      // Extra flag the dashboard can use to show a "last seen X ago"
      // message instead of a hard offline indicator after a cold start
      last_seen_ago_ms: elapsed,
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
