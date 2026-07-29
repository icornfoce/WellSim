/**
 * WellSim — Analysis Engine Validation Harness
 *
 * Phase 2 of the test plan ("AI Validation") in miniature: build signals
 * whose ground truth we know, run them through the real analysis engine,
 * and assert that the detectors fire where they should and stay quiet
 * where they should not.
 *
 * Run:  node test/validate.js
 *
 * These are synthetic signals with the acoustic properties described in
 * the CORSA respiratory-sound guidelines. They verify that the DSP is
 * correct — they are NOT a substitute for validation on a labelled
 * clinical corpus (e.g. the ICBHI 2017 database), which is Phase 2 of
 * the field-trial plan.
 */

const { analyze } = require('../src/services/audioAnalysis');

const SR = 8000;

// ─── Synthetic Signal Builders ───────────────────────────────────────

/** Encode float samples as a 16-bit PCM mono WAV buffer. */
function toWav(samples, sampleRate = SR) {
  const dataLength = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataLength);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);           // PCM
  buffer.writeUInt16LE(1, 22);           // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataLength, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buffer;
}

/** Deterministic pseudo-random noise so runs are reproducible. */
function makeRng(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s / 0x7fffffff) * 2 - 1;
  };
}

/** Normal vesicular breathing: band-limited noise modulated by breath cycles. */
function normalBreathing(seconds = 8, rng = makeRng()) {
  const n = seconds * SR;
  const out = new Float32Array(n);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    // Breath envelope: ~15 breaths/min (4 s cycle)
    const phase = (t % 4) / 4;
    const env = phase < 0.4
      ? Math.sin((phase / 0.4) * Math.PI) * 0.9      // inspiration
      : phase < 0.75
        ? Math.sin(((phase - 0.4) / 0.35) * Math.PI) * 0.5 // expiration
        : 0.02;
    const white = rng();
    lp = lp * 0.82 + white * 0.18;   // low-pass → vesicular character
    out[i] = lp * env * 0.6;
  }
  return out;
}

/** Add a monophonic wheeze: sustained tone at `hz` during expiration. */
function addWheeze(signal, hz = 400, seconds = 8) {
  const out = Float32Array.from(signal);
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const phase = (t % 4) / 4;
    // Expiratory wheeze, 0.45–0.72 of each cycle ≈ 1.08 s — well over 80 ms
    if (phase > 0.45 && phase < 0.72) {
      const local = (phase - 0.45) / 0.27;
      const env = Math.sin(local * Math.PI);
      out[i] += Math.sin(2 * Math.PI * hz * t) * 0.45 * env;
      out[i] += Math.sin(2 * Math.PI * hz * 2 * t) * 0.12 * env; // harmonic
    }
  }
  return out;
}

/** Add fine crackles: short exponentially-damped broadband bursts. */
function addCrackles(signal, countPerBreath = 6, rng = makeRng(7)) {
  const out = Float32Array.from(signal);
  const cycles = Math.floor(out.length / SR / 4);
  for (let c = 0; c <= cycles; c++) {
    for (let k = 0; k < countPerBreath; k++) {
      // Late-inspiratory crackles cluster in 0.15–0.40 of the cycle
      const phase = 0.15 + (k / countPerBreath) * 0.25 + rng() * 0.01;
      const start = Math.floor((c * 4 + phase * 4) * SR);
      const len = Math.floor(0.006 * SR); // 6 ms — fine crackle
      for (let i = 0; i < len && start + i < out.length; i++) {
        const decay = Math.exp(-i / (len * 0.28));
        out[start + i] += rng() * 0.85 * decay;
      }
    }
  }
  return out;
}

/** Heart sounds: S1/S2 thumps at a given BPM, optionally irregular. */
function heartSounds(seconds = 10, bpm = 72, irregular = false, murmur = 0, rng = makeRng(3)) {
  const n = seconds * SR;
  const out = new Float32Array(n);
  const baseCycle = 60 / bpm;
  let t = 0.2;

  while (t < seconds - 0.5) {
    const jitter = irregular ? (rng() * 0.42) : (rng() * 0.012);
    const cycle = Math.max(0.32, baseCycle + jitter);

    // S1 — lower and longer
    placeThump(out, t, 45, 0.10, 0.9);
    // S2 — higher and shorter, ~35 % into the cycle (systole)
    const s2 = t + cycle * 0.34;
    placeThump(out, s2, 65, 0.07, 0.65);

    // Systolic murmur: noise filling the S1→S2 gap
    if (murmur > 0) {
      const start = Math.floor((t + 0.06) * SR);
      const end = Math.floor((s2 - 0.02) * SR);
      let lp = 0;
      for (let i = start; i < end && i < n; i++) {
        const white = rng();
        lp = lp * 0.55 + white * 0.45;       // band-passed toward 150–400 Hz
        const env = Math.sin(((i - start) / (end - start)) * Math.PI);
        out[i] += lp * murmur * env;
      }
    }

    t += cycle;
  }

  // Low-level background
  for (let i = 0; i < n; i++) out[i] += rng() * 0.012;
  return out;
}

function placeThump(out, tSec, hz, durSec, amp) {
  const start = Math.floor(tSec * SR);
  const len = Math.floor(durSec * SR);
  for (let i = 0; i < len && start + i < out.length; i++) {
    const decay = Math.exp(-i / (len * 0.3));
    out[start + i] += Math.sin(2 * Math.PI * hz * (i / SR)) * amp * decay;
  }
}

/** Cough bursts: explosive onset, noisy decay. */
function coughSignal(seconds = 8, count = 4, wet = false, rng = makeRng(11)) {
  const n = seconds * SR;
  const out = new Float32Array(n);
  for (let c = 0; c < count; c++) {
    const start = Math.floor((0.8 + c * 1.7) * SR);
    const len = Math.floor(0.32 * SR);
    let lp = 0;
    for (let i = 0; i < len && start + i < n; i++) {
      const decay = Math.exp(-i / (len * 0.22));
      const white = rng();
      // A "wet" cough carries more low-frequency energy
      lp = wet ? lp * 0.88 + white * 0.12 : lp * 0.35 + white * 0.65;
      out[start + i] += lp * decay * 0.95;
    }
  }
  for (let i = 0; i < n; i++) out[i] += rng() * 0.008;
  return out;
}

// ─── Test Runner ─────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 56 - title.length))}`);
}

// ─── Cases ───────────────────────────────────────────────────────────

console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║  WellSim — Analysis Engine Validation                    ║');
console.log('╚══════════════════════════════════════════════════════════╝');

// 1. Normal breathing → must NOT raise a false alarm
section('CASE 1  Normal vesicular breathing (expect: normal)');
{
  const r = analyze(toWav(normalBreathing(8)), 'lung', { spo2: 98, heartRate: 72, systolicBP: 118 });
  console.log(`     label=${r.label}  conf=${r.confidence}  triage=${r.triage?.level}  quality=${r.quality?.score}`);
  check('status ok', r.status === 'ok', r.message);
  check('classified as normal', r.label === 'normal_breath_sounds', `got ${r.label}`);
  check('triage green', r.triage.level === 'green', `got ${r.triage.level}`);
  check('no wheeze false positive', !r.features.wheeze.detected);
  check('respiratory rate plausible (8–30)',
    r.features.breathing.ratePerMinute >= 8 && r.features.breathing.ratePerMinute <= 30,
    `got ${r.features.breathing.ratePerMinute}`);
  check('spectrogram produced', r.spectrogram.matrix.length === 96 && r.spectrogram.matrix[0].length === 40);
  check('waveform produced', r.waveform.length === 140);
}

// 2. Wheeze → must be detected with the right frequency
section('CASE 2  Expiratory wheeze @ 400 Hz (expect: wheeze)');
{
  const sig = addWheeze(normalBreathing(8), 400);
  const r = analyze(toWav(sig), 'lung', { spo2: 93, heartRate: 104, systolicBP: 142 });
  console.log(`     label=${r.label}  conf=${r.confidence}  dominantHz=${r.features.wheeze.dominantHz}  triage=${r.triage?.level}`);
  check('wheeze detected', r.features.wheeze.detected);
  check('label is wheeze-related', /wheeze/.test(r.label), `got ${r.label}`);
  check('dominant frequency within ±80 Hz of 400',
    Math.abs((r.features.wheeze.dominantHz || 0) - 400) <= 80,
    `got ${r.features.wheeze.dominantHz} Hz`);
  check('episode ≥ 80 ms', r.features.wheeze.longestMs >= 80, `got ${r.features.wheeze.longestMs} ms`);
  check('triage escalated to red (low SpO2 + wheeze)', r.triage.level === 'red', `got ${r.triage.level}`);
  check('anomaly segments have timestamps', r.segments.length > 0 && r.segments[0].end > r.segments[0].start);
  check('data-fusion reason present',
    r.triage.reasons.some((x) => /fusion/i.test(x)), r.triage.reasons.join(' | '));
}

// 3. Crackles → detected, and characterised as fine
section('CASE 3  Fine crackles (expect: fine_crackles)');
{
  const sig = addCrackles(normalBreathing(8), 6);
  const r = analyze(toWav(sig), 'lung', { spo2: 95, heartRate: 88, systolicBP: 126 });
  console.log(`     label=${r.label}  conf=${r.confidence}  count=${r.features.crackle.count}  width=${r.features.crackle.meanWidthMs}ms  triage=${r.triage?.level}`);
  check('crackles detected', r.features.crackle.detected, `count=${r.features.crackle.count}`);
  check('label is crackle-related', /crackle/.test(r.label), `got ${r.label}`);
  check('crackle width under 45 ms', r.features.crackle.meanWidthMs <= 45, `got ${r.features.crackle.meanWidthMs}`);
  check('triage at least yellow', r.triage.level !== 'green', `got ${r.triage.level}`);
  check('differentials suggested', r.differentials.length > 0);
}

// 4. Regular heart rhythm → correct BPM, not flagged irregular
section('CASE 4  Regular heart rhythm @ 72 bpm (expect: regular)');
{
  const r = analyze(toWav(heartSounds(12, 72, false, 0)), 'heart', { spo2: 98, heartRate: 72, systolicBP: 120 });
  console.log(`     label=${r.label}  bpm=${r.features.cardiac.bpm}  CV=${r.features.cardiac.intervalCV}  triage=${r.triage?.level}`);
  check('heart sounds detected', r.features.cardiac.detected);
  check('BPM within ±12 of 72', Math.abs((r.features.cardiac.bpm || 0) - 72) <= 12, `got ${r.features.cardiac.bpm}`);
  check('not flagged irregular', !r.features.cardiac.irregular, `CV=${r.features.cardiac.intervalCV}`);
  check('label regular_rhythm', r.label === 'regular_rhythm', `got ${r.label}`);
  check('triage green', r.triage.level === 'green', `got ${r.triage.level}`);
}

// 5. Irregular rhythm → flagged
section('CASE 5  Irregular rhythm (expect: irregular)');
{
  const r = analyze(toWav(heartSounds(14, 78, true, 0)), 'heart', { spo2: 97, heartRate: 88, systolicBP: 130 });
  console.log(`     label=${r.label}  bpm=${r.features.cardiac.bpm}  CV=${r.features.cardiac.intervalCV}  triage=${r.triage?.level}`);
  check('flagged irregular', r.features.cardiac.irregular, `CV=${r.features.cardiac.intervalCV}`);
  check('label mentions irregular', /irregular/.test(r.label), `got ${r.label}`);
  check('triage at least yellow', r.triage.level !== 'green', `got ${r.triage.level}`);
  check('ECG referral in differentials',
    r.differentials.some((d) => /ECG/i.test(d)), r.differentials.join(' | '));
}

// 6. Murmur → mid-band energy between S1/S2 detected
section('CASE 6  Systolic murmur (expect: murmur signal)');
{
  const r = analyze(toWav(heartSounds(12, 74, false, 0.30)), 'heart', { spo2: 97, heartRate: 76, systolicBP: 124 });
  console.log(`     label=${r.label}  murmurIndex=${r.features.cardiac.murmurIndex}  triage=${r.triage?.level}`);
  check('murmur index elevated', (r.features.cardiac.murmurIndex || 0) > 0.35, `got ${r.features.cardiac.murmurIndex}`);
  check('label mentions murmur', /murmur/.test(r.label), `got ${r.label}`);
}

// 7. Cough → burst count and character
section('CASE 7  Dry cough ×4 (expect: dry_cough)');
{
  const r = analyze(toWav(coughSignal(8, 4, false)), 'cough', { spo2: 97, heartRate: 84, systolicBP: 122 });
  console.log(`     label=${r.label}  count=${r.features.cough.count}  character=${r.features.cough.character}`);
  check('cough bursts detected', r.features.cough.detected);
  check('count within ±2 of 4', Math.abs(r.features.cough.count - 4) <= 2, `got ${r.features.cough.count}`);
  check('character is dry', r.features.cough.character === 'dry', `got ${r.features.cough.character}`);
}

section('CASE 8  Productive cough ×4 (expect: productive)');
{
  const r = analyze(toWav(coughSignal(8, 4, true)), 'cough', { spo2: 94, heartRate: 96, systolicBP: 132 });
  console.log(`     label=${r.label}  count=${r.features.cough.count}  character=${r.features.cough.character}  triage=${r.triage?.level}`);
  check('cough bursts detected', r.features.cough.detected);
  check('character is productive/wet', r.features.cough.character === 'productive/wet', `got ${r.features.cough.character}`);
}

// 9. Quality gate — silence must be refused, not guessed at
section('CASE 9  Near-silent recording (expect: refuses to guess)');
{
  const silent = new Float32Array(8 * SR);
  const rng = makeRng(5);
  for (let i = 0; i < silent.length; i++) silent[i] = rng() * 0.001;
  const r = analyze(toWav(silent), 'lung', { spo2: 98 });
  console.log(`     label=${r.label}  conf=${r.confidence}  quality=${r.quality.score}  issues=${r.quality.issues}`);
  check('quality flagged as poor', r.quality.score < 0.5, `score=${r.quality.score}`);
  check('confidence capped low', r.confidence <= 0.65, `conf=${r.confidence}`);
  check('quality issue reported', r.quality.issues.length > 0);
}

section('CASE 10  Too-short recording (expect: error, not a guess)');
{
  const short = new Float32Array(Math.floor(0.2 * SR));
  const rng = makeRng(9);
  for (let i = 0; i < short.length; i++) short[i] = rng() * 0.4;
  const r = analyze(toWav(short), 'lung', {});
  console.log(`     status=${r.status}  error=${r.error}`);
  check('returns an error rather than a label', r.status === 'error', `got ${r.status}`);
}

section('CASE 11  Non-WAV payload (expect: clear format error)');
{
  const r = analyze(Buffer.from('this is not audio at all, it is text'), 'lung', {});
  console.log(`     status=${r.status}  error=${r.error}`);
  check('rejects gracefully', r.status === 'error' && r.error === 'UNSUPPORTED_AUDIO_FORMAT');
  check('message explains the fix', /WAV/.test(r.message || ''));
}

// 12. Vitals must be able to escalate on their own
section('CASE 12  Normal sound + severe hypoxaemia (expect: red)');
{
  const r = analyze(toWav(normalBreathing(8)), 'lung', { spo2: 88, heartRate: 118, systolicBP: 145 });
  console.log(`     label=${r.label}  triage=${r.triage.level}  score=${r.triage.score}`);
  check('vitals escalate triage to red', r.triage.level === 'red', `got ${r.triage.level} (${r.triage.score})`);
  check('reason cites SpO2', r.triage.reasons.some((x) => /SpO/i.test(x)), r.triage.reasons.join(' | '));
}

// 13. Determinism — the same input must always give the same output
section('CASE 13  Determinism (expect: identical results)');
{
  const wav = toWav(addWheeze(normalBreathing(8), 350));
  const a = analyze(wav, 'lung', { spo2: 95 });
  const b = analyze(wav, 'lung', { spo2: 95 });
  check('same label', a.label === b.label);
  check('same confidence', a.confidence === b.confidence);
  check('same triage score', a.triage.score === b.triage.score);
  check('same segment count', a.segments.length === b.segments.length);
}

// ─── Summary ─────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(60)}`);
console.log(`  PASSED: ${passed}    FAILED: ${failed}`);
if (failures.length) {
  console.log('\n  Failures:');
  failures.forEach((f) => console.log(`   • ${f}`));
}
console.log(`${'═'.repeat(60)}\n`);

process.exit(failed === 0 ? 0 : 1);
