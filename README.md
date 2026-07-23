# 🫁 WellSim — IoT Healthcare Dashboard

> AI-powered Respiratory & Cardiovascular Screening System (Prototype)

Real-time monitoring dashboard that receives sensor data from ESP32 IoT devices and displays it on a modern medical dashboard.

---

## 📐 Architecture

```
ESP32 Device ──HTTP POST──▶ Express API (:3001) ──Store──▶ In-Memory Map
                                    ▲                          │
                                    │                          ▼
                           Next.js Dashboard ◀──GET Poll───  Data
                                (:3000)          (2s interval)
```

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

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/device/data` | Receive sensor data from ESP32 |
| `GET` | `/api/device/latest` | Get the latest sensor reading |
| `GET` | `/api/device/status` | Check device connection status |
| `GET` | `/api/health` | API health check |

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
├── backend/
│   ├── server.js                    # Express entry point
│   ├── config/
│   │   └── index.js                 # Centralized configuration
│   └── src/
│       ├── routes/
│       │   └── device.js            # REST API endpoints
│       ├── services/
│       │   └── deviceService.js     # Business logic & data store
│       ├── middleware/
│       │   └── validation.js        # JSON payload validation
│       └── placeholders/
│           ├── aiAnalysis.js        # Future AI integration stub
│           └── database.js          # Future DB integration stub
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
│       │   ├── Header.jsx           # App header with live clock
│       │   ├── StatusIndicator.jsx  # Online/offline indicator
│       │   ├── DeviceInfoCard.jsx   # Device ID & connection info
│       │   ├── BatteryCard.jsx      # Battery gauge
│       │   ├── TemperatureCard.jsx  # Temperature with range bar
│       │   ├── AudioStatusCard.jsx  # Audio status & waveform
│       │   ├── WifiSignalCard.jsx   # WiFi signal strength bars
│       │   └── RawDataCard.jsx      # Raw JSON viewer
│       ├── hooks/
│       │   └── useDeviceData.js     # Real-time polling hook
│       └── services/
│           └── api.js               # API client
│
└── README.md
```

## 🔮 Future Modules (Placeholders Ready)

The architecture is designed for seamless expansion:

- **AI Analysis** — Respiratory sound classification, cardiovascular risk scoring
- **Database** — PostgreSQL/TimescaleDB for persistent time-series storage
- **Authentication** — User/provider login and role-based access
- **Patient History** — Historical data tracking and trend analysis
- **Alerts** — Real-time anomaly detection and notifications

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
