/**
 * WellSim Backend — Patient Routes
 * 
 * REST API endpoints for patient data management.
 * Protected by authentication middleware.
 * 
 * Routes:
 *   GET  /api/patients          — List all patients
 *   GET  /api/patients/:id      — Get patient by ID
 *   PUT  /api/patients/:id/vitals — Update patient vitals
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getAllPatients, getPatientById, updatePatientVitals } = require('../services/dbService');

// ─── GET /api/patients ───────────────────────────────────────────────
// List all patients. Requires authentication.
router.get('/', requireAuth, (req, res) => {
  try {
    const patients = getAllPatients();
    res.status(200).json({
      success: true,
      patients,
    });
  } catch (error) {
    console.error('❌ Error fetching patients:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error while fetching patients.',
    });
  }
});

// ─── GET /api/patients/:id ───────────────────────────────────────────
// Get a specific patient. Requires authentication.
router.get('/:id', requireAuth, (req, res) => {
  try {
    const patient = getPatientById(req.params.id);
    if (!patient) {
      return res.status(404).json({
        success: false,
        error: `Patient with ID "${req.params.id}" not found.`,
      });
    }
    res.status(200).json({
      success: true,
      patient,
    });
  } catch (error) {
    console.error('❌ Error fetching patient:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error while fetching patient.',
    });
  }
});

// ─── PUT /api/patients/:id/vitals ────────────────────────────────────
// Update a patient's vitals and recalculate risk. Requires authentication.
router.put('/:id/vitals', requireAuth, (req, res) => {
  try {
    const vitals = req.body;
    if (!vitals || typeof vitals !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Request body must be a JSON object containing vitals data.',
      });
    }

    const updatedPatient = updatePatientVitals(req.params.id, vitals);
    if (!updatedPatient) {
      return res.status(404).json({
        success: false,
        error: `Patient with ID "${req.params.id}" not found.`,
      });
    }

    console.log(`📋 Vitals updated for patient ${updatedPatient.name} by ${req.user.name}`);

    res.status(200).json({
      success: true,
      message: 'Patient vitals updated and risk recalculated.',
      patient: updatedPatient,
    });
  } catch (error) {
    console.error('❌ Error updating vitals:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error while updating vitals.',
    });
  }
});

module.exports = router;
