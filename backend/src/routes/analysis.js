/**
 * WellSim Backend — AI Analysis & Physician Review Routes
 *
 * These endpoints implement the two-layer assessment the system is
 * built around:
 *
 *   Layer 1  POST /api/analysis/run          — the engine screens the audio
 *   Layer 2  POST /api/analysis/:id/:type/review — a doctor signs it off
 *
 * The role gate on the review endpoint is the mechanism that makes the
 * "physician has the final word" claim true rather than decorative:
 * a nurse account is refused with 403 at the API level, not merely
 * hidden in the UI.
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const { requireAuth, requireRole } = require('../middleware/auth');

/** Analyses concern other people's medical records — staff only. */
const staffOnly = requireRole('nurse', 'doctor');
const audioAnalysis = require('../services/audioAnalysis');
const {
  getPatientById,
  getPatientByUserId,
  savePatientAnalysis,
  saveAnalysisReview,
  getFeedback,
  getAgreementStats,
} = require('../services/dbService');

const UPLOADS_DIR = path.join(__dirname, '../../uploads');
const VALID_TYPES = ['lung', 'heart', 'cough'];

/** Resolve a stored /uploads/<file> URL to a path inside the uploads dir. */
function resolveAudioPath(url) {
  if (!url) return null;
  // basename() prevents any path traversal via a crafted URL
  const filename = path.basename(String(url));
  const full = path.join(UPLOADS_DIR, filename);
  if (!full.startsWith(UPLOADS_DIR)) return null;
  return fs.existsSync(full) ? full : null;
}

/**
 * Run the analysis engine over a patient's stored recording.
 * Shared by the manual endpoint and the automatic post-upload hook.
 *
 * @returns {{ ok: true, patient, analysis }|{ ok: false, code, message }}
 */
function runAnalysisFor(patientId, type) {
  const patient = getPatientById(patientId);
  if (!patient) {
    return { ok: false, code: 404, message: `Patient "${patientId}" not found.` };
  }

  const log = patient.audioLogs?.[type];
  if (!log || !log.available || !log.url) {
    return {
      ok: false,
      code: 400,
      message: `No ${type} recording exists for this patient. Capture one first.`,
    };
  }

  const filePath = resolveAudioPath(log.url);
  if (!filePath) {
    return {
      ok: false,
      code: 404,
      message: `The audio file for this recording is missing from storage (${log.url}).`,
    };
  }

  const buffer = fs.readFileSync(filePath);
  const analysis = audioAnalysis.analyze(buffer, type, patient.vitals || {});
  const updated = savePatientAnalysis(patientId, type, analysis);

  return { ok: true, patient: updated, analysis: updated.analyses[type] };
}

// ─── POST /api/analysis/run ──────────────────────────────────────────
// Layer 1. Any authenticated clinical user may run the screening.
router.post('/run', requireAuth, staffOnly, (req, res) => {
  try {
    const { patient_id, type } = req.body || {};

    if (!patient_id) {
      return res.status(400).json({ success: false, error: 'patient_id is required.' });
    }
    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({
        success: false,
        error: `type must be one of: ${VALID_TYPES.join(', ')}.`,
      });
    }

    const result = runAnalysisFor(patient_id, type);
    if (!result.ok) {
      return res.status(result.code).json({ success: false, error: result.message });
    }

    console.log(
      `🧠 Analysis (${type}) for ${result.patient.name}: ` +
      `${result.analysis.label} @ ${result.analysis.confidence} → ` +
      `triage ${result.analysis.triage?.level} [awaiting physician review]`
    );

    res.status(200).json({
      success: true,
      message: 'Analysis complete. Result is awaiting physician confirmation.',
      analysis: result.analysis,
      patient: result.patient,
    });
  } catch (error) {
    console.error('❌ Analysis error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error while analysing the recording.',
    });
  }
});

// ─── GET /api/analysis/my ─────────────────────────────────────────────
// A patient's own AI analyses + review status. Patient accounts only.
// Deliberately limited: no raw confidence scores or internal biomarkers
// are surfaced — only the label, triage level, and review state.
//
// MUST stay above `/:patientId`. Express matches in declaration order,
// and while this route sat below it, `/my` was captured as a patientId
// and handed to the staff-only guard — so the one endpoint the patient
// portal depends on answered 403 to every patient, and the portal
// always claimed there were no screening results.
router.get('/my', requireAuth, (req, res) => {
  try {
    if (req.user.role !== 'patient') {
      return res.status(403).json({
        success: false,
        error: 'This endpoint is for patient accounts only.',
      });
    }
    const patient = getPatientByUserId(req.user.userId);
    if (!patient) {
      return res.status(200).json({ success: true, analyses: {} });
    }

    // Strip internal fields; keep only what the patient should see
    const safe = {};
    for (const type of VALID_TYPES) {
      const a = patient.analyses?.[type];
      if (!a) continue;
      const review = a.review || {};
      safe[type] = {
        label: a.label || null,
        triage: a.triage?.level || null,
        review: {
          status: review.status || 'pending',
          doctorName: review.doctorName || null,
          finalLabel: review.finalLabel || null,
          finalTriage: review.finalTriage || null,
          note: (review.status === 'confirmed' || review.status === 'modified' || review.status === 'rejected')
            ? (review.note || null)
            : null,
          reviewedAt: review.reviewedAt || null,
        },
      };
    }

    res.status(200).json({ success: true, analyses: safe });
  } catch (error) {
    console.error('❌ Error fetching patient analyses:', error.message);
    res.status(500).json({ success: false, error: 'Internal server error.' });
  }
});

// ─── GET /api/analysis/:patientId ────────────────────────────────────
// All stored analyses for a patient, with their review state.
router.get('/:patientId', requireAuth, staffOnly, (req, res) => {
  try {
    const patient = getPatientById(req.params.patientId);
    if (!patient) {
      return res.status(404).json({
        success: false,
        error: `Patient "${req.params.patientId}" not found.`,
      });
    }

    res.status(200).json({
      success: true,
      patientId: patient.id,
      analyses: patient.analyses || {},
      reviewSummary: patient.reviewSummary || null,
      // A nurse can read everything but cannot sign anything off
      canReview: req.user.role === 'doctor',
    });
  } catch (error) {
    console.error('❌ Error fetching analyses:', error.message);
    res.status(500).json({ success: false, error: 'Internal server error.' });
  }
});

// ─── POST /api/analysis/:patientId/:type/review ──────────────────────
// Layer 2. DOCTORS ONLY — enforced server-side.
router.post('/:patientId/:type/review', requireAuth, requireRole('doctor'), (req, res) => {
  try {
    const { patientId, type } = req.params;
    const { action, finalLabel, finalTriage, note } = req.body || {};

    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({
        success: false,
        error: `type must be one of: ${VALID_TYPES.join(', ')}.`,
      });
    }
    if (!['confirm', 'modify', 'reject'].includes(action)) {
      return res.status(400).json({
        success: false,
        error: 'action must be "confirm", "modify", or "reject".',
      });
    }
    if (action === 'modify' && !finalLabel && !finalTriage) {
      return res.status(400).json({
        success: false,
        error: 'A modified review must supply finalLabel and/or finalTriage.',
      });
    }
    if (action === 'reject' && !String(note || '').trim()) {
      return res.status(400).json({
        success: false,
        error: 'Rejecting an AI result requires a note explaining why — ' +
               'this is what the model is retrained on.',
      });
    }
    if (finalTriage && !['green', 'yellow', 'red'].includes(finalTriage)) {
      return res.status(400).json({
        success: false,
        error: 'finalTriage must be "green", "yellow", or "red".',
      });
    }

    const result = saveAnalysisReview(
      patientId,
      type,
      { action, finalLabel, finalTriage, note },
      { userId: req.user.userId, name: req.user.name, station: req.user.station }
    );

    if (!result) {
      return res.status(404).json({
        success: false,
        error: `Patient "${patientId}" not found.`,
      });
    }
    if (result.error === 'NO_ANALYSIS') {
      return res.status(404).json({
        success: false,
        error: `No ${type} analysis exists for this patient yet.`,
      });
    }
    if (result.error === 'INVALID_ACTION') {
      return res.status(400).json({ success: false, error: 'Invalid review action.' });
    }

    const review = result.patient.analyses[type].review;
    console.log(
      `🩺 Review by Dr. ${req.user.name}: ${type} for ${result.patient.name} ` +
      `→ ${review.status}${review.finalLabel ? ` (${review.finalLabel})` : ''}` +
      `${result.feedback ? ' [logged for retraining]' : ''}`
    );

    res.status(200).json({
      success: true,
      message:
        action === 'confirm' ? 'AI result confirmed by physician.'
        : action === 'modify' ? 'Physician diagnosis recorded — logged for model retraining.'
        : 'AI result rejected — logged for model retraining.',
      review,
      patient: result.patient,
      feedbackLogged: !!result.feedback,
    });
  } catch (error) {
    console.error('❌ Review error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error while recording the review.',
    });
  }
});

// ─── GET /api/analysis/stats/agreement ───────────────────────────────
// Live AI-vs-physician agreement — the Phase 4 metric.
router.get('/stats/agreement', requireAuth, staffOnly, (req, res) => {
  try {
    res.status(200).json({
      success: true,
      modelVersion: audioAnalysis.MODEL_VERSION,
      stats: getAgreementStats(),
    });
  } catch (error) {
    console.error('❌ Stats error:', error.message);
    res.status(500).json({ success: false, error: 'Internal server error.' });
  }
});

// ─── GET /api/analysis/feedback/export ───────────────────────────────
// The physician-correction corpus. Doctors only — it contains clinical
// judgements attributed to named practitioners.
router.get('/feedback/export', requireAuth, requireRole('doctor'), (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 2000);
    const feedback = getFeedback(limit);

    if (req.query.format === 'csv') {
      const cols = [
        'id', 'createdAt', 'patientId', 'type', 'audioUrl', 'modelVersion',
        'aiLabel', 'aiConfidence', 'aiTriage', 'doctorLabel', 'doctorTriage',
        'action', 'doctorName', 'note',
      ];
      const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = [
        cols.join(','),
        ...feedback.map((row) => cols.map((c) => escape(row[c])).join(',')),
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="wellsim-feedback.csv"');
      return res.status(200).send(csv);
    }

    res.status(200).json({
      success: true,
      count: feedback.length,
      note: 'Physician corrections of AI output — the retraining dataset.',
      feedback,
    });
  } catch (error) {
    console.error('❌ Feedback export error:', error.message);
    res.status(500).json({ success: false, error: 'Internal server error.' });
  }
});

module.exports = router;
module.exports.runAnalysisFor = runAnalysisFor;
