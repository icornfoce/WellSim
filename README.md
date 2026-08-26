# 🫁 WellSim — AI-Assisted Telemedicine Screening

> Two-layer respiratory & cardiovascular screening: an AI acoustic engine screens every
> recording, and a physician has the final word on all of them.

WellSim captures lung, heart, and cough audio via browser microphone or audio file upload alongside vital signs and laboratory results. The backend analyses the audio using digital signal processing (DSP) and machine learning feature extraction, assigns a triage level, and holds the result as **"awaiting physician confirmation"** until a doctor confirms, modifies, or rejects it. Every disagreement is logged as clinical feedback data for model retraining.

---

## ⚙️ Configuration

`backend/.env` is required. Copy `backend/.env.example` and set at minimum
`TOKEN_SECRET` — **the server refuses to start in production without it** rather than falling back to an insecure default. `STAFF_REGISTRATION_CODE` gates nurse/doctor signup; leave it blank to disable staff self-registration entirely.

See [`docs/SECURITY.md`](docs/SECURITY.md) for the audit details and security requirements.

## 📐 Architecture

```
                     ┌─────────── LAYER 1: AI SCREENING ────────────┐
Browser mic / upload │ WAV → 8 kHz → STFT → log-Mel → detectors →   │
   ──── audio ────▶  │ label + confidence + triage + evidence       │
                     └────────────────────┬────────────────────────┘
                                          │ AWAITING CONFIRMATION
                                          ▼
                     ┌─────────── LAYER 2: PHYSICIAN REVIEW ────────┐
                     │ Doctor sees spectrogram, flagged segments,   │
                     │ raw audio → CONFIRM · MODIFY · REJECT        │
                     │ Corrections → db.feedback[] (retraining set) │
                     └────────────────────┬────────────────────────┘
                                          ▼
                              Triage queue, urgent first
```

The role gate is enforced **server-side**: the review endpoint returns 403 for any non-doctor account. Hiding the buttons in the UI is a convenience, not the security boundary.

**What the AI actually does** — real DSP, no simulated values: wheeze detection by tonal-peak tracking (CORSA: 100–1000 Hz, ≥ 80 ms), crackle detection by spectral-flux onsets at 4 ms resolution, cardiac rhythm from S1/S2 interval variability, murmur from systolic mid-band energy. Confidence is calibrated by measured recording quality, and unreadable audio returns an error instead of a guess.

> **Model status:** `wellsim-dsp-baseline-v0.1` is a deterministic DSP classifier, **not** a placeholder. It produces the exact log-Mel input tensor a neural network consumes, and the classifier is a drop-in replacement point. See [`docs/AI_PIPELINE.md`](docs/AI_PIPELINE.md).

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 18.x
- **npm** ≥ 9.x

### 1. Start the Backend

```bash
cd backend
npm install
npm run dev
```

The API server starts at `http://localhost:3001`.

### 2. Start the Frontend

```bash
cd frontend
npm install
npm run dev
```

The dashboard opens at `http://localhost:3000`.

---

## 📡 API Reference

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/device/audio` | any | Upload an audio recording **and screen it automatically** |
| `DELETE` | `/api/device/audio/:patientId/:type` | any | Delete a recording, its file, and its analysis |
| `POST` | `/api/analysis/run` | any | Layer 1 — screen a stored recording |
| `GET` | `/api/analysis/:patientId` | any | Analyses + review state |
| `POST` | `/api/analysis/:patientId/:type/review` | **doctor** | Layer 2 — confirm / modify / reject |
| `GET` | `/api/analysis/stats/agreement` | any | Live AI-vs-physician agreement |
| `GET` | `/api/analysis/feedback/export` | **doctor** | Retraining corpus (`?format=csv`) |
| `GET` | `/api/patients` | any | Fetch patient queue & records |
| `POST` | `/api/patients` | any | Create a new patient record |
| `PUT` | `/api/patients/:id` | any | Update patient demographics |
| `PUT` | `/api/patients/:id/vitals` | any | Update patient vitals / lab values |
| `DELETE` | `/api/patients/:id` | any | Delete patient record |
| `GET` | `/api/health` | — | API health check |

### Layer 2 — Physician Review

```bash
# Confirm the AI result
curl -X POST http://localhost:3001/api/analysis/p1/lung/review \
  -H "Authorization: Bearer $DOCTOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"confirm","note":"Agree — expiratory wheeze audible."}'

# Override it (logged for retraining)
curl -X POST http://localhost:3001/api/analysis/p1/lung/review \
  -H "Authorization: Bearer $DOCTOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"modify","finalLabel":"coarse_crackles","finalTriage":"yellow",
       "note":"Secretions, not bronchospasm."}'
```

### Running the Test Suites

```bash
cd backend
cp .env.example .env      # fill in TOKEN_SECRET first

node test/validate.js     # 47 DSP assertions (no server needed)

npm start &               # the next two probe a live server
node test/audio.test.js   # 23 upload / delete / permission assertions
node test/audit.js        # security audit — expects 0 critical, 0 high
```

---

## 📁 Project Structure

```
WellSim/
├── backend/
│   ├── server.js                    # Express entry point
│   ├── config/index.js              # Centralized configuration
│   ├── test/validate.js             # DSP validation suite (47 assertions)
│   └── src/
│       ├── routes/
│       │   ├── analysis.js          # AI screening & physician review
│       │   ├── auth.js              # Login / register / session
│       │   ├── patients.js          # Patient CRUD & vitals
│       │   └── device.js            # Audio upload & management
│       ├── services/
│       │   ├── dsp.js               # FFT, STFT, Mel filterbank, WAV decode
│       │   ├── audioAnalysis.js     # Detectors, classifier, triage fusion
│       │   └── dbService.js         # Storage, reviews, feedback log
│       └── middleware/
│           ├── auth.js              # Token auth + requireRole gate
│           └── validation.js        # JSON payload validation
│
├── frontend/
│   ├── next.config.js               # API proxy rewrites
│   ├── tailwind.config.js           # Medical theme & animations
│   └── src/
│       ├── app/
│       │   ├── layout.js            # Root layout & metadata
│       │   ├── page.js              # Clinician Dashboard (triage queue, vitals, AI review)
│       │   ├── portal/page.js       # Patient Portal (health summary, recordings, reviews)
│       │   ├── login/page.js        # Staff & Patient authentication
│       │   └── globals.css          # Tailwind + custom design system
│       ├── components/
│       │   ├── AIAnalysisPanel.jsx  # AI verdict + physician review UI
│       │   ├── SpectrogramView.jsx  # Log-Mel heatmap + anomaly overlay
│       │   ├── AudioPlayer.jsx      # Multi-type audio player & waveform
│       │   ├── PatientFormModal.jsx # Add / edit patient
│       │   ├── TopBar.jsx           # Clean sticky header & system status
│       │   ├── vitals/VitalsGrid.jsx # Interactive clinical vitals grid & ranges
│       │   └── ui/                  # Reusable UI primitives (dialogs, toasts, badges)
│       ├── i18n/
│       │   └── translations.js      # Bilingual (Thai / English) dictionary
│       ├── hooks/
│       │   └── useAudioPlayback.js  # Unified audio playback hook
│       ├── lib/
│       │   └── audioEncoder.js      # Browser recording → PCM WAV transcoder
│       └── services/
│           └── api.js               # API client
│
└── README.md
```

## 🎙️ Audio Capture Methods

| Method | How | Output |
|---|---|---|
| **Browser Microphone** | Live capture via Web Audio / MediaRecorder | Transcoded to 16 kHz Mono PCM WAV |
| **Audio File Upload** | Pick file (.wav, .mp3, .m4a, .ogg, .flac, .webm) | Transcoded client-side to 16 kHz Mono PCM WAV |

Uploaded audio is decoded with the Web Audio API and re-encoded to **16 kHz mono PCM WAV** in the browser, so every file reaches the AI engine in the exact same format. Screening runs automatically on upload.

## ✅ Key Features

- **Direct Audio Capture** — Browser microphone recording and file upload with client-side 16 kHz PCM WAV transcoding
- **Real-Time DSP & AI Screening** — Wheeze, crackle, cardiac rhythm, murmur, and cough detection with confidence scoring and timestamped anomaly segments
- **Interactive Spectrogram** — High-resolution log-Mel spectrogram with anomaly overlays and audio playback synchronization
- **Physician Review & Override (Layer 2)** — Confirm, modify, or reject AI findings with audit logging and retraining dataset export
- **Bilingual Interface (TH/EN)** — Full support for Thai and English clinical terminology and patient-friendly explanations
- **Collapsible Layout** — Clean, modern medical UI with expandable/collapsible cards for efficient triage workflows
- **Role-Based Access Control** — Dedicated views and permission gates for doctors, nurses, and patients
