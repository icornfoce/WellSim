/**
 * WellSim Backend — Authentication Middleware
 * 
 * Protects routes by verifying JWT-like tokens from the Authorization header.
 * Uses HMAC-SHA256 for token signing (no external dependencies).
 */

const crypto = require('crypto');
const config = require('../../config');

// Resolved in config/index.js, which refuses to boot in production
// without a real secret rather than falling back to a public constant.
const TOKEN_SECRET = config.TOKEN_SECRET;
const TOKEN_EXPIRY_HOURS = 24;

/** Constant-time string compare — leaks no information via timing. */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ─── Token Creation ──────────────────────────────────────────────────

/**
 * Generate a signed token for a user.
 * Format: base64(payload).signature
 * 
 * @param {Object} user - User object (id, email, role, name)
 * @returns {string} Signed token string
 */
function generateToken(user) {
  const payload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    iat: Date.now(),
    exp: Date.now() + (TOKEN_EXPIRY_HOURS * 60 * 60 * 1000),
  };

  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(payloadBase64)
    .digest('base64url');

  return `${payloadBase64}.${signature}`;
}

// ─── Token Verification ──────────────────────────────────────────────

/**
 * Verify and decode a token.
 * 
 * @param {string} token - Token string
 * @returns {Object|null} Decoded payload or null if invalid/expired
 */
function verifyToken(token) {
  try {
    const [payloadBase64, signature] = token.split('.');
    if (!payloadBase64 || !signature) return null;

    // Verify signature
    const expectedSig = crypto
      .createHmac('sha256', TOKEN_SECRET)
      .update(payloadBase64)
      .digest('base64url');

    if (!safeEqual(signature, expectedSig)) return null;

    // Decode payload
    const payload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString());

    // Check expiration
    if (payload.exp && Date.now() > payload.exp) return null;

    return payload;
  } catch {
    return null;
  }
}

// ─── Express Middleware ──────────────────────────────────────────────

/**
 * Express middleware to protect routes.
 * Reads the Authorization: Bearer <token> header.
 * On success, injects req.user with the decoded payload.
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required. Please provide a valid token.',
    });
  }

  const token = authHeader.substring(7); // Remove 'Bearer '
  const decoded = verifyToken(token);

  if (!decoded) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired token. Please log in again.',
    });
  }

  // Attach user info to the request
  req.user = decoded;
  next();
}

/**
 * Restrict a route to specific roles. Always used *after* requireAuth.
 *
 * The physician-review endpoints depend on this: an AI result may only
 * be confirmed, modified, or rejected by a user whose role is 'doctor'.
 * A nurse can see the result and its status, but cannot sign it off.
 *
 * @param {...string} roles - Allowed roles, e.g. requireRole('doctor')
 */
function requireRole(...roles) {
  return function (req, res, next) {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required.',
      });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: `This action requires the role: ${roles.join(' or ')}. ` +
               `Your account is registered as "${req.user.role}".`,
        requiredRoles: roles,
        yourRole: req.user.role,
      });
    }
    next();
  };
}

/**
 * Accept EITHER a logged-in clinical user OR a registered IoT device.
 *
 * The dashboard drives these endpoints with a user token; the ESP32
 * has no user account and presents `X-Device-Key` instead. Before this
 * existed the endpoints were fully open, which meant anyone on the
 * internet could plant a recording into a patient's record or make a
 * device in a clinic start recording.
 */
function requireDeviceOrUser(req, res, next) {
  const deviceKey = req.headers['x-device-key'];
  if (deviceKey && safeEqual(deviceKey, config.DEVICE_API_KEY)) {
    req.device = { authenticated: true, id: req.body?.device_id || 'unknown' };
    return next();
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const decoded = verifyToken(authHeader.substring(7));
    if (decoded) {
      req.user = decoded;
      return next();
    }
  }

  return res.status(401).json({
    success: false,
    error:
      'Authentication required. Sign in as clinical staff, or send the ' +
      'device key in the X-Device-Key header.',
  });
}

/**
 * Fixed-window rate limiter, in memory.
 *
 * Enough to stop credential stuffing against the login endpoint on a
 * single-instance deployment. A multi-instance deployment needs a
 * shared store (Redis) — noted in docs/SECURITY.md.
 */
function rateLimit({ windowMs = 60_000, max = 10, keyPrefix = '' } = {}) {
  const hits = new Map();

  // Evict expired buckets so the map cannot grow without bound
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (now > entry.resetAt) hits.delete(key);
    }
  }, windowMs).unref();

  return function (req, res, next) {
    const ip =
      (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      req.socket.remoteAddress ||
      'unknown';
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();

    let entry = hits.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count++;

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      return res.status(429).json({
        success: false,
        error: `Too many attempts. Please try again in ${retryAfter} seconds.`,
      });
    }
    next();
  };
}

module.exports = {
  generateToken,
  verifyToken,
  requireAuth,
  requireRole,
  requireDeviceOrUser,
  rateLimit,
  safeEqual,
};
