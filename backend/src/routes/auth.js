/**
 * WellSim Backend — Auth Routes
 * 
 * Authentication endpoints for login and session verification.
 * 
 * Routes:
 *   POST /api/auth/register — Create a new staff account
 *   POST /api/auth/login    — Authenticate with email/password
 *   GET  /api/auth/me       — Get current user profile from token
 */

const express = require('express');
const router = express.Router();
const {
  findUserByEmail,
  createUser,
  checkPassword,
  upgradePasswordHash,
  createBarePatientRecord,
} = require('../services/dbService');
const { generateToken, requireAuth, requireRole, rateLimit, safeEqual } = require('../middleware/auth');
const config = require('../../config');

// ─── POST /api/auth/register ─────────────────────────────────────────
const ALLOWED_ROLES = ['nurse', 'doctor', 'patient'];
const STAFF_ROLES = ['nurse', 'doctor'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Signup is a write endpoint reachable without credentials — cap it
const registerLimiter = rateLimit({ windowMs: 60_000, max: 5, keyPrefix: 'register' });
const loginLimiter = rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'login' });

router.post('/register', registerLimiter, (req, res) => {
  try {
    const { name, email, password, role, station, staffCode } = req.body || {};

    // Validate input
    if (!name || String(name).trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Please provide your full name (at least 2 characters).',
      });
    }
    if (!email || !EMAIL_RE.test(String(email).trim())) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid email address.',
      });
    }
    if (!password || String(password).length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters long.',
      });
    }
    if (!ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        error: 'Role must be "nurse", "doctor", or "patient".',
      });
    }

    // ── Clinical roles cannot be self-assigned ──
    // A `doctor` account is the only thing that can turn an AI screening
    // result into a clinical finding. If the public signup form can mint
    // one, the entire physician-review layer is decorative.
    if (STAFF_ROLES.includes(role)) {
      if (!config.STAFF_REGISTRATION_CODE) {
        return res.status(403).json({
          success: false,
          error:
            'Staff registration is disabled on this server. A nurse or doctor ' +
            'account must be created by an administrator.',
        });
      }
      if (!staffCode || !safeEqual(staffCode, config.STAFF_REGISTRATION_CODE)) {
        return res.status(403).json({
          success: false,
          error:
            'A valid staff registration code is required to create a ' +
            `"${role}" account. Contact your clinic administrator.`,
        });
      }
    }

    // Create the account
    const result = createUser({ name, email, password, role, station });
    if (result.error === 'EMAIL_TAKEN') {
      return res.status(409).json({
        success: false,
        error: 'An account with this email already exists.',
      });
    }

    const user = result.user;

    // Patients get an empty triage record straight away,
    // linked by userId, so the portal always has something to show.
    if (user.role === 'patient') {
      try {
        createBarePatientRecord(user);
      } catch (e) {
        console.error('⚠️ Could not create bare patient record:', e.message);
      }
    }

    // Auto-login: issue a token right away
    const token = generateToken(user);

    console.log(`🆕 Account created: ${user.name} (${user.role}) <${user.email}>`);

    res.status(201).json({
      success: true,
      message: 'Account created successfully.',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        station: user.station,
      },
    });
  } catch (error) {
    console.error('❌ Register error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error during registration.',
    });
  }
});

// ─── POST /api/auth/login ────────────────────────────────────────────
router.post('/login', loginLimiter, (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required.',
      });
    }

    // Find user by email
    const user = findUserByEmail(email);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials. Please check your email and password.',
      });
    }

    // Verify password
    const result = checkPassword(password, user.password);
    if (!result.valid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials. Please check your email and password.',
      });
    }

    // Transparently migrate legacy SHA-256 hashes to scrypt on first
    // successful login, so no one has to reset their password.
    if (result.needsUpgrade) {
      try {
        upgradePasswordHash(user.id, password);
      } catch (e) {
        console.error('⚠️ Password upgrade failed:', e.message);
      }
    }

    // Generate token
    const token = generateToken(user);

    console.log(`🔑 User logged in: ${user.name} (${user.role})`);

    res.status(200).json({
      success: true,
      message: 'Login successful.',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        station: user.station,
      },
    });
  } catch (error) {
    console.error('❌ Login error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error during authentication.',
    });
  }
});

// ─── GET /api/auth/me ────────────────────────────────────────────────
router.get('/me', requireAuth, (req, res) => {
  try {
    res.status(200).json({
      success: true,
      user: {
        id: req.user.userId,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
      },
    });
  } catch (error) {
    console.error('❌ Auth/me error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error.',
    });
  }
});

module.exports = router;
