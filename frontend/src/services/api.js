/**
 * WellSim Frontend — API Service
 * 
 * Centralized API client for communicating with the Express backend.
 * Includes authentication, device, and patient endpoints.
 * Points to the production backend deployed on Render.
 */

const getApiUrl = () => {
  if (typeof window === 'undefined') {
    return 'https://wellsim-backend.onrender.com';
  }
  const hostname = window.location.hostname;
  const isLocal =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('10.') ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) ||
    hostname.endsWith('.local');

  return isLocal ? `http://${hostname}:3001` : 'https://wellsim-backend.onrender.com';
};

export const API_URL = getApiUrl();
const DEVICE_BASE = `${API_URL}/api/device`;
const AUTH_BASE = `${API_URL}/api/auth`;
const PATIENTS_BASE = `${API_URL}/api/patients`;
const ANALYSIS_BASE = `${API_URL}/api/analysis`;

// ─── Helper: Get auth headers & handle auth errors ────────────────────

function getAuthHeaders() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('wellsim_token') : null;
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

function checkAuthError(response, data) {
  if (response.status === 401 && typeof window !== 'undefined') {
    localStorage.removeItem('wellsim_token');
    localStorage.removeItem('wellsim_user');
    if (window.location.pathname !== '/login') {
      window.location.replace('/login');
    }
  }
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

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    checkAuthError(response, data);
    throw new Error(data.error || 'Session invalid');
  }
  return data;
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
    checkAuthError(response, errorData);
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
    checkAuthError(response, errorData);
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Create a new patient. Requires authentication.
 *
 * @param {Object} patient - Patient fields (name, age, gender, weight, height, vitals, ...)
 * @returns {Promise<Object>} { success, patient }
 */
export async function createPatient(patient) {
  const response = await fetch(PATIENTS_BASE, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(patient),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    checkAuthError(response, errorData);
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Update a patient's record (demographics and/or vitals).
 * Backend recalculates risk when vitals change. Requires authentication.
 *
 * @param {string} patientId
 * @param {Object} updates
 * @returns {Promise<Object>} { success, patient }
 */
export async function updatePatient(patientId, updates) {
  const response = await fetch(`${PATIENTS_BASE}/${patientId}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    checkAuthError(response, errorData);
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Delete a patient by ID. Requires authentication.
 *
 * @param {string} patientId
 * @returns {Promise<Object>} { success, patient }
 */
export async function deletePatient(patientId) {
  const response = await fetch(`${PATIENTS_BASE}/${patientId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    checkAuthError(response, errorData);
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

// ─── Registration API ────────────────────────────────────────────────

/**
 * Create a new staff account.
 *
 * @param {Object} data - { name, email, password, role, station }
 * @returns {Promise<Object>} { success, token, user }
 */
export async function register({ name, email, password, role, station, staffCode }) {
  const response = await fetch(`${AUTH_BASE}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password, role, station, staffCode }),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Registration failed. Please try again.');
  }

  return data;
}

// ─── Audio API ───────────────────────────────────────────────────────

/**
 * Upload a recording. The backend screens it automatically on arrival,
 * so the response already carries the AI result.
 *
 * @param {Object} payload - { patient_id, type, audio_base64, duration, device_id }
 * @returns {Promise<Object>} { success, audioUrl, patient, analysis }
 */
export async function uploadAudio({ patientId, type, audioBase64, duration, deviceId = 'FILE-UPLOAD' }) {
  const response = await fetch(`${DEVICE_BASE}/audio`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({
      device_id: deviceId,
      patient_id: patientId,
      type,
      duration,
      audio_base64: audioBase64,
      mime_type: 'audio/wav',
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    throw new Error(data.error || `Upload failed (HTTP ${response.status})`);
  }
  return data;
}

/**
 * Ask a device to start recording.
 *
 * @param {Object} payload - { deviceId, command, patientId, type }
 * @returns {Promise<Object>} { success, message }
 */
export async function sendDeviceCommand({ deviceId, command, patientId, type }) {
  const response = await fetch(`${DEVICE_BASE}/command`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({
      device_id: deviceId,
      command,
      patient_id: patientId,
      type,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    throw new Error(data.error || `Command failed (HTTP ${response.status})`);
  }
  return data;
}

/**
 * Delete a recording, its stored file, and the analysis derived from it.
 *
 * @param {string} patientId
 * @param {'lung'|'heart'|'cough'} type
 * @returns {Promise<Object>} { success, fileRemoved, hadReview, patient }
 */
export async function deleteAudio(patientId, type) {
  const response = await fetch(`${DEVICE_BASE}/audio/${patientId}/${type}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    checkAuthError(response, data);
    throw new Error(data.error || `Delete failed (HTTP ${response.status})`);
  }
  return data;
}

// ─── AI Analysis & Physician Review API ──────────────────────────────

/** Shared response unwrapper for the analysis endpoints. */
async function unwrap(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    checkAuthError(response, data);
    const err = new Error(data.error || `HTTP ${response.status}`);
    err.status = response.status;
    err.requiredRoles = data.requiredRoles;
    throw err;
  }
  return data;
}

/**
 * Layer 1 — run the screening engine over a stored recording.
 * Any authenticated clinical user may trigger this.
 *
 * @param {string} patientId
 * @param {'lung'|'heart'|'cough'} type
 * @returns {Promise<Object>} { success, analysis, patient }
 */
export async function runAnalysis(patientId, type) {
  return unwrap(await fetch(`${ANALYSIS_BASE}/run`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ patient_id: patientId, type }),
  }));
}

/**
 * Fetch every stored analysis for a patient, with review state.
 *
 * @param {string} patientId
 * @returns {Promise<Object>} { success, analyses, reviewSummary, canReview }
 */
export async function fetchAnalyses(patientId) {
  return unwrap(await fetch(`${ANALYSIS_BASE}/${patientId}`, {
    headers: getAuthHeaders(),
    cache: 'no-store',
  }));
}

/**
 * Layer 2 — a physician's verdict on an AI result.
 * The server rejects this with 403 for any non-doctor account.
 *
 * @param {string} patientId
 * @param {'lung'|'heart'|'cough'} type
 * @param {Object} verdict - { action: 'confirm'|'modify'|'reject', finalLabel?, finalTriage?, note? }
 * @returns {Promise<Object>} { success, review, patient, feedbackLogged }
 */
export async function submitReview(patientId, type, verdict) {
  return unwrap(await fetch(`${ANALYSIS_BASE}/${patientId}/${type}/review`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(verdict),
  }));
}

/**
 * Live AI-versus-physician agreement statistics.
 *
 * @returns {Promise<Object>} { success, modelVersion, stats }
 */
export async function fetchAgreementStats() {
  return unwrap(await fetch(`${ANALYSIS_BASE}/stats/agreement`, {
    headers: getAuthHeaders(),
    cache: 'no-store',
  }));
}

/** URL of the physician-correction dataset export (doctors only). */
export function feedbackExportUrl(format = 'json') {
  return `${ANALYSIS_BASE}/feedback/export?format=${format}`;
}

/**
 * Fetch the logged-in patient's own triage record.
 *
 * @returns {Promise<Object>} { success, patient }
 */
export async function fetchMyRecord() {
  const response = await fetch(`${PATIENTS_BASE}/me`, {
    headers: getAuthHeaders(),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Failed to fetch your record.');
  }

  return data;
}

/**
 * Update the logged-in patient's own demographic record.
 * Accepts partial updates for allowed fields.
 */
export async function updateMyRecord(updates) {
  const response = await fetch(`${PATIENTS_BASE}/me`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(updates),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Failed to update your record.');
  }

  return data;
}
