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
const SALT = 'wellsim-salt-2026';

// ─── Password Utilities ─────────────────────────────────────────────

/**
 * Hash a password using SHA-256 with a static salt.
 * For production, use bcrypt — this is a portable prototype approach.
 */
function hashPassword(password) {
  return crypto.createHash('sha256').update(SALT + password).digest('hex');
}

/**
 * Verify a plaintext password against a hash.
 */
function verifyPassword(password, hash) {
  return hashPassword(password) === hash;
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
    return JSON.parse(raw);
  } catch (error) {
    console.error('❌ DB read error:', error.message);
    const defaultDB = createDefaultDB();
    writeDB(defaultDB);
    return defaultDB;
  }
}

/**
 * Write the entire database to disk.
 * @param {Object} data - Full database object
 */
function writeDB(data) {
  try {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error('❌ DB write error:', error.message);
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
    ],
    patients: [
      {
        id: 'p1',
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
        findings: [
          'Wheezing detected in the lower right lung field during expiration.',
          'Slight tachycardia noted (104 bpm) matching elevated systolic BP.',
          'Data Fusion Indicator: Low SpO2 (93%) correlated with abnormal lung sound pattern.',
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
          'Mild cough sound pattern detected with normal lung ventilation.',
          'Vitals are stable; Blood Pressure is pre-hypertensive.',
          'No active wheezing or crackles heard.',
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
          'All vesicular lung sounds are normal throughout both lung fields.',
          'Healthy cardiac rhythm with clear S1/S2 sounds.',
          'Oxygen saturation is optimal at 99%.',
        ],
      },
    ],
    readings: [],
  };
}

// ─── User Operations ─────────────────────────────────────────────────

/**
 * Find a user by email.
 */
function findUserByEmail(email) {
  const db = readDB();
  return db.users.find(u => u.email === email) || null;
}

/**
 * Find a user by ID.
 */
function findUserById(id) {
  const db = readDB();
  return db.users.find(u => u.id === id) || null;
}

// ─── Patient Operations ──────────────────────────────────────────────

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
 * Update a patient's vitals and recalculate risk.
 */
function updatePatientVitals(patientId, vitals) {
  const db = readDB();
  const patient = db.patients.find(p => p.id === patientId);
  if (!patient) return null;

  // Merge vitals
  patient.vitals = { ...patient.vitals, ...vitals };

  // Simple risk recalculation
  const hr = parseInt(patient.vitals.heartRate) || 0;
  const o2 = parseInt(patient.vitals.spo2) || 100;
  const bp = parseInt(patient.vitals.systolicBP) || 120;

  if (o2 < 94 || hr > 100 || bp > 140) {
    patient.riskScore = 85;
    patient.riskStatus = 'high';
  } else if (o2 < 96 || hr > 85 || bp > 130) {
    patient.riskScore = 45;
    patient.riskStatus = 'moderate';
  } else {
    patient.riskScore = 15;
    patient.riskStatus = 'low';
  }

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

module.exports = {
  hashPassword,
  verifyPassword,
  readDB,
  writeDB,
  findUserByEmail,
  findUserById,
  getAllPatients,
  getPatientById,
  updatePatientVitals,
  saveReading,
};
