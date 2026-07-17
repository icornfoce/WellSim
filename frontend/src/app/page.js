/**
 * WellSim — Clinical Triage & AI Analysis Dashboard (UI v3 "Instrument")
 *
 * A professional, highly scannable medical web application for triage
 * nurses and clinic doctors. Real-time patient queue, lab data fusion,
 * bio-acoustics playback, and AI recommendation engine.
 *
 * Design language: paper & ink, hairline rules, IBM Plex, one clinical
 * green accent. Numbers are mono and tabular. Decoration only where it
 * carries information.
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Play,
  Pause,
  Printer,
  RefreshCw,
  Search,
  Check,
  LogOut,
  Plus,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useDeviceData } from '../hooks/useDeviceData';
import RouteGuard from '../components/RouteGuard';
import PatientFormModal from '../components/PatientFormModal';
import ThemeToggle from '../components/ThemeToggle';
import LangToggle from '../components/LangToggle';
import { useLang } from '../i18n/LanguageContext';
import {
  fetchPatients,
  updatePatientVitals as apiUpdateVitals,
  createPatient as apiCreatePatient,
  updatePatient as apiUpdatePatient,
  deletePatient as apiDeletePatient,
} from '../services/api';

// Audio logs are client-side only (not stored in DB yet)
const DEFAULT_AUDIO_LOGS = {
  lung: { available: true, status: 'Recorded via WellSim IoT Device (INMP441 - I2S)', duration: '0:12' },
  heart: { available: true, status: 'Recorded via WellSim IoT Device (INMP441 - I2S)', duration: '0:15' },
  cough: { available: false, status: 'Not recorded', duration: '0:00' }
};

const NO_AUDIO_LOGS = {
  lung: { available: false, status: 'Not recorded', duration: '0:00' },
  heart: { available: false, status: 'Not recorded', duration: '0:00' },
  cough: { available: false, status: 'Not recorded', duration: '0:00' },
};

// Only the seeded demo patients ship with sample recordings
const DEMO_AUDIO_IDS = ['p1', 'p2', 'p3'];

export default function Page() {
  return (
    <RouteGuard>
      <Dashboard />
    </RouteGuard>
  );
}

/* ─── The WellSim mark: a hand-drawn pulse in a solid block ────────── */
function PulseMark({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path
        d="M1 8h3.2l1.6-4.5 2.9 9 1.9-4.5H15"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ─── Numbered section header with a trailing hairline rule ────────── */
function SectionHead({ index, title, children }) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <span className="font-mono text-[10px] text-med-600 dark:text-med-300 shrink-0">{index}</span>
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink dark:text-chalk whitespace-nowrap">
        {title}
      </h2>
      <span className="flex-1 h-px bg-hairline dark:bg-coal-700 min-w-[12px]" />
      {children}
    </div>
  );
}

/* ─── Instrument tick: where a reading sits against its ref band ───── */
function TickBar({ value, min, max, okMin, okMax, tone = 'ok' }) {
  const clamp = (v, a, b) => Math.min(Math.max(Number(v) || 0, a), b);
  const pct = ((clamp(value, min, max) - min) / (max - min)) * 100;
  const okStart = ((okMin - min) / (max - min)) * 100;
  const okWidth = ((okMax - okMin) / (max - min)) * 100;
  const tickCls =
    tone === 'bad'
      ? 'bg-risk-high dark:bg-risk-highd'
      : tone === 'warn'
        ? 'bg-risk-mod dark:bg-risk-modd'
        : 'bg-med-600 dark:bg-med-300';
  return (
    <div className="relative h-[3px] mt-3 bg-hairline dark:bg-coal-700">
      <div
        className="absolute inset-y-0 bg-ink/[0.09] dark:bg-white/[0.09]"
        style={{ left: `${okStart}%`, width: `${okWidth}%` }}
      />
      <div
        className={`absolute -top-[4px] w-[2px] h-[11px] transition-all duration-700 ${tickCls}`}
        style={{ left: `calc(${pct}% - 1px)` }}
      />
    </div>
  );
}

function Dashboard() {
  const { deviceStatus } = useDeviceData();
  const { t } = useLang();
  const [user, setUser] = useState(null);
  const [patients, setPatients] = useState([]);
  const [patientsLoaded, setPatientsLoaded] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState('p1');
  const [activeAudioTab, setActiveAudioTab] = useState('lung'); // lung, heart, cough
  const [isPlaying, setIsPlaying] = useState(false);
  const [playProgress, setPlayProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Input editing state for vitals/lab data
  const [isEditing, setIsEditing] = useState(false);
  const [editedVitals, setEditedVitals] = useState({});

  // Add/Edit patient modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('add'); // 'add' | 'edit'
  const [modalSubmitting, setModalSubmitting] = useState(false);

  // Get active patient
  const patient = patients.find(p => p.id === selectedPatientId) || patients[0];

  // Load patients from backend on mount
  const loadPatients = useCallback(async () => {
    try {
      const res = await fetchPatients();
      if (res.success && res.patients) {
        // Add client-side audio logs to each patient
        const patientsWithAudio = res.patients.map(p => ({
          ...p,
          audioLogs: p.audioLogs || (DEMO_AUDIO_IDS.includes(p.id) ? DEFAULT_AUDIO_LOGS : NO_AUDIO_LOGS),
        }));
        setPatients(patientsWithAudio);
        if (!selectedPatientId && patientsWithAudio.length > 0) {
          setSelectedPatientId(patientsWithAudio[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to load patients:', err.message);
    } finally {
      setPatientsLoaded(true);
    }
  }, [selectedPatientId]);

  useEffect(() => {
    loadPatients();
  }, [loadPatients]);

  // Load user data on client mount
  useEffect(() => {
    const userStr = localStorage.getItem('wellsim_user');
    if (userStr) {
      try {
        const parsed = JSON.parse(userStr);
        if (parsed?.role === 'patient') {
          window.location.replace('/portal');
          return;
        }
        setUser(parsed);
      } catch (e) {
        console.error('Failed to parse user data:', e);
      }
    }
  }, []);

  const onLogout = () => {
    localStorage.removeItem('wellsim_token');
    localStorage.removeItem('wellsim_user');
    window.location.href = '/login';
  };

  // Auto update system time
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Audio Playback simulation
  useEffect(() => {
    let interval;
    if (isPlaying) {
      interval = setInterval(() => {
        setPlayProgress(prev => {
          if (prev >= 100) {
            setIsPlaying(false);
            return 0;
          }
          return prev + 5;
        });
      }, 500);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [isPlaying]);

  // Set up edits
  useEffect(() => {
    if (patient && patient.vitals) {
      setEditedVitals({ ...patient.vitals });
    } else {
      setEditedVitals({});
    }
    setIsPlaying(false);
    setPlayProgress(0);
  }, [selectedPatientId, patient]);

  // Show loading screen while waiting for the API to fetch patients
  if (!patientsLoaded) {
    return (
      <div className="min-h-screen bg-paper dark:bg-coal-950 flex items-center justify-center transition-colors duration-300">
        <div className="text-center animate-fade-in">
          <div className="w-8 h-8 mx-auto rounded bg-ink dark:bg-chalk flex items-center justify-center">
            <PulseMark className="w-4 h-4 text-white dark:text-coal-950" />
          </div>
          <div className="relative w-40 h-px bg-hairline dark:bg-coal-700 mx-auto mt-6 overflow-hidden">
            <div className="absolute inset-y-0 w-12 bg-ink dark:bg-chalk animate-sweep" />
          </div>
          <p className="microlabel mt-4">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  // BMI Calculator
  const calculateBMI = (w, h) => {
    if (!w || !h) return '—';
    const heightInMeters = h / 100;
    return (w / (heightInMeters * heightInMeters)).toFixed(1);
  };

  const getBMICategory = (bmi) => {
    const val = parseFloat(bmi);
    if (isNaN(val)) return '';
    if (val < 18.5) return 'Underweight';
    if (val < 25.0) return 'Normal weight';
    if (val < 30.0) return 'Overweight';
    return 'Obese';
  };

  // Risk semantics → typography & color (single source of truth)
  const getRisk = (status) => {
    switch (status) {
      case 'high': return {
        label: t('risk.high'),
        mark: '▲',
        text: 'text-risk-high dark:text-risk-highd',
        dot: 'bg-risk-high dark:bg-risk-highd',
        stroke: 'stroke-risk-high dark:stroke-risk-highd',
      };
      case 'moderate': return {
        label: t('risk.mod'),
        mark: '▲',
        text: 'text-risk-mod dark:text-risk-modd',
        dot: 'bg-risk-mod dark:bg-risk-modd',
        stroke: 'stroke-risk-mod dark:stroke-risk-modd',
      };
      case 'low': return {
        label: t('risk.low'),
        mark: '',
        text: 'text-risk-low dark:text-risk-lowd',
        dot: 'bg-risk-low dark:bg-risk-lowd',
        stroke: 'stroke-risk-low dark:stroke-risk-lowd',
      };
      default: return {
        label: t('risk.pending'),
        mark: '',
        text: 'text-muted dark:text-chalk-muted',
        dot: 'bg-hairline-strong dark:bg-coal-600',
        stroke: 'stroke-hairline-strong dark:stroke-coal-600',
      };
    }
  };

  const saveVitals = async () => {
    try {
      // Send updated vitals to backend — backend recalculates risk
      const res = await apiUpdateVitals(patient.id, editedVitals);
      if (res.success && res.patient) {
        // Update local state with backend response
        setPatients(prev => prev.map(p => {
          if (p.id === res.patient.id) {
            return { ...p, ...res.patient, audioLogs: p.audioLogs };
          }
          return p;
        }));
      }
    } catch (err) {
      console.error('Failed to save vitals:', err.message);
      alert('Failed to save vitals. Please try again.');
    }
    setIsEditing(false);
  };

  // ─── Patient CRUD handlers ──────────────────────────────────────────
  const openAddModal = () => {
    setModalMode('add');
    setModalOpen(true);
  };

  const openEditModal = () => {
    setModalMode('edit');
    setModalOpen(true);
  };

  const handleModalSubmit = async (payload) => {
    setModalSubmitting(true);
    try {
      if (modalMode === 'add') {
        const res = await apiCreatePatient(payload);
        if (res.success && res.patient) {
          const newPatient = { ...res.patient, audioLogs: DEFAULT_AUDIO_LOGS };
          setPatients((prev) => [...prev, newPatient]);
          setSelectedPatientId(res.patient.id);
        }
      } else {
        const res = await apiUpdatePatient(patient.id, payload);
        if (res.success && res.patient) {
          setPatients((prev) =>
            prev.map((p) =>
              p.id === res.patient.id ? { ...p, ...res.patient, audioLogs: p.audioLogs } : p
            )
          );
        }
      }
      setModalOpen(false);
    } catch (err) {
      console.error('Failed to save patient:', err.message);
      alert(`Failed to save patient: ${err.message}`);
    } finally {
      setModalSubmitting(false);
    }
  };

  const handleDeletePatient = async () => {
    if (!patient) return;
    if (!window.confirm(t('confirm.delete', { name: patient.name }))) return;

    const deletedId = patient.id;
    try {
      const res = await apiDeletePatient(deletedId);
      if (res.success) {
        const remaining = patients.filter((p) => p.id !== deletedId);
        setPatients(remaining);
        setSelectedPatientId(remaining.length ? remaining[0].id : null);
      }
    } catch (err) {
      console.error('Failed to delete patient:', err.message);
      alert(`Failed to delete patient: ${err.message}`);
    }
  };

  // Empty state — no patients in the queue (e.g. after deleting them all)
  if (!patient) {
    return (
      <>
        <div className="min-h-screen bg-paper dark:bg-coal-950 flex items-center justify-center p-4 transition-colors duration-300">
          <div className="text-center max-w-sm animate-fade-up">
            <p className="microlabel">{t('empty.label')}</p>
            <h2 className="text-2xl font-light text-ink dark:text-chalk mt-2">{t('empty.title')}</h2>
            <p className="text-sm text-muted dark:text-chalk-muted mt-2 leading-relaxed">
              {t('empty.body')}
            </p>
            <button onClick={openAddModal} className="btn-ink mt-6">
              <Plus className="w-3.5 h-3.5" /> {t('empty.add')}
            </button>
          </div>
        </div>
        <PatientFormModal
          open={modalOpen}
          mode={modalMode}
          initialData={null}
          onClose={() => setModalOpen(false)}
          onSubmit={handleModalSubmit}
          submitting={modalSubmitting}
        />
      </>
    );
  }

  const risk = getRisk(patient?.riskStatus);
  const bmiValue = calculateBMI(patient.weight, patient.height);
  const v = patient?.vitals || {};
  const has = (x) => x !== null && x !== undefined;

  return (
    <div className="min-h-screen bg-paper dark:bg-coal-950 flex flex-col font-sans transition-colors duration-300">

      {/* ─── 1. TOP BAR ──────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 bg-surface/95 dark:bg-coal-900/95 backdrop-blur-sm border-b border-hairline dark:border-coal-700 px-4 sm:px-6 print-hidden">
        <div className="max-w-7xl mx-auto flex items-center justify-between h-14 gap-4">

          {/* Wordmark */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-7 h-7 rounded bg-ink dark:bg-chalk flex items-center justify-center">
              <PulseMark className="w-4 h-4 text-white dark:text-coal-950" />
            </div>
            <div className="flex items-baseline gap-2.5">
              <span className="text-[15px] font-semibold tracking-tight text-ink dark:text-chalk">WellSim</span>
              <span className="microlabel hidden sm:inline">Triage / v2</span>
            </div>
          </div>

          {/* Telemetry strip */}
          <div className="hidden md:flex items-center gap-6 font-mono text-[11px] text-muted dark:text-chalk-muted">
            <span className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-[1px] ${
                deviceStatus?.status === 'online'
                  ? 'bg-med-500 dark:bg-med-300 animate-blink'
                  : 'bg-risk-high dark:bg-risk-highd'
              }`} />
              {deviceStatus?.status === 'online' ? t('header.iotOnline') : t('header.iotOffline')}
            </span>
            <span>RSSI {deviceStatus?.wifi_strength ? `${deviceStatus.wifi_strength} dBm` : '—'}</span>
            <span className="tabular-nums text-ink dark:text-chalk">
              {currentTime.toLocaleTimeString('en-US', { hour12: false })}
            </span>
          </div>

          {/* User / theme */}
          <div className="flex items-center gap-3">
            <LangToggle />
            <ThemeToggle />
            <span className="w-px h-5 bg-hairline dark:bg-coal-700" />
            <div className="text-right hidden sm:block leading-tight">
              <p className="text-xs font-semibold text-ink dark:text-chalk">{user?.name || 'Staff'}</p>
              <p className="font-mono text-[10px] text-muted dark:text-chalk-muted uppercase">
                {user?.role || 'Unknown'} · {user?.station || 'General'}
              </p>
            </div>
            <button
              onClick={onLogout}
              title={t('header.signOut')}
              className="w-7 h-7 rounded border border-hairline-strong dark:border-coal-600 flex items-center justify-center
                         text-muted hover:text-risk-high hover:border-risk-high/50
                         dark:text-chalk-muted dark:hover:text-risk-highd dark:hover:border-risk-highd/50
                         transition-colors duration-200"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* ─── MAIN ────────────────────────────────────────────────────── */}
      <main className="relative flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Registration marks — a quiet nod to print production */}
        <span className="hidden lg:block absolute top-1 right-2 font-mono text-[11px] text-hairline-strong dark:text-coal-600 select-none print-hidden" aria-hidden="true">+</span>
        <span className="hidden lg:block absolute bottom-1 left-2 font-mono text-[11px] text-hairline-strong dark:text-coal-600 select-none print-hidden" aria-hidden="true">+</span>

        {/* ─── 2. PATIENT QUEUE ───────────────────────────────────────── */}
        <section className="lg:col-span-1 will-fade-up">
          <div className="card overflow-hidden flex flex-col h-[calc(100vh-10.5rem)] min-h-[500px]">

            {/* Panel head */}
            <div className="p-4 border-b border-hairline dark:border-coal-700">
              <SectionHead index="01" title={t('queue.title')}>
                <span className="font-mono text-[10px] text-muted dark:text-chalk-muted">N={patients.length}</span>
                <button
                  onClick={loadPatients}
                  title={t('queue.refresh')}
                  className="w-6 h-6 rounded border border-hairline-strong dark:border-coal-600 flex items-center justify-center
                             text-muted hover:text-ink hover:border-ink/50 dark:text-chalk-muted dark:hover:text-chalk dark:hover:border-chalk/50
                             transition-colors duration-200 group"
                >
                  <RefreshCw className="w-3 h-3 transition-transform duration-500 group-hover:rotate-180" />
                </button>
                <button onClick={openAddModal} className="btn-ink !px-2.5 !py-1" title={t('queue.addTitle')}>
                  <Plus className="w-3 h-3" /> {t('queue.add')}
                </button>
              </SectionHead>

              {/* Search */}
              <div className="relative mt-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted/70 dark:text-chalk-muted/70" />
                <input
                  type="text"
                  placeholder={t('queue.search')}
                  className="field !pl-9 !py-1.5 !text-[13px]"
                />
              </div>
            </div>

            {/* Rows */}
            <div className="flex-1 overflow-y-auto divide-y divide-hairline dark:divide-coal-700">
              {patients.map((item) => {
                const r = getRisk(item.riskStatus);
                const isSelected = item.id === selectedPatientId;
                return (
                  <button
                    key={item.id}
                    onClick={() => setSelectedPatientId(item.id)}
                    className={`relative w-full text-left px-4 py-3 flex items-center justify-between gap-2 transition-colors duration-200 ${
                      isSelected
                        ? 'bg-med-600/[0.06] dark:bg-med-300/[0.07]'
                        : 'hover:bg-paper dark:hover:bg-coal-850'
                    }`}
                  >
                    {isSelected && (
                      <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-med-600 dark:bg-med-300" />
                    )}
                    <span className="flex items-center gap-3 min-w-0">
                      <span className={`w-1.5 h-1.5 rounded-[1px] shrink-0 ${r.dot} ${item.riskStatus === 'high' ? 'animate-blink' : ''}`} />
                      <span className="min-w-0">
                        <span className={`block text-[13px] font-semibold truncate ${
                          isSelected ? 'text-med-700 dark:text-med-300' : 'text-ink dark:text-chalk'
                        }`}>
                          {item.name}
                        </span>
                        <span className="block font-mono text-[10px] text-muted dark:text-chalk-muted mt-0.5">
                          {t('queue.age')} {item.age ?? '—'} · {item.checkInTime}
                        </span>
                      </span>
                    </span>
                    <span className={`font-mono text-[10px] shrink-0 ${r.text}`}>
                      {r.mark && <span className="mr-1">{r.mark}</span>}{r.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* ─── 3. PATIENT RECORD ──────────────────────────────────────── */}
        <section className="lg:col-span-2 flex flex-col gap-5">

          {/* Identity */}
          <div className="card p-5 will-fade-up animate-delay-100">
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-med-600 dark:text-med-300">
                  {t('record.active')} / {patient.id.toUpperCase()}
                </p>
                <h1 className="text-[28px] font-light tracking-tight text-ink dark:text-chalk mt-1 leading-tight">
                  {patient.name}
                </h1>
              </div>

              <div className="flex items-center gap-2">
                <button onClick={openEditModal} className="btn-line" title={t('record.editTitle')}>
                  <Pencil className="w-3 h-3" /> {t('common.edit')}
                </button>
                <button
                  onClick={handleDeletePatient}
                  title={t('record.deleteTitle')}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded
                             border border-risk-high/40 text-risk-high hover:bg-risk-high/[0.06]
                             dark:border-risk-highd/40 dark:text-risk-highd dark:hover:bg-risk-highd/[0.08]
                             transition-colors duration-200 active:translate-y-px"
                >
                  <Trash2 className="w-3 h-3" /> {t('common.delete')}
                </button>
                <span className="w-px h-6 bg-hairline dark:bg-coal-700 mx-1" />
                <div className="text-right">
                  <p className="microlabel">{t('record.aiRisk')}</p>
                  <p className={`font-mono text-xs mt-0.5 ${risk.text}`}>
                    {risk.mark && <span className="mr-1">{risk.mark}</span>}{risk.label}
                  </p>
                </div>
              </div>
            </div>

            {/* Demographics — ruled table */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-px bg-hairline dark:bg-coal-700 border border-hairline dark:border-coal-700 rounded overflow-hidden mt-5">
              {[
                { label: t('demo.age'), value: patient.age ?? '—', unit: patient.age != null ? t('demo.yrs') : '' },
                { label: t('demo.gender'), value: ['male','female','other','unspecified'].includes(String(patient.gender || '').toLowerCase()) ? t('gender.' + String(patient.gender).toLowerCase()) : (patient.gender ?? '—'), unit: '' },
                { label: t('demo.weight'), value: patient.weight ?? '—', unit: patient.weight != null ? 'kg' : '' },
                { label: t('demo.height'), value: patient.height ?? '—', unit: patient.height != null ? 'cm' : '' },
                { label: 'BMI', value: bmiValue, unit: getBMICategory(bmiValue) },
              ].map(({ label, value, unit }) => (
                <div key={label} className="bg-surface dark:bg-coal-900 px-3 py-2.5">
                  <p className="microlabel">{label}</p>
                  <p className="text-[15px] font-medium text-ink dark:text-chalk mt-1 tabular-nums">
                    {value}
                    {unit && <span className="font-mono text-[10px] text-muted dark:text-chalk-muted ml-1.5">{unit}</span>}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Vitals */}
          <div className="card p-5 will-fade-up animate-delay-200">
            <SectionHead index="02" title={t('vitals.title')}>
              {isEditing ? (
                <span className="flex gap-2">
                  <button onClick={() => setIsEditing(false)} className="btn-line !py-1.5">{t('common.cancel')}</button>
                  <button onClick={saveVitals} className="btn-ink !py-1.5">
                    <Check className="w-3 h-3" /> {t('common.save')}
                  </button>
                </span>
              ) : (
                <button onClick={() => setIsEditing(true)} className="btn-line !py-1.5">{t('vitals.edit')}</button>
              )}
            </SectionHead>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-px bg-hairline dark:bg-coal-700 border border-hairline dark:border-coal-700 rounded overflow-hidden mt-4">

              {/* SpO2 */}
              <div className="bg-surface dark:bg-coal-900 p-4">
                <div className="flex justify-between items-baseline">
                  <p className="microlabel">{t('vitals.spo2')}</p>
                  {(has(v.spo2) && v.spo2 < 95) && (
                    <span className="font-mono text-[10px] text-risk-high dark:text-risk-highd">▼ {t('tag.low')}</span>
                  )}
                </div>
                {isEditing ? (
                  <input
                    type="number"
                    value={editedVitals.spo2 || ''}
                    onChange={(e) => setEditedVitals(prev => ({ ...prev, spo2: parseInt(e.target.value) || 0 }))}
                    className="field mt-2 !text-lg !font-light tabular-nums"
                  />
                ) : (
                  <p className={`text-[26px] font-light leading-none tabular-nums mt-2.5 ${
                    (has(v.spo2) && v.spo2 < 95) ? 'text-risk-high dark:text-risk-highd' : 'text-ink dark:text-chalk'
                  }`}>
                    {has(v.spo2) ? v.spo2 : '—'}
                    <span className="font-mono text-[11px] text-muted dark:text-chalk-muted ml-1">%</span>
                  </p>
                )}
                {has(v.spo2) && <TickBar value={v.spo2} min={85} max={100} okMin={95} okMax={100}
                  tone={v.spo2 < 95 ? 'bad' : 'ok'} />}
                <p className="font-mono text-[10px] text-muted dark:text-chalk-muted mt-2">{t('vitals.ref')} 95–100</p>
              </div>

              {/* Heart rate */}
              <div className="bg-surface dark:bg-coal-900 p-4">
                <div className="flex justify-between items-baseline">
                  <p className="microlabel">{t('vitals.hr')}</p>
                  {(has(v.heartRate) && v.heartRate > 100) && (
                    <span className="font-mono text-[10px] text-risk-high dark:text-risk-highd">▲ {t('tag.high')}</span>
                  )}
                </div>
                {isEditing ? (
                  <input
                    type="number"
                    value={editedVitals.heartRate || ''}
                    onChange={(e) => setEditedVitals(prev => ({ ...prev, heartRate: parseInt(e.target.value) || 0 }))}
                    className="field mt-2 !text-lg !font-light tabular-nums"
                  />
                ) : (
                  <p className={`text-[26px] font-light leading-none tabular-nums mt-2.5 ${
                    (has(v.heartRate) && v.heartRate > 100) ? 'text-risk-high dark:text-risk-highd' : 'text-ink dark:text-chalk'
                  }`}>
                    {has(v.heartRate) ? v.heartRate : '—'}
                    <span className="font-mono text-[11px] text-muted dark:text-chalk-muted ml-1.5">bpm</span>
                  </p>
                )}
                {has(v.heartRate) && <TickBar value={v.heartRate} min={40} max={140} okMin={60} okMax={100}
                  tone={v.heartRate > 100 ? 'bad' : 'ok'} />}
                <p className="font-mono text-[10px] text-muted dark:text-chalk-muted mt-2">{t('vitals.ref')} 60–100</p>
              </div>

              {/* Blood pressure */}
              <div className="bg-surface dark:bg-coal-900 p-4">
                <div className="flex justify-between items-baseline">
                  <p className="microlabel">{t('vitals.bp')}</p>
                  {(has(v.systolicBP) && v.systolicBP > 140) && (
                    <span className="font-mono text-[10px] text-risk-mod dark:text-risk-modd">▲ {t('tag.high')}</span>
                  )}
                </div>
                {isEditing ? (
                  <div className="flex items-center gap-1.5 mt-2">
                    <input
                      type="number"
                      value={editedVitals.systolicBP || ''}
                      onChange={(e) => setEditedVitals(prev => ({ ...prev, systolicBP: parseInt(e.target.value) || 0 }))}
                      className="field !text-lg !font-light tabular-nums"
                    />
                    <span className="text-muted">/</span>
                    <input
                      type="number"
                      value={editedVitals.diastolicBP || ''}
                      onChange={(e) => setEditedVitals(prev => ({ ...prev, diastolicBP: parseInt(e.target.value) || 0 }))}
                      className="field !text-lg !font-light tabular-nums"
                    />
                  </div>
                ) : (
                  <p className={`text-[26px] font-light leading-none tabular-nums mt-2.5 ${
                    (has(v.systolicBP) && v.systolicBP > 140) ? 'text-risk-mod dark:text-risk-modd' : 'text-ink dark:text-chalk'
                  }`}>
                    {has(v.systolicBP) ? v.systolicBP : '—'}/{has(v.diastolicBP) ? v.diastolicBP : '—'}
                    <span className="font-mono text-[11px] text-muted dark:text-chalk-muted ml-1.5">mmHg</span>
                  </p>
                )}
                {has(v.systolicBP) && <TickBar value={v.systolicBP} min={80} max={180} okMin={90} okMax={120}
                  tone={v.systolicBP > 140 ? 'warn' : 'ok'} />}
                <p className="font-mono text-[10px] text-muted dark:text-chalk-muted mt-2">{t('vitals.ref')} &lt;120/80</p>
              </div>

              {/* WBC */}
              <div className="bg-surface dark:bg-coal-900 p-4">
                <div className="flex justify-between items-baseline">
                  <p className="microlabel">{t('vitals.wbc')}</p>
                  {(has(v.wbc) && v.wbc > 11000) && (
                    <span className="font-mono text-[10px] text-risk-mod dark:text-risk-modd">▲ {t('tag.high')}</span>
                  )}
                </div>
                {isEditing ? (
                  <input
                    type="number"
                    value={editedVitals.wbc || ''}
                    onChange={(e) => setEditedVitals(prev => ({ ...prev, wbc: parseInt(e.target.value) || 0 }))}
                    className="field mt-2 !text-lg !font-light tabular-nums"
                  />
                ) : (
                  <p className={`text-[26px] font-light leading-none tabular-nums mt-2.5 ${
                    (has(v.wbc) && v.wbc > 11000) ? 'text-risk-mod dark:text-risk-modd' : 'text-ink dark:text-chalk'
                  }`}>
                    {has(v.wbc) ? v.wbc.toLocaleString() : '—'}
                    <span className="font-mono text-[11px] text-muted dark:text-chalk-muted ml-1.5">/mcL</span>
                  </p>
                )}
                {has(v.wbc) && <TickBar value={v.wbc} min={2000} max={20000} okMin={4500} okMax={11000}
                  tone={v.wbc > 11000 ? 'warn' : 'ok'} />}
                <p className="font-mono text-[10px] text-muted dark:text-chalk-muted mt-2">{t('vitals.ref')} 4,500–11,000</p>
              </div>

              {/* Hemoglobin */}
              <div className="bg-surface dark:bg-coal-900 p-4">
                <div className="flex justify-between items-baseline">
                  <p className="microlabel">{t('vitals.hgb')}</p>
                  {(has(v.hemoglobin) && v.hemoglobin < 12) && (
                    <span className="font-mono text-[10px] text-risk-mod dark:text-risk-modd">▼ {t('tag.low')}</span>
                  )}
                </div>
                {isEditing ? (
                  <input
                    type="number"
                    step="0.1"
                    value={editedVitals.hemoglobin || ''}
                    onChange={(e) => setEditedVitals(prev => ({ ...prev, hemoglobin: parseFloat(e.target.value) || 0 }))}
                    className="field mt-2 !text-lg !font-light tabular-nums"
                  />
                ) : (
                  <p className={`text-[26px] font-light leading-none tabular-nums mt-2.5 ${
                    (has(v.hemoglobin) && v.hemoglobin < 12) ? 'text-risk-mod dark:text-risk-modd' : 'text-ink dark:text-chalk'
                  }`}>
                    {has(v.hemoglobin) ? v.hemoglobin : '—'}
                    <span className="font-mono text-[11px] text-muted dark:text-chalk-muted ml-1.5">g/dL</span>
                  </p>
                )}
                {has(v.hemoglobin) && <TickBar value={v.hemoglobin} min={8} max={20} okMin={12} okMax={17.5}
                  tone={v.hemoglobin < 12 ? 'warn' : 'ok'} />}
                <p className="font-mono text-[10px] text-muted dark:text-chalk-muted mt-2">{t('vitals.ref')} 12.0–17.5</p>
              </div>

              {/* Reserved slot */}
              <div className="bg-surface dark:bg-coal-900 p-4 flex flex-col items-center justify-center text-center">
                <p className="microlabel">{t('vitals.reserved')}</p>
                <p className="font-mono text-[10px] text-muted/60 dark:text-chalk-muted/60 mt-1">{t('vitals.reservedNote')}</p>
              </div>

            </div>
          </div>

          {/* Bio-acoustics */}
          <div className="card p-5 will-fade-up animate-delay-300">
            <SectionHead index="03" title={t('audio.title')}>
              <div className="flex gap-4">
                {['lung', 'heart', 'cough'].map((tab) => (
                  <button
                    key={tab}
                    onClick={() => {
                      setActiveAudioTab(tab);
                      setIsPlaying(false);
                      setPlayProgress(0);
                    }}
                    className={`text-xs capitalize pb-0.5 border-b transition-colors duration-200 ${
                      activeAudioTab === tab
                        ? 'font-semibold text-ink dark:text-chalk border-med-600 dark:border-med-300'
                        : 'font-medium text-muted dark:text-chalk-muted border-transparent hover:text-ink dark:hover:text-chalk'
                    }`}
                  >
                    {t('audio.' + tab)}
                  </button>
                ))}
              </div>
            </SectionHead>

            <div className="mt-4">
              {patient?.audioLogs?.[activeAudioTab]?.available ? (
                <div>
                  <div className="flex items-center justify-between font-mono text-[10px] text-muted dark:text-chalk-muted">
                    <span className="truncate pr-4">{t('audio.src')} · {patient?.audioLogs?.[activeAudioTab]?.status || t('audio.statusUnavailable')}</span>
                    <span className="shrink-0">{t('audio.dur')} {patient?.audioLogs?.[activeAudioTab]?.duration || '0:00'}</span>
                  </div>

                  {/* Player — an ink panel in both themes */}
                  <div className="mt-3 bg-ink dark:bg-coal-850 dark:border dark:border-coal-700 rounded-md p-4 flex items-center gap-4">
                    <button
                      onClick={() => setIsPlaying(!isPlaying)}
                      className="w-10 h-10 rounded bg-med-500 hover:bg-med-400 text-white flex items-center justify-center
                                 flex-shrink-0 transition-colors duration-200 active:translate-y-px"
                    >
                      {isPlaying ? <Pause className="w-4 h-4 fill-white" /> : <Play className="w-4 h-4 fill-white ml-0.5" />}
                    </button>

                    <div className="relative flex-1 h-10 flex items-center gap-[3px] overflow-hidden">
                      <div
                        className="absolute top-0 bottom-0 left-0 border-r border-white/50 transition-all duration-300 z-10"
                        style={{ width: `${playProgress}%` }}
                      />
                      {[...Array(38)].map((_, i) => {
                        const active = (i / 38) * 100 <= playProgress;
                        return (
                          <div
                            key={i}
                            className={`flex-1 rounded-[1px] transition-colors duration-300 ${
                              active ? `bg-med-400 ${isPlaying ? 'eq-bar' : ''}` : 'bg-white/15'
                            }`}
                            style={{
                              height: `${Math.sin(i * 0.4) * 14 + 20}px`,
                              animationDelay: `${(i % 6) * 0.11}s`,
                            }}
                          />
                        );
                      })}
                    </div>

                    <span className="font-mono text-[10px] text-white/40 tabular-nums w-9 text-right shrink-0">
                      {playProgress}%
                    </span>
                  </div>
                </div>
              ) : (
                <div className="border border-dashed border-hairline-strong dark:border-coal-600 rounded-md py-8 text-center">
                  <p className="microlabel">{t('audio.none')}</p>
                  <p className="font-mono text-[10px] text-muted/70 dark:text-chalk-muted/70 mt-1.5">
                    {t('audio.noneDetail')}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* AI analysis */}
          <div className="card p-5 will-fade-up animate-delay-400">
            <SectionHead index="04" title={t('ai.title')} />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center mt-5">

              {/* Instrument dial */}
              <div className="flex flex-col items-center md:border-r border-hairline dark:border-coal-700 py-2">
                <div className="relative w-36 h-36">
                  <svg viewBox="0 0 144 144" className="w-full h-full">
                    {/* Tick ring */}
                    {Array.from({ length: 24 }).map((_, i) => (
                      <line
                        key={i}
                        x1="72" y1="4" x2="72" y2={i % 6 === 0 ? '10' : '7'}
                        transform={`rotate(${i * 15} 72 72)`}
                        className="stroke-hairline-strong dark:stroke-coal-600"
                        strokeWidth="1"
                      />
                    ))}
                    <g transform="rotate(-90 72 72)">
                      <circle cx="72" cy="72" r="54" strokeWidth="4"
                        className="stroke-hairline dark:stroke-coal-700" fill="transparent" />
                      <circle
                        cx="72" cy="72" r="54" strokeWidth="4"
                        strokeDasharray={2 * Math.PI * 54}
                        strokeDashoffset={2 * Math.PI * 54 * (1 - (patient?.riskScore || 0) / 100)}
                        className={`${risk.stroke} transition-all duration-1000 ease-out`}
                        fill="transparent"
                      />
                    </g>
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-4xl font-light tabular-nums text-ink dark:text-chalk leading-none">
                      {patient?.riskScore || 0}
                      <span className="font-mono text-sm text-muted dark:text-chalk-muted ml-0.5">%</span>
                    </span>
                    <span className="microlabel mt-1.5">{t('ai.probability')}</span>
                  </div>
                </div>
                <p className={`font-mono text-[11px] mt-3 ${risk.text}`}>
                  {risk.mark && <span className="mr-1">{risk.mark}</span>}{t('ai.riskLine', { label: risk.label })}
                </p>
              </div>

              {/* Findings */}
              <div className="md:col-span-2">
                <p className="microlabel">{t('ai.biomarkers')}</p>
                <ul className="mt-2 divide-y divide-hairline dark:divide-coal-700">
                  {(patient?.findings || []).map((finding, idx) => (
                    <li key={idx} className="flex items-start gap-3 py-2.5">
                      <span className="font-mono text-[10px] text-muted/70 dark:text-chalk-muted/70 w-5 shrink-0 pt-0.5">
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      <span className="text-xs leading-relaxed text-ink/90 dark:text-chalk/90">{finding}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-2 mt-5 pt-5 border-t border-hairline dark:border-coal-700 print-hidden">
              <button
                onClick={() => alert(t('alerts.approved', { name: patient.name }))}
                className="btn-ink flex-1"
              >
                {t('actions.approve')}
              </button>
              <button
                onClick={() => alert(t('alerts.retake'))}
                className="btn-line flex-1"
              >
                {t('actions.retake')}
              </button>
              <button onClick={() => window.print()} className="btn-line flex-1">
                <Printer className="w-3.5 h-3.5" /> {t('actions.print')}
              </button>
            </div>
          </div>

          {/* Colophon */}
          <p className="font-mono text-[10px] text-muted/60 dark:text-chalk-muted/50 text-center uppercase tracking-[0.14em] pb-2 print-hidden">
            {t('colophon')}
          </p>
        </section>
      </main>

      {/* Add / Edit Patient Modal */}
      <PatientFormModal
        open={modalOpen}
        mode={modalMode}
        initialData={modalMode === 'edit' ? patient : null}
        onClose={() => setModalOpen(false)}
        onSubmit={handleModalSubmit}
        submitting={modalSubmitting}
      />
    </div>
  );
}
