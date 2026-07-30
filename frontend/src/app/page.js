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

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
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
  X,
  Clock,
  ShieldCheck,
  Upload,
  Mic,
  Laptop,
} from 'lucide-react';
import { useDeviceData } from '../hooks/useDeviceData';
import RouteGuard from '../components/RouteGuard';
import PatientFormModal from '../components/PatientFormModal';
import ThemeToggle from '../components/ThemeToggle';
import LangToggle from '../components/LangToggle';
import AIAnalysisPanel from '../components/AIAnalysisPanel';
import { useLang } from '../i18n/LanguageContext';
import { dataDictionaryTH } from '../i18n/translations';
import {
  encodeWavFromBlob,
  formatDuration,
  ACCEPTED_AUDIO,
  MAX_DURATION_SEC,
} from '../lib/audioEncoder';
import {
  API_URL,
  fetchPatients,
  updatePatientVitals as apiUpdateVitals,
  createPatient as apiCreatePatient,
  updatePatient as apiUpdatePatient,
  deletePatient as apiDeletePatient,
  runAnalysis as apiRunAnalysis,
  fetchAnalyses as apiFetchAnalyses,
  submitReview as apiSubmitReview,
  uploadAudio as apiUploadAudio,
  deleteAudio as apiDeleteAudio,
} from '../services/api';

/** Queue ordering: urgent first, then anything a doctor has not signed. */
const TRIAGE_RANK = { high: 0, moderate: 1, low: 2, pending: 3 };

/**
 * A recording only counts as available when the backend actually holds
 * a file for it. Earlier versions marked the seeded demo patients as
 * "recorded" with no audio behind it, which meant the player fell back
 * to a synthesiser and the screening engine had nothing to read. A
 * screening tool must not claim to hold data it does not have.
 */
const NO_AUDIO_LOGS = {
  lung: { available: false, status: 'Not recorded', duration: '0:00' },
  heart: { available: false, status: 'Not recorded', duration: '0:00' },
  cough: { available: false, status: 'Not recorded', duration: '0:00' },
};

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
  const router = useRouter();
  const { deviceStatus } = useDeviceData();
  const { t, lang } = useLang();
  // Translate known demo/backend data strings when viewing in Thai
  const td = (text) => (lang === 'th' && dataDictionaryTH[text]) || text;
  const [user, setUser] = useState(null);
  const [patients, setPatients] = useState([]);
  const [patientsLoaded, setPatientsLoaded] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState(null);
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

  // ─── AI screening (layer 1) & physician review (layer 2) ──────────
  const [analyses, setAnalyses] = useState({});
  const [canReview, setCanReview] = useState(false);
  const [analysisRunning, setAnalysisRunning] = useState(false);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);

  // Queue search
  const [searchQuery, setSearchQuery] = useState('');

  // Dark mode drives the spectrogram colour ramp
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const read = () => setIsDark(document.documentElement.classList.contains('dark'));
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // Get active patient
  const patient = patients.find(p => p.id === selectedPatientId) || patients[0];

  // Load patients from backend on mount
  const loadPatients = useCallback(async () => {
    try {
      const res = await fetchPatients();
      if (res.success && res.patients) {
        // Only trust audioLogs that carry a real stored file URL
        const patientsWithAudio = res.patients.map((p) => {
          const logs = { ...NO_AUDIO_LOGS };
          for (const type of ['lung', 'heart', 'cough']) {
            const stored = p.audioLogs?.[type];
            if (stored?.available && stored?.url) logs[type] = stored;
          }
          return { ...p, audioLogs: logs };
        });
        setPatients(patientsWithAudio);
        if (patientsWithAudio.length > 0) {
          setSelectedPatientId((prev) => prev ?? patientsWithAudio[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to load patients:', err.message);
    } finally {
      setPatientsLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadPatients();
  }, [loadPatients]);

  // ─── Load AI analyses for the selected patient ────────────────────
  const loadAnalyses = useCallback(async (patientId) => {
    if (!patientId) return;
    try {
      const res = await apiFetchAnalyses(patientId);
      setAnalyses(res.analyses || {});
      setCanReview(!!res.canReview);
    } catch (err) {
      console.error('Failed to load analyses:', err.message);
      setAnalyses({});
    }
  }, []);

  useEffect(() => {
    setAnalyses({});
    loadAnalyses(selectedPatientId);
  }, [selectedPatientId, loadAnalyses]);

  /** Layer 1 — run (or re-run) the screening engine on this recording. */
  const handleRunAnalysis = async () => {
    if (!patient) return;
    setAnalysisRunning(true);
    try {
      const res = await apiRunAnalysis(patient.id, activeAudioTab);
      setAnalyses((prev) => ({ ...prev, [activeAudioTab]: res.analysis }));
      if (res.patient) {
        setPatients((prev) =>
          prev.map((p) => (p.id === res.patient.id ? { ...p, ...res.patient, audioLogs: p.audioLogs } : p))
        );
      }
    } catch (err) {
      console.error('Analysis failed:', err.message);
      alert(err.message);
    } finally {
      setAnalysisRunning(false);
    }
  };

  /**
   * Layer 2 — record the physician's verdict.
   * The server refuses this for non-doctor accounts; the thrown error
   * is surfaced to the panel rather than swallowed.
   */
  const handleReview = async (verdict) => {
    if (!patient) return;
    setReviewSubmitting(true);
    try {
      const res = await apiSubmitReview(patient.id, activeAudioTab, verdict);
      setAnalyses((prev) => ({
        ...prev,
        [activeAudioTab]: { ...prev[activeAudioTab], review: res.review },
      }));
      if (res.patient) {
        setPatients((prev) =>
          prev.map((p) => (p.id === res.patient.id ? { ...p, ...res.patient, audioLogs: p.audioLogs } : p))
        );
      }
    } finally {
      setReviewSubmitting(false);
    }
  };

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
    router.replace('/login');
  };

  // Auto update system time
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const audioRef = useRef(null);
  const synthRef = useRef(null);

  // Web Audio Context synthesizer for demo/placeholder patient sounds
  const playDemoSynth = (type) => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);

      if (type === 'heart') {
        // Low heartbeat thuds
        osc.type = 'sine';
        osc.frequency.setValueAtTime(55, audioCtx.currentTime);
        
        gain.gain.setValueAtTime(0, audioCtx.currentTime);
        const duration = 15;
        // Rhythmic lub-dub heartbeat pulses
        for (let t = 0; t < duration; t += 1.0) {
          // Lub
          gain.gain.linearRampToValueAtTime(0.4, audioCtx.currentTime + t);
          gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + t + 0.12);
          // Dub
          gain.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + t + 0.22);
          gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + t + 0.40);
        }
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
      } else {
        // Lung breath sound (simulated using modulated triangle wave)
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(90, audioCtx.currentTime);
        
        gain.gain.setValueAtTime(0.005, audioCtx.currentTime);
        const duration = 12;
        // Slow deep breathing cycle (4 seconds per breath)
        for (let t = 0; t < duration; t += 4.0) {
          // Inhale (amplitude and frequency rise)
          gain.gain.linearRampToValueAtTime(0.08, audioCtx.currentTime + t + 1.2);
          osc.frequency.linearRampToValueAtTime(140, audioCtx.currentTime + t + 1.2);
          // Exhale (amplitude and frequency fall)
          gain.gain.linearRampToValueAtTime(0.005, audioCtx.currentTime + t + 3.2);
          osc.frequency.linearRampToValueAtTime(90, audioCtx.currentTime + t + 3.2);
        }
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
      }

      return {
        stop: () => {
          try {
            osc.stop();
            audioCtx.close();
          } catch (e) {}
        }
      };
    } catch (e) {
      console.error('AudioContext synth failed:', e);
      return null;
    }
  };

  const handleTogglePlay = () => {
    const audioLog = patient?.audioLogs?.[activeAudioTab];
    if (!audioLog || !audioLog.available) return;

    if (isPlaying) {
      // Pause/Stop
      if (audioRef.current) {
        audioRef.current.pause();
      }
      if (synthRef.current) {
        if (synthRef.current.stop) synthRef.current.stop();
        if (synthRef.current.interval) clearInterval(synthRef.current.interval);
        synthRef.current = null;
      }
      setIsPlaying(false);
    } else {
      // Start Playback
      setIsPlaying(true);
      setPlayProgress(0);

      if (audioLog.url) {
        // Play real uploaded audio file from the backend
        const fullUrl = audioLog.url.startsWith('http')
          ? audioLog.url
          : `${API_URL}${audioLog.url}`;

        if (audioRef.current) {
          audioRef.current.pause();
        }

        const audio = new Audio(fullUrl);
        audio.crossOrigin = 'anonymous'; // Required for cross-origin audio playback
        audioRef.current = audio;

        audio.addEventListener('timeupdate', () => {
          if (audio.duration && isFinite(audio.duration)) {
            setPlayProgress(Math.round((audio.currentTime / audio.duration) * 100));
          }
        });

        audio.addEventListener('ended', () => {
          setIsPlaying(false);
          setPlayProgress(0);
        });

        // If real audio file fails to load, fall back to synthesizer
        audio.addEventListener('error', () => {
          console.warn('Audio file failed to load, falling back to synthesizer:', fullUrl);
          audioRef.current = null;
          const synth = playDemoSynth(activeAudioTab);
          synthRef.current = synth;

          const durationSec = activeAudioTab === 'lung' ? 12 : activeAudioTab === 'heart' ? 15 : 10;
          const startTime = Date.now();
          const interval = setInterval(() => {
            const elapsed = (Date.now() - startTime) / 1000;
            const progress = Math.min(Math.round((elapsed / durationSec) * 100), 100);
            setPlayProgress(progress);

            if (progress >= 100) {
              clearInterval(interval);
              setIsPlaying(false);
              if (synthRef.current) {
                synthRef.current.stop();
                synthRef.current = null;
              }
            }
          }, 100);

          if (synthRef.current) synthRef.current.interval = interval;
        });

        audio.play().catch(err => {
          console.error("Audio playback failed:", err);
          setIsPlaying(false);
        });
      } else {
        // Play simulated synthesizer sound
        const synth = playDemoSynth(activeAudioTab);
        synthRef.current = synth;

        const durationSec = activeAudioTab === 'lung' ? 12 : 15;
        const startTime = Date.now();
        const interval = setInterval(() => {
          const elapsed = (Date.now() - startTime) / 1000;
          const progress = Math.min((elapsed / durationSec) * 100, 100);
          setPlayProgress(progress);

          if (progress >= 100) {
            clearInterval(interval);
            setIsPlaying(false);
            if (synthRef.current) {
              synthRef.current.stop();
              synthRef.current = null;
            }
          }
        }, 100);

        synthRef.current.interval = interval;
      }
    }
  };

  const [isTriggeringESP32, setIsTriggeringESP32] = useState(false);
  const [esp32TriggerMessage, setEsp32TriggerMessage] = useState('');
  const [isBrowserRecording, setIsBrowserRecording] = useState(false);
  const [browserRecordTime, setBrowserRecordTime] = useState(0);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  // File upload / delete
  const fileInputRef = useRef(null);
  const [uploadState, setUploadState] = useState({ busy: false, message: '', error: '' });
  const [deleting, setDeleting] = useState(false);

  /**
   * Upload an audio file from the user's computer.
   *
   * Anything the browser can decode is accepted and converted to the
   * same 16 kHz mono WAV the ESP32 sends, so a file dropped in here
   * reaches the analysis engine in exactly the same shape as a live
   * capture. Screening then happens server-side on arrival.
   */
  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    // Reset immediately so re-picking the same file still fires onChange
    event.target.value = '';
    if (!file || !patient) return;

    setUploadState({ busy: true, message: `Reading ${file.name}…`, error: '' });

    try {
      setUploadState({ busy: true, message: 'Converting to WAV…', error: '' });
      const wav = await encodeWavFromBlob(file);

      setUploadState({ busy: true, message: 'Uploading and screening…', error: '' });
      const res = await apiUploadAudio({
        patientId: patient.id,
        type: activeAudioTab,
        audioBase64: wav.base64,
        duration: formatDuration(wav.durationSec),
        deviceId: 'FILE-UPLOAD',
      });

      if (res.analysis) {
        setAnalyses((prev) => ({ ...prev, [activeAudioTab]: res.analysis }));
      }
      await loadPatients();
      await loadAnalyses(patient.id);

      setUploadState({
        busy: false,
        error: '',
        message: wav.trimmed
          ? `Uploaded — trimmed to the first ${MAX_DURATION_SEC}s.`
          : `Uploaded ${file.name} (${formatDuration(wav.durationSec)}).`,
      });
      setTimeout(() => setUploadState((s) => (s.busy ? s : { ...s, message: '' })), 6000);
    } catch (err) {
      console.error('Upload failed:', err);
      setUploadState({ busy: false, message: '', error: err.message });
    }
  };

  /** Delete the current recording, its file, and its AI analysis. */
  const handleDeleteAudio = async () => {
    if (!patient) return;

    const signed = analyses?.[activeAudioTab]?.review;
    const wasSigned = signed && signed.status !== 'pending';

    const confirmText = wasSigned
      ? t('audio.confirmDeleteSigned', { doctor: signed.doctorName || '—' })
      : t('audio.confirmDelete');
    if (!window.confirm(confirmText)) return;

    setDeleting(true);
    try {
      const res = await apiDeleteAudio(patient.id, activeAudioTab);
      setAnalyses((prev) => {
        const next = { ...prev };
        delete next[activeAudioTab];
        return next;
      });
      if (res.patient) {
        setPatients((prev) =>
          prev.map((p) =>
            p.id === res.patient.id
              ? {
                  ...p,
                  ...res.patient,
                  audioLogs: {
                    ...p.audioLogs,
                    [activeAudioTab]: { available: false, status: 'Not recorded', duration: '0:00' },
                  },
                }
              : p
          )
        );
      }
      setIsPlaying(false);
      setPlayProgress(0);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    } catch (err) {
      console.error('Delete failed:', err);
      alert(err.message);
    } finally {
      setDeleting(false);
    }
  };

  const triggerESP32Record = async () => {
    try {
      setIsTriggeringESP32(true);
      setEsp32TriggerMessage('Sending command to ESP32...');

      const res = await fetch(`${API_URL}/api/device/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: 'ESP32-INMP441-A',
          command: 'record',
          patient_id: patient.id,
          type: activeAudioTab
        })
      });

      const data = await res.json();
      if (data.success) {
        setEsp32TriggerMessage('Waiting for ESP32 to record (this takes ~5s)...');

        let attempts = 0;
        const interval = setInterval(async () => {
          attempts++;
          try {
            const patientsRes = await fetchPatients();
            if (patientsRes.success && patientsRes.patients) {
              const updatedPatient = patientsRes.patients.find(p => p.id === patient.id);
              if (updatedPatient && updatedPatient.audioLogs?.[activeAudioTab]?.available) {
                clearInterval(interval);
                setIsTriggeringESP32(false);
                setEsp32TriggerMessage('');
                loadPatients();
                // The recording is screened server-side on arrival —
                // pull the result so the dashboard shows it immediately
                loadAnalyses(patient.id);
                return;
              }
            }
          } catch (e) {
            console.error('Polling error:', e);
          }

          if (attempts > 20) {
            clearInterval(interval);
            setIsTriggeringESP32(false);
            setEsp32TriggerMessage('Timeout waiting for ESP32. Please ensure the device is powered on.');
          }
        }, 1500);
      } else {
        setIsTriggeringESP32(false);
        setEsp32TriggerMessage('Failed to trigger ESP32: ' + data.error);
      }
    } catch (err) {
      setIsTriggeringESP32(false);
      setEsp32TriggerMessage('Network error: ' + err.message);
    }
  };

  const startBrowserRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];

      // Detect supported mime type
      let options = {};
      let detectedMime = 'audio/wav';
      if (MediaRecorder.isTypeSupported('audio/webm')) {
        options = { mimeType: 'audio/webm' };
        detectedMime = 'audio/webm';
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        options = { mimeType: 'audio/mp4' };
        detectedMime = 'audio/mp4';
      } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
        options = { mimeType: 'audio/ogg' };
        detectedMime = 'audio/ogg';
      }

      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: detectedMime });
        stream.getTracks().forEach(track => track.stop());

        try {
          // Transcode to PCM WAV so the analysis engine can actually read
          // it — MediaRecorder emits WebM/Opus or MP4/AAC, neither of
          // which the engine decodes.
          setEsp32TriggerMessage('Converting recording…');
          const wav = await encodeWavFromBlob(audioBlob);
          const mins = Math.floor(wav.durationSec / 60);
          const secs = Math.round(wav.durationSec % 60);

          const res = await fetch(`${API_URL}/api/device/audio`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              device_id: 'BROWSER-MIC',
              patient_id: patient.id,
              type: activeAudioTab,
              duration: `${mins}:${String(secs).padStart(2, '0')}`,
              audio_base64: wav.base64,
              mime_type: 'audio/wav',
            })
          });
          const data = await res.json();
          if (data.success) {
            // The backend screens on upload — pick the result straight up
            if (data.analysis) {
              setAnalyses((prev) => ({ ...prev, [activeAudioTab]: data.analysis }));
            }
            loadPatients();
            loadAnalyses(patient.id);
          } else {
            alert('Failed to save audio: ' + data.error);
          }
        } catch (err) {
          console.error(err);
          alert('Upload failed: ' + err.message);
        } finally {
          setEsp32TriggerMessage('');
        }
      };

      mediaRecorder.start();
      setIsBrowserRecording(true);
      setBrowserRecordTime(0);

      // The engine needs at least 3 s of signal and reads breathing
      // cycles best over several breaths — 10 s is the sweet spot.
      const MAX_SECONDS = 10;
      let time = 0;
      const interval = setInterval(() => {
        time++;
        setBrowserRecordTime(time);
        if (time >= MAX_SECONDS) {
          clearInterval(interval);
          mediaRecorder.stop();
          setIsBrowserRecording(false);
        }
      }, 1000);

      mediaRecorderRef.current.timerInterval = interval;
    } catch (err) {
      console.error('Mic access denied:', err);
      alert('Cannot access microphone: ' + err.message);
    }
  };

  const stopBrowserRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      if (mediaRecorderRef.current.timerInterval) {
        clearInterval(mediaRecorderRef.current.timerInterval);
      }
      setIsBrowserRecording(false);
    }
  };

  // Clean up any playing audio and recording on page unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      if (synthRef.current) {
        if (synthRef.current.stop) synthRef.current.stop();
        if (synthRef.current.interval) clearInterval(synthRef.current.interval);
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
        if (mediaRecorderRef.current.timerInterval) {
          clearInterval(mediaRecorderRef.current.timerInterval);
        }
      }
    };
  }, []);

  // Set up edits & reset/cleanup audio/recording when switching patient or tab
  useEffect(() => {
    if (patient && patient.vitals) {
      setEditedVitals({ ...patient.vitals });
    } else {
      setEditedVitals({});
    }

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (synthRef.current) {
      if (synthRef.current.stop) synthRef.current.stop();
      if (synthRef.current.interval) clearInterval(synthRef.current.interval);
      synthRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      if (mediaRecorderRef.current.timerInterval) {
        clearInterval(mediaRecorderRef.current.timerInterval);
      }
    }
    setIsBrowserRecording(false);
    setIsTriggeringESP32(false);
    setEsp32TriggerMessage('');

    setIsPlaying(false);
    setPlayProgress(0);
  }, [selectedPatientId, patient, activeAudioTab]);

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
          const newPatient = { ...res.patient, audioLogs: NO_AUDIO_LOGS };
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

  // The screening result for the recording currently selected
  const currentAnalysis = analyses?.[activeAudioTab] || null;

  // ─── AI-driven triage queue ───────────────────────────────────────
  // Urgent cases first, and within the same level the ones no doctor
  // has signed yet — so the queue answers "who needs me next?" rather
  // than "who arrived first?".
  const query = searchQuery.trim().toLowerCase();
  const visiblePatients = patients
    .filter((p) => {
      if (!query) return true;
      return (
        String(p.name || '').toLowerCase().includes(query) ||
        String(p.id || '').toLowerCase().includes(query) ||
        String(p.age ?? '').includes(query)
      );
    })
    .slice()
    .sort((a, b) => {
      const byRisk = (TRIAGE_RANK[a.riskStatus] ?? 3) - (TRIAGE_RANK[b.riskStatus] ?? 3);
      if (byRisk !== 0) return byRisk;
      // Unreviewed before reviewed at the same urgency
      const aPending = a.reviewSummary?.pending || 0;
      const bPending = b.reviewSummary?.pending || 0;
      if (aPending !== bPending) return bPending - aPending;
      return String(a.checkInTime || '').localeCompare(String(b.checkInTime || ''));
    });

  const totalPendingReview = patients.reduce((n, p) => n + (p.reviewSummary?.pending || 0), 0);

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
                {['nurse', 'doctor', 'patient'].includes(user?.role) ? t('role.' + user.role) : t('role.unknown')} · {user?.station || '—'}
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
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('queue.search')}
                  className="field !pl-9 !py-1.5 !text-[13px]"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-ink dark:hover:text-chalk"
                    aria-label="Clear search"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Ordering is a feature, so it is stated, not implied */}
              <p className="font-mono text-[10px] text-muted/70 dark:text-chalk-muted/70 mt-2 leading-relaxed">
                {t('queue.sortNote')}
                {totalPendingReview > 0 && (
                  <span className="text-risk-mod dark:text-risk-modd">
                    {' · '}{t('queue.pendingReview', { n: totalPendingReview })}
                  </span>
                )}
              </p>
            </div>

            {/* Rows */}
            <div className="flex-1 overflow-y-auto divide-y divide-hairline dark:divide-coal-700">
              {visiblePatients.length === 0 && (
                <p className="px-4 py-6 text-center text-xs text-muted dark:text-chalk-muted">
                  {t('queue.noMatch', { q: searchQuery })}
                </p>
              )}
              {visiblePatients.map((item) => {
                const r = getRisk(item.riskStatus);
                const isSelected = item.id === selectedPatientId;
                const pending = item.reviewSummary?.pending || 0;
                const signed = (item.reviewSummary?.confirmed || 0) + (item.reviewSummary?.modified || 0);
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
                    <span className="flex flex-col items-end gap-1 shrink-0">
                      <span className={`font-mono text-[10px] ${r.text}`}>
                        {r.mark && <span className="mr-1">{r.mark}</span>}{r.label}
                      </span>
                      {/* Review state at a glance */}
                      {pending > 0 ? (
                        <span className="flex items-center gap-1 font-mono text-[9px] text-risk-mod dark:text-risk-modd">
                          <Clock className="w-2.5 h-2.5" />{pending}
                        </span>
                      ) : signed > 0 ? (
                        <span className="flex items-center gap-1 font-mono text-[9px] text-med-600 dark:text-med-300">
                          <ShieldCheck className="w-2.5 h-2.5" />{signed}
                        </span>
                      ) : null}
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
              {/* One hidden picker serves both the empty and populated states */}
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_AUDIO}
                onChange={handleFileUpload}
                className="hidden"
              />

              {patient?.audioLogs?.[activeAudioTab]?.available ? (
                <div>
                  <div className="flex items-center justify-between font-mono text-[10px] text-muted dark:text-chalk-muted">
                    <span className="truncate pr-4">{t('audio.src')} · {patient?.audioLogs?.[activeAudioTab]?.status ? td(patient.audioLogs[activeAudioTab].status) : t('audio.statusUnavailable')}</span>
                    <span className="shrink-0">{t('audio.dur')} {patient?.audioLogs?.[activeAudioTab]?.duration || '0:00'}</span>
                  </div>

                  {/* Player — an ink panel in both themes */}
                  <div className="mt-3 bg-ink dark:bg-coal-850 dark:border dark:border-coal-700 rounded-md p-4 flex items-center gap-4">
                    <button
                      onClick={handleTogglePlay}
                      className="w-10 h-10 rounded bg-med-500 hover:bg-med-400 text-white flex items-center justify-center
                                 flex-shrink-0 transition-colors duration-200 active:translate-y-px"
                    >
                      {isPlaying ? <Pause className="w-4 h-4 fill-white" /> : <Play className="w-4 h-4 fill-white ml-0.5" />}
                    </button>

                    {/* Waveform — the real amplitude envelope measured
                        from the recording, with the segments the engine
                        flagged marked underneath. Falls back to a flat
                        bar only when no analysis exists yet. */}
                    <div className="relative flex-1 h-10 flex items-center gap-[2px] overflow-hidden">
                      <div
                        className="absolute top-0 bottom-0 left-0 border-r border-white/50 transition-all duration-300 z-10"
                        style={{ width: `${playProgress}%` }}
                      />
                      {(() => {
                        const env = currentAnalysis?.waveform;
                        const bars = env && env.length ? env : new Array(70).fill(0.25);
                        const duration = currentAnalysis?.durationSec || 0;
                        return bars.map((amp, i) => {
                          const active = (i / bars.length) * 100 <= playProgress;
                          // Is this slice inside a flagged segment?
                          const tSec = duration ? (i / bars.length) * duration : -1;
                          const flagged = duration > 0 && (currentAnalysis?.segments || []).some(
                            (s) => s.type !== 'heart_sound' && tSec >= s.start && tSec <= s.end
                          );
                          return (
                            <div
                              key={i}
                              className={`flex-1 min-w-[1px] rounded-[1px] transition-colors duration-300 ${
                                flagged
                                  ? 'bg-risk-modd'
                                  : active
                                    ? `bg-med-400 ${isPlaying ? 'eq-bar' : ''}`
                                    : 'bg-white/15'
                              }`}
                              style={{
                                height: `${Math.max(3, amp * 34)}px`,
                                animationDelay: `${(i % 6) * 0.11}s`,
                              }}
                            />
                          );
                        });
                      })()}
                    </div>

                    <span className="font-mono text-[10px] text-white/40 tabular-nums w-9 text-right shrink-0">
                      {playProgress}%
                    </span>
                  </div>

                  {/* Manage the stored recording */}
                  <div className="flex flex-wrap items-center gap-2 mt-3 print-hidden">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadState.busy || deleting}
                      className="btn-line !py-1.5 disabled:opacity-50"
                    >
                      <Upload className="w-3 h-3" /> {t('audio.replace')}
                    </button>
                    <button
                      onClick={handleDeleteAudio}
                      disabled={uploadState.busy || deleting}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded
                                 border border-risk-high/40 text-risk-high hover:bg-risk-high/[0.06]
                                 dark:border-risk-highd/40 dark:text-risk-highd dark:hover:bg-risk-highd/[0.08]
                                 transition-colors duration-200 active:translate-y-px disabled:opacity-50"
                    >
                      <Trash2 className="w-3 h-3" /> {deleting ? t('audio.deleting') : t('audio.delete')}
                    </button>

                    {uploadState.busy && (
                      <span className="font-mono text-[10px] text-med-600 dark:text-med-300">
                        {uploadState.message}
                      </span>
                    )}
                    {!uploadState.busy && uploadState.message && (
                      <span className="font-mono text-[10px] text-muted dark:text-chalk-muted">
                        {uploadState.message}
                      </span>
                    )}
                    {uploadState.error && (
                      <span className="font-mono text-[10px] text-risk-high dark:text-risk-highd">
                        {uploadState.error}
                      </span>
                    )}
                  </div>

                  <p className="font-mono text-[10px] text-muted/60 dark:text-chalk-muted/60 mt-2 leading-relaxed">
                    {t('audio.deleteNote')}
                  </p>
                </div>
              ) : (
                <div className="border border-dashed border-hairline-strong dark:border-coal-600 rounded-md py-6 px-4 text-center">
                  <p className="microlabel mb-2">{t('audio.none')}</p>

                  {isTriggeringESP32 ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-center gap-2">
                        <span className="w-2.5 h-2.5 bg-med-500 rounded-full animate-ping" />
                        <span className="font-mono text-xs text-ink dark:text-chalk">ESP32 Action Triggered</span>
                      </div>
                      <p className="font-mono text-[10px] text-muted/70 dark:text-chalk-muted/70">
                        {esp32TriggerMessage}
                      </p>
                    </div>
                  ) : isBrowserRecording ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-center gap-2">
                        <span className="w-2.5 h-2.5 bg-risk-high rounded-full animate-pulse" />
                        <span className="font-mono text-xs text-risk-high">Recording from Browser Mic... ({browserRecordTime}s)</span>
                      </div>
                      <button
                        onClick={stopBrowserRecording}
                        className="btn-line border-risk-high text-risk-high hover:bg-risk-high/[0.05]"
                      >
                        Stop Recording
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="font-mono text-[10px] text-muted/70 dark:text-chalk-muted/70">
                        {t('audio.noneDetail')}
                      </p>
                      <div className="flex flex-wrap justify-center gap-3">
                        <button
                          onClick={triggerESP32Record}
                          disabled={uploadState.busy}
                          className="btn-line hover:border-med-500 hover:text-med-500 disabled:opacity-50"
                        >
                          <Mic className="w-3 h-3" /> {t('audio.useEsp32')}
                        </button>
                        <button
                          onClick={startBrowserRecording}
                          disabled={uploadState.busy}
                          className="btn-line hover:border-risk-mod hover:text-risk-mod disabled:opacity-50"
                        >
                          <Laptop className="w-3 h-3" /> {t('audio.useBrowserMic')}
                        </button>
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          disabled={uploadState.busy}
                          className="btn-ink disabled:opacity-50"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          {uploadState.busy ? t('audio.uploading') : t('audio.uploadFile')}
                        </button>
                      </div>

                      {uploadState.busy && (
                        <p className="font-mono text-[10px] text-med-600 dark:text-med-300">
                          {uploadState.message}
                        </p>
                      )}
                      {uploadState.error && (
                        <p className="font-mono text-[10px] text-risk-high dark:text-risk-highd max-w-md mx-auto leading-relaxed">
                          {uploadState.error}
                        </p>
                      )}

                      <p className="font-mono text-[10px] text-muted/60 dark:text-chalk-muted/60 leading-relaxed">
                        {t('audio.uploadHint')}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* AI screening (layer 1) + physician review (layer 2) */}
          <div className="card p-5 will-fade-up animate-delay-400">
            <SectionHead index="04" title={t('ai.title')}>
              <span className="font-mono text-[10px] text-muted dark:text-chalk-muted uppercase">
                {t('audio.' + activeAudioTab)}
              </span>
            </SectionHead>

            <div className="mt-4">
              <AIAnalysisPanel
                analysis={currentAnalysis}
                type={activeAudioTab}
                canReview={canReview}
                running={analysisRunning}
                progress={playProgress}
                isDark={isDark}
                onRun={handleRunAnalysis}
                onReview={handleReview}
                reviewSubmitting={reviewSubmitting}
              />
            </div>

            {/* Print / export */}
            <div className="flex flex-col sm:flex-row gap-2 mt-5 pt-5 border-t border-hairline dark:border-coal-700 print-hidden">
              <button onClick={() => window.print()} className="btn-line flex-1">
                <Printer className="w-3.5 h-3.5" /> {t('actions.print')}
              </button>
            </div>
          </div>

          {/* Legal position — this is a screening aid, not a diagnosis */}
          <p className="text-[10px] leading-relaxed text-muted/80 dark:text-chalk-muted/70 border-t border-hairline dark:border-coal-700 pt-3">
            {t('disclaimer')}
          </p>

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
