/**
 * WellSim Frontend — API Service
 * 
 * Centralized API client for communicating with the Express backend.
 * Includes authentication, device, and patient endpoints.
 * Points to the production backend deployed on Render.
 */

const API_URL = 'https://wellsim-backend.onrender.com';
const DEVICE_BASE = `${API_URL}/api/device`;
const AUTH_BASE = `${API_URL}/api/auth`;
const PATIENTS_BASE = `${API_URL}/api/patients`;

// ─── Helper: Get auth headers ────────────────────────────────────────

function getAuthHeaders() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('wellsim_token') : null;
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

// ─── Authentication API ──────────────────────────────────────────────

/**
 * Login with email and password.
 * 
 * @param {string} email
 * @param {string} password
 * @returns {Promise<Object>} { success, token, user }
 */
export async function login(email, password) {
  const response = await fetch(`${AUTH_BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Login failed');
  }
  return data;
}

/**
 * Verify current session token.
 * 
 * @returns {Promise<Object>} { success, user }
 */
export async function verifySession() {
  const response = await fetch(`${AUTH_BASE}/me`, {
    method: 'GET',
    headers: getAuthHeaders(),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error('Session invalid');
  }
  return response.json();
}

// ─── Patient API ─────────────────────────────────────────────────────

/**
 * Fetch all patients from the backend.
 * Requires authentication.
 * 
 * @returns {Promise<Object>} { success, patients[] }
 */
export async function fetchPatients() {
  const response = await fetch(PATIENTS_BASE, {
    method: 'GET',
    headers: getAuthHeaders(),
    cache: 'no-store',
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Update a patient's vitals. Backend will recalculate risk.
 * Requires authentication.
 * 
 * @param {string} patientId
 * @param {Object} vitals
 * @returns {Promise<Object>} { success, patient }
 */
export async function updatePatientVitals(patientId, vitals) {
  const response = await fetch(`${PATIENTS_BASE}/${patientId}/vitals`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(vitals),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }
  return response.json();
}

// ─── Device API ──────────────────────────────────────────────────────

/**
 * Fetch the latest sensor data from the backend.
 * 
 * @param {string} [deviceId] - Optional device ID filter
 * @returns {Promise<Object>} Latest device data
 */
export async function fetchLatestData(deviceId) {
  const url = deviceId
    ? `${DEVICE_BASE}/latest?device_id=${encodeURIComponent(deviceId)}`
    : `${DEVICE_BASE}/latest`;

  const response = await fetch(url, {
    method: 'GET',
    headers: getAuthHeaders(),
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
    ? `${DEVICE_BASE}/status?device_id=${encodeURIComponent(deviceId)}`
    : `${DEVICE_BASE}/status`;

  const response = await fetch(url, {
    method: 'GET',
    headers: getAuthHeaders(),
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
 * 
 * @param {Object} data - Test sensor data payload
 * @returns {Promise<Object>} Server response
 */
export async function sendTestData(data) {
  const response = await fetch(`${DEVICE_BASE}/data`, {
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
