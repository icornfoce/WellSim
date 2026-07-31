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
const { requireAuth, requireRole } = require('../middleware/auth');
const { validateVitalsPayload } = require('../middleware/validation');

/**
 * Clinical staff only.
 *
 * Every route below exposes other people's medical records. A `patient`
 * account has exactly one legitimate destination — GET /me — and is
 * refused everywhere else. Before this gate existed, any patient who
 * signed up could list, read, edit and delete the entire clinic's
 * records: a straightforward IDOR and a PDPA breach.
 */
const staffOnly = requireRole('nurse', 'doctor');
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
router.get('/', requireAuth, staffOnly, (req, res) => {
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
    if (!patient) {
      patient = createBarePatientRecord({ id: req.user.userId, name: req.user.name });
    }
    res.status(200).json({ success: true, patient });
  } catch (error) {
    console.error('❌ Error fetching own record:', error.message);
    res.status(500).json({ success: false, error: 'Internal server error.' });
  }
});

// ─── PUT /api/patients/me ────────────────────────────────────────────
// Allow a patient to edit or add their own demographic fields.
router.put('/me', requireAuth, validateVitalsPayload, (req, res) => {
  try {
    if (req.user.role !== 'patient') {
      return res.status(403).json({
        success: false,
        error: 'Only patients can edit their own record.',
      });
    }
    const updates = req.body || {};
    const allowed = ['name', 'age', 'gender', 'weight', 'height'];
    const filtered = {};
    for (const key of allowed) {
      if (key in updates && updates[key] !== undefined) {
        if (key === 'age' || key === 'weight' || key === 'height') {
          filtered[key] = updates[key] === '' || updates[key] === null ? null : Number(updates[key]);
        } else {
          filtered[key] = updates[key];
        }
      }
    }
    let patient = getPatientByUserId(req.user.userId);
    if (!patient) {
      patient = createBarePatientRecord({ id: req.user.userId, name: req.user.name });
    }
    const updated = updatePatient(patient.id, filtered);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Patient record not found.' });
    }
    console.log(`✏️ Patient self-updated demographic info: ${updated.id} (${updated.name}) by ${req.user.name}`);
    res.status(200).json({ success: true, patient: updated });
  } catch (error) {
    console.error('❌ Error patient self-update:', error.message);
    res.status(500).json({ success: false, error: 'Internal server error while updating patient.' });
  }
});


// ─── POST /api/patients ──────────────────────────────────────────────
// Create a new patient. Clinical staff only.
//
// This route went missing in an earlier refactor while the frontend
// kept calling it, so "Add patient" returned 404 with no visible cause.
router.post('/', requireAuth, staffOnly, validateVitalsPayload, (req, res) => {
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

// ─── GET /api/patients/:id ───────────────────────────────────────────
// Get a specific patient. Requires authentication.
router.get('/:id', requireAuth, staffOnly, (req, res) => {
  try {
    const patient = getPatientById(req.params.id);
    if (!patient) {
      return res.status(404).json({
        success: false,
        error: `Patient with ID "${req.params.id}" not found.`,
      });
    }
    res.status(200).json({ success: true, patient });
  } catch (error) {
    console.error('❌ Error fetching patient:', error.message);
    res.status(500).json({ success: false, error: 'Internal server error.' });
  }
});


// ─── PUT /api/patients/:id/vitals ────────────────────────────────────
// Update a patient's vitals and recalculate risk. Requires authentication.
router.put('/:id/vitals', requireAuth, staffOnly, validateVitalsPayload, (req, res) => {
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
router.put('/:id', requireAuth, staffOnly, validateVitalsPayload, (req, res) => {
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
router.delete('/:id', requireAuth, staffOnly, (req, res) => {
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
