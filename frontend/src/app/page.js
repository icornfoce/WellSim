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
  sendDeviceCommand as apiSendDeviceCommand,
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
      setUploadState({ busy: false, message: '', error: err.message });
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
  const [playbackError, setPlaybackError] = useState('');

  /**
   * Play the stored recording — and only the stored recording.
   *
   * An earlier version fell back to a Web Audio synthesiser when the
   * file failed to load: it played a generated "heartbeat" or
   * "breathing" tone and ran the progress bar as though the patient's
   * own audio were playing. A clinician listening to that would have
   * been auscultating an oscillator. A screening tool must never
   * substitute a plausible sound for a missing one, so a failed load
   * now says so and stops.
   */
  const handleTogglePlay = () => {
    const audioLog = patient?.audioLogs?.[activeAudioTab];
    if (!audioLog?.available) return;

    if (isPlaying) {
      audioRef.current?.pause();
      setIsPlaying(false);
      return;
    }

    if (!audioLog.url) {
      setPlaybackError(t('audio.playbackMissing'));
      return;
    }

    setPlaybackError('');
    setPlayProgress(0);

    const fullUrl = audioLog.url.startsWith('http')
      ? audioLog.url
      : `${API_URL}${audioLog.url}`;

    audioRef.current?.pause();

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

    audio.addEventListener('error', () => {
      console.warn('Audio file failed to load:', fullUrl);
      audioRef.current = null;
      setIsPlaying(false);
      setPlayProgress(0);
      setPlaybackError(t('audio.playbackFailed'));
    });

    audio.play()
      .then(() => setIsPlaying(true))
      .catch((err) => {
        console.error('Audio playback failed:', err);
        setIsPlaying(false);
        setPlaybackError(t('audio.playbackFailed'));
      });
  };

  const [isTriggeringESP32, setIsTriggeringESP32] = useState(false);
  // One status line shared by every capture route (device, mic, upload)
  const [captureMessage, setCaptureMessage] = useState('');
  const [isBrowserRecording, setIsBrowserRecording] = useState(false);
  const [browserRecordTime, setBrowserRecordTime] = useState(0);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const esp32PollRef = useRef(null);

  const stopEsp32Poll = useCallback(() => {
    if (esp32PollRef.current) {
      clearInterval(esp32PollRef.current);
      esp32PollRef.current = null;
    }
  }, []);

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

    setUploadState({ busy: true, message: t('audio.stepReading', { file: file.name }), error: '' });

    try {
      setUploadState({ busy: true, message: t('audio.stepConverting'), error: '' });
      const wav = await encodeWavFromBlob(file);

      setUploadState({ busy: true, message: t('audio.stepUploading'), error: '' });
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
          ? t('audio.stepDoneTrimmed', { max: MAX_DURATION_SEC })
          : t('audio.stepDone', { file: file.name, dur: formatDuration(wav.durationSec) }),
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
      setUploadState({ busy: false, message: '', error: err.message });
    } finally {
      setDeleting(false);
    }
  };

  const triggerESP32Record = async () => {
    try {
      setIsTriggeringESP32(true);
      setCaptureMessage(t('audio.esp32Sending'));

      // Goes through the API client so the session token is attached —
      // this endpoint now requires an authenticated user or a device key
      const data = await apiSendDeviceCommand({
        deviceId: 'ESP32-INMP441-A',
        command: 'record',
        patientId: patient.id,
        type: activeAudioTab,
      }).catch((err) => ({ success: false, error: err.message }));

      if (data.success) {
        setCaptureMessage(t('audio.esp32Waiting'));

        // Held in a ref so switching patient or leaving the page stops
        // the poll. It used to be a bare local, which kept hitting the
        // API for another 30 s after the dashboard had moved on.
        let attempts = 0;
        esp32PollRef.current = setInterval(async () => {
          attempts++;
          try {
            const patientsRes = await fetchPatients();
            if (patientsRes.success && patientsRes.patients) {
              const updatedPatient = patientsRes.patients.find(p => p.id === patient.id);
              if (updatedPatient && updatedPatient.audioLogs?.[activeAudioTab]?.available) {
                stopEsp32Poll();
                setIsTriggeringESP32(false);
                setCaptureMessage('');
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
            stopEsp32Poll();
            setIsTriggeringESP32(false);
            setCaptureMessage(t('audio.esp32Timeout'));
          }
        }, 1500);
      } else {
        setIsTriggeringESP32(false);
        setCaptureMessage(t('audio.esp32Failed', { error: data.error }));
      }
    } catch (err) {
      setIsTriggeringESP32(false);
      setCaptureMessage(t('audio.networkError', { error: err.message }));
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
          setCaptureMessage(t('audio.stepConverting'));
          const wav = await encodeWavFromBlob(audioBlob);
          const mins = Math.floor(wav.durationSec / 60);
          const secs = Math.round(wav.durationSec % 60);

          const data = await apiUploadAudio({
            patientId: patient.id,
            type: activeAudioTab,
            audioBase64: wav.base64,
            duration: `${mins}:${String(secs).padStart(2, '0')}`,
            deviceId: 'BROWSER-MIC',
          });
          if (data.success) {
            // The backend screens on upload — pick the result straight up
            if (data.analysis) {
              setAnalyses((prev) => ({ ...prev, [activeAudioTab]: data.analysis }));
            }
            loadPatients();
            loadAnalyses(patient.id);
          } else {
            setUploadState({ busy: false, message: '', error: data.error || t('audio.saveFailed') });
          }
        } catch (err) {
          console.error(err);
          setUploadState({ busy: false, message: '', error: err.message });
        } finally {
          setCaptureMessage('');
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
      setUploadState({ busy: false, message: '', error: t('audio.micDenied', { error: err.message }) });
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

  // Clean up any playing audio, recording and device poll on unmount
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      stopEsp32Poll();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
        if (mediaRecorderRef.current.timerInterval) {
          clearInterval(mediaRecorderRef.current.timerInterval);
        }
      }
    };
  }, [stopEsp32Poll]);

  /**
   * Reset capture and playback when the clinician moves to another
   * patient or another recording.
   *
   * Keyed on `selectedPatientId`, not on the `patient` object: the
   * object is replaced on every write to the patient list (saving
   * vitals, running a screening, uploading audio), and this effect
   * used to fire on each of those and silently discard whatever the
   * nurse had typed into the vitals form.
   */
  useEffect(() => {
    audioRef.current?.pause();
    audioRef.current = null;

    stopEsp32Poll();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      if (mediaRecorderRef.current.timerInterval) {
        clearInterval(mediaRecorderRef.current.timerInterval);
      }
    }
    setIsBrowserRecording(false);
    setIsTriggeringESP32(false);
    setCaptureMessage('');
    setPlaybackError('');

    setIsPlaying(false);
    setPlayProgress(0);
    setIsEditing(false);
  }, [selectedPatientId, activeAudioTab, stopEsp32Poll]);

  // Seed the vitals form from the record — but never overwrite an edit
  // in progress, which is what the combined effect above used to do.
  useEffect(() => {
    if (isEditing) return;
    setEditedVitals(patient?.vitals ? { ...patient.vitals } : {});
  }, [patient, isEditing]);

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
    if (val < 18.5) return t('bmi.under');
    if (val < 25.0) return t('bmi.normal');
    if (val < 30.0) return t('bmi.over');
    return t('bmi.obese');
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
      <div className="min-h-screen bg-paper dark:bg-coal-950 flex flex-col font-sans transition-colors duration-300">
        <header className="sticky top-0 z-50 bg-surface/95 dark:bg-coal-900/95 backdrop-blur-sm border-b border-hairline dark:border-coal-700 px-4 sm:px-6 print-hidden">
          <div className="max-w-7xl mx-auto flex items-center justify-between h-14 gap-4">
            <div className="flex items-center gap-3 shrink-0">
              <div className="w-7 h-7 rounded bg-ink dark:bg-chalk flex items-center justify-center">
                <PulseMark className="w-4 h-4 text-white dark:text-coal-950" />
              </div>
              <div className="flex items-baseline gap-2.5">
                <span className="text-[15px] font-semibold tracking-tight text-ink dark:text-chalk">WellSim</span>
                <span className="microlabel hidden sm:inline">Triage / v2</span>
              </div>
            </div>

            <div className="hidden md:flex items-center gap-6 font-mono text-[11px] text-muted dark:text-chalk-muted">
              <span className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-[1px] ${
                  deviceStatus?.status === 'online'
                    ? 'bg-med-500 dark:bg-med-300 animate-blink'
                    : 'bg-risk-high dark:bg-risk-highd'
                }`} />
                {deviceStatus?.status === 'online'
                  ? t('header.iotOnline')
                  : deviceStatus?.last_seen_ago_ms > 0 && deviceStatus.last_seen_ago_ms < 3_600_000
                    ? (() => {
                        const mins = Math.floor(deviceStatus.last_seen_ago_ms / 60_000);
                        return lang === 'th'
                          ? `IOT · เห็นล่าสุด ${mins > 0 ? `${mins}น.` : '<1น.'} ที่แล้ว`
                          : `IOT · last seen ${mins > 0 ? `${mins}m` : '<1m'} ago`;
                      })()
                  : t('header.iotOffline')
                }
              </span>
              <span>RSSI {deviceStatus?.wifi_strength ? `${deviceStatus.wifi_strength} dBm` : '—'}</span>
              <span className="tabular-nums text-ink dark:text-chalk">
                {currentTime.toLocaleTimeString('en-US', { hour12: false })}
              </span>
            </div>

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
                className="tap-target w-7 h-7 rounded border border-hairline-strong dark:border-coal-600 flex items-center justify-center
                           text-muted hover:text-risk-high hover:border-risk-high/50
                           dark:text-chalk-muted dark:hover:text-risk-highd dark:hover:border-risk-highd/50
                           transition-colors duration-200"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </header>

        <div className="flex-1 flex items-center justify-center p-4">
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
      </div>
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
      {/* Urgency is carried by the AI triage badge and the queue ordering,
          which are driven by the analysis engine. A second banner running
          its own vitals-only rule could contradict them. */}

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
              {deviceStatus?.status === 'online'
                ? t('header.iotOnline')
                : deviceStatus?.last_seen_ago_ms > 0 && deviceStatus.last_seen_ago_ms < 3_600_000
                  ? (() => {
                      const mins = Math.floor(deviceStatus.last_seen_ago_ms / 60_000);
                      return lang === 'th'
                        ? `IOT · เห็นล่าสุด ${mins > 0 ? `${mins}น.` : '<1น.'} ที่แล้ว`
                        : `IOT · last seen ${mins > 0 ? `${mins}m` : '<1m'} ago`;
                    })()
                  : t('header.iotOffline')
              }
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
            <button
              onClick={() => window.print()}
              title={lang === 'th' ? 'พิมพ์รายงาน' : 'Print report'}
              className="tap-target w-7 h-7 rounded border border-hairline-strong dark:border-coal-600 flex items-center justify-center
                         text-muted hover:text-ink hover:border-ink/50
                         dark:text-chalk-muted dark:hover:text-chalk dark:hover:border-chalk/50
                         transition-colors duration-200"
            >
              <Printer className="w-3.5 h-3.5" />
            </button>
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
              className="tap-target w-7 h-7 rounded border border-hairline-strong dark:border-coal-600 flex items-center justify-center
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

        {/* Print-only letterhead */}
        <div className="hidden print-letterhead lg:col-span-3">
          <h1>WellSim — Clinical Triage Report</h1>
          <p>AI-Assisted Respiratory &amp; Cardiovascular Screening · Printed {new Date().toLocaleDateString('en-GB')} {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</p>
        </div>

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
                  className="tap-target w-6 h-6 rounded border border-hairline-strong dark:border-coal-600 flex items-center justify-center
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
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted dark:text-chalk-muted" />
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
              <p className="note-sm mt-2.5">
                {t('queue.sortNote')}
                {totalPendingReview > 0 && (
                  <span className="font-medium text-risk-mod dark:text-risk-modd">
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
                      <span className={`w-2 h-2 rounded-[1px] shrink-0 ${r.dot} ${item.riskStatus === 'high' ? 'animate-blink' : ''}`} />
                      <span className="min-w-0">
                        <span className={`block text-sm font-semibold truncate ${
                          isSelected ? 'text-med-700 dark:text-med-300' : 'text-ink dark:text-chalk'
                        }`}>
                          {item.name}
                        </span>
                        <span className="datum block mt-0.5">
                          {t('queue.age')} {item.age ?? '—'} · {item.checkInTime}
                        </span>
                      </span>
                    </span>
                    <span className="flex flex-col items-end gap-1 shrink-0">
                      <span className={`font-mono text-[11px] font-medium ${r.text}`}>
                        {r.mark && <span className="mr-1">{r.mark}</span>}{r.label}
                      </span>
                      {/* Review state at a glance */}
                      {pending > 0 ? (
                        <span
                          className="flex items-center gap-1 font-mono text-[11px] tabular-nums text-risk-mod dark:text-risk-modd"
                          title={t('queue.pendingReview', { n: pending })}
                        >
                          <Clock className="w-3 h-3" />{pending}
                        </span>
                      ) : signed > 0 ? (
                        <span
                          className="flex items-center gap-1 font-mono text-[11px] tabular-nums text-med-700 dark:text-med-300"
                          title={t('queue.signedCount', { n: signed })}
                        >
                          <ShieldCheck className="w-3 h-3" />{signed}
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
                // The BMI band is a sentence, not a unit — it gets its
                // own line rather than being crushed in beside the number.
                { label: 'BMI', value: bmiValue, unit: '', note: getBMICategory(bmiValue) },
              ].map(({ label, value, unit, note }) => (
                <div key={label} className="bg-surface dark:bg-coal-900 px-3 py-2.5">
                  <p className="microlabel">{label}</p>
                  <p className="text-base font-medium text-ink dark:text-chalk mt-1 tabular-nums">
                    {value}
                    {unit && <span className="font-mono text-[11px] text-muted dark:text-chalk-muted ml-1.5">{unit}</span>}
                  </p>
                  {note && <p className="note-sm mt-0.5">{note}</p>}
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
                    <span className="font-mono text-[11px] font-medium text-risk-high dark:text-risk-highd">▼ {t('tag.low')}</span>
                  )}
                </div>
                {isEditing ? (
                  <input
                    type="number"
                    min="0"
                    onKeyDown={(e) => { if (e.key === '-' || e.key === 'e' || e.key === 'E') e.preventDefault(); }}
                    value={editedVitals.spo2 || ''}
                    onChange={(e) => setEditedVitals(prev => ({ ...prev, spo2: Math.max(0, parseInt(e.target.value) || 0) }))}
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
                <p className="datum mt-2.5">{t('vitals.ref')} 95–100</p>
              </div>

              {/* Heart rate */}
              <div className="bg-surface dark:bg-coal-900 p-4">
                <div className="flex justify-between items-baseline">
                  <p className="microlabel">{t('vitals.hr')}</p>
                  {(has(v.heartRate) && v.heartRate > 100) && (
                    <span className="font-mono text-[11px] font-medium text-risk-high dark:text-risk-highd">▲ {t('tag.high')}</span>
                  )}
                </div>
                {isEditing ? (
                  <input
                    type="number"
                    min="0"
                    onKeyDown={(e) => { if (e.key === '-' || e.key === 'e' || e.key === 'E') e.preventDefault(); }}
                    value={editedVitals.heartRate || ''}
                    onChange={(e) => setEditedVitals(prev => ({ ...prev, heartRate: Math.max(0, parseInt(e.target.value) || 0) }))}
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
                <p className="datum mt-2.5">{t('vitals.ref')} 60–100</p>
              </div>

              {/* Blood pressure */}
              <div className="bg-surface dark:bg-coal-900 p-4">
                <div className="flex justify-between items-baseline">
                  <p className="microlabel">{t('vitals.bp')}</p>
                  {(has(v.systolicBP) && v.systolicBP > 140) && (
                    <span className="font-mono text-[11px] font-medium text-risk-mod dark:text-risk-modd">▲ {t('tag.high')}</span>
                  )}
                </div>
                {isEditing ? (
                  <div className="flex items-center gap-1.5 mt-2">
                    <input
                      type="number"
                      min="0"
                      onKeyDown={(e) => { if (e.key === '-' || e.key === 'e' || e.key === 'E') e.preventDefault(); }}
                      value={editedVitals.systolicBP || ''}
                      onChange={(e) => setEditedVitals(prev => ({ ...prev, systolicBP: Math.max(0, parseInt(e.target.value) || 0) }))}
                      className="field !text-lg !font-light tabular-nums"
                    />
                    <span className="text-muted">/</span>
                    <input
                      type="number"
                      min="0"
                      onKeyDown={(e) => { if (e.key === '-' || e.key === 'e' || e.key === 'E') e.preventDefault(); }}
                      value={editedVitals.diastolicBP || ''}
                      onChange={(e) => setEditedVitals(prev => ({ ...prev, diastolicBP: Math.max(0, parseInt(e.target.value) || 0) }))}
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
                <p className="datum mt-2.5">{t('vitals.ref')} &lt;120/80</p>
              </div>

              {/* WBC */}
              <div className="bg-surface dark:bg-coal-900 p-4">
                <div className="flex justify-between items-baseline">
                  <p className="microlabel">{t('vitals.wbc')}</p>
                  {(has(v.wbc) && v.wbc > 11000) && (
                    <span className="font-mono text-[11px] font-medium text-risk-mod dark:text-risk-modd">▲ {t('tag.high')}</span>
                  )}
                </div>
                {isEditing ? (
                  <input
                    type="number"
                    min="0"
                    onKeyDown={(e) => { if (e.key === '-' || e.key === 'e' || e.key === 'E') e.preventDefault(); }}
                    value={editedVitals.wbc || ''}
                    onChange={(e) => setEditedVitals(prev => ({ ...prev, wbc: Math.max(0, parseInt(e.target.value) || 0) }))}
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
                <p className="datum mt-2.5">{t('vitals.ref')} 4,500–11,000</p>
              </div>

              {/* Hemoglobin */}
              <div className="bg-surface dark:bg-coal-900 p-4">
                <div className="flex justify-between items-baseline">
                  <p className="microlabel">{t('vitals.hgb')}</p>
                  {(has(v.hemoglobin) && v.hemoglobin < 12) && (
                    <span className="font-mono text-[11px] font-medium text-risk-mod dark:text-risk-modd">▼ {t('tag.low')}</span>
                  )}
                </div>
                {isEditing ? (
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    onKeyDown={(e) => { if (e.key === '-' || e.key === 'e' || e.key === 'E') e.preventDefault(); }}
                    value={editedVitals.hemoglobin || ''}
                    onChange={(e) => setEditedVitals(prev => ({ ...prev, hemoglobin: Math.max(0, parseFloat(e.target.value) || 0) }))}
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
                <p className="datum mt-2.5">{t('vitals.ref')} 12.0–17.5</p>
              </div>

              {/* Reserved slot */}
              <div className="bg-surface dark:bg-coal-900 p-4 flex flex-col items-center justify-center text-center">
                <p className="microlabel">{t('vitals.reserved')}</p>
                <p className="note-sm mt-1">{t('vitals.reservedNote')}</p>
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
                    // py-2.5 is not decoration: at pb-0.5 these tabs
                    // were a 19px-tall tap target on a phone.
                    className={`text-[13px] capitalize text-center min-w-[2.75rem] px-1 py-2.5 border-b-2 transition-colors duration-200 ${
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
                  <div className="flex items-center justify-between gap-4 datum">
                    <span className="truncate">{t('audio.src')} · {patient?.audioLogs?.[activeAudioTab]?.status ? td(patient.audioLogs[activeAudioTab].status) : t('audio.statusUnavailable')}</span>
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

                    <span className="font-mono text-[11px] text-chalk-muted tabular-nums w-9 text-right shrink-0">
                      {playProgress}%
                    </span>
                  </div>

                  {playbackError && (
                    <p className="note mt-2 !text-risk-high dark:!text-risk-highd">
                      {playbackError}
                    </p>
                  )}

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
                      <span className="note !text-med-700 dark:!text-med-300">
                        {uploadState.message}
                      </span>
                    )}
                    {!uploadState.busy && uploadState.message && (
                      <span className="note">{uploadState.message}</span>
                    )}
                    {uploadState.error && (
                      <span className="note !text-risk-high dark:!text-risk-highd">
                        {uploadState.error}
                      </span>
                    )}
                  </div>

                  <p className="note mt-2.5 max-w-prose">{t('audio.deleteNote')}</p>
                </div>
              ) : (
                <div className="border border-dashed border-hairline-strong dark:border-coal-600 rounded-md py-7 px-4 text-center">
                  <p className="microlabel mb-2.5">{t('audio.none')}</p>

                  {isTriggeringESP32 ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-center gap-2">
                        <span className="w-2.5 h-2.5 bg-med-500 rounded-full animate-ping" />
                        <span className="text-[13px] font-medium text-ink dark:text-chalk">
                          {t('audio.esp32Triggered')}
                        </span>
                      </div>
                      <p className="note">{captureMessage}</p>
                    </div>
                  ) : isBrowserRecording ? (
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-center gap-2">
                        <span className="w-2.5 h-2.5 bg-risk-high dark:bg-risk-highd rounded-full animate-pulse" />
                        <span className="text-[13px] font-medium text-risk-high dark:text-risk-highd tabular-nums">
                          {t('audio.recordingNow', { s: browserRecordTime })}
                        </span>
                      </div>
                      <p className="note-sm">{t('audio.recordingHint', { max: 10 })}</p>
                      <button
                        onClick={stopBrowserRecording}
                        className="btn-line !border-risk-high/50 !text-risk-high hover:!bg-risk-high/[0.06]
                                   dark:!border-risk-highd/50 dark:!text-risk-highd"
                      >
                        {t('audio.stopRecording')}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <p className="note max-w-sm mx-auto">{t('audio.noneDetail')}</p>
                      <div className="flex flex-wrap justify-center gap-3">
                        <button
                          onClick={triggerESP32Record}
                          disabled={uploadState.busy}
                          className="btn-line hover:border-med-500 hover:text-med-600 dark:hover:text-med-300 disabled:opacity-50"
                        >
                          <Mic className="w-3 h-3" /> {t('audio.useEsp32')}
                        </button>
                        <button
                          onClick={startBrowserRecording}
                          disabled={uploadState.busy}
                          className="btn-line hover:border-med-500 hover:text-med-600 dark:hover:text-med-300 disabled:opacity-50"
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
                        <p className="note !text-med-700 dark:!text-med-300">{uploadState.message}</p>
                      )}
                      {uploadState.error && (
                        <p className="note !text-risk-high dark:!text-risk-highd max-w-md mx-auto">
                          {uploadState.error}
                        </p>
                      )}

                      <p className="note-sm max-w-md mx-auto">{t('audio.uploadHint')}</p>
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
          <p className="note border-t border-hairline dark:border-coal-700 pt-3 max-w-prose">
            {t('disclaimer')}
          </p>

          {/* Colophon */}
          <p className="microlabel text-center pb-2 print-hidden">
            {t('colophon')}
          </p>
        </section>

        {/* Print-only signature block */}
        <div className="hidden print-footer lg:col-span-3" style={{ display: 'none' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '40px', marginTop: '24px' }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: '9pt', color: '#4a4a4a', marginBottom: '32px' }}>Reviewed by:</p>
              <div style={{ borderTop: '1px solid #999', paddingTop: '4px' }}>
                <p style={{ fontSize: '9pt' }}>Physician name &amp; signature</p>
                <p style={{ fontSize: '8pt', color: '#5c5c5c' }}>Date: _____ / _____ / _____</p>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: '9pt', color: '#4a4a4a', marginBottom: '32px' }}>Nurse/Staff:</p>
              <div style={{ borderTop: '1px solid #999', paddingTop: '4px' }}>
                <p style={{ fontSize: '9pt' }}>Name &amp; signature</p>
                <p style={{ fontSize: '8pt', color: '#5c5c5c' }}>Station: _____________</p>
              </div>
            </div>
          </div>
          <p style={{ fontSize: '8pt', color: '#5c5c5c', textAlign: 'center', marginTop: '16px' }}>
            WellSim Clinical Triage System — AI screening results require physician verification before clinical action.
          </p>
        </div>
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
