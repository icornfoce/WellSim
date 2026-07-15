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

module.exports = { validateDeviceData };
