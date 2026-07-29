/**
 * WellSim Backend — AI Analysis (compatibility shim)
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  NO LONGER A PLACEHOLDER                                         ║
 * ║                                                                  ║
 * ║  The real engine now lives in src/services/audioAnalysis.js and  ║
 * ║  runs automatically when a recording is uploaded (see            ║
 * ║  src/routes/device.js → POST /api/device/audio).                 ║
 * ║                                                                  ║
 * ║  This file is kept only so older imports keep resolving. It      ║
 * ║  delegates to the real module rather than pretending.            ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

const audioAnalysis = require('../services/audioAnalysis');

const placeholder = {
  /**
   * Telemetry-only records (battery, RSSI, temperature) carry no audio,
   * so there is nothing acoustic to analyse here. Audio arrives on a
   * separate endpoint and is screened there.
   */
  analyze() {
    return {
      status: 'not_applicable',
      message:
        'Telemetry payloads contain no audio. Acoustic screening runs on ' +
        'POST /api/device/audio via services/audioAnalysis.js.',
      modelVersion: audioAnalysis.MODEL_VERSION,
    };
  },

  /** The acoustic engine is present and running. */
  isAvailable() {
    return true;
  },

  analyzeAudio: audioAnalysis.analyze,
  MODEL_VERSION: audioAnalysis.MODEL_VERSION,
};

module.exports = { placeholder };
