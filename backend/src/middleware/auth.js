/**
 * WellSim Backend — Authentication Middleware
 * 
 * Protects routes by verifying JWT-like tokens from the Authorization header.
 * Uses HMAC-SHA256 for token signing (no external dependencies).
 */

const crypto = require('crypto');

const TOKEN_SECRET = process.env.TOKEN_SECRET || 'wellsim-secret-key-2026';
const TOKEN_EXPIRY_HOURS = 24;

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

    if (signature !== expectedSig) return null;

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

module.exports = {
  generateToken,
  verifyToken,
  requireAuth,
};
