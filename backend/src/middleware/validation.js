/**
 * WellSim Backend — Validation Middleware
 * 
 * Validates incoming ESP32 JSON payloads.
 * Designed to be flexible: only required fields are enforced,
 * additional fields are passed through untouched.
 */

/**
 * Minimum required fields for a valid device data payload.
 * The ESP32 must provide at least a device_id.
 * All other fields are optional and will be stored as-is.
 */
const REQUIRED_FIELDS = ['device_id'];

/**
 * Optional field type hints for validation.
 * If a field is present, its type is checked.
 * Unknown fields are always accepted (future-proof).
 */
const FIELD_TYPE_MAP = {
  device_id: 'string',
  timestamp: 'string',
  audio_status: 'string',
  sample_rate: 'number',
  temperature: 'number',
  battery: 'number',
  wifi_strength: 'number',
};

/**
 * Express middleware — validate device data payload.
 */
function validateDeviceData(req, res, next) {
  const data = req.body;

  // Check that request body exists and is an object
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid payload: expected a JSON object.',
    });
  }

  // Check required fields
  for (const field of REQUIRED_FIELDS) {
    if (!(field in data)) {
      return res.status(400).json({
        success: false,
        error: `Missing required field: "${field}".`,
      });
    }
  }

  // Validate known field types (if present)
  for (const [field, expectedType] of Object.entries(FIELD_TYPE_MAP)) {
    if (field in data && typeof data[field] !== expectedType) {
      return res.status(400).json({
        success: false,
        error: `Invalid type for "${field}": expected ${expectedType}, got ${typeof data[field]}.`,
      });
    }
  }

  // Validate battery range (if present)
  if ('battery' in data && (data.battery < 0 || data.battery > 100)) {
    return res.status(400).json({
      success: false,
      error: 'Battery level must be between 0 and 100.',
    });
  }

  // Payload is valid — proceed
  next();
}

/**
 * Physiologically possible ranges for manually entered vitals.
 *
 * These are deliberately wide — the bounds of human survivability, not
 * of normality — because the job here is to catch typos and junk input,
 * not to second-guess a clinician. A heart rate of 210 is real; 99999
 * is a slipped keypress, and letting it through means the triage score
 * gets computed from nonsense.
 */
const VITALS_RANGES = {
  spo2:        { min: 50,   max: 100,   label: 'SpO₂ (%)' },
  heartRate:   { min: 20,   max: 250,   label: 'Heart rate (bpm)' },
  systolicBP:  { min: 50,   max: 260,   label: 'Systolic BP (mmHg)' },
  diastolicBP: { min: 20,   max: 200,   label: 'Diastolic BP (mmHg)' },
  wbc:         { min: 100,  max: 200000, label: 'WBC (/mcL)' },
  hemoglobin:  { min: 2,    max: 25,    label: 'Hemoglobin (g/dL)' },
};

const DEMOGRAPHIC_RANGES = {
  age:    { min: 0, max: 130, label: 'Age (years)' },
  weight: { min: 0.5, max: 400, label: 'Weight (kg)' },
  height: { min: 20, max: 260, label: 'Height (cm)' },
};

/**
 * Validate a vitals object. Blank/null values mean "not measured" and
 * are always allowed — the UI shows "—" for them.
 *
 * @returns {string[]} Human-readable errors, empty if valid
 */
function validateVitals(vitals = {}) {
  const errors = [];
  for (const [field, range] of Object.entries(VITALS_RANGES)) {
    if (!(field in vitals)) continue;
    const raw = vitals[field];
    if (raw === null || raw === undefined || raw === '') continue;

    const value = Number(raw);
    if (!Number.isFinite(value)) {
      errors.push(`${range.label} must be a number.`);
      continue;
    }
    if (value < range.min || value > range.max) {
      errors.push(`${range.label} must be between ${range.min} and ${range.max} (got ${value}).`);
    }
  }

  // Systolic must exceed diastolic — otherwise the reading is transposed
  const sys = Number(vitals.systolicBP);
  const dia = Number(vitals.diastolicBP);
  if (Number.isFinite(sys) && Number.isFinite(dia) && sys > 0 && dia > 0 && sys <= dia) {
    errors.push(`Systolic BP (${sys}) must be higher than diastolic (${dia}) — values may be swapped.`);
  }

  return errors;
}

/** Validate age / weight / height on a patient payload. */
function validateDemographics(data = {}) {
  const errors = [];
  for (const [field, range] of Object.entries(DEMOGRAPHIC_RANGES)) {
    if (!(field in data)) continue;
    const raw = data[field];
    if (raw === null || raw === undefined || raw === '') continue;

    const value = Number(raw);
    if (!Number.isFinite(value)) {
      errors.push(`${range.label} must be a number.`);
    } else if (value < range.min || value > range.max) {
      errors.push(`${range.label} must be between ${range.min} and ${range.max} (got ${value}).`);
    }
  }

  if ('name' in data && String(data.name).length > 200) {
    errors.push('Patient name must be 200 characters or fewer.');
  }
  return errors;
}

/** Express middleware — reject out-of-range vitals before they are stored. */
function validateVitalsPayload(req, res, next) {
  let body = req.body || {};
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
      req.body = body;
    } catch {
      body = {};
    }
  }
  // Accept both { spo2: … } and { vitals: { spo2: … } } shapes
  const vitals = body.vitals && typeof body.vitals === 'object' ? body.vitals : body;

  const errors = [...validateVitals(vitals), ...validateDemographics(body)];
  if (errors.length) {
    return res.status(400).json({
      success: false,
      error: errors[0],
      errors,
    });
  }
  next();
}

module.exports = {
  validateDeviceData,
  validateVitals,
  validateDemographics,
  validateVitalsPayload,
  VITALS_RANGES,
  DEMOGRAPHIC_RANGES,
};
