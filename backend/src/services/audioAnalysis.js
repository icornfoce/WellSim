/**
 * WellSim Backend — Bio-Acoustic Analysis Engine
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  MODEL STATUS — read before quoting accuracy figures             ║
 * ║                                                                  ║
 * ║  Layer 1 (this file) is a DETERMINISTIC DSP CLASSIFIER, not a    ║
 * ║  trained neural network. Every feature below is measured from    ║
 * ║  the real audio signal, and the decision rules follow published  ║
 * ║  CORSA acoustic definitions (wheeze ≥ 80 ms tonal 100–1200 Hz;   ║
 * ║  crackle < 20 ms broadband transient). No value is randomised    ║
 * ║  or hard-coded per patient.                                      ║
 * ║                                                                  ║
 * ║  It is a calibrated BASELINE, honest about its own limits: it    ║
 * ║  reports confidence, evidence, and signal quality, and every     ║
 * ║  result stays "awaiting physician confirmation" until a doctor   ║
 * ║  signs it. The log-Mel spectrogram it already computes is the    ║
 * ║  exact input tensor a CNN will consume once the team has a       ║
 * ║  labelled training set (see docs/AI_PIPELINE.md).                ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

const dsp = require('./dsp');

const MODEL_VERSION = 'wellsim-dsp-baseline-v0.1';
const TARGET_SAMPLE_RATE = 8000; // 4 kHz Nyquist — covers lung & heart bands
const FRAME_SIZE = 512;          // 64 ms @ 8 kHz
const HOP_SIZE = 128;            // 16 ms hop
const BIN_HZ = TARGET_SAMPLE_RATE / FRAME_SIZE; // 15.625 Hz per bin

// ─── Helpers ─────────────────────────────────────────────────────────

const hzToBin = (hz) => Math.round(hz / BIN_HZ);
const frameToTime = (t) => +(t * HOP_SIZE / TARGET_SAMPLE_RATE).toFixed(3);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const round = (x, d = 3) => +Number(x).toFixed(d);

/** Band energy of one STFT frame, in Hz range [lo, hi]. */
function bandEnergy(frame, lo, hi) {
  const a = Math.max(0, hzToBin(lo));
  const b = Math.min(frame.length - 1, hzToBin(hi));
  let sum = 0;
  for (let k = a; k <= b; k++) sum += frame[k] * frame[k];
  return sum;
}

/** Spectral flatness (Wiener entropy): 1 = noise-like, 0 = tonal. */
function spectralFlatness(frame, lo, hi) {
  const a = Math.max(1, hzToBin(lo));
  const b = Math.min(frame.length - 1, hzToBin(hi));
  if (b <= a) return 1;
  let logSum = 0;
  let arithSum = 0;
  let n = 0;
  for (let k = a; k <= b; k++) {
    const p = frame[k] * frame[k] + 1e-12;
    logSum += Math.log(p);
    arithSum += p;
    n++;
  }
  const geo = Math.exp(logSum / n);
  const arith = arithSum / n;
  return arith > 0 ? clamp01(geo / arith) : 1;
}

/** Spectral flatness over an explicit bin range (for non-default FFT sizes). */
function spectralFlatness2(frame, binLo, binHi) {
  const a = Math.max(1, binLo);
  const b = Math.min(frame.length - 1, binHi);
  if (b <= a) return 1;
  let logSum = 0;
  let arithSum = 0;
  let n = 0;
  for (let k = a; k <= b; k++) {
    const p = frame[k] * frame[k] + 1e-12;
    logSum += Math.log(p);
    arithSum += p;
    n++;
  }
  return arithSum > 0 ? clamp01(Math.exp(logSum / n) / (arithSum / n)) : 1;
}

/** Dominant spectral peak within a band, with its prominence over the band mean. */
function dominantPeak(frame, lo, hi) {
  const a = Math.max(1, hzToBin(lo));
  const b = Math.min(frame.length - 1, hzToBin(hi));
  let peakBin = a;
  let peakVal = 0;
  let sum = 0;
  let n = 0;
  for (let k = a; k <= b; k++) {
    const v = frame[k];
    sum += v;
    n++;
    if (v > peakVal) {
      peakVal = v;
      peakBin = k;
    }
  }
  const avg = n ? sum / n : 0;
  return {
    hz: peakBin * BIN_HZ,
    magnitude: peakVal,
    prominence: avg > 1e-9 ? peakVal / avg : 0,
  };
}

// ─── Signal Quality Gate ─────────────────────────────────────────────

/**
 * Reject or flag recordings that are too short, too quiet, clipped, or
 * dominated by noise. An honest screening tool must say "I can't read
 * this" rather than guess — this is what makes the physician-review
 * layer meaningful instead of decorative.
 */
function assessQuality(samples, sampleRate) {
  const duration = samples.length / sampleRate;
  let peak = 0;
  let sumSq = 0;
  let clipped = 0;

  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
    sumSq += samples[i] * samples[i];
    if (a > 0.99) clipped++;
  }

  const rms = Math.sqrt(sumSq / (samples.length || 1));
  const clipRatio = clipped / (samples.length || 1);
  const crest = rms > 1e-9 ? peak / rms : 0;

  const issues = [];
  if (duration < 2.0) issues.push('RECORDING_TOO_SHORT');
  if (peak < 0.02) issues.push('SIGNAL_TOO_QUIET');
  if (clipRatio > 0.01) issues.push('SIGNAL_CLIPPED');
  if (crest > 0 && crest < 2.0) issues.push('LOW_DYNAMIC_RANGE');

  // Usable score drops with each issue; drives the confidence ceiling
  let score = 1;
  if (duration < 2.0) score *= clamp01(duration / 2.0);
  if (peak < 0.02) score *= clamp01(peak / 0.02);
  if (clipRatio > 0.01) score *= clamp01(1 - clipRatio * 10);
  if (crest < 2.0) score *= clamp01(crest / 2.0);

  return {
    duration: round(duration, 2),
    peakAmplitude: round(peak),
    rms: round(rms, 4),
    clippedRatio: round(clipRatio, 4),
    crestFactor: round(crest, 2),
    score: round(clamp01(score)),
    usable: issues.length === 0 || (score > 0.4 && !issues.includes('RECORDING_TOO_SHORT')),
    issues,
  };
}

// ─── Detector: Wheeze ────────────────────────────────────────────────

/**
 * Wheeze — a continuous, musical (tonal) sound.
 * CORSA definition: dominant frequency 100–1000 Hz, duration ≥ 80 ms.
 *
 * We track the dominant spectral peak frame by frame and group runs
 * where the peak stays tonal and frequency-stable.
 */
function detectWheeze(stftResult) {
  const MIN_PROMINENCE = 3.0;   // peak must be 3× the band average
  const MAX_FLATNESS = 0.35;    // tonal, not noise-like
  const FREQ_TOLERANCE = 0.18;  // ±18 % peak drift allowed within an episode
  const MIN_FRAMES = Math.ceil(0.08 / (HOP_SIZE / TARGET_SAMPLE_RATE)); // 80 ms

  const tonalFrames = stftResult.frames.map((frame) => {
    const peak = dominantPeak(frame, 100, 1200);
    const flatness = spectralFlatness(frame, 100, 1200);
    const isTonal = peak.prominence >= MIN_PROMINENCE && flatness <= MAX_FLATNESS;
    return { isTonal, hz: peak.hz, prominence: peak.prominence, flatness };
  });

  const episodes = [];
  let run = null;

  for (let t = 0; t < tonalFrames.length; t++) {
    const f = tonalFrames[t];
    if (f.isTonal) {
      const drift = run ? Math.abs(f.hz - run.refHz) / (run.refHz || 1) : 0;
      if (run && drift <= FREQ_TOLERANCE) {
        run.end = t;
        run.freqs.push(f.hz);
        run.proms.push(f.prominence);
      } else {
        if (run && run.end - run.start + 1 >= MIN_FRAMES) episodes.push(run);
        run = { start: t, end: t, refHz: f.hz, freqs: [f.hz], proms: [f.prominence] };
      }
    } else if (run) {
      if (run.end - run.start + 1 >= MIN_FRAMES) episodes.push(run);
      run = null;
    }
  }
  if (run && run.end - run.start + 1 >= MIN_FRAMES) episodes.push(run);

  const segments = episodes.map((e) => ({
    type: 'wheeze',
    start: frameToTime(e.start),
    end: frameToTime(e.end + 1),
    dominantHz: Math.round(dsp.median(e.freqs)),
    strength: round(clamp01((dsp.mean(e.proms) - MIN_PROMINENCE) / 6 + 0.35)),
  }));

  const totalFrames = stftResult.frameCount || 1;
  const wheezeFrames = episodes.reduce((s, e) => s + (e.end - e.start + 1), 0);

  return {
    detected: segments.length > 0,
    episodeCount: segments.length,
    // Fraction of the recording occupied by wheeze — the clinical
    // "wheeze rate" used to grade severity
    occupancyRatio: round(wheezeFrames / totalFrames),
    dominantHz: segments.length ? Math.round(dsp.median(segments.map((s) => s.dominantHz))) : null,
    longestMs: segments.length
      ? Math.round(Math.max(...segments.map((s) => (s.end - s.start) * 1000)))
      : 0,
    segments,
  };
}

// ─── Detector: Crackle ───────────────────────────────────────────────

/**
 * Crackle — discontinuous, explosive, broadband transient.
 * Fine crackles ≈ 5 ms, coarse ≈ 10–20 ms.
 *
 * Detected as sharp spectral-flux onsets in the 200–2000 Hz band that
 * decay again within 20 ms and are broadband (high spectral flatness),
 * which separates them from the tonal onset of a wheeze.
 */
function detectCrackle(samples) {
  // A crackle is 5–20 ms long. The 64 ms / 16 ms grid used for wheeze
  // analysis smears it into the surrounding breath noise, so crackle
  // detection gets its own fine-resolution transform: 16 ms windows
  // stepped every 4 ms. At that scale a crackle dominates its frame
  // while the breath envelope is essentially static.
  const FINE_FRAME = 128; // 16 ms @ 8 kHz
  const FINE_HOP = 32;    //  4 ms hop
  const FINE_BIN_HZ = TARGET_SAMPLE_RATE / FINE_FRAME;
  const fineBin = (hz) => Math.round(hz / FINE_BIN_HZ);

  const fine = dsp.stft(samples, FINE_FRAME, FINE_HOP);
  const frames = fine.frames;
  if (frames.length < 5) {
    return { detected: false, count: 0, ratePerMinute: 0, meanWidthMs: 0, character: null, segments: [] };
  }

  // Spectral flux — positive-only energy change between frames
  const flux = new Array(frames.length).fill(0);
  const a = Math.max(1, fineBin(200));
  const b = Math.min(frames[0].length - 1, fineBin(2000));
  for (let t = 1; t < frames.length; t++) {
    let sum = 0;
    for (let k = a; k <= b; k++) {
      const d = frames[t][k] - frames[t - 1][k];
      if (d > 0) sum += d * d;
    }
    flux[t] = Math.sqrt(sum);
  }

  const smoothed = dsp.smooth(flux, 1);
  const positive = smoothed.filter((x) => x > 0);
  // Robust threshold: MAD is not inflated by the transients themselves,
  // unlike the standard deviation, which would push the threshold above
  // the very events we are looking for.
  const med = dsp.median(positive);
  const spread = dsp.medianAbsoluteDeviation(positive) || dsp.stdDev(positive);
  const threshold = med + 5.0 * spread;

  const MIN_DISTANCE = 5; // ≥ 20 ms apart, prevents double-counting one burst
  const peaks = dsp.findPeaks(smoothed, threshold, MIN_DISTANCE);

  const msPerFrame = (FINE_HOP / TARGET_SAMPLE_RATE) * 1000; // 4 ms
  const segments = [];

  for (const t of peaks) {
    // A crackle is broadband, not tonal — this rejects wheeze onsets
    const flatness = spectralFlatness2(frames[t], a, b);
    if (flatness < 0.2) continue;

    // Measure decay — a true crackle is over within ~20 ms
    let width = 1;
    for (let j = t + 1; j < Math.min(t + 12, frames.length); j++) {
      if (smoothed[j] > threshold * 0.4) width++;
      else break;
    }
    const widthMs = width * msPerFrame;
    if (widthMs > 45) continue; // too long — that is a breath or artefact

    segments.push({
      type: 'crackle',
      start: round((t * FINE_HOP) / TARGET_SAMPLE_RATE),
      end: round(((t + width) * FINE_HOP) / TARGET_SAMPLE_RATE),
      widthMs: Math.round(widthMs),
      strength: round(clamp01(smoothed[t] / (threshold * 2 || 1))),
    });
  }

  const durationSec = (frames.length * FINE_HOP) / TARGET_SAMPLE_RATE || 1;

  return {
    detected: segments.length >= 3, // isolated pops are not clinically meaningful
    count: segments.length,
    ratePerMinute: Math.round((segments.length / durationSec) * 60),
    meanWidthMs: segments.length ? Math.round(dsp.mean(segments.map((s) => s.widthMs))) : 0,
    // < 10 ms suggests fine crackles (interstitial / pneumonia),
    // > 10 ms suggests coarse crackles (secretions / bronchitis)
    character: segments.length
      ? (dsp.mean(segments.map((s) => s.widthMs)) < 10 ? 'fine' : 'coarse')
      : null,
    segments: segments.slice(0, 40), // cap payload size
  };
}

// ─── Detector: Breathing Cycle ───────────────────────────────────────

/** Estimate respiratory rate from the slow amplitude envelope. */
function analyseBreathing(samples) {
  const env = dsp.smooth(dsp.rmsEnvelope(samples, 512, 256), 8);
  const envRate = TARGET_SAMPLE_RATE / 256; // envelope samples per second
  if (env.length < envRate * 2) {
    return { breathCount: 0, ratePerMinute: null, regularity: null };
  }

  const avg = dsp.mean(env);
  const peaks = dsp.findPeaks(env, avg * 1.15, Math.round(envRate * 1.2)); // ≥1.2 s apart
  const durationSec = env.length / envRate;

  const intervals = [];
  for (let i = 1; i < peaks.length; i++) intervals.push((peaks[i] - peaks[i - 1]) / envRate);

  const cv = intervals.length >= 2 ? dsp.stdDev(intervals) / (dsp.mean(intervals) || 1) : null;

  return {
    breathCount: peaks.length,
    ratePerMinute: peaks.length >= 2 ? Math.round((peaks.length / durationSec) * 60) : null,
    regularity: cv === null ? null : round(clamp01(1 - cv)),
  };
}

// ─── Detector: Cardiac Rhythm ────────────────────────────────────────

/**
 * Heart sound analysis — S1/S2 peak picking on the low-band envelope,
 * then rhythm regularity from the beat-to-beat intervals.
 *
 * Irregularity is reported as a *signal finding*, never as an
 * arrhythmia diagnosis: only a 12-lead ECG can diagnose arrhythmia.
 */
function analyseCardiac(samples, stftResult) {
  const env = dsp.smooth(dsp.rmsEnvelope(samples, 256, 64), 3);
  const envRate = TARGET_SAMPLE_RATE / 64; // 125 Hz envelope
  const durationSec = samples.length / TARGET_SAMPLE_RATE;

  const avg = dsp.mean(env);
  const sd = dsp.stdDev(env);
  const threshold = avg + 0.6 * sd;
  // Heart sounds cannot be closer than ~0.15 s (400 bpm ceiling)
  const peaks = dsp.findPeaks(env, threshold, Math.round(envRate * 0.15));

  if (peaks.length < 4) {
    return {
      detected: false,
      beatsDetected: peaks.length,
      bpm: null,
      rhythmRegularity: null,
      irregular: false,
      murmurIndex: null,
      note: 'Too few identifiable heart sounds to estimate rhythm.',
    };
  }

  // Raw peak intervals mix S1→S2 (short) and S2→S1 (long). The cardiac
  // cycle is the S1→S1 distance, so we take every second interval when
  // the alternation is clear, otherwise fall back to peak pairing.
  const allIntervals = [];
  for (let i = 1; i < peaks.length; i++) allIntervals.push((peaks[i] - peaks[i - 1]) / envRate);

  const medInterval = dsp.median(allIntervals);
  const shortOnes = allIntervals.filter((x) => x < medInterval);
  const longOnes = allIntervals.filter((x) => x >= medInterval);
  const alternating =
    shortOnes.length >= 2 &&
    longOnes.length >= 2 &&
    dsp.mean(longOnes) > dsp.mean(shortOnes) * 1.3;

  // Cycle length = S1→S1
  const cycles = [];
  if (alternating) {
    for (let i = 0; i + 1 < allIntervals.length; i += 2) {
      cycles.push(allIntervals[i] + allIntervals[i + 1]);
    }
  } else {
    cycles.push(...allIntervals);
  }

  const meanCycle = dsp.mean(cycles);
  const bpm = meanCycle > 0 ? Math.round(60 / meanCycle) : null;
  const cv = cycles.length >= 3 ? dsp.stdDev(cycles) / (meanCycle || 1) : null;

  // ── Murmur proxy ──
  // A normal heart sounds like "lub … dub … silence". Systole — the
  // interval between S1 and S2 — should be quiet. A murmur fills it
  // with mid-frequency (150–400 Hz) turbulence.
  //
  // The reference has to be the FULL-BAND energy of S1/S2, not the same
  // 150–400 Hz slice: S1 and S2 are low-frequency (~40–70 Hz) events, so
  // in the mid band they sit at the noise floor and the ratio would come
  // out near 1.0 for every recording, murmur or not.
  //
  // Guard bands matter too — S1 rings for ~100 ms and its decay tail
  // would otherwise leak into the "silent" window.
  const FRAME_RATE = TARGET_SAMPLE_RATE / HOP_SIZE;
  const timeToFrame = (sec) => Math.round(sec * FRAME_RATE);
  const peakTimes = peaks.map((p) => p / envRate);

  const S1_TAIL = 0.10;  // skip the first 100 ms after a heart sound
  const S2_LEAD = 0.04;  // stop 40 ms before the next one

  const systolicMid = [];
  const diastolicMid = [];
  const peakFullBand = [];

  for (let i = 0; i < peakTimes.length - 1; i++) {
    // The shorter interval of the alternating pair is systole
    const isSystole = allIntervals[i] < medInterval;
    const a = timeToFrame(peakTimes[i] + S1_TAIL);
    const b = timeToFrame(peakTimes[i + 1] - S2_LEAD);
    for (let t = Math.max(0, a); t < b && t < stftResult.frameCount; t++) {
      (isSystole ? systolicMid : diastolicMid).push(bandEnergy(stftResult.frames[t], 150, 400));
    }
  }
  for (const tSec of peakTimes) {
    const a = timeToFrame(tSec);
    const b = timeToFrame(tSec + 0.06);
    for (let t = Math.max(0, a); t < b && t < stftResult.frameCount; t++) {
      peakFullBand.push(bandEnergy(stftResult.frames[t], 20, 800));
    }
  }

  // Medians, not means — one noisy frame should not define the verdict
  const sysAvg = systolicMid.length ? dsp.median(systolicMid) : 0;
  const peakAvg = peakFullBand.length ? dsp.median(peakFullBand) : 0;
  const murmurIndex =
    peakAvg > 1e-12 && systolicMid.length >= 3
      ? round(clamp01(Math.sqrt(sysAvg / peakAvg))) // amplitude ratio, not power
      : null;

  // Secondary check: a systolic murmur makes systole louder than
  // diastole in the mid band. Reported for the physician, not scored.
  const diaAvg = diastolicMid.length ? dsp.median(diastolicMid) : 0;
  const systolicEmphasis =
    diaAvg > 1e-12 && systolicMid.length >= 3 ? round(Math.sqrt(sysAvg / diaAvg), 2) : null;

  const segments = peaks.slice(0, 60).map((p) => ({
    type: 'heart_sound',
    start: round(p / envRate),
    end: round(p / envRate + 0.06),
  }));

  return {
    detected: true,
    beatsDetected: peaks.length,
    bpm,
    cycleCount: cycles.length,
    rhythmRegularity: cv === null ? null : round(clamp01(1 - cv)),
    // CV > 0.15 of the cardiac cycle is the usual threshold for
    // "irregular rhythm — recommend ECG"
    irregular: cv !== null && cv > 0.15,
    intervalCV: cv === null ? null : round(cv),
    s1s2Alternation: alternating,
    murmurIndex,
    systolicEmphasis,
    durationSec: round(durationSec, 1),
    segments,
  };
}

// ─── Detector: Cough ─────────────────────────────────────────────────

/** Cough burst detection — count, duration, and dry/wet character. */
function detectCough(samples, stftResult) {
  const env = dsp.smooth(dsp.rmsEnvelope(samples, 256, 128), 2);
  const envRate = TARGET_SAMPLE_RATE / 128;
  const avg = dsp.mean(env);
  const sd = dsp.stdDev(env);
  const peaks = dsp.findPeaks(env, avg + 2.2 * sd, Math.round(envRate * 0.25));

  const bursts = peaks.map((p) => {
    // Walk outwards to the burst edges (half-peak amplitude)
    const half = env[p] * 0.35;
    let a = p;
    let b = p;
    while (a > 0 && env[a] > half) a--;
    while (b < env.length - 1 && env[b] > half) b++;
    const frameIdx = Math.round((p / envRate) * (TARGET_SAMPLE_RATE / HOP_SIZE));
    const frame = stftResult.frames[Math.min(frameIdx, stftResult.frameCount - 1)];
    // "Wet" coughs carry more low-frequency energy from secretions
    const lowE = frame ? bandEnergy(frame, 50, 400) : 0;
    const highE = frame ? bandEnergy(frame, 400, 3500) : 0;
    return {
      type: 'cough',
      start: round(a / envRate),
      end: round(b / envRate),
      durationMs: Math.round(((b - a) / envRate) * 1000),
      lowHighRatio: highE > 1e-12 ? round(lowE / highE) : null,
    };
  });

  const wetLike = bursts.filter((b) => b.lowHighRatio !== null && b.lowHighRatio > 1.5).length;

  return {
    detected: bursts.length > 0,
    count: bursts.length,
    meanDurationMs: bursts.length ? Math.round(dsp.mean(bursts.map((b) => b.durationMs))) : 0,
    character: bursts.length ? (wetLike / bursts.length > 0.5 ? 'productive/wet' : 'dry') : null,
    segments: bursts.slice(0, 30),
  };
}

// ─── Spectrogram Downsampling (for the dashboard heatmap) ────────────

/** Reduce the log-Mel matrix to a fixed grid so the JSON stays small. */
function downsampleSpectrogram(matrix, targetFrames = 96) {
  if (!matrix.length) return [];
  const nMels = matrix[0].length;
  const step = matrix.length / targetFrames;
  const out = [];
  for (let i = 0; i < targetFrames; i++) {
    const a = Math.floor(i * step);
    const b = Math.max(a + 1, Math.floor((i + 1) * step));
    const row = new Array(nMels).fill(0);
    let n = 0;
    for (let t = a; t < Math.min(b, matrix.length); t++) {
      for (let m = 0; m < nMels; m++) row[m] += matrix[t][m];
      n++;
    }
    out.push(row.map((x) => round(x / (n || 1), 3)));
  }
  return out;
}

/** Amplitude envelope reduced to N points, for drawing the real waveform. */
function downsampleEnvelope(samples, points = 140) {
  const out = [];
  const step = Math.max(1, Math.floor(samples.length / points));
  let peak = 0;
  for (let i = 0; i < points; i++) {
    const a = i * step;
    const b = Math.min(a + step, samples.length);
    let maxAbs = 0;
    for (let j = a; j < b; j++) {
      const v = Math.abs(samples[j]);
      if (v > maxAbs) maxAbs = v;
    }
    out.push(maxAbs);
    if (maxAbs > peak) peak = maxAbs;
  }
  return out.map((x) => round(peak > 0 ? x / peak : 0, 3));
}

// ─── Classification ──────────────────────────────────────────────────

/**
 * Turn measured features into a label, a confidence, and human-readable
 * evidence. Confidence is capped by recording quality — a clean signal
 * with strong evidence scores high; a marginal signal never does.
 */
function classifyLung(features, quality) {
  const { wheeze, crackle, breathing } = features;
  const evidence = [];
  const differentials = [];

  let label = 'normal_breath_sounds';
  let confidence = 0.55;

  const wheezeScore = wheeze.detected
    ? clamp01(wheeze.occupancyRatio * 4 + Math.min(wheeze.episodeCount, 6) * 0.08)
    : 0;
  const crackleScore = crackle.detected
    ? clamp01(Math.min(crackle.ratePerMinute, 90) / 90 * 0.8 + 0.2)
    : 0;

  if (wheeze.detected) {
    evidence.push(
      `Continuous tonal sound detected in ${wheeze.episodeCount} episode(s), ` +
      `dominant frequency ${wheeze.dominantHz} Hz, longest ${wheeze.longestMs} ms ` +
      `(${Math.round(wheeze.occupancyRatio * 100)}% of the recording) — consistent with wheeze.`
    );
  }
  if (crackle.detected) {
    evidence.push(
      `${crackle.count} short broadband transients detected ` +
      `(≈${crackle.ratePerMinute}/min, mean width ${crackle.meanWidthMs} ms) — ` +
      `consistent with ${crackle.character} crackles.`
    );
  }
  if (breathing.ratePerMinute) {
    evidence.push(
      `Respiratory rate estimated at ${breathing.ratePerMinute} breaths/min from the ` +
      `amplitude envelope (regularity ${Math.round((breathing.regularity ?? 0) * 100)}%).`
    );
  }

  if (wheezeScore > 0.25 && crackleScore > 0.25) {
    label = 'wheeze_and_crackles';
    confidence = 0.5 + 0.35 * Math.min(wheezeScore, crackleScore);
    differentials.push('Bronchitis', 'COPD exacerbation', 'Pneumonia with bronchospasm');
  } else if (wheezeScore > 0.25) {
    label = 'wheeze';
    confidence = 0.5 + 0.4 * wheezeScore;
    differentials.push('Asthma', 'COPD', 'Bronchospasm');
  } else if (crackleScore > 0.25) {
    label = crackle.character === 'fine' ? 'fine_crackles' : 'coarse_crackles';
    confidence = 0.5 + 0.38 * crackleScore;
    differentials.push(
      crackle.character === 'fine' ? 'Pneumonia' : 'Bronchitis / retained secretions',
      crackle.character === 'fine' ? 'Pulmonary oedema' : 'COPD'
    );
  } else {
    label = 'normal_breath_sounds';
    // Confidence in "normal" rises with a clean, long, quiet-background recording
    confidence = 0.5 + 0.3 * quality.score;
    evidence.push('No wheeze episodes or crackle clusters exceeded detection thresholds.');
  }

  return { label, confidence, evidence, differentials, scores: { wheezeScore: round(wheezeScore), crackleScore: round(crackleScore) } };
}

function classifyHeart(features, quality) {
  const { cardiac } = features;
  const evidence = [];
  const differentials = [];

  if (!cardiac.detected) {
    return {
      label: 'inconclusive',
      confidence: 0.2,
      evidence: [cardiac.note || 'Heart sounds could not be isolated from the recording.'],
      differentials: [],
      scores: {},
    };
  }

  evidence.push(
    `${cardiac.beatsDetected} heart sounds detected over ${cardiac.durationSec}s; ` +
    `estimated rate ${cardiac.bpm} bpm from ${cardiac.cycleCount} cardiac cycles.`
  );
  evidence.push(
    `Beat-to-beat interval variation (CV) = ${cardiac.intervalCV}; ` +
    `rhythm regularity ${Math.round((cardiac.rhythmRegularity ?? 0) * 100)}%.`
  );
  if (cardiac.murmurIndex !== null) {
    evidence.push(
      `Systolic turbulence index ${cardiac.murmurIndex} — mid-frequency (150–400 Hz) ` +
      `energy during systole relative to the S1/S2 sounds themselves ` +
      `(a quiet systole is expected; above 0.25 suggests a murmur).` +
      (cardiac.systolicEmphasis !== null
        ? ` Systole is ${cardiac.systolicEmphasis}× louder than diastole in that band.`
        : '')
    );
  }

  let label = 'regular_rhythm';
  let confidence = 0.5 + 0.3 * quality.score;

  const MURMUR_THRESHOLD = 0.25;
  const murmurSuspect = cardiac.murmurIndex !== null && cardiac.murmurIndex > MURMUR_THRESHOLD;

  if (cardiac.irregular && murmurSuspect) {
    label = 'irregular_rhythm_with_murmur_signal';
    confidence = 0.45 + 0.35 * clamp01(cardiac.intervalCV / 0.4);
    differentials.push('Atrial fibrillation (ECG required)', 'Valvular heart disease');
  } else if (cardiac.irregular) {
    label = 'irregular_rhythm';
    confidence = 0.45 + 0.4 * clamp01(cardiac.intervalCV / 0.4);
    differentials.push('Arrhythmia — 12-lead ECG required for diagnosis', 'Ectopic beats');
  } else if (murmurSuspect) {
    label = 'murmur_signal_present';
    confidence = 0.45 + 0.35 * clamp01((cardiac.murmurIndex - MURMUR_THRESHOLD) / 0.4);
    differentials.push('Valvular murmur — echocardiogram advised', 'Flow murmur');
  } else if (cardiac.bpm && cardiac.bpm > 100) {
    label = 'tachycardia_signal';
    confidence = 0.5 + 0.25 * quality.score;
    differentials.push('Tachycardia — correlate with pulse oximetry');
  } else if (cardiac.bpm && cardiac.bpm < 50) {
    label = 'bradycardia_signal';
    confidence = 0.5 + 0.25 * quality.score;
    differentials.push('Bradycardia — correlate clinically');
  }

  return { label, confidence, evidence, differentials, scores: { intervalCV: cardiac.intervalCV, murmurIndex: cardiac.murmurIndex } };
}

function classifyCough(features, quality) {
  const { cough, crackle } = features;
  const evidence = [];
  const differentials = [];

  if (!cough.detected) {
    return {
      label: 'no_cough_detected',
      confidence: 0.4 + 0.3 * quality.score,
      evidence: ['No cough bursts exceeded the detection threshold in this recording.'],
      differentials: [],
      scores: {},
    };
  }

  evidence.push(
    `${cough.count} cough burst(s) detected, mean duration ${cough.meanDurationMs} ms, ` +
    `spectral character: ${cough.character}.`
  );

  let label = cough.character === 'dry' ? 'dry_cough' : 'productive_cough';
  let confidence = 0.45 + 0.3 * quality.score + Math.min(cough.count, 5) * 0.03;

  if (cough.character === 'dry') {
    differentials.push('Viral URI', 'Asthma-variant cough', 'Post-infectious cough');
  } else {
    differentials.push('Lower respiratory tract infection', 'Bronchitis', 'Pneumonia');
  }

  if (crackle.detected) {
    evidence.push(`Crackle-like transients also present between coughs (${crackle.count}).`);
    differentials.unshift('Pneumonia — chest imaging advised');
    confidence = Math.min(0.9, confidence + 0.08);
  }

  return { label, confidence, evidence, differentials, scores: { burstCount: cough.count } };
}

// ─── Triage Fusion ───────────────────────────────────────────────────

/**
 * Combine the acoustic label with the patient's vitals into a single
 * triage level. This is what pushes a case to the top of the queue.
 *
 * Vitals dominate: a SpO2 of 88 % is an emergency regardless of what
 * the microphone heard.
 */
function fuseTriage(acoustic, vitals = {}, type) {
  const reasons = [];
  let score = 0;

  const num = (x) => (x === null || x === undefined || x === '' ? null : Number(x));
  const spo2 = num(vitals.spo2);
  const hr = num(vitals.heartRate);
  const sys = num(vitals.systolicBP);

  // ── Acoustic contribution ──
  const acousticWeights = {
    wheeze_and_crackles: 45,
    fine_crackles: 40,
    coarse_crackles: 32,
    wheeze: 35,
    irregular_rhythm_with_murmur_signal: 45,
    irregular_rhythm: 38,
    murmur_signal_present: 30,
    tachycardia_signal: 25,
    bradycardia_signal: 25,
    productive_cough: 22,
    dry_cough: 12,
    regular_rhythm: 0,
    normal_breath_sounds: 0,
    no_cough_detected: 0,
    inconclusive: 8,
  };
  const acousticPoints = (acousticWeights[acoustic.label] ?? 10) * acoustic.confidence;
  score += acousticPoints;
  if (acousticPoints >= 15) {
    reasons.push(`Acoustic finding: ${acoustic.label.replace(/_/g, ' ')} (confidence ${Math.round(acoustic.confidence * 100)}%)`);
  }

  // ── Vitals contribution ──
  if (spo2 !== null) {
    if (spo2 < 90) { score += 50; reasons.push(`SpO₂ ${spo2}% — severe hypoxaemia`); }
    else if (spo2 < 94) { score += 30; reasons.push(`SpO₂ ${spo2}% — below normal range`); }
    else if (spo2 < 96) { score += 12; reasons.push(`SpO₂ ${spo2}% — borderline`); }
  }
  if (hr !== null) {
    if (hr > 120 || hr < 45) { score += 25; reasons.push(`Heart rate ${hr} bpm — outside safe range`); }
    else if (hr > 100 || hr < 55) { score += 12; reasons.push(`Heart rate ${hr} bpm — abnormal`); }
  }
  if (sys !== null) {
    if (sys > 180 || sys < 90) { score += 25; reasons.push(`Systolic BP ${sys} mmHg — outside safe range`); }
    else if (sys > 140) { score += 10; reasons.push(`Systolic BP ${sys} mmHg — hypertensive`); }
  }

  // Cross-modal agreement raises the score: a low SpO2 that matches an
  // abnormal lung sound is far more meaningful than either alone.
  if (spo2 !== null && spo2 < 95 && acousticPoints >= 15 && type === 'lung') {
    score += 12;
    reasons.push('Data fusion: abnormal lung sound correlates with reduced oxygen saturation');
  }

  const finalScore = Math.min(100, Math.round(score));
  let level;
  if (finalScore >= 60) level = 'red';
  else if (finalScore >= 30) level = 'yellow';
  else level = 'green';

  // ── Safety floor ──
  // If the engine heard something abnormal with reasonable confidence,
  // the case cannot be cleared as "green" on the strength of normal
  // vitals alone. An irregular rhythm with a normal SpO₂ still needs a
  // human to look at it — that is the whole point of a screening tool
  // that defers to a physician.
  const ABNORMAL_LABELS = new Set([
    'wheeze', 'wheeze_and_crackles', 'fine_crackles', 'coarse_crackles',
    'irregular_rhythm', 'irregular_rhythm_with_murmur_signal',
    'murmur_signal_present', 'tachycardia_signal', 'bradycardia_signal',
    'productive_cough',
  ]);
  if (level === 'green' && ABNORMAL_LABELS.has(acoustic.label) && acoustic.confidence >= 0.5) {
    level = 'yellow';
    reasons.push('Abnormal acoustic finding — cannot be cleared without physician review');
  }

  return {
    level,
    score: finalScore,
    // Maps onto the existing patient.riskStatus vocabulary
    riskStatus: level === 'red' ? 'high' : level === 'yellow' ? 'moderate' : 'low',
    reasons,
  };
}

// ─── Public Entry Point ──────────────────────────────────────────────

/**
 * Run the full analysis pipeline on one recording.
 *
 * @param {Buffer} fileBuffer - Raw audio file contents
 * @param {'lung'|'heart'|'cough'} type
 * @param {Object} [vitals] - Patient vitals for triage fusion
 * @returns {Object} Analysis record ready to store and render
 */
function analyze(fileBuffer, type = 'lung', vitals = {}) {
  const startedAt = Date.now();

  // ── Decode ──
  let decoded;
  try {
    decoded = dsp.decodeWav(fileBuffer);
  } catch (err) {
    return {
      status: 'error',
      modelVersion: MODEL_VERSION,
      error: 'UNSUPPORTED_AUDIO_FORMAT',
      message:
        `Could not decode this recording (${err.message}). The analysis engine reads ` +
        `PCM WAV. Recordings captured in the browser are converted to WAV before upload; ` +
        `the ESP32 firmware already sends WAV.`,
      analyzedAt: new Date().toISOString(),
    };
  }

  // ── Pre-process ──
  let samples = dsp.removeDC(decoded.samples);
  samples = dsp.resample(samples, decoded.sampleRate, TARGET_SAMPLE_RATE);
  const quality = assessQuality(samples, TARGET_SAMPLE_RATE);
  samples = dsp.normalize(samples);

  if (samples.length < FRAME_SIZE * 4) {
    return {
      status: 'error',
      modelVersion: MODEL_VERSION,
      error: 'RECORDING_TOO_SHORT',
      message: 'The recording is too short to analyse. Please capture at least 3 seconds.',
      quality,
      analyzedAt: new Date().toISOString(),
    };
  }

  // ── Transform ──
  // Pre-emphasis lifts crackle energy; the raw signal is kept for the
  // envelope-based cardiac and cough detectors.
  const emphasised = dsp.preEmphasis(samples);
  const spec = dsp.stft(emphasised, FRAME_SIZE, HOP_SIZE);
  const rawSpec = dsp.stft(samples, FRAME_SIZE, HOP_SIZE);
  const mel = dsp.logMelSpectrogram(rawSpec, TARGET_SAMPLE_RATE, 40);

  // ── Feature extraction ──
  const features = {
    wheeze: detectWheeze(rawSpec),
    crackle: detectCrackle(emphasised),
    breathing: analyseBreathing(samples),
    cardiac: type === 'heart' ? analyseCardiac(samples, rawSpec) : { detected: false },
    cough: type === 'cough' ? detectCough(samples, rawSpec) : { detected: false, count: 0, segments: [] },
  };

  // ── Classify ──
  let acoustic;
  if (type === 'heart') acoustic = classifyHeart(features, quality);
  else if (type === 'cough') acoustic = classifyCough(features, quality);
  else acoustic = classifyLung(features, quality);

  // Recording quality caps confidence — the engine must not be more
  // certain than the signal allows.
  const confidenceCeiling = 0.35 + 0.6 * quality.score;
  const confidence = round(Math.min(acoustic.confidence, confidenceCeiling), 3);

  if (quality.issues.length) {
    acoustic.evidence.push(
      `Signal quality note: ${quality.issues.join(', ')} — confidence capped at ` +
      `${Math.round(confidenceCeiling * 100)}%.`
    );
  }

  // ── Triage fusion ──
  const triage = fuseTriage({ ...acoustic, confidence }, vitals, type);

  // ── Collect anomaly segments for the timeline overlay ──
  const segments = [
    ...(features.wheeze.segments || []),
    ...(features.crackle.segments || []),
    ...(type === 'heart' ? features.cardiac.segments || [] : []),
    ...(type === 'cough' ? features.cough.segments || [] : []),
  ].sort((a, b) => a.start - b.start);

  return {
    status: 'ok',
    modelVersion: MODEL_VERSION,
    method: 'deterministic DSP feature classifier (log-Mel + CORSA acoustic rules)',
    type,
    label: acoustic.label,
    labelText: acoustic.label.replace(/_/g, ' '),
    confidence,
    evidence: acoustic.evidence,
    differentials: acoustic.differentials,
    scores: acoustic.scores,
    triage,
    quality,
    features: {
      wheeze: { ...features.wheeze, segments: undefined },
      crackle: { ...features.crackle, segments: undefined },
      breathing: features.breathing,
      cardiac: type === 'heart' ? { ...features.cardiac, segments: undefined } : null,
      cough: type === 'cough' ? { ...features.cough, segments: undefined } : null,
    },
    segments,
    spectrogram: {
      matrix: downsampleSpectrogram(mel.matrix, 96),
      nMels: mel.nMels,
      maxHz: TARGET_SAMPLE_RATE / 2,
      durationSec: round(samples.length / TARGET_SAMPLE_RATE, 2),
    },
    waveform: downsampleEnvelope(samples, 140),
    durationSec: round(samples.length / TARGET_SAMPLE_RATE, 2),
    sampleRate: decoded.sampleRate,
    processingMs: Date.now() - startedAt,
    analyzedAt: new Date().toISOString(),
  };
}

module.exports = {
  analyze,
  MODEL_VERSION,
  // exported for unit testing
  _internal: {
    detectWheeze,
    detectCrackle,
    analyseCardiac,
    detectCough,
    analyseBreathing,
    assessQuality,
    fuseTriage,
  },
};
