/**
 * WellSim Backend — Configuration
 * 
 * Centralized configuration for the Express server.
 * All environment-specific values are managed here.
 */

require('dotenv').config();
const crypto = require('crypto');

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';

/**
 * Resolve a secret from the environment.
 *
 * In production a missing secret is fatal: a hardcoded fallback that
 * ships in a public repository is the same as having no authentication
 * at all — anyone who can read the source can mint a doctor token and
 * sign off AI results. In development we generate a random one per boot
 * (which invalidates old tokens on restart — that is the point) and say
 * so loudly.
 */
function requireSecret(name, devFallbackLabel) {
  const value = process.env[name];
  if (value && value.length >= 16) return value;

  if (isProd) {
    console.error(
      `\n🔴 FATAL: ${name} is not set (or is shorter than 16 characters).\n` +
      `   Refusing to start in production with a guessable secret.\n` +
      `   Generate one with:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"\n`
    );
    process.exit(1);
  }

  const generated = crypto.randomBytes(32).toString('hex');
  console.warn(
    `⚠️  ${name} not set — generated a random ${devFallbackLabel} for this session. ` +
    `Sessions will not survive a restart. Set it in backend/.env for stable dev logins.`
  );
  return generated;
}

module.exports = {
  // Server
  PORT: process.env.PORT || 3001,
  NODE_ENV,
  IS_PRODUCTION: isProd,

  // ─── Secrets ──────────────────────────────────────────────────────
  TOKEN_SECRET: requireSecret('TOKEN_SECRET', 'token secret'),

  /**
   * Shared key the ESP32 firmware sends as `X-Device-Key`. Without it,
   * anyone on the internet can post fabricated recordings into a
   * patient's medical record or command a device to start recording.
   */
  DEVICE_API_KEY: requireSecret('DEVICE_API_KEY', 'device key'),

  /**
   * Required to register a `nurse` or `doctor` account. Clinical roles
   * decide whether an AI result becomes a finding, so they cannot be
   * self-assigned from a public signup form.
   */
  STAFF_REGISTRATION_CODE: process.env.STAFF_REGISTRATION_CODE || null,

  // CORS — allowed frontend origins
  CORS_ORIGINS: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
    : ['http://localhost:3000', 'https://wellsim.pages.dev'],

  // Device status threshold (milliseconds)
  // If no data received within this window, device is considered offline
  DEVICE_OFFLINE_THRESHOLD_MS: parseInt(process.env.DEVICE_OFFLINE_THRESHOLD_MS, 10) || 30000,

  // Maximum number of historical readings to keep per device (in-memory)
  MAX_HISTORY_PER_DEVICE: parseInt(process.env.MAX_HISTORY_PER_DEVICE, 10) || 100,
};
