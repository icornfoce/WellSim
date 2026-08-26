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
  Printer,
  RefreshCw,
  Search,
  Check,
  Plus,
  Pencil,
  Trash2,
  X,
  Clock,
  ShieldCheck,
  Upload,
  Mic,
  Laptop,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react';
import { useDeviceData } from '../hooks/useDeviceData';
import RouteGuard from '../components/RouteGuard';
import PatientFormModal from '../components/PatientFormModal';
import AIAnalysisPanel from '../components/AIAnalysisPanel';
import TopBar, { TelemetryStrip } from '../components/TopBar';
import LoadingScreen from '../components/ui/LoadingScreen';
import SectionHead from '../components/ui/SectionHead';
import AudioPlayer from '../components/AudioPlayer';
import AudioTypeTabs from '../components/AudioTypeTabs';
import VitalsGrid, { summariseVitals } from '../components/vitals/VitalsGrid';
import LabResultChart from '../components/LabResultChart';
import LabResultBadge from '../components/LabResultBadge';
import { useAudioPlayback } from '../hooks/useAudioPlayback';
import { AUDIO_TYPES, resolveAudioUrl } from '../lib/audioTypes';
import { useToast } from '../components/ui/Toast';
import { useConfirm } from '../components/ui/ConfirmDialog';
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
  updatePatientVitals as apiUpdatePatientVitals,
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
const NO_AUDIO_LOGS = Object.fromEntries(
  AUDIO_TYPES.map((type) => [type, { available: false, status: 'Not recorded', duration: '0:00' }])
);

export default function Page() {
  return (
    <RouteGuard>
      <Dashboard />
    </RouteGuard>
  );
}

function Dashboard() {
  const router = useRouter();
  const { deviceStatus } = useDeviceData();
  const { t, lang } = useLang();
  const { toast } = useToast();
  const confirm = useConfirm();
  // Dates and clocks follow the language toggle. They used to be pinned
  // to 'en-US', so the Thai UI still printed "Mon, Aug 24" and a 12-hour
  // clock next to Thai labels.
  const locale = lang === 'th' ? 'th-TH' : 'en-GB';
  // Translate known demo/backend data strings when viewing in Thai
  const td = (text) => (lang === 'th' && dataDictionaryTH[text]) || text;
  const [user, setUser] = useState(null);
  const [patients, setPatients] = useState([]);
  const [patientsLoaded, setPatientsLoaded] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState(null);
  const [activeAudioTab, setActiveAudioTab] = useState('lung'); // lung, heart, cough
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

  /**
   * Which of the two panes a phone is looking at.
   *
   * Below `lg` the queue and the record used to stack, with the queue
   * pinned to a full viewport height and scrolling inside itself. That
   * put the patient's record a screen and a half below the fold behind
   * a scroll trap, and tapping a name in the queue produced no visible
   * result — the record it opened was off-screen. One pane at a time,
   * with an explicit way back, is what that layout actually wanted.
   * From `lg` up both panes are shown and this state is ignored.
   */
  const [mobileView, setMobileView] = useState('queue');

  /** Select a patient, and on a phone move to their record. */
  const openPatient = useCallback((id) => {
    setSelectedPatientId(id);
    setMobileView('record');
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  // Collapsible section states
  const [demographicsCollapsed, setDemographicsCollapsed] = useState(false);
  const [vitalsCollapsed, setVitalsCollapsed] = useState(false);
  const [audioSectionCollapsed, setAudioSectionCollapsed] = useState(false);
  const [labResultCollapsed, setLabResultCollapsed] = useState(false);
  const [aiPanelCollapsed, setAiPanelCollapsed] = useState(false);
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
      if (res.analysis?.status !== 'error') {
        toast(t('toast.analysisDone'), { tone: 'success' });
      }
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
      toast(t('toast.reviewSaved'), { tone: 'success' });
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

  /**
   * Playback of the selected recording.
   *
   * The element, pause/resume, seeking and the elapsed clock all live
   * in useAudioPlayback, which the patient portal shares. Both screens
   * used to keep their own copy, and both copies rebuilt the Audio
   * element on every press of play — so pausing and resuming restarted
   * the recording from zero.
   */
  const currentAudioUrl = resolveAudioUrl(API_URL, patient?.audioLogs?.[activeAudioTab]);
  const player = useAudioPlayback({ url: currentAudioUrl, t });

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

    const ok = await confirm({
      title: wasSigned ? t('confirm.audioSignedTitle') : t('confirm.audioTitle'),
      body: wasSigned
        ? t('audio.confirmDeleteSigned', { doctor: signed.doctorName || '—' })
        : t('audio.confirmDelete'),
      confirmLabel: t('common.delete'),
      tone: 'danger',
    });
    if (!ok) return;

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
      player.stop();
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

  // Clean up recording and the device poll on unmount. Playback is
  // released by useAudioPlayback.
  useEffect(() => {
    return () => {
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
    setIsEditing(false);
    setAiPanelCollapsed(false);
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
      <LoadingScreen label={t('common.loading')} />
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
      // Only send fields that hold something. An emptied input used to
      // arrive at the API as 0 and be stored as a real measurement.
      const payload = {};
      for (const [key, raw] of Object.entries(editedVitals)) {
        if (raw === '' || raw === null || raw === undefined) continue;
        const n = Number(raw);
        if (Number.isFinite(n) && n >= 0) payload[key] = n;
      }
      const res = await apiUpdatePatientVitals(patient.id, payload);
      if (res.success && res.patient) {
        // Update local state with backend response
        setPatients(prev => prev.map(p => {
          if (p.id === res.patient.id) {
            return { ...p, ...res.patient, audioLogs: p.audioLogs };
          }
          return p;
        }));
      }
      toast(t('toast.vitalsSaved'), { tone: 'success' });
      setIsEditing(false);
    } catch (err) {
      console.error('Failed to save vitals:', err.message);
      // Stay in edit mode on failure: dropping back to the read-only
      // view after a failed save shows the old numbers and reads as if
      // the save had worked.
      toast(t('toast.vitalsFailed'), { tone: 'error' });
    }
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
          toast(t('toast.patientCreated', { name: res.patient.name }), { tone: 'success' });
        }
      } else {
        const res = await apiUpdatePatient(patient.id, payload);
        if (res.success && res.patient) {
          setPatients((prev) =>
            prev.map((p) =>
              p.id === res.patient.id ? { ...p, ...res.patient, audioLogs: p.audioLogs } : p
            )
          );
          toast(t('toast.patientUpdated', { name: res.patient.name }), { tone: 'success' });
        }
      }
      setModalOpen(false);
    } catch (err) {
      console.error('Failed to save patient:', err.message);
      // The modal stays open so the typed record is not lost.
      toast(t('toast.patientSaveFailed', { reason: err.message }), { tone: 'error' });
    } finally {
      setModalSubmitting(false);
    }
  };

  const handleDeletePatient = async () => {
    if (!patient) return;
    const deletedName = patient.name;
    const ok = await confirm({
      title: t('confirm.deleteTitle'),
      body: t('confirm.deleteBody', { name: deletedName }),
      detail: t('confirm.deleteDetail'),
      confirmLabel: t('common.delete'),
      tone: 'danger',
    });
    if (!ok) return;

    const deletedId = patient.id;
    try {
      const res = await apiDeletePatient(deletedId);
      if (res.success) {
        const remaining = patients.filter((p) => p.id !== deletedId);
        setPatients(remaining);
        setSelectedPatientId(remaining.length ? remaining[0].id : null);
        toast(t('toast.patientDeleted', { name: deletedName }), { tone: 'success' });
      }
    } catch (err) {
      console.error('Failed to delete patient:', err.message);
      toast(t('toast.patientDeleteFailed', { reason: err.message }), { tone: 'error' });
    }
  };

  // Empty state — no patients in the queue (e.g. after deleting them all)
  if (!patient) {
    return (
      <div className="min-h-screen bg-paper dark:bg-coal-950 flex flex-col font-sans transition-colors duration-300">
        <TopBar
          kicker="Triage / v2"
          telemetry={
            <TelemetryStrip
              deviceStatus={deviceStatus}
              currentTime={currentTime}
              locale={locale}
              lang={lang}
              t={t}
            />
          }
          deviceStatus={deviceStatus}
          user={user}
          showRole
          onLogout={onLogout}
          t={t}
        />

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
      <TopBar
        kicker="Triage / v2"
        telemetry={
          <TelemetryStrip
            deviceStatus={deviceStatus}
            currentTime={currentTime}
            locale={locale}
            lang={lang}
            t={t}
          />
        }
        deviceStatus={deviceStatus}
        user={user}
        showRole
        onPrint={() => window.print()}
        onLogout={onLogout}
        t={t}
      />

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
        <section
          className={`lg:col-span-1 will-fade-up ${mobileView === 'record' ? 'hidden lg:block' : 'block'}`}
          aria-label={t('a11y.patientQueue')}
        >
          {/* 100dvh, not 100vh: on mobile Safari and Chrome, 100vh is
              the height with the address bar hidden, so the last row of
              the queue sat underneath it. */}
          <div className="card overflow-hidden flex flex-col h-[calc(100dvh-9rem)] lg:h-[calc(100dvh-10.5rem)] lg:min-h-[500px]">

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
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('queue.search')}
                  aria-label={t('queue.search')}
                  className="field !pl-9 !pr-8 !py-1.5 !text-[13px]
                             [&::-webkit-search-cancel-button]:appearance-none"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-ink dark:hover:text-chalk"
                    aria-label={t('a11y.clearSearch')}
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
                    onClick={() => openPatient(item.id)}
                    aria-current={isSelected ? 'true' : undefined}
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
        <section
          className={`lg:col-span-2 flex flex-col gap-5 ${mobileView === 'queue' ? 'hidden lg:flex' : 'flex'}`}
          aria-label={t('a11y.patientRecord')}
        >
          {/* Back to queue button on mobile */}
          <div className="lg:hidden">
            <button
              onClick={() => setMobileView('queue')}
              className="btn-line !py-1.5 !px-3 text-xs flex items-center gap-1.5"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>{t('queue.backToQueue')}</span>
            </button>
          </div>

          {/* 01. Identity & Demographics */}
          <div className="card p-5 will-fade-up animate-delay-100">
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-med-600 dark:text-med-300">
                  {t('record.active')} / {patient.id.toUpperCase()}
                </p>
                <h1 className="text-[28px] font-light tracking-tight text-ink dark:text-chalk mt-1 leading-tight">
                  {patient.name}
                </h1>
                {/* Status strip — triage chip + quick stats */}
                <div className="flex flex-wrap items-center gap-2 mt-2.5">
                  {/* Triage chip */}
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-semibold font-mono border ${
                    patient.riskStatus === 'high'
                      ? 'bg-risk-high/[0.07] text-risk-high dark:text-risk-highd border-risk-high/30 dark:border-risk-highd/30 dark:bg-risk-highd/[0.09]'
                      : patient.riskStatus === 'moderate'
                        ? 'bg-risk-mod/[0.07] text-risk-mod dark:text-risk-modd border-risk-mod/30 dark:border-risk-modd/30 dark:bg-risk-modd/[0.09]'
                        : patient.riskStatus === 'low'
                          ? 'bg-risk-low/[0.07] text-risk-low dark:text-risk-lowd border-risk-low/30 dark:border-risk-lowd/30 dark:bg-risk-lowd/[0.09]'
                          : 'bg-paper dark:bg-coal-800 text-muted dark:text-chalk-muted border-hairline dark:border-coal-700'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-[1px] ${risk.dot} ${patient.riskStatus === 'high' ? 'animate-blink' : ''}`} />
                    {risk.label}
                  </span>
                  {/* Check-in time */}
                  <span className="datum flex items-center gap-1.5">
                    <Clock className="w-3 h-3" />
                    {patient.checkInTime || '—'}
                  </span>
                  {/* Recording count */}
                  {(() => {
                    const recorded = ['lung', 'heart', 'cough'].filter(k => patient?.audioLogs?.[k]?.available).length;
                    return (
                      <span className="datum">
                        {recorded}/3 {t('audio.title').toLowerCase()}
                      </span>
                    );
                  })()}
                  {/* Pending review indicator */}
                  {(patient.reviewSummary?.pending || 0) > 0 && (
                    <span className="inline-flex items-center gap-1 font-mono text-[11px] text-risk-mod dark:text-risk-modd">
                      <Clock className="w-3 h-3" />
                      {t('queue.pendingReview', { n: patient.reviewSummary.pending })}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button onClick={openEditModal} className="btn-line !py-1.5" title={t('record.editTitle')}>
                  <Pencil className="w-3 h-3" /> {t('common.edit')}
                </button>
                <button
                  onClick={handleDeletePatient}
                  title={t('record.deleteTitle')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded
                             border border-risk-high/40 text-risk-high hover:bg-risk-high/[0.06]
                             dark:border-risk-highd/40 dark:text-risk-highd dark:hover:bg-risk-highd/[0.08]
                             transition-colors duration-200 active:translate-y-px"
                >
                  <Trash2 className="w-3 h-3" /> {t('common.delete')}
                </button>
                <button
                  onClick={() => setDemographicsCollapsed(v => !v)}
                  className="shrink-0 flex items-center gap-1 font-mono text-[10px] text-muted dark:text-chalk-muted hover:text-ink dark:hover:text-chalk transition-colors duration-200 ml-1"
                  title={demographicsCollapsed ? 'Show demographics' : 'Collapse demographics'}
                >
                  {demographicsCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                  {demographicsCollapsed ? (lang === 'th' ? 'ขยาย' : 'Expand') : (lang === 'th' ? 'ย่อ' : 'Collapse')}
                </button>
              </div>
            </div>

            {/* Demographics — ruled table */}
            {!demographicsCollapsed && (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-px bg-hairline dark:bg-coal-700 border border-hairline dark:border-coal-700 rounded overflow-hidden mt-5 animate-fade-in">
                {[
                  { label: t('demo.age'), value: patient.age ?? '—', unit: patient.age != null ? t('demo.yrs') : '' },
                  { label: t('demo.gender'), value: ['male','female','other','unspecified'].includes(String(patient.gender || '').toLowerCase()) ? t('gender.' + String(patient.gender).toLowerCase()) : (patient.gender ?? '—'), unit: '' },
                  { label: t('demo.weight'), value: patient.weight ?? '—', unit: patient.weight != null ? 'kg' : '' },
                  { label: t('demo.height'), value: patient.height ?? '—', unit: patient.height != null ? 'cm' : '' },
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
            )}
          </div>

          {/* 02. Vitals & Data Fusion (ผลแล็บและการรวมข้อมูล) */}
          <div className="card p-5 will-fade-up animate-delay-200">
            <div className="flex items-center justify-between gap-3">
              <SectionHead index="02" title={t('vitals.title')}>
                {!vitalsCollapsed && (
                  isEditing ? (
                    <span className="flex gap-2">
                      <button onClick={() => setIsEditing(false)} className="btn-line !py-1.5">{t('common.cancel')}</button>
                      <button onClick={saveVitals} className="btn-ink !py-1.5">
                        <Check className="w-3 h-3" /> {t('common.save')}
                      </button>
                    </span>
                  ) : (
                    <button onClick={() => setIsEditing(true)} className="btn-line !py-1.5">{t('vitals.edit')}</button>
                  )
                )}
              </SectionHead>
              <button
                onClick={() => setVitalsCollapsed(v => !v)}
                className="shrink-0 flex items-center gap-1 font-mono text-[10px] text-muted dark:text-chalk-muted hover:text-ink dark:hover:text-chalk transition-colors duration-200 ml-2"
                title={vitalsCollapsed ? 'Show vitals section' : 'Collapse vitals section'}
              >
                {vitalsCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                {vitalsCollapsed ? (lang === 'th' ? 'ขยาย' : 'Expand') : (lang === 'th' ? 'ย่อ' : 'Collapse')}
              </button>
            </div>

            {!vitalsCollapsed && (
              <div className="mt-4 animate-fade-in">
                {/* Abnormal summary chip */}
                {!isEditing && (() => {
                  const { measured, abnormal } = summariseVitals(v);
                  if (measured === 0) return null;
                  return (
                    <div className={`mb-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border ${
                      abnormal > 0
                        ? 'bg-risk-mod/[0.07] text-risk-mod dark:text-risk-modd border-risk-mod/20 dark:border-risk-modd/25 dark:bg-risk-modd/[0.09]'
                        : 'bg-risk-low/[0.07] text-risk-low dark:text-risk-lowd border-risk-low/20 dark:border-risk-lowd/25 dark:bg-risk-lowd/[0.09]'
                    }`}>
                      {abnormal > 0
                        ? <><AlertTriangle className="w-3 h-3" /> {t('portal.vitalsAbnormal', { n: abnormal })}</>
                        : <><CheckCircle className="w-3 h-3" /> {t('portal.vitalsAllNormal')}</>
                      }
                    </div>
                  );
                })()}

                <VitalsGrid
                  vitals={v}
                  isEditing={isEditing}
                  edited={editedVitals}
                  onEdit={setEditedVitals}
                  t={t}
                >
                  {/* Reserved slot */}
                  <div className="bg-surface dark:bg-coal-900 p-4 flex flex-col items-center justify-center text-center">
                    <p className="microlabel">{t('vitals.reserved')}</p>
                    <p className="note-sm mt-1">{t('vitals.reservedNote')}</p>
                  </div>
                </VitalsGrid>
              </div>
            )}
          </div>

          {/* 03. Bio-acoustics (เสียงชีวภาพ) */}
          <div className="card p-5 will-fade-up animate-delay-300">
            <div className="flex items-center justify-between gap-3">
              <SectionHead index="03" title={t('audio.title')}>
                <AudioTypeTabs
                  active={activeAudioTab}
                  onChange={setActiveAudioTab}
                  audioLogs={patient?.audioLogs}
                  t={t}
                  gap="gap-2"
                />
              </SectionHead>
              <button
                onClick={() => setAudioSectionCollapsed(v => !v)}
                className="shrink-0 flex items-center gap-1 font-mono text-[10px] text-muted dark:text-chalk-muted hover:text-ink dark:hover:text-chalk transition-colors duration-200 ml-2"
                title={audioSectionCollapsed ? 'Show audio section' : 'Collapse audio section'}
              >
                {audioSectionCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                {audioSectionCollapsed ? (lang === 'th' ? 'ขยาย' : 'Expand') : (lang === 'th' ? 'ย่อ' : 'Collapse')}
              </button>
            </div>

            {!audioSectionCollapsed && (
              <div className="mt-4 animate-fade-in">
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

                    <AudioPlayer
                      player={player}
                      waveform={currentAnalysis?.waveform}
                      segments={currentAnalysis?.segments}
                      durationSec={currentAnalysis?.durationSec || 0}
                      t={t}
                    />

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
                  <div className="border border-dashed border-hairline-strong dark:border-coal-600 rounded-md py-6 px-4 text-center">
                    <p className="microlabel mb-2">{t('audio.none')}</p>
                    {isBrowserRecording ? (
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-center gap-2">
                          <span className="w-2.5 h-2.5 bg-risk-high dark:bg-risk-highd rounded-full animate-pulse" />
                          <span className="text-[13px] font-medium text-risk-high dark:text-risk-highd tabular-nums">
                            {t('audio.recordingNow', { s: browserRecordTime })}
                          </span>
                        </div>
                        <p className="note-sm">{t('audio.recordingHint', { max: 120 })}</p>
                        <button
                          onClick={stopBrowserRecording}
                          className="btn-line !border-risk-high/50 !text-risk-high hover:!bg-risk-high/[0.06] dark:!border-risk-highd/50 dark:!text-risk-highd"
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
                            disabled={isTriggeringESP32 || uploadState.busy}
                            className="btn-line hover:border-med-500 hover:text-med-500 disabled:opacity-50"
                            title={t('audio.useEsp32')}
                          >
                            <Laptop className="w-3.5 h-3.5" /> {t('audio.useEsp32')}
                          </button>
                          <button
                            onClick={startBrowserRecording}
                            disabled={isTriggeringESP32 || uploadState.busy}
                            className="btn-line hover:border-med-500 hover:text-med-500 disabled:opacity-50"
                          >
                            <Mic className="w-3.5 h-3.5" /> {t('audio.useBrowserMic')}
                          </button>
                          <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isTriggeringESP32 || uploadState.busy}
                            className="btn-ink disabled:opacity-50"
                          >
                            <Upload className="w-3.5 h-3.5" />
                            {uploadState.busy ? t('audio.uploading') : t('audio.uploadFile')}
                          </button>
                        </div>
                        {captureMessage && <p className="note-sm text-med-600 dark:text-med-300 mt-2">{captureMessage}</p>}
                        <p className="note-sm max-w-md mx-auto">{t('audio.uploadHint')}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 04. Lab Results & Data Integration (ผลแล็บและการรวมข้อมูล) */}
          <div className="card p-5 will-fade-up animate-delay-400">
            <div className="flex items-center justify-between gap-3">
              <SectionHead index="04" title={t('vitals.title')} />
              <button
                onClick={() => setLabResultCollapsed(v => !v)}
                className="shrink-0 flex items-center gap-1 font-mono text-[10px] text-muted dark:text-chalk-muted hover:text-ink dark:hover:text-chalk transition-colors duration-200 ml-2"
                title={labResultCollapsed ? 'Show lab results' : 'Collapse lab results'}
              >
                {labResultCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                {labResultCollapsed ? (lang === 'th' ? 'ขยาย' : 'Expand') : (lang === 'th' ? 'ย่อ' : 'Collapse')}
              </button>
            </div>
            {!labResultCollapsed && (
              <div className="mt-4 animate-fade-in">
                <LabResultBadge status="pending" label={t('tag.high') ? 'Verified' : 'Pending'} />
                <div className="mt-3">
                  <LabResultChart data={patient?.vitals || {}} />
                </div>
              </div>
            )}
          </div>

          {/* 05. AI Analysis & Screening Results by Physician (ผลคัดกรองและการตรวจสอบโดยแพทย์) */}
          <div className="card overflow-hidden will-fade-up animate-delay-400">
            <div className="p-5 flex items-center justify-between gap-3 border-b border-hairline dark:border-coal-700 bg-surface dark:bg-coal-900">
              <SectionHead index="05" title={t('ai.title')} />
              <div className="flex items-center gap-2">
                {!aiPanelCollapsed && (
                  <button
                    onClick={handleRunAnalysis}
                    disabled={analysisRunning || !patient?.audioLogs?.[activeAudioTab]?.available}
                    className="btn-ink !py-1 !px-2.5 text-xs flex items-center gap-1.5 disabled:opacity-40"
                  >
                    <RefreshCw className={`w-3 h-3 ${analysisRunning ? 'animate-spin' : ''}`} />
                    <span>{analysisRunning ? t('ai.running') : t('ai.runScreening')}</span>
                  </button>
                )}
                <button
                  onClick={() => setAiPanelCollapsed(v => !v)}
                  className="shrink-0 flex items-center gap-1 font-mono text-[10px] text-muted dark:text-chalk-muted hover:text-ink dark:hover:text-chalk transition-colors duration-200 ml-1"
                  title={aiPanelCollapsed ? 'Show AI panel' : 'Collapse AI panel'}
                >
                  {aiPanelCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                  {aiPanelCollapsed ? (lang === 'th' ? 'ขยาย' : 'Expand') : (lang === 'th' ? 'ย่อ' : 'Collapse')}
                </button>
              </div>
            </div>

            {/* Collapsed summary row — shows verdict, triage, confidence at a glance */}
            {aiPanelCollapsed && currentAnalysis && currentAnalysis.status !== 'error' && (
              <div className="p-4 flex flex-wrap items-center gap-3 animate-fade-in">
                {(() => {
                  const rev = currentAnalysis.review || { status: 'pending' };
                  const lbl = rev.finalLabel || currentAnalysis.label;
                  const tri = rev.finalTriage || currentAnalysis.triage?.level || 'green';
                  const conf = Math.round((currentAnalysis.confidence || 0) * 100);
                  const triColors = {
                    red: 'text-risk-high dark:text-risk-highd bg-risk-high/[0.06] border-risk-high/30',
                    yellow: 'text-risk-mod dark:text-risk-modd bg-risk-mod/[0.06] border-risk-mod/30',
                    green: 'text-risk-low dark:text-risk-lowd bg-risk-low/[0.06] border-risk-low/30',
                  };
                  const revColors = {
                    pending: 'text-muted dark:text-chalk-muted',
                    confirmed: 'text-med-600 dark:text-med-300',
                    modified: 'text-med-600 dark:text-med-300',
                    rejected: 'text-risk-high dark:text-risk-highd',
                  };
                  return (
                    <>
                      <span className="text-sm font-semibold text-ink dark:text-chalk">
                        {lbl ? lbl.replace(/_/g, ' ') : '—'}
                      </span>
                      <span className={`font-mono text-[11px] px-2 py-0.5 rounded border ${triColors[tri] || triColors.green}`}>
                        {t('triage.' + tri)}
                      </span>
                      <span className="font-mono text-[11px] text-muted dark:text-chalk-muted">
                        {t('ai.confidence')} {conf}%
                      </span>
                      <span className={`font-mono text-[11px] ${revColors[rev.status] || revColors.pending}`}>
                        {t('ai.status' + rev.status.charAt(0).toUpperCase() + rev.status.slice(1))}
                      </span>
                    </>
                  );
                })()}
              </div>
            )}
            {aiPanelCollapsed && !currentAnalysis && (
              <p className="p-4 note animate-fade-in">{t('ai.noResult')}</p>
            )}

            {/* Full panel — hidden when collapsed */}
            {!aiPanelCollapsed && (
              <div className="p-5 animate-fade-in">
                <AIAnalysisPanel
                  analysis={currentAnalysis}
                  type={activeAudioTab}
                  canReview={canReview}
                  running={analysisRunning}
                  progress={player.progress}
                  isDark={isDark}
                  onRun={handleRunAnalysis}
                  onReview={handleReview}
                  reviewSubmitting={reviewSubmitting}
                />

                {/* Print / export */}
                <div className="flex flex-col sm:flex-row gap-2 mt-5 pt-5 border-t border-hairline dark:border-coal-700 print-hidden">
                  <button onClick={() => window.print()} className="btn-line flex-1">
                    <Printer className="w-3.5 h-3.5" /> {t('actions.print')}
                  </button>
                </div>
              </div>
            )}
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
