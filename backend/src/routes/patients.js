/**
 * WellSim Backend — Patient Routes
 * 
 * REST API endpoints for patient data management.
 * Protected by authentication middleware.
 * 
 * Routes:
 *   GET    /api/patients          — List all patients
 *   GET    /api/patients/:id      — Get patient by ID
 *   POST   /api/patients          — Create a new patient
 *   PUT    /api/patients/:id       — Update a patient record
 *   PUT    /api/patients/:id/vitals — Update patient vitals only
 *   DELETE /api/patients/:id       — Delete a patient
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const {
  getAllPatients,
  getPatientById,
  createPatient,
  updatePatient,
  deletePatient,
  updatePatientVitals,
  getPatientByUserId,
  createBarePatientRecord,
} = require('../services/dbService');

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

// ─── GET /api/patients/me ────────────────────────────────────────────
// A patient's own triage record. Patient accounts only.
// Must be registered BEFORE /:id so "me" is not treated as an ID.
router.get('/me', requireAuth, (req, res) => {
  try {
    if (req.user.role !== 'patient') {
      return res.status(403).json({
        success: false,
        error: 'This endpoint is for patient accounts only.',
      });
    }

    let patient = getPatientByUserId(req.user.userId);

    // Accounts created before this feature: create the record lazily
    if (!patient) {
      patient = createBarePatientRecord({ id: req.user.userId, name: req.user.name });
    }

    res.status(200).json({
      success: true,
      patient,
    });
  } catch (error) {
    console.error('❌ Error fetching own record:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error while fetching your record.',
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

// ─── POST /api/patients ──────────────────────────────────────────────
// Create a new patient. Requires authentication.
router.post('/', requireAuth, (req, res) => {
  try {
    const data = req.body;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return res.status(400).json({
        success: false,
        error: 'Request body must be a JSON object containing patient data.',
      });
    }
    if (!data.name || !String(data.name).trim()) {
      return res.status(400).json({
        success: false,
        error: 'Patient name is required.',
      });
    }

    const patient = createPatient(data);

    console.log(`➕ Patient created: ${patient.name} (${patient.id}) by ${req.user.name}`);

    res.status(201).json({
      success: true,
      message: 'Patient created successfully.',
      patient,
    });
  } catch (error) {
    console.error('❌ Error creating patient:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error while creating patient.',
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

// ─── PUT /api/patients/:id ───────────────────────────────────────────
// Update a patient's editable fields (and optionally vitals). Requires auth.
router.put('/:id', requireAuth, (req, res) => {
  try {
    const updates = req.body;
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      return res.status(400).json({
        success: false,
        error: 'Request body must be a JSON object containing patient data.',
      });
    }
    if ('name' in updates && !String(updates.name).trim()) {
      return res.status(400).json({
        success: false,
        error: 'Patient name cannot be empty.',
      });
    }

    const updatedPatient = updatePatient(req.params.id, updates);
    if (!updatedPatient) {
      return res.status(404).json({
        success: false,
        error: `Patient with ID "${req.params.id}" not found.`,
      });
    }

    console.log(`✏️  Patient updated: ${updatedPatient.name} (${updatedPatient.id}) by ${req.user.name}`);

    res.status(200).json({
      success: true,
      message: 'Patient updated successfully.',
      patient: updatedPatient,
    });
  } catch (error) {
    console.error('❌ Error updating patient:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error while updating patient.',
    });
  }
});

// ─── DELETE /api/patients/:id ────────────────────────────────────────
// Delete a patient. Requires authentication.
router.delete('/:id', requireAuth, (req, res) => {
  try {
    const removed = deletePatient(req.params.id);
    if (!removed) {
      return res.status(404).json({
        success: false,
        error: `Patient with ID "${req.params.id}" not found.`,
      });
    }

    console.log(`🗑️  Patient deleted: ${removed.name} (${removed.id}) by ${req.user.name}`);

    res.status(200).json({
      success: true,
      message: 'Patient deleted successfully.',
      patient: removed,
    });
  } catch (error) {
    console.error('❌ Error deleting patient:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error while deleting patient.',
    });
  }
});

module.exports = router;
