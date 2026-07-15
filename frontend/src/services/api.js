/**
 * WellSim Frontend — API Service
 * 
 * Centralized API client for communicating with the Express backend.
 * All API calls go through Next.js rewrites → Express backend.
 */

const API_BASE = '/api/device';

/**
 * Fetch the latest sensor data from the backend.
 * 
 * @param {string} [deviceId] - Optional device ID filter
 * @returns {Promise<Object>} Latest device data
 */
export async function fetchLatestData(deviceId) {
  const url = deviceId
    ? `${API_BASE}/latest?device_id=${encodeURIComponent(deviceId)}`
    : `${API_BASE}/latest`;

  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Fetch device connection status from the backend.
 * 
 * @param {string} [deviceId] - Optional device ID filter
 * @returns {Promise<Object>} Device status
 */
export async function fetchDeviceStatus(deviceId) {
  const url = deviceId
    ? `${API_BASE}/status?device_id=${encodeURIComponent(deviceId)}`
    : `${API_BASE}/status`;

  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Send test data to the backend (for development/testing).
 * Simulates an ESP32 device sending sensor data.
 * 
 * @param {Object} data - Test sensor data payload
 * @returns {Promise<Object>} Server response
 */
export async function sendTestData(data) {
  const response = await fetch(`${API_BASE}/data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }

  return response.json();
}
