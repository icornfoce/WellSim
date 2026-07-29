# WellSim — AI Screening Pipeline

How the system turns a recording into a triage level, and exactly how far
the current model can be trusted.

---

## The two layers

```
                     ┌──────────────── LAYER 1: AI SCREENING ────────────────┐
ESP32 / browser mic  │  WAV → resample 8 kHz → STFT → log-Mel spectrogram    │
   ──── audio ────▶  │       → feature detectors → classifier → triage       │
                     │  Output: label + confidence + evidence + segments     │
                     └───────────────────────┬──────────────────────────────┘
                                             │  status: AWAITING CONFIRMATION
                                             ▼
                     ┌──────────────── LAYER 2: PHYSICIAN REVIEW ───────────┐
                     │  Doctor sees spectrogram, flagged segments, audio     │
                     │  → CONFIRM · MODIFY · REJECT                          │
                     │  Disagreements are logged to db.feedback[]            │
                     └───────────────────────┬──────────────────────────────┘
                                             ▼
                                    Patient triage level
                                (physician verdict always wins)
```

The role gate is enforced server-side. `POST /api/analysis/:id/:type/review`
returns **403** for any account whose role is not `doctor`, so "the physician
has the final word" is a property of the API, not just of the UI.

---

## Layer 1 — what is actually computed

Everything below is measured from the audio samples. No value is randomised,
simulated, or hard-coded per patient. Running the same file twice gives byte-
identical output (verified by `test/validate.js`, case 13).

### Signal chain

| Stage | Parameters | File |
|---|---|---|
| WAV decode | 8/16/24/32-bit PCM + IEEE float, any channel count → mono | `services/dsp.js` |
| DC removal | mean subtraction (ESP32 I2S captures sit off-centre) | `services/dsp.js` |
| Resample | → 8 kHz (4 kHz Nyquist covers lung and heart bands) | `services/dsp.js` |
| Normalise | peak → 0.95 | `services/dsp.js` |
| Pre-emphasis | first-order high-pass, α = 0.97 | `services/dsp.js` |
| STFT | 512-sample Hann window (64 ms), 128 hop (16 ms), radix-2 FFT | `services/dsp.js` |
| Mel filterbank | 40 triangular bands, 50 Hz – 4 kHz | `services/dsp.js` |
| Log-Mel | dB scale, normalised to [0,1] with a 60 dB floor | `services/dsp.js` |

The resulting 40-band log-Mel spectrogram is **the standard input tensor for
respiratory-sound CNNs**. It is computed today, rendered in the dashboard, and
is what a trained model will consume without changing anything upstream.

### Detectors

**Wheeze** — CORSA definition: continuous, musical, dominant frequency
100–1000 Hz, duration ≥ 80 ms.
Tracks the dominant spectral peak frame by frame; groups runs where the peak
stays tonal (spectral flatness ≤ 0.35, prominence ≥ 3× band average) and
frequency-stable (±18 % drift). Reports episode count, dominant frequency,
longest episode, and occupancy ratio.

**Crackle** — discontinuous, explosive, < 20 ms broadband transient.
Uses its own fine-resolution transform (128-sample window, 32 hop = 4 ms
steps) because a 6 ms event is invisible inside a 64 ms window. Onsets are
found by spectral flux against a **median + 5×MAD** threshold — MAD rather
than standard deviation, because the transients themselves inflate σ and push
the threshold above the very events being looked for. Survivors must be
broadband (rejects wheeze onsets) and decay within 45 ms. Mean width < 10 ms
is reported as *fine*, otherwise *coarse*.

**Cardiac rhythm** — S1/S2 peaks on the RMS envelope, alternation detection to
recover the S1→S1 cardiac cycle, then BPM and the coefficient of variation of
cycle length. CV > 0.15 is reported as an irregular rhythm.

**Murmur** — mid-band (150–400 Hz) energy during systole, referenced against
the **full-band** energy of S1/S2. The full-band reference matters: S1 and S2
are 40–70 Hz events, so measured in the 150–400 Hz slice alone they sit at the
noise floor and every recording scores ≈ 1.0. Threshold: 0.25.

**Cough** — burst detection on the envelope, with the low/high energy ratio
separating dry from productive.

### Confidence

Confidence is derived from evidence strength, then **capped by recording
quality**: `ceiling = 0.35 + 0.6 × qualityScore`. The engine cannot be more
certain than the signal allows. Quality itself is measured from duration, peak
amplitude, clipping ratio, and crest factor.

Recordings that are too short, silent, or unreadable return
`status: 'error'` with an explanation rather than a guess.

### Triage fusion

Acoustic finding + vitals → 0–100 score → red (≥60) / yellow (≥30) / green.

- Vitals can escalate on their own — SpO₂ 88 % is an emergency whatever the
  microphone heard.
- Cross-modal agreement adds points: a low SpO₂ that *matches* an abnormal
  lung sound is more meaningful than either alone.
- **Safety floor:** an abnormal acoustic finding at ≥ 0.5 confidence can never
  be cleared as green, even with perfect vitals. It becomes yellow with the
  reason "cannot be cleared without physician review".

---

## What this model is, and is not

**It is** a deterministic DSP classifier implementing published acoustic
definitions, with calibrated confidence and honest failure modes.

**It is not** a trained neural network, and the project must not claim
sensitivity, specificity, or AUC figures until Phase 2 validation is done.

Current status: `wellsim-dsp-baseline-v0.1`

### Path to a trained model

1. **Phase 2 — validate the baseline.** Run the engine over the ICBHI 2017
   Respiratory Sound Database and compute sensitivity/specificity/AUC per
   class. This gives the first defensible accuracy number.
2. **Collect labelled data.** Field recordings plus physician labels from
   `db.feedback[]` (exportable as CSV at `/api/analysis/feedback/export`).
3. **Train a CNN** on the log-Mel spectrograms the pipeline already produces.
4. **Swap the classifier**, keep everything else. The replacement point is the
   `classifyLung` / `classifyHeart` / `classifyCough` functions in
   `services/audioAnalysis.js` — the signal chain, evidence reporting, triage
   fusion, and review workflow are all model-agnostic.
5. **Keep the baseline as a fallback** for when the model is unavailable or
   its confidence is low.

---

## Layer 2 — the feedback loop

Every physician verdict is stored on the analysis record. `modify` and
`reject` additionally append to `db.feedback[]`:

```json
{
  "audioUrl":     "/uploads/audio_ESP32-A_lung_1784965285614.wav",
  "modelVersion": "wellsim-dsp-baseline-v0.1",
  "aiLabel":      "wheeze",
  "aiConfidence": 0.78,
  "aiTriage":     "yellow",
  "doctorLabel":  "coarse_crackles",
  "doctorTriage": "yellow",
  "action":       "modify",
  "note":         "Sounds like secretions, not bronchospasm.",
  "doctorName":   "Dr. Somchai"
}
```

Each row is a `(spectrogram, expert label)` training pair. **Disagreement is
the useful signal**, which is why rejections require a written reason and why
the AI's original opinion is preserved rather than overwritten.

`GET /api/analysis/stats/agreement` reports live confirm/modify/reject counts
and raw agreement. Cohen's κ is deliberately *not* computed here — it needs a
balanced labelled set and belongs in the Phase 4 offline analysis.

---

## Testing

```bash
cd backend && node test/validate.js
```

47 assertions across 13 cases: normal breathing (no false alarm), wheeze at a
known frequency, fine crackles, regular/irregular rhythm, murmur, dry and
productive cough, silent and too-short recordings, non-WAV payloads,
vitals-driven escalation, and determinism.

These use synthetic signals with known ground truth — they verify the DSP is
correct. **They are not clinical validation.** That is Phase 2.
