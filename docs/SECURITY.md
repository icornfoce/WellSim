# WellSim — Security Audit

Findings from a live probe of the running API (not a code read), with the
fix applied to each. Re-runnable: `node test/audit.js` against a dev server.

**Result: 5 critical, 4 high, 1 medium → all closed.**

---

## 🔴 CRITICAL

### 1. Anyone could self-register as a doctor

`POST /api/auth/register` accepted `role: "doctor"` from an anonymous
request with no verification. The new account could immediately confirm AI
screening results.

This was the single worst issue in the system. The entire premise is that a
physician has the final word — if the public signup form mints physicians,
the review layer is theatre.

**Fixed** — `nurse` and `doctor` now require `STAFF_REGISTRATION_CODE`,
compared in constant time. If the variable is unset, staff self-registration
is refused outright (the correct setting for a real deployment). Patient
signup stays open.

### 2–4. Patient accounts had full access to every medical record

A `patient` account could:

| Request | Before | Now |
|---|---|---|
| `GET /api/patients` | 200 — every record in the clinic | 403 |
| `GET /api/patients/p2` | 200 — anyone's record by ID (IDOR) | 403 |
| `DELETE /api/patients/p3` | 200 — deleted another patient | 403 |

A textbook IDOR and a direct PDPA breach: health data disclosed to someone
with no lawful basis to see it.

**Fixed** — every route in `patients.js` now carries
`requireRole('nurse','doctor')`. A patient account has exactly one
destination, `/api/patients/me`, scoped to its own `userId`.

### 5. Session secret was hardcoded in the repository

`TOKEN_SECRET` fell back to the literal `'wellsim-secret-key-2026'` when the
env var was absent. Anyone reading the source could forge a valid doctor
token — confirmed in the audit by minting one and calling `GET /api/patients`
successfully.

**Fixed** — `config/index.js` exits with a fatal error in production when
`TOKEN_SECRET` or `DEVICE_API_KEY` is missing or under 16 characters. In
development it generates a random per-boot secret and warns.

---

## 🟠 HIGH

### 6. Device endpoints were completely unauthenticated

`POST /api/device/audio`, `POST /api/device/command` and `POST /api/device/data`
required nothing at all. Consequences:

- Anyone on the internet could plant fabricated audio into a named patient's
  record — which the AI would then screen and present to a doctor as that
  patient's lung sounds.
- Anyone could command a stethoscope sitting in a clinic to start recording.

**Fixed** — `requireDeviceOrUser` accepts either a signed-in clinical user
(the dashboard) or the `X-Device-Key` header (the ESP32). Both are compared
in constant time.

### 7. Patients could read other patients' AI analyses

`GET /api/analysis/:patientId` was open to any authenticated account.

**Fixed** — staff-only, same as the patient routes.

### 8. Passwords were a single unsalted SHA-256

One static salt shared by every account, one fast hash. Two consequences:
identical passwords produced identical hashes (one leak deanonymises every
reuse), and SHA-256 is built for speed — roughly 10¹⁰ GPU guesses/second.

**Fixed** — scrypt (N=16384, r=8, p=1) with a 16-byte per-user random salt,
stored as `scrypt$<salt>$<hash>`. Verified in constant time. Legacy hashes
still validate and are **transparently upgraded on next successful login**,
so nobody has to reset a password. scrypt ships with Node — no new
dependency, which matters on a free-tier host.

### 9. No rate limiting on authentication

Unlimited login attempts — credential stuffing was free.

**Fixed** — 10 login attempts and 5 registrations per IP per minute,
returning 429 with `Retry-After`. In-memory and single-instance; a
multi-instance deployment needs a shared store (Redis).

---

## 🟡 MEDIUM

### 10. Vitals accepted physiologically impossible values

`spo2: -500` and `heartRate: 99999` were stored without complaint, and the
triage score was then computed from them.

**Fixed** — `validateVitalsPayload` enforces survivability bounds (SpO₂
50–100, HR 20–250, systolic 50–260, …). Ranges are deliberately wide: the
job is catching slipped keypresses, not second-guessing a clinician. Also
catches transposed blood pressure (systolic ≤ diastolic).

---

## Also fixed along the way

- **CORS reflected any origin with credentials enabled.** Now restricted to
  `CORS_ORIGINS` in production; requests without an `Origin` header (ESP32,
  curl, health checks) still pass, since CORS is a browser mechanism.
- **Token signature compared with `!==`** — timing oracle. Now
  `crypto.timingSafeEqual`.
- **`db.json` written non-atomically** — a crash mid-write truncated the file
  and took every patient record with it. Now writes to a temp file and
  `rename()`s, which is atomic on POSIX and Windows.
- **Migrations ran inside every `readDB()`**, and `readDB()` runs several
  times per request. `ensureAudioFilesExist` alone did one `fs.existsSync`
  per patient per recording type — 600 stat calls per request at 200
  patients. Now runs once per process.

---

## Known limits (not yet addressed)

- **Concurrent writes can be lost.** `readDB`/`writeDB` is
  read-modify-write with no locking; two simultaneous requests can clobber
  each other. Acceptable for a single-clinic prototype, not for production —
  this is the main reason to move to PostgreSQL.
- **Tokens live in `localStorage`**, so any XSS steals a session. httpOnly
  cookies plus CSRF tokens would be stronger.
- **No audit log.** For a medical record system, every read and write should
  be attributable. Currently only reviews and deletions are logged, to stdout.
- **No token revocation.** A stolen token is valid until it expires (24 h).
- **Uploaded audio is stored unencrypted** on the server filesystem.
