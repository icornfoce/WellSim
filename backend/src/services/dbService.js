/**
 * WellSim Backend — Database Service
 * 
 * Lightweight JSON file-based database for persistent storage.
 * Stores users, patients, and IoT readings in backend/data/db.json.
 * 
 * FUTURE: Replace with PostgreSQL/MongoDB adapter.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, '../../data/db.json');

/** Legacy scheme — kept only so existing accounts can still log in once. */
const LEGACY_SALT = 'wellsim-salt-2026';

// ─── Password Utilities ─────────────────────────────────────────────

const SCRYPT_KEYLEN = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 }; // ~100 ms/hash, OWASP-aligned

/**
 * Hash a password with scrypt and a per-user random salt.
 *
 * Format: `scrypt$<saltHex>$<hashHex>`
 *
 * The previous scheme was a single unsalted SHA-256 with one salt shared
 * by every account. Two problems: identical passwords produced identical
 * hashes (so one leak deanonymises every reuse), and SHA-256 is designed
 * to be fast — a GPU tries ~10^10 candidates per second. scrypt is
 * deliberately slow and memory-hard, which collapses that to a few
 * thousand per second.
 *
 * scrypt ships with Node, so this adds no dependency — relevant when the
 * target deployment is a free-tier server.
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** Constant-time comparison of two hex strings. */
function safeCompareHex(a, b) {
  const bufA = Buffer.from(String(a), 'hex');
  const bufB = Buffer.from(String(b), 'hex');
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verify a plaintext password against a stored hash.
 * Understands both the scrypt format and the legacy SHA-256 one.
 *
 * @returns {{ valid: boolean, needsUpgrade: boolean }}
 */
function checkPassword(password, stored) {
  if (typeof stored !== 'string' || !stored) return { valid: false, needsUpgrade: false };

  if (stored.startsWith('scrypt$')) {
    const [, saltHex, hashHex] = stored.split('$');
    if (!saltHex || !hashHex) return { valid: false, needsUpgrade: false };
    try {
      const derived = crypto.scryptSync(
        String(password), Buffer.from(saltHex, 'hex'), SCRYPT_KEYLEN, SCRYPT_PARAMS
      );
      return { valid: safeCompareHex(derived.toString('hex'), hashHex), needsUpgrade: false };
    } catch {
      return { valid: false, needsUpgrade: false };
    }
  }

  // Legacy SHA-256 — verify, then flag for transparent re-hashing on login
  const legacy = crypto.createHash('sha256').update(LEGACY_SALT + password).digest('hex');
  return { valid: safeCompareHex(legacy, stored), needsUpgrade: safeCompareHex(legacy, stored) };
}

/** Backwards-compatible boolean form used by existing callers. */
function verifyPassword(password, stored) {
  return checkPassword(password, stored).valid;
}

/** Re-hash a verified password with the current scheme. */
function upgradePasswordHash(userId, plaintext) {
  const db = readDB();
  const user = db.users.find(u => u.id === userId);
  if (!user) return false;
  user.password = hashPassword(plaintext);
  writeDB(db);
  console.log(`🔐 Upgraded password hash to scrypt for ${user.email}`);
  return true;
}

// ─── Database Read/Write ─────────────────────────────────────────────

/**
 * Read the entire database from disk.
 * @returns {Object} Database contents
 */
function readDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      // Initialize with default data if db.json doesn't exist
      const defaultDB = createDefaultDB();
      writeDB(defaultDB);
      return defaultDB;
    }
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    const db = JSON.parse(raw);
    runMigrationsOnce(db);
    return db;
  } catch (error) {
    console.error('❌ DB read error:', error.message);
    const defaultDB = createDefaultDB();
    writeDB(defaultDB);
    return defaultDB;
  }
}

/**
 * Write the entire database to disk.
 *
 * Writes to a temp file first, then renames. rename() is atomic on both
 * POSIX and Windows, so a crash mid-write cannot leave a truncated
 * db.json — which would take every patient record with it.
 *
 * @param {Object} data - Full database object
 */
function writeDB(data) {
  try {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmp = `${DB_PATH}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, DB_PATH);
  } catch (error) {
    console.error('❌ DB write error:', error.message);
  }
}

/**
 * Run schema migrations exactly once per process.
 *
 * These used to run inside every readDB() call — and readDB() runs on
 * every request, several times for some. ensureAudioFilesExist alone
 * did an fs.existsSync per patient per recording type, so a 200-patient
 * clinic performed 600 stat() calls to answer a single API request.
 */
let migrationsDone = false;
function runMigrationsOnce(db) {
  if (migrationsDone) return;
  migrationsDone = true;
  ensurePatientDemo(db);
  ensureNoFakeVitals(db);
  ensureNoFabricatedAcoustics(db);
  ensureAudioFilesExist(db);
}

/**
 * Migration: make sure the demo patient account exists in databases
 * created before the patient-portal feature. Runs once per db.json.
 */
function ensurePatientDemo(db) {
  if (!db || !Array.isArray(db.users)) return;
  if (db.users.some(u => u.email === 'patient@wellsim.com')) return;

  const maxNum = db.users.reduce((max, u) => {
    const m = /^u(\d+)$/.exec(u.id || '');
    return m ? Math.max(max, parseInt(m[1], 10)) : max;
  }, 0);
  const demoUser = {
    id: `u${maxNum + 1}`,
    name: 'Somchai Jaidee',
    email: 'patient@wellsim.com',
    password: hashPassword('password123'),
    role: 'patient',
    station: 'OPD',
  };
  db.users.push(demoUser);

  // Link the seeded demo record p1 if it isn't owned by anyone yet
  const p1 = (db.patients || []).find(p => p.id === 'p1');
  if (p1 && !p1.userId) p1.userId = demoUser.id;

  writeDB(db);
  console.log('🔧 Migrated DB: added demo patient account (patient@wellsim.com)');
}

/**
 * Migration: older versions silently filled unentered vitals with a
 * fixed "healthy defaults" set. If a record still carries EXACTLY that
 * signature (all six values untouched), treat it as never measured.
 */
function ensureNoFakeVitals(db) {
  if (!db || !Array.isArray(db.patients)) return;
  const isFake = (v) =>
    v &&
    v.spo2 === 98 && v.heartRate === 75 &&
    v.systolicBP === 120 && v.diastolicBP === 80 &&
    v.wbc === 7000 && v.hemoglobin === 13.5;

  let changed = false;
  for (const p of db.patients) {
    if (isFake(p.vitals)) {
      p.vitals = null;
      p.riskScore = 0;
      p.riskStatus = 'pending';
      if (
        Array.isArray(p.findings) &&
        p.findings.length === 1 &&
        /New patient record created/.test(p.findings[0])
      ) {
        p.findings = [];
      }
      changed = true;
    }
  }
  if (changed) {
    writeDB(db);
    console.log('🔧 Migrated DB: cleared placeholder vitals on unmeasured records');
  }
}

/**
 * Migration: earlier seed data asserted acoustic findings ("Wheezing
 * detected in the lower right lung field…") for patients who had no
 * recording at all. Now that lung sounds are genuinely analysed, those
 * sentences are not just decorative — they are false. Replace them with
 * findings that follow from the vitals actually on record.
 */
function ensureNoFabricatedAcoustics(db) {
  if (!db || !Array.isArray(db.patients)) return;

  const FABRICATED = [
    'Wheezing detected in the lower right lung field during expiration.',
    'Data Fusion Indicator: Low SpO2 (93%) correlated with abnormal lung sound pattern.',
    'Mild cough sound pattern detected with normal lung ventilation.',
    'No active wheezing or crackles heard.',
    'All vesicular lung sounds are normal throughout both lung fields.',
    'Healthy cardiac rhythm with clear S1/S2 sounds.',
    'Slight tachycardia noted (104 bpm) matching elevated systolic BP.',
    'Vitals are stable; Blood Pressure is pre-hypertensive.',
  ];
  const REPLACEMENTS = {
    p1: [
      'SpO₂ 93% — below the 95–100% reference range.',
      'Tachycardia: 104 bpm alongside a systolic BP of 142 mmHg.',
      'WBC 12,400/mcL — above reference, consistent with an inflammatory response.',
      'No bio-acoustic recording on file yet — capture lung audio to screen for wheeze or crackles.',
    ],
    p2: [
      'Vitals stable; blood pressure pre-hypertensive at 128/84 mmHg.',
      'SpO₂ 96% and WBC 8,900/mcL are both within reference.',
      'No bio-acoustic recording on file yet — capture lung audio to screen for wheeze or crackles.',
    ],
    p3: [
      'All recorded vitals are within their reference ranges.',
      'Oxygen saturation is optimal at 99%.',
      'No bio-acoustic recording on file yet — capture lung audio to screen for wheeze or crackles.',
    ],
  };

  let changed = false;
  for (const p of db.patients) {
    if (!Array.isArray(p.findings)) continue;
    if (!p.findings.some((f) => FABRICATED.includes(f))) continue;
    p.findings = REPLACEMENTS[p.id] || p.findings.filter((f) => !FABRICATED.includes(f));
    changed = true;
  }

  if (changed) {
    writeDB(db);
    console.log('🔧 Migrated DB: removed seeded acoustic findings with no recording behind them');
  }
}

/**
 * Migration: drop audioLogs entries whose file is no longer on disk.
 * A dashboard that offers "Play" for a recording the server cannot
 * produce is worse than one that admits the recording is gone.
 */
function ensureAudioFilesExist(db) {
  if (!db || !Array.isArray(db.patients)) return;
  const uploadsDir = path.join(__dirname, '../../uploads');
  let changed = false;

  for (const p of db.patients) {
    if (!p.audioLogs) continue;
    for (const type of ['lung', 'heart', 'cough']) {
      const log = p.audioLogs[type];
      if (!log || !log.available) continue;

      const exists = log.url && fs.existsSync(path.join(uploadsDir, path.basename(log.url)));
      if (!exists) {
        p.audioLogs[type] = { available: false, status: 'Not recorded', duration: '0:00' };
        if (p.analyses?.[type]) delete p.analyses[type];
        changed = true;
      }
    }
  }

  if (changed) {
    writeDB(db);
    console.log('🔧 Migrated DB: cleared audio entries whose files are missing from storage');
  }
}

// ─── Default Database Schema ─────────────────────────────────────────

function createDefaultDB() {
  return {
    users: [
      {
        id: 'u1',
        name: 'Nurse Ploy',
        email: 'nurse@wellsim.com',
        password: hashPassword('password123'),
        role: 'nurse',
        station: 'Triage Staff Node A',
      },
      {
        id: 'u2',
        name: 'Dr. Somchai',
        email: 'doctor@wellsim.com',
        password: hashPassword('password123'),
        role: 'doctor',
        station: 'General Clinic',
      },
      {
        id: 'u3',
        name: 'Somchai Jaidee',
        email: 'patient@wellsim.com',
        password: hashPassword('password123'),
        role: 'patient',
        station: 'OPD',
      },
    ],
    patients: [
      {
        id: 'p1',
        userId: 'u3',
        name: 'Somchai Jaidee',
        age: 62,
        gender: 'Male',
        weight: 78,
        height: 170,
        checkInTime: '19:15',
        riskStatus: 'high',
        riskScore: 87,
        vitals: {
          hemoglobin: 11.2,
          wbc: 12400,
          systolicBP: 142,
          diastolicBP: 91,
          spo2: 93,
          heartRate: 104,
        },
        // Derived from the vitals above and nothing else. Acoustic
        // findings are produced by the analysis engine from a real
        // recording — they are never seeded.
        findings: [
          'SpO₂ 93% — below the 95–100% reference range.',
          'Tachycardia: 104 bpm alongside a systolic BP of 142 mmHg.',
          'WBC 12,400/mcL — above reference, consistent with an inflammatory response.',
          'No bio-acoustic recording on file yet — capture lung audio to screen for wheeze or crackles.',
        ],
      },
      {
        id: 'p2',
        name: 'Somsri Rakdee',
        age: 45,
        gender: 'Female',
        weight: 56,
        height: 158,
        checkInTime: '19:30',
        riskStatus: 'moderate',
        riskScore: 48,
        vitals: {
          hemoglobin: 12.8,
          wbc: 8900,
          systolicBP: 128,
          diastolicBP: 84,
          spo2: 96,
          heartRate: 82,
        },
        findings: [
          'Vitals stable; blood pressure pre-hypertensive at 128/84 mmHg.',
          'SpO₂ 96% and WBC 8,900/mcL are both within reference.',
          'No bio-acoustic recording on file yet — capture lung audio to screen for wheeze or crackles.',
        ],
      },
      {
        id: 'p3',
        name: 'Anan Suksamran',
        age: 28,
        gender: 'Male',
        weight: 72,
        height: 175,
        checkInTime: '19:42',
        riskStatus: 'low',
        riskScore: 12,
        vitals: {
          hemoglobin: 15.1,
          wbc: 6200,
          systolicBP: 118,
          diastolicBP: 76,
          spo2: 99,
          heartRate: 70,
        },
        findings: [
          'All recorded vitals are within their reference ranges.',
          'Oxygen saturation is optimal at 99%.',
          'No bio-acoustic recording on file yet — capture lung audio to screen for wheeze or crackles.',
        ],
      },
    ],
    readings: [],
    // Physician corrections of AI output — the retraining corpus
    feedback: [],
  };
}

// ─── User Operations ─────────────────────────────────────────────────

/**
 * Find a user by email.
 */
function findUserByEmail(email) {
  const db = readDB();
  const needle = String(email || '').trim().toLowerCase();
  return db.users.find(u => u.email.toLowerCase() === needle) || null;
}

/**
 * Find a user by ID.
 */
function findUserById(id) {
  const db = readDB();
  return db.users.find(u => u.id === id) || null;
}

/**
 * Generate the next sequential user ID (u1, u2, u3, ...).
 * Always greater than any existing numeric ID, so it never collides
 * even after deletions.
 */
function nextUserId(users) {
  const maxNum = users.reduce((max, u) => {
    const match = /^u(\d+)$/.exec(u.id || '');
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, 0);
  return `u${maxNum + 1}`;
}

/**
 * Create a new user account.
 * Email is normalized to lowercase and must be unique.
 * Password is hashed before storage.
 *
 * @param {Object} data - { name, email, password, role, station }
 * @returns {{ user: Object }|{ error: string }}
 */
function createUser(data = {}) {
  const db = readDB();

  const email = String(data.email || '').trim().toLowerCase();
  if (db.users.some(u => u.email.toLowerCase() === email)) {
    return { error: 'EMAIL_TAKEN' };
  }

  const user = {
    id: nextUserId(db.users),
    name: String(data.name || '').trim(),
    email,
    password: hashPassword(String(data.password || '')),
    role: data.role,
    station: String(data.station || '').trim() ||
      (data.role === 'doctor'
        ? 'General Clinic'
        : data.role === 'patient'
          ? 'OPD'
          : 'Triage Staff Node A'),
  };

  db.users.push(user);
  writeDB(db);
  return { user };
}

/**
 * Find the triage record that belongs to a patient user account.
 */
function getPatientByUserId(userId) {
  const db = readDB();
  return db.patients.find(p => p.userId === userId) || null;
}

/**
 * Create an empty (bare) triage record for a self-registered patient.
 * No vitals, no findings, risk = pending. Staff fill it in later;
 * the UI shows "—" for anything not yet measured.
 */
function createBarePatientRecord(user) {
  const db = readDB();
  const patient = {
    id: nextPatientId(db.patients),
    userId: user.id,
    name: String(user.name || '').trim() || 'Unnamed Patient',
    age: null,
    gender: 'Unspecified',
    weight: null,
    height: null,
    checkInTime: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    vitals: null,
    riskScore: 0,
    riskStatus: 'pending',
    findings: [],
  };
  db.patients.push(patient);
  writeDB(db);
  return patient;
}

// ─── Patient Operations ──────────────────────────────────────────────

/**
 * Recalculate a patient's risk score/status from their vitals.
 * Shared by create, update, and vitals-update flows.
 *
 * @param {Object} vitals
 * @returns {{ riskScore: number, riskStatus: string }}
 */
function calculateRisk(vitals = {}) {
  const hr = parseInt(vitals.heartRate) || 0;
  const o2 = parseInt(vitals.spo2) || 100;
  const bp = parseInt(vitals.systolicBP) || 120;

  if (o2 < 94 || hr > 100 || bp > 140) {
    return { riskScore: 85, riskStatus: 'high' };
  }
  if (o2 < 96 || hr > 85 || bp > 130) {
    return { riskScore: 45, riskStatus: 'moderate' };
  }
  return { riskScore: 15, riskStatus: 'low' };
}

/**
 * Generate the next sequential patient ID (p1, p2, p3, ...).
 * Always greater than any existing numeric ID, so it never collides
 * even after deletions.
 */
function nextPatientId(patients) {
  const maxNum = patients.reduce((max, p) => {
    const match = /^p(\d+)$/.exec(p.id || '');
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, 0);
  return `p${maxNum + 1}`;
}

/**
 * Get all patients.
 */
function getAllPatients() {
  const db = readDB();
  return db.patients;
}

/**
 * Get a patient by ID.
 */
function getPatientById(id) {
  const db = readDB();
  return db.patients.find(p => p.id === id) || null;
}

/**
 * Create a new patient record.
 * Missing vitals fall back to healthy defaults; risk is auto-calculated.
 *
 * @param {Object} data - Patient fields (name, age, gender, weight, height, ...)
 * @returns {Object} The newly created patient
 */
function createPatient(data = {}) {
  const db = readDB();

  // Only keep the vitals that were actually entered — everything else
  // stays null so the UI can honestly show "—" until it's measured.
  const provided = data.vitals || {};
  const vitals = {};
  ['spo2', 'heartRate', 'systolicBP', 'diastolicBP', 'wbc', 'hemoglobin'].forEach((k) => {
    vitals[k] = provided[k] ?? null;
  });
  const hasAnyVitals = Object.values(vitals).some((x) => x !== null && x !== undefined);

  const patient = {
    id: nextPatientId(db.patients),
    name: (data.name || '').trim() || 'Unnamed Patient',
    age: data.age ?? null,
    gender: data.gender || 'Unspecified',
    weight: data.weight ?? null,
    height: data.height ?? null,
    checkInTime:
      data.checkInTime ||
      new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    vitals: hasAnyVitals ? vitals : null,
    findings:
      Array.isArray(data.findings) && data.findings.length
        ? data.findings
        : [],
    ...(hasAnyVitals ? calculateRisk(vitals) : { riskScore: 0, riskStatus: 'pending' }),
  };

  db.patients.push(patient);
  writeDB(db);
  return patient;
}

/**
 * Update an existing patient's editable fields (and optionally vitals).
 * Recalculates risk whenever vitals change.
 *
 * @param {string} patientId
 * @param {Object} updates
 * @returns {Object|null} The updated patient, or null if not found
 */
function updatePatient(patientId, updates = {}) {
  const db = readDB();
  const patient = db.patients.find(p => p.id === patientId);
  if (!patient) return null;

  const editableFields = ['name', 'age', 'gender', 'weight', 'height', 'checkInTime', 'findings'];
  for (const field of editableFields) {
    if (field in updates && updates[field] !== undefined) {
      patient[field] = updates[field];
    }
  }

  if (updates.vitals && typeof updates.vitals === 'object') {
    patient.vitals = { ...patient.vitals, ...updates.vitals };
    Object.assign(patient, calculateRisk(patient.vitals));
  }

  writeDB(db);
  return patient;
}

/**
 * Delete a patient by ID.
 *
 * @param {string} patientId
 * @returns {Object|null} The removed patient, or null if not found
 */
function deletePatient(patientId) {
  const db = readDB();
  const index = db.patients.findIndex(p => p.id === patientId);
  if (index === -1) return null;

  const [removed] = db.patients.splice(index, 1);
  writeDB(db);
  return removed;
}

/**
 * Update a patient's vitals and recalculate risk.
 */
function updatePatientVitals(patientId, vitals) {
  const db = readDB();
  const patient = db.patients.find(p => p.id === patientId);
  if (!patient) return null;

  // Merge vitals and recalculate risk
  patient.vitals = { ...patient.vitals, ...vitals };
  Object.assign(patient, calculateRisk(patient.vitals));

  writeDB(db);
  return patient;
}

// ─── Reading Operations ──────────────────────────────────────────────

/**
 * Save a device reading to the database.
 */
function saveReading(record) {
  const db = readDB();
  db.readings.push(record);

  // Keep last 500 readings max
  if (db.readings.length > 500) {
    db.readings = db.readings.slice(-500);
  }

  writeDB(db);
}

/**
 * Save audio details for a patient.
 */
function savePatientAudio(patientId, type, audioUrl, duration) {
  const db = readDB();
  const patient = db.patients.find(p => p.id === patientId);
  if (!patient) return null;

  patient.audioLogs = patient.audioLogs || {
    lung: { available: false, status: 'Not recorded', duration: '0:00' },
    heart: { available: false, status: 'Not recorded', duration: '0:00' },
    cough: { available: false, status: 'Not recorded', duration: '0:00' }
  };

  patient.audioLogs[type] = {
    available: true,
    status: 'Recorded via WellSim IoT Device (INMP441 - I2S)',
    duration: duration || '0:10',
    url: audioUrl
  };

  writeDB(db);
  return patient;
}

/**
 * Remove a patient's recording of one type.
 *
 * The stored analysis goes with it — an AI result that outlives the
 * audio it was derived from cannot be checked by anyone, which defeats
 * the point of the review layer. Any physician feedback already logged
 * in db.feedback[] is deliberately kept: it is training data, and the
 * spectrogram it refers to is reproducible from the record.
 *
 * @param {string} patientId
 * @param {'lung'|'heart'|'cough'} type
 * @returns {{ patient, removedUrl, hadReview }|{ error: string }|null}
 */
function deletePatientAudio(patientId, type) {
  const db = readDB();
  const patient = db.patients.find(p => p.id === patientId);
  if (!patient) return null;

  const log = patient.audioLogs?.[type];
  if (!log || !log.available) return { error: 'NO_AUDIO' };

  const removedUrl = log.url || null;
  const review = patient.analyses?.[type]?.review;
  const hadReview = !!review && review.status !== 'pending';

  patient.audioLogs[type] = {
    available: false,
    status: 'Not recorded',
    duration: '0:00',
  };
  if (patient.analyses?.[type]) delete patient.analyses[type];

  recomputePatientRisk(patient);

  // Is the same file referenced by any other record? If so, keep it.
  const stillReferenced = removedUrl
    ? db.patients.some(p =>
        ['lung', 'heart', 'cough'].some(k => p.audioLogs?.[k]?.url === removedUrl)
      )
    : false;

  writeDB(db);
  return { patient, removedUrl, hadReview, stillReferenced };
}

// ─── AI Analysis & Physician Review ──────────────────────────────────

/**
 * Attach an AI analysis result to a patient.
 *
 * Every stored analysis starts life with review.status = 'pending'.
 * Nothing in this system is ever considered a finding until a doctor
 * has signed it — the record itself enforces that.
 *
 * @param {string} patientId
 * @param {'lung'|'heart'|'cough'} type
 * @param {Object} analysis - Result from audioAnalysis.analyze()
 * @returns {Object|null} The updated patient
 */
function savePatientAnalysis(patientId, type, analysis) {
  const db = readDB();
  const patient = db.patients.find(p => p.id === patientId);
  if (!patient) return null;

  patient.analyses = patient.analyses || {};
  patient.analyses[type] = {
    ...analysis,
    id: `an_${patientId}_${type}_${Date.now()}`,
    review: {
      status: 'pending',
      doctorId: null,
      doctorName: null,
      finalLabel: null,
      finalTriage: null,
      note: '',
      reviewedAt: null,
    },
  };

  recomputePatientRisk(patient);
  writeDB(db);
  return patient;
}

/**
 * Record a physician's verdict on an AI analysis.
 *
 * Three outcomes, all of them logged:
 *   confirm — the doctor agrees with the AI
 *   modify  — the doctor substitutes their own label and/or triage level
 *   reject  — the doctor discards the AI result entirely
 *
 * A 'modify' or 'reject' is appended to db.feedback, which is the
 * corpus the model is retrained on. Disagreement is the useful signal
 * here, so it is captured rather than overwritten.
 *
 * @param {string} patientId
 * @param {'lung'|'heart'|'cough'} type
 * @param {Object} verdict - { action, finalLabel, finalTriage, note }
 * @param {Object} doctor - { userId, name, station }
 * @returns {{ patient: Object, feedback: Object|null }|null}
 */
function saveAnalysisReview(patientId, type, verdict, doctor) {
  const db = readDB();
  const patient = db.patients.find(p => p.id === patientId);
  if (!patient) return null;

  const analysis = patient.analyses?.[type];
  if (!analysis) return { error: 'NO_ANALYSIS' };

  const action = verdict.action; // 'confirm' | 'modify' | 'reject'
  const statusMap = { confirm: 'confirmed', modify: 'modified', reject: 'rejected' };
  const status = statusMap[action];
  if (!status) return { error: 'INVALID_ACTION' };

  const finalLabel =
    action === 'confirm' ? analysis.label
    : action === 'modify' ? (verdict.finalLabel || analysis.label)
    : null;

  const finalTriage =
    action === 'confirm' ? analysis.triage?.level
    : action === 'modify' ? (verdict.finalTriage || analysis.triage?.level)
    : null;

  analysis.review = {
    status,
    doctorId: doctor.userId,
    doctorName: doctor.name,
    doctorStation: doctor.station || null,
    finalLabel,
    finalTriage,
    note: String(verdict.note || '').slice(0, 2000),
    reviewedAt: new Date().toISOString(),
  };

  // ── Feedback loop ──
  let feedback = null;
  if (action === 'modify' || action === 'reject') {
    db.feedback = db.feedback || [];
    feedback = {
      id: `fb_${Date.now()}`,
      analysisId: analysis.id,
      patientId,
      type,
      audioUrl: patient.audioLogs?.[type]?.url || null,
      modelVersion: analysis.modelVersion,
      aiLabel: analysis.label,
      aiConfidence: analysis.confidence,
      aiTriage: analysis.triage?.level,
      doctorLabel: finalLabel,
      doctorTriage: finalTriage,
      action,
      note: analysis.review.note,
      doctorId: doctor.userId,
      doctorName: doctor.name,
      createdAt: analysis.review.reviewedAt,
    };
    db.feedback.push(feedback);
    if (db.feedback.length > 2000) db.feedback = db.feedback.slice(-2000);
  }

  recomputePatientRisk(patient);
  writeDB(db);
  return { patient, feedback };
}

/**
 * Recompute a patient's headline risk from every available source.
 *
 * Precedence:
 *   1. A doctor's confirmed/modified triage level always wins.
 *   2. Otherwise the highest AI triage level across recordings.
 *   3. Otherwise the vitals-only risk calculation.
 *
 * Mutates the patient in place; the caller writes the DB.
 */
function recomputePatientRisk(patient) {
  const rank = { low: 1, moderate: 2, high: 3 };
  const levelToStatus = { green: 'low', yellow: 'moderate', red: 'high' };

  let best = null;      // { status, score, source }
  let doctorSigned = false;

  for (const type of ['lung', 'heart', 'cough']) {
    const a = patient.analyses?.[type];
    if (!a || a.status !== 'ok') continue;

    const review = a.review || {};
    if (review.status === 'rejected') continue; // doctor threw it out

    const level = review.status === 'confirmed' || review.status === 'modified'
      ? (review.finalTriage || a.triage?.level)
      : a.triage?.level;
    if (!level) continue;

    const status = levelToStatus[level] || 'low';
    const isDoctor = review.status === 'confirmed' || review.status === 'modified';
    const score = a.triage?.score ?? 0;

    // A doctor's verdict outranks any unreviewed AI result
    if (isDoctor && !doctorSigned) {
      best = { status, score, source: `physician (${review.doctorName || 'unknown'})` };
      doctorSigned = true;
    } else if (isDoctor && doctorSigned) {
      if (rank[status] > rank[best.status]) best = { status, score, source: best.source };
    } else if (!doctorSigned) {
      if (!best || rank[status] > rank[best.status]) {
        best = { status, score, source: `AI (${type}, awaiting review)` };
      }
    }
  }

  // Fall back to the vitals-only calculation
  if (!best && patient.vitals) {
    const v = calculateRisk(patient.vitals);
    best = { status: v.riskStatus, score: v.riskScore, source: 'vitals only' };
  }

  if (best) {
    patient.riskStatus = best.status;
    patient.riskScore = best.score;
    patient.riskSource = best.source;
  } else {
    patient.riskStatus = 'pending';
    patient.riskScore = 0;
    patient.riskSource = 'not screened';
  }

  // Roll up the review state so the queue can show it without
  // unpacking every analysis
  const analyses = Object.values(patient.analyses || {}).filter(a => a && a.status === 'ok');
  patient.reviewSummary = {
    total: analyses.length,
    pending: analyses.filter(a => (a.review?.status || 'pending') === 'pending').length,
    confirmed: analyses.filter(a => a.review?.status === 'confirmed').length,
    modified: analyses.filter(a => a.review?.status === 'modified').length,
    rejected: analyses.filter(a => a.review?.status === 'rejected').length,
  };

  return patient;
}

/** The accumulated physician-correction dataset, newest first. */
function getFeedback(limit = 200) {
  const db = readDB();
  return (db.feedback || []).slice(-limit).reverse();
}

/**
 * Agreement statistics between the AI and the reviewing physicians.
 * These are the Phase 4 metrics from the test plan, computed live.
 */
function getAgreementStats() {
  const db = readDB();
  let confirmed = 0;
  let modified = 0;
  let rejected = 0;
  let pending = 0;
  const perLabel = {};

  for (const patient of db.patients || []) {
    for (const type of ['lung', 'heart', 'cough']) {
      const a = patient.analyses?.[type];
      if (!a || a.status !== 'ok') continue;
      const s = a.review?.status || 'pending';
      if (s === 'confirmed') confirmed++;
      else if (s === 'modified') modified++;
      else if (s === 'rejected') rejected++;
      else pending++;

      if (s !== 'pending') {
        perLabel[a.label] = perLabel[a.label] || { reviewed: 0, agreed: 0 };
        perLabel[a.label].reviewed++;
        if (s === 'confirmed') perLabel[a.label].agreed++;
      }
    }
  }

  const reviewed = confirmed + modified + rejected;
  return {
    reviewed,
    pending,
    confirmed,
    modified,
    rejected,
    // Raw agreement. Cohen's κ needs a balanced labelled set and is
    // computed offline during Phase 4 — not claimed here.
    rawAgreement: reviewed ? +(confirmed / reviewed).toFixed(3) : null,
    perLabel,
  };
}

/**
 * Lightweight read used by deviceService to restore the in-memory
 * store after a cold-start/sleep wake-up. Deliberately skips
 * runMigrationsOnce so waking the server doesn't trigger schema
 * migrations for an otherwise idle status poll.
 *
 * @returns {{ readings: Object[] }} — only the readings array
 */
function readDBForDevice() {
  try {
    if (!fs.existsSync(DB_PATH)) return { readings: [] };
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    const db = JSON.parse(raw);
    return { readings: Array.isArray(db.readings) ? db.readings : [] };
  } catch {
    return { readings: [] };
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  checkPassword,
  upgradePasswordHash,
  readDB,
  writeDB,
  findUserByEmail,
  findUserById,
  createUser,
  getPatientByUserId,
  createBarePatientRecord,
  getAllPatients,
  getPatientById,
  createPatient,
  updatePatient,
  deletePatient,
  updatePatientVitals,
  calculateRisk,
  saveReading,
  savePatientAudio,
  deletePatientAudio,
  savePatientAnalysis,
  saveAnalysisReview,
  recomputePatientRisk,
  getFeedback,
  getAgreementStats,
  readDBForDevice,
};
