# 🫁 WellSim — AI-Assisted Telemedicine Screening

> Two-layer respiratory & cardiovascular screening: an AI engine screens every
> recording, and a physician has the final word on all of them.

A low-cost ESP32 device captures lung, heart, and cough audio alongside vital
signs. The backend analyses the audio, assigns a triage level, and holds the
result as **"awaiting physician confirmation"** until a doctor confirms,
modifies, or rejects it. Every disagreement is logged as training data.

---

## ⚙️ Configuration

`backend/.env` is required. Copy `backend/.env.example` and set at minimum
`TOKEN_SECRET` and `DEVICE_API_KEY` — **the server refuses to start in
production without them** rather than falling back to a value published in
this repository. `STAFF_REGISTRATION_CODE` gates nurse/doctor signup; leave
it blank to disable staff self-registration entirely.

See [`docs/SECURITY.md`](docs/SECURITY.md) for the audit that produced these
requirements.

## 📐 Architecture

```
                     ┌─────────── LAYER 1: AI SCREENING ────────────┐
ESP32 / browser mic  │ WAV → 8 kHz → STFT → log-Mel → detectors →   │
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

The role gate is enforced **server-side**: the review endpoint returns 403 for
any non-doctor account. Hiding the buttons in the UI is a convenience, not the
security boundary.

**What the AI actually does** — real DSP, no simulated values: wheeze detection
by tonal-peak tracking (CORSA: 100–1000 Hz, ≥ 80 ms), crackle detection by
spectral-flux onsets at 4 ms resolution, cardiac rhythm from S1/S2 interval
variability, murmur from systolic mid-band energy. Confidence is capped by
measured recording quality, and unreadable audio returns an error instead of a
guess.

> **Model status:** `wellsim-dsp-baseline-v0.1` is a deterministic DSP
> classifier, **not** a trained CNN. It produces the exact log-Mel input tensor
> a CNN will consume, and the classifier is a drop-in replacement point. No
> accuracy figures should be quoted until Phase 2 validation against a labelled
> clinical corpus. See [`docs/AI_PIPELINE.md`](docs/AI_PIPELINE.md).

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

### 3. Send Test Data

Simulate an ESP32 device:

```bash
curl -X POST http://localhost:3001/api/device/data \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "ESP32-001",
    "timestamp": "2026-07-15T10:25:30Z",
    "audio_status": "recording",
    "sample_rate": 16000,
    "temperature": 36.7,
    "battery": 92,
    "wifi_strength": -58
  }'
```

The dashboard will update automatically within 2 seconds.

---

## 📡 API Reference

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/device/data` | — | Receive telemetry from ESP32 |
| `POST` | `/api/device/audio` | — | Receive a recording **and screen it automatically** |
| `DELETE` | `/api/device/audio/:patientId/:type` | any | Delete a recording, its file, and its analysis |
| `GET` | `/api/device/latest` | any | Latest sensor reading |
| `GET` | `/api/device/status` | any | Device connection status |
| `POST` | `/api/analysis/run` | any | Layer 1 — screen a stored recording |
| `GET` | `/api/analysis/:patientId` | any | Analyses + review state |
| `POST` | `/api/analysis/:patientId/:type/review` | **doctor** | Layer 2 — confirm / modify / reject |
| `GET` | `/api/analysis/stats/agreement` | any | Live AI-vs-physician agreement |
| `GET` | `/api/analysis/feedback/export` | **doctor** | Retraining corpus (`?format=csv`) |
| `GET` | `/api/health` | — | API health check |

### Layer 2 — physician review

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

A nurse token gets `403` with an explanation. Rejecting a result **requires** a
written reason — that reason is what the model learns from.

### Running the test suites

```bash
cd backend
cp .env.example .env      # fill in TOKEN_SECRET and DEVICE_API_KEY first

node test/validate.js     # 47 DSP assertions (no server needed)

npm start &               # the next two probe a live server
node test/audio.test.js   # 23 upload / delete / permission assertions
node test/audit.js        # security audit — expects 0 critical, 0 high
```

Run `audit.js` last, or against a fresh server: it deliberately triggers the
login rate limiter, which will then throttle anything that follows.

47 assertions over synthetic signals with known ground truth: normal breathing
raises no false alarm, a 400 Hz wheeze is found within ±80 Hz, crackles are
counted and characterised, rhythm irregularity and murmurs are separated,
silent/short/non-WAV inputs are refused rather than guessed at, and the same
input always produces the same output.

### POST `/api/device/data`

**Request Body:**
```json
{
  "device_id": "ESP32-001",
  "timestamp": "2026-07-15T10:25:30Z",
  "audio_status": "recording",
  "sample_rate": 16000,
  "temperature": 36.7,
  "battery": 92,
  "wifi_strength": -58
}
```

> **Note:** Only `device_id` is required. Additional fields are accepted and stored as-is, making the API future-proof for expanding ESP32 payloads.

**Response:**
```json
{
  "success": true,
  "message": "Data received successfully.",
  "device_id": "ESP32-001",
  "received_at": "2026-07-15T10:25:30.123Z"
}
```

### GET `/api/device/latest`

Optional query: `?device_id=ESP32-001`

### GET `/api/device/status`

Returns `online` if data was received within the last 30 seconds, otherwise `offline`.

---

## 📁 Project Structure

```
WellSim/
├── .gitignore
├── .next
├── ESP32-code
├── uploads
├── backend/
│   ├── server.js                    # Express entry point
│   ├── config/index.js              # Centralized configuration
│   ├── test/validate.js             # DSP validation suite (47 assertions)
│   └── src/
│       ├── routes/
│       │   ├── device.js            # ESP32 telemetry + audio upload
│       │   ├── analysis.js          # AI screening & physician review
│       │   ├── auth.js              # Login / register / session
│       │   └── patients.js          # Patient CRUD
│       ├── services/
│       │   ├── dsp.js               # FFT, STFT, Mel filterbank, WAV decode
│       │   ├── audioAnalysis.js     # Detectors, classifier, triage fusion
│       │   ├── dbService.js         # Storage, reviews, feedback log
│       │   └── deviceService.js     # Telemetry store
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
│       │   ├── page.js              # Dashboard page
│       │   └── globals.css          # Tailwind + custom styles
│       ├── components/
│       │   ├── AIAnalysisPanel.jsx  # AI verdict + physician review UI
│       │   ├── SpectrogramView.jsx  # Log-Mel heatmap + anomaly overlay
│       │   ├── PatientFormModal.jsx # Add / edit patient
│       │   ├── Header.jsx           # App header with live clock
│       │   └── …                    # Telemetry cards, toggles, guards
│       ├── i18n/
│       ├── hooks/
│       │   └── useDeviceData.js     # Real-time polling hook
│       ├── lib/
│       │   └── audioEncoder.js      # Browser recording → PCM WAV
│       └── services/
│           └── api.js               # API client
│
├── docs/
│   └── AI_PIPELINE.md               # How the screening works & its limits
└── README.md
```

## 🎙️ Three ways to get audio in

| Source | How | Notes |
|---|---|---|
| **ESP32 device** | Dashboard sends a `record` command; the device posts back | Already WAV |
| **Browser microphone** | 10 s capture from the laptop mic | Transcoded to WAV client-side |
| **File upload** | Pick a file from the computer | WAV, MP3, M4A, OGG, FLAC, WebM |

Uploaded files are decoded with the Web Audio API and re-encoded to **16 kHz
mono PCM WAV** in the browser, so every path reaches the engine in the same
format. Minimum 3 s, trimmed at 120 s. Screening runs automatically on arrival
— no separate step.

Deleting a recording removes the file from disk, the `audioLogs` entry, **and
the AI analysis derived from it**: a verdict that outlives its audio cannot be
checked by anyone. If a doctor had already signed that result, the confirmation
dialog says so explicitly before you commit. Physician corrections already in
`db.feedback[]` are kept — they are training data.

## ✅ Implemented

- **Audio capture** — ESP32, browser microphone, or file upload; all three
  normalised to 16 kHz mono WAV, with delete and replace
- **AI screening** — wheeze, crackle, cardiac rhythm, murmur and cough
  detection from real audio, with confidence, evidence, and time-stamped
  anomaly segments (`src/services/audioAnalysis.js`, `src/services/dsp.js`)
- **Explainability** — log-Mel spectrogram rendered in the dashboard with the
  flagged segments drawn on top, over the real amplitude envelope
- **Physician review** — confirm / modify / reject, role-gated at the API
- **Feedback loop** — every correction stored as a `(spectrogram, expert label)`
  pair, exportable as CSV
- **Triage queue** — sorted by urgency, unreviewed cases first
- **Authentication** — token auth with nurse / doctor / patient roles
- **Persistence** — JSON file store with schema migrations

## 🔮 Still to do

- **Train the CNN** — the log-Mel pipeline and the labelled corpus are in
  place; the classifier is the drop-in replacement point
- **Phase 2 validation** — sensitivity / specificity / AUC against the ICBHI
  2017 database
- **Database** — PostgreSQL/TimescaleDB in place of the JSON store
- **Alerts** — push notification on a red triage result

## 🛠 ESP32 Integration

Example Arduino/ESP-IDF code for sending data:

```cpp
#include <HTTPClient.h>
#include <ArduinoJson.h>

void sendData() {
  HTTPClient http;
  http.begin("http://YOUR_SERVER_IP:3001/api/device/data");
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<256> doc;
  doc["device_id"] = "ESP32-001";
  doc["timestamp"] = getISOTimestamp();
  doc["audio_status"] = "recording";
  doc["sample_rate"] = 16000;
  doc["temperature"] = readTemperature();
  doc["battery"] = getBatteryLevel();
  doc["wifi_strength"] = WiFi.RSSI();

  String payload;
  serializeJson(doc, payload);

  int responseCode = http.POST(payload);
  http.end();
}
```

---
