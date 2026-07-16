/**
 * WellSim Backend — Auth Routes
 * 
 * Authentication endpoints for login and session verification.
 * 
 * Routes:
 *   POST /api/auth/login  — Authenticate with email/password
 *   GET  /api/auth/me     — Get current user profile from token
 */

const express = require('express');
const router = express.Router();
const { findUserByEmail } = require('../services/dbService');
const { verifyPassword } = require('../services/dbService');
const { generateToken, requireAuth } = require('../middleware/auth');

// ─── POST /api/auth/login ────────────────────────────────────────────
router.post('/login', (req, res) => {
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
    if (!verifyPassword(password, user.password)) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials. Please check your email and password.',
      });
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
