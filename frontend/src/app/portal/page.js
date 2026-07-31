/**
 * WellSim — Patient Portal (UI v3 "Instrument")
 *
 * Read-only view where a patient sees their own triage record:
 * demographics, vitals, AI risk, and recordings. Anything not yet
 * measured shows "—"; recordings that don't exist say so plainly.
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, RefreshCw, Pencil, Check, Upload, Printer, Mic, Play, Pause, Trash2, Laptop } from 'lucide-react';
import ThemeToggle from '../../components/ThemeToggle';
import LangToggle from '../../components/LangToggle';
import { useLang } from '../../i18n/LanguageContext';
import { dataDictionaryTH } from '../../i18n/translations';
import {
  fetchMyRecord,
  updateMyRecord,
  uploadAudio as apiUploadAudio,
  deleteAudio as apiDeleteAudio,
  API_URL,
} from '../../services/api';
import { encodeWavFromBlob, formatDuration, ACCEPTED_AUDIO } from '../../lib/audioEncoder';

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

function TickBar({ value, min, max, okMin, okMax, tone = 'ok' }) {
  const clamp = (val, a, b) => Math.min(Math.max(Number(val) || 0, a), b);
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

export default function PortalPage() {
  const router = useRouter();
  const { t, lang } = useLang();
  const td = (text) => (lang === 'th' && dataDictionaryTH[text]) || text;
  const [user, setUser] = useState(null);
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Demographic edit state
  const [isEditingDemo, setIsEditingDemo] = useState(false);
  const [demoForm, setDemoForm] = useState({
    name: '',
    age: '',
    gender: 'Unspecified',
    weight: '',
    height: '',
  });
  const [savingDemo, setSavingDemo] = useState(false);
  const [demoErr, setDemoErr] = useState('');

  const startEditDemo = () => {
    if (!record) return;
    setDemoForm({
      name: record.name || '',
      age: record.age ?? '',
      gender: record.gender || 'Unspecified',
      weight: record.weight ?? '',
      height: record.height ?? '',
    });
    setDemoErr('');
    setIsEditingDemo(true);
  };

  const cancelEditDemo = () => {
    setIsEditingDemo(false);
    setDemoErr('');
  };

  const handleSaveDemo = async (e) => {
    e.preventDefault();
    if (!demoForm.name.trim()) {
      setDemoErr(lang === 'th' ? 'กรุณาระบุชื่อ-นามสกุล' : 'Name is required.');
      return;
    }
    setSavingDemo(true);
    setDemoErr('');
    try {
      const res = await updateMyRecord(demoForm);
      if (res.patient) {
        setRecord((prev) => ({ ...prev, ...res.patient }));
      }
      setIsEditingDemo(false);
    } catch (err) {
      setDemoErr(err.message || (lang === 'th' ? 'บันทึกข้อมูลไม่สำเร็จ' : 'Failed to update demographics.'));
    } finally {
      setSavingDemo(false);
    }
  };

  // Patient audio recording & playback states
  const [activeAudioTab, setActiveAudioTab] = useState('lung');
  const [isPlaying, setIsPlaying] = useState(false);
  const [playProgress, setPlayProgress] = useState(0);
  const [isBrowserRecording, setIsBrowserRecording] = useState(false);
  const [browserRecordTime, setBrowserRecordTime] = useState(0);
  const [uploadState, setUploadState] = useState({ busy: false, message: '', error: '' });
  const [deleting, setDeleting] = useState(false);

  const audioRef = React.useRef(null);
  const mediaRecorderRef = React.useRef(null);
  const audioChunksRef = React.useRef([]);
  const fileInputRef = React.useRef(null);

  useEffect(() => {
    let interval;
    if (isBrowserRecording) {
      interval = setInterval(() => {
        setBrowserRecordTime((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isBrowserRecording]);

  const handleTogglePlay = () => {
    const audioLog = record?.audioLogs?.[activeAudioTab];
    if (!audioLog || !audioLog.available) return;

    if (isPlaying) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
      setPlayProgress(0);

      if (audioLog.url) {
        const fullUrl = audioLog.url.startsWith('http')
          ? audioLog.url
          : `${API_URL}${audioLog.url}`;

        if (audioRef.current) {
          audioRef.current.pause();
        }

        const audio = new Audio(fullUrl);
        audio.crossOrigin = 'anonymous';
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
          audioRef.current = null;
          setIsPlaying(false);
        });

        audio.play().catch((err) => {
          console.error('Audio playback failed:', err);
          setIsPlaying(false);
        });
      }
    }
  };

  const startBrowserRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];

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
        stream.getTracks().forEach((track) => track.stop());

        try {
          setUploadState({ busy: true, message: lang === 'th' ? 'กำลังแปลงไฟล์เสียง…' : 'Converting recording…', error: '' });
          const wav = await encodeWavFromBlob(audioBlob);
          const mins = Math.floor(wav.durationSec / 60);
          const secs = Math.round(wav.durationSec % 60);

          const data = await apiUploadAudio({
            patientId: record.id,
            type: activeAudioTab,
            audioBase64: wav.base64,
            duration: `${mins}:${String(secs).padStart(2, '0')}`,
            deviceId: 'PATIENT-MIC',
          });

          if (data.success) {
            setUploadState({
              busy: false,
              message: lang === 'th' ? 'บันทึกและอัปโหลดเสียงสำเร็จ!' : 'Audio recorded and saved successfully!',
              error: '',
            });
            await load();
          } else {
            setUploadState({ busy: false, message: '', error: data.error || 'Failed to save audio' });
          }
        } catch (err) {
          setUploadState({ busy: false, message: '', error: err.message || 'Error processing audio recording.' });
        } finally {
          setIsBrowserRecording(false);
          setTimeout(() => setUploadState((s) => (s.busy ? s : { ...s, message: '' })), 5000);
        }
      };

      mediaRecorder.start(100);
      setIsBrowserRecording(true);
      setBrowserRecordTime(0);
    } catch (err) {
      setUploadState({
        busy: false,
        message: '',
        error: (lang === 'th' ? 'ไม่สามารถเข้าถึงไมโครโฟนได้: ' : 'Microphone access denied: ') + err.message,
      });
    }
  };

  const stopBrowserRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !record) return;

    setUploadState({ busy: true, message: lang === 'th' ? 'กำลังอัปโหลด…' : 'Uploading…', error: '' });

    try {
      const wav = await encodeWavFromBlob(file);
      await apiUploadAudio({
        patientId: record.id,
        type: activeAudioTab,
        audioBase64: wav.base64,
        duration: formatDuration(wav.durationSec),
        deviceId: 'PATIENT-PORTAL',
      });

      setUploadState({
        busy: false,
        message: lang === 'th' ? 'อัปโหลดไฟล์เสียงสำเร็จ!' : 'Upload successful!',
        error: '',
      });
      await load();
    } catch (err) {
      setUploadState({ busy: false, message: '', error: err.message || 'Failed to upload audio.' });
    } finally {
      setTimeout(() => setUploadState((s) => (s.busy ? s : { ...s, message: '' })), 5000);
    }
  };

  const handleDeleteAudio = async () => {
    if (!record) return;
    if (!window.confirm(lang === 'th' ? 'ต้องการลบไฟล์เสียงนี้ใช่หรือไม่?' : 'Delete this recording?')) return;

    setDeleting(true);
    try {
      await apiDeleteAudio(record.id, activeAudioTab);
      setIsPlaying(false);
      setPlayProgress(0);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      await load();
    } catch (err) {
      setUploadState({ busy: false, message: '', error: err.message || 'Failed to delete audio.' });
    } finally {
      setDeleting(false);
    }
  };

  // Guard: patients only
  useEffect(() => {
    const token = localStorage.getItem('wellsim_token');
    const userStr = localStorage.getItem('wellsim_user');
    if (!token || !userStr) {
      router.replace('/login');
      return;
    }
    try {
      const parsed = JSON.parse(userStr);
      if (parsed?.role !== 'patient') {
        router.replace('/');
        return;
      }
      setUser(parsed);
    } catch {
      router.replace('/login');
    }
  }, [router]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchMyRecord();
      setRecord(res.patient);
    } catch (err) {
      setError(err.message || t('portal.error'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  const onLogout = () => {
    localStorage.removeItem('wellsim_token');
    localStorage.removeItem('wellsim_user');
    router.replace('/login');
  };

  const has = (x) => x !== null && x !== undefined;
  const v = record?.vitals || {};

  const calculateBMI = (w, h) => {
    if (!w || !h) return '—';
    const m = h / 100;
    return (w / (m * m)).toFixed(1);
  };

  const getRisk = (status) => {
    switch (status) {
      case 'high': return { label: t('risk.high'), mark: '▲', text: 'text-risk-high dark:text-risk-highd', stroke: 'stroke-risk-high dark:stroke-risk-highd' };
      case 'moderate': return { label: t('risk.mod'), mark: '▲', text: 'text-risk-mod dark:text-risk-modd', stroke: 'stroke-risk-mod dark:stroke-risk-modd' };
      case 'low': return { label: t('risk.low'), mark: '', text: 'text-risk-low dark:text-risk-lowd', stroke: 'stroke-risk-low dark:stroke-risk-lowd' };
      default: return { label: t('risk.pending'), mark: '', text: 'text-muted dark:text-chalk-muted', stroke: 'stroke-hairline-strong dark:stroke-coal-600' };
    }
  };

  const risk = getRisk(record?.riskStatus);
  const isPending = !record?.riskStatus || record?.riskStatus === 'pending';
  const bmiValue = record ? calculateBMI(record.weight, record.height) : '—';

  const genderDisplay = (g) => {
    const key = String(g || '').toLowerCase();
    return ['male', 'female', 'other', 'unspecified'].includes(key) ? t('gender.' + key) : (g ?? '—');
  };

  // Vitals rows: value formatter + abnormal tone
  const vitalRows = [
    {
      label: t('vitals.spo2'), value: has(v.spo2) ? v.spo2 : null, unit: '%', ref: '95–100',
      bad: has(v.spo2) && v.spo2 < 95, mark: '▼', bar: has(v.spo2) ? { value: v.spo2, min: 85, max: 100, okMin: 95, okMax: 100, tone: v.spo2 < 95 ? 'bad' : 'ok' } : null
    },
    {
      label: t('vitals.hr'), value: has(v.heartRate) ? v.heartRate : null, unit: 'bpm', ref: '60–100',
      bad: has(v.heartRate) && v.heartRate > 100, mark: '▲', bar: has(v.heartRate) ? { value: v.heartRate, min: 40, max: 140, okMin: 60, okMax: 100, tone: v.heartRate > 100 ? 'bad' : 'ok' } : null
    },
    {
      label: t('vitals.bp'), value: has(v.systolicBP) ? `${v.systolicBP}/${has(v.diastolicBP) ? v.diastolicBP : '—'}` : null, unit: 'mmHg', ref: '<120/80',
      bad: has(v.systolicBP) && v.systolicBP > 140, mark: '▲', bar: has(v.systolicBP) ? { value: v.systolicBP, min: 80, max: 180, okMin: 90, okMax: 120, tone: v.systolicBP > 140 ? 'warn' : 'ok' } : null
    },
    {
      label: t('vitals.wbc'), value: has(v.wbc) ? v.wbc.toLocaleString() : null, unit: '/mcL', ref: '4,500–11,000',
      bad: has(v.wbc) && v.wbc > 11000, mark: '▲', bar: has(v.wbc) ? { value: v.wbc, min: 2000, max: 20000, okMin: 4500, okMax: 11000, tone: v.wbc > 11000 ? 'warn' : 'ok' } : null
    },
    {
      label: t('vitals.hgb'), value: has(v.hemoglobin) ? v.hemoglobin : null, unit: 'g/dL', ref: '12.0–17.5',
      bad: has(v.hemoglobin) && v.hemoglobin < 12, mark: '▼', bar: has(v.hemoglobin) ? { value: v.hemoglobin, min: 8, max: 20, okMin: 12, okMax: 17.5, tone: v.hemoglobin < 12 ? 'warn' : 'ok' } : null
    },
  ];

  const audioRows = ['lung', 'heart', 'cough'].map((key) => {
    const log = record?.audioLogs?.[key];
    return { key, label: t('audio.' + key), available: !!log?.available, duration: log?.duration };
  });

  if (!user || loading) {
    return (
      <div className="min-h-screen bg-paper dark:bg-coal-950 flex items-center justify-center transition-colors duration-300">
        <div className="text-center animate-fade-in">
          <div className="w-8 h-8 mx-auto rounded bg-ink dark:bg-chalk flex items-center justify-center">
            <PulseMark className="w-4 h-4 text-white dark:text-coal-950" />
          </div>
          <div className="relative w-40 h-px bg-hairline dark:bg-coal-700 mx-auto mt-6 overflow-hidden">
            <div className="absolute inset-y-0 w-12 bg-ink dark:bg-chalk animate-sweep" />
          </div>
          <p className="microlabel mt-4">{t('portal.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper dark:bg-coal-950 flex flex-col font-sans transition-colors duration-300">

      {/* Top bar */}
      <header className="sticky top-0 z-50 bg-surface/95 dark:bg-coal-900/95 backdrop-blur-sm border-b border-hairline dark:border-coal-700 px-4 sm:px-6 print-hidden">
        <div className="max-w-3xl mx-auto flex items-center justify-between h-14 gap-4">
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-7 h-7 rounded bg-ink dark:bg-chalk flex items-center justify-center">
              <PulseMark className="w-4 h-4 text-white dark:text-coal-950" />
            </div>
            <div className="flex items-baseline gap-2.5">
              <span className="text-[15px] font-semibold tracking-tight text-ink dark:text-chalk">WellSim</span>
              <span className="microlabel hidden sm:inline">{t('portal.kicker')}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <LangToggle />
            <ThemeToggle />
            <button
              onClick={() => window.print()}
              title={lang === 'th' ? 'พิมพ์รายงาน' : 'Print report'}
              className="w-7 h-7 rounded border border-hairline-strong dark:border-coal-600 flex items-center justify-center
                         text-muted hover:text-ink hover:border-ink/50
                         dark:text-chalk-muted dark:hover:text-chalk dark:hover:border-chalk/50
                         transition-colors duration-200"
            >
              <Printer className="w-3.5 h-3.5" />
            </button>
            <span className="w-px h-5 bg-hairline dark:bg-coal-700" />
            <p className="text-xs font-semibold text-ink dark:text-chalk hidden sm:block">{user?.name}</p>
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

      <main className="flex-1 max-w-3xl w-full mx-auto p-4 sm:p-6 flex flex-col gap-5">

        {/* Print-only letterhead */}
        <div className="hidden print-letterhead">
          <h1>WellSim — Patient Health Summary</h1>
          <p>AI-Assisted Respiratory &amp; Cardiovascular Screening · Printed {new Date().toLocaleDateString('en-GB')} {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</p>
        </div>

        {error && (
          <div className="border-l-2 border-risk-high dark:border-risk-highd bg-risk-high/[0.05] dark:bg-risk-highd/[0.07] px-3 py-2.5 animate-fade-in flex items-center justify-between gap-3">
            <p className="text-xs text-risk-high dark:text-risk-highd">{error}</p>
            <button onClick={load} className="btn-line !py-1 shrink-0">
              <RefreshCw className="w-3 h-3" /> {t('portal.refresh')}
            </button>
          </div>
        )}

        {record && (
          <>
            {/* Identity */}
            <div className="card p-5 will-fade-up">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-med-600 dark:text-med-300">
                    {t('portal.identity')} / {record.id.toUpperCase()}
                  </p>
                  <h1 className="text-[28px] font-light tracking-tight text-ink dark:text-chalk mt-1 leading-tight">
                    {record.name}
                  </h1>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <p className="microlabel">{t('portal.checkin')}</p>
                    <p className="font-mono text-xs text-ink dark:text-chalk mt-0.5 tabular-nums">{record.checkInTime || '—'}</p>
                  </div>
                  {!isEditingDemo && (
                    <button
                      onClick={startEditDemo}
                      className="btn-line !py-1 !px-2.5 flex items-center gap-1.5 text-xs ml-1"
                      title={lang === 'th' ? 'แก้ไขข้อมูลส่วนตัว' : 'Edit profile'}
                    >
                      <Pencil className="w-3 h-3" />
                      <span>{t('common.edit')}</span>
                    </button>
                  )}
                </div>
              </div>

              {isEditingDemo ? (
                <form onSubmit={handleSaveDemo} className="mt-5 pt-4 border-t border-hairline dark:border-coal-700 animate-fade-in flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-ink dark:text-chalk">
                      {lang === 'th' ? 'แก้ไขข้อมูลส่วนตัว' : 'Edit Personal Details'}
                    </h3>
                    <span className="font-mono text-[10px] text-muted dark:text-chalk-muted">
                      {lang === 'th' ? '(แก้ไขข้อมูลทั่วไปของผู้ป่วย)' : '(Demographics only)'}
                    </span>
                  </div>

                  {demoErr && (
                    <p className="text-xs text-risk-high dark:text-risk-highd bg-risk-high/10 p-2 rounded">{demoErr}</p>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="microlabel block mb-1">{t('modal.fullName')}</label>
                      <input
                        type="text"
                        value={demoForm.name}
                        onChange={(e) => setDemoForm({ ...demoForm, name: e.target.value })}
                        className="field w-full text-xs"
                        required
                      />
                    </div>
                    <div>
                      <label className="microlabel block mb-1">{t('modal.gender')}</label>
                      <select
                        value={demoForm.gender}
                        onChange={(e) => setDemoForm({ ...demoForm, gender: e.target.value })}
                        className="field w-full text-xs"
                      >
                        <option value="Male">{t('gender.male')}</option>
                        <option value="Female">{t('gender.female')}</option>
                        <option value="Other">{t('gender.other')}</option>
                        <option value="Unspecified">{t('gender.unspecified')}</option>
                      </select>
                    </div>
                    <div>
                      <label className="microlabel block mb-1">{t('modal.age')}</label>
                      <input
                        type="number"
                        min="0"
                        max="120"
                        onKeyDown={(e) => { if (e.key === '-' || e.key === 'e' || e.key === 'E') e.preventDefault(); }}
                        value={demoForm.age}
                        onChange={(e) => setDemoForm({ ...demoForm, age: String(e.target.value).replace(/[-eE]/g, '') })}
                        placeholder="yrs"
                        className="field w-full text-xs"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="microlabel block mb-1">{t('modal.weightKg')}</label>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          onKeyDown={(e) => { if (e.key === '-' || e.key === 'e' || e.key === 'E') e.preventDefault(); }}
                          value={demoForm.weight}
                          onChange={(e) => setDemoForm({ ...demoForm, weight: String(e.target.value).replace(/[-eE]/g, '') })}
                          placeholder="kg"
                          className="field w-full text-xs"
                        />
                      </div>
                      <div>
                        <label className="microlabel block mb-1">{t('modal.heightCm')}</label>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          onKeyDown={(e) => { if (e.key === '-' || e.key === 'e' || e.key === 'E') e.preventDefault(); }}
                          value={demoForm.height}
                          onChange={(e) => setDemoForm({ ...demoForm, height: String(e.target.value).replace(/[-eE]/g, '') })}
                          placeholder="cm"
                          className="field w-full text-xs"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 mt-1">
                    <button
                      type="button"
                      onClick={cancelEditDemo}
                      disabled={savingDemo}
                      className="btn-line !py-1.5 !px-3 text-xs"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      type="submit"
                      disabled={savingDemo}
                      className="btn-ink !py-1.5 !px-4 text-xs flex items-center gap-1.5"
                    >
                      {savingDemo ? t('modal.saving') : (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>{t('common.save')}</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-px bg-hairline dark:bg-coal-700 border border-hairline dark:border-coal-700 rounded overflow-hidden mt-5">
                  {[
                    { label: t('demo.age'), value: record.age ?? '—', unit: record.age != null ? t('demo.yrs') : '' },
                    { label: t('demo.gender'), value: genderDisplay(record.gender), unit: '' },
                    { label: t('demo.weight'), value: record.weight ?? '—', unit: record.weight != null ? 'kg' : '' },
                    { label: t('demo.height'), value: record.height ?? '—', unit: record.height != null ? 'cm' : '' },
                    { label: 'BMI', value: bmiValue, unit: '' },
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
              )}
            </div>

            {/* Vitals */}
            <div className="card p-5 will-fade-up animate-delay-100">
              <SectionHead index="01" title={t('vitals.title')} />
              <div className="grid grid-cols-2 md:grid-cols-3 gap-px bg-hairline dark:bg-coal-700 border border-hairline dark:border-coal-700 rounded overflow-hidden mt-4">
                {vitalRows.map((row) => (
                  <div key={row.label} className="bg-surface dark:bg-coal-900 p-4">
                    <div className="flex justify-between items-baseline">
                      <p className="microlabel">{row.label}</p>
                      {row.bad && (
                        <span className="font-mono text-[10px] text-risk-high dark:text-risk-highd">
                          {row.mark} {row.mark === '▲' ? t('tag.high') : t('tag.low')}
                        </span>
                      )}
                    </div>
                    <p className={`text-[26px] font-light leading-none tabular-nums mt-2.5 ${row.bad ? 'text-risk-high dark:text-risk-highd' : 'text-ink dark:text-chalk'
                      }`}>
                      {row.value ?? '—'}
                      {row.value != null && (
                        <span className="font-mono text-[11px] text-muted dark:text-chalk-muted ml-1.5">{row.unit}</span>
                      )}
                    </p>
                    {row.bar && <TickBar {...row.bar} />}
                    <p className="font-mono text-[10px] text-muted dark:text-chalk-muted mt-2">{t('vitals.ref')} {row.ref}</p>
                  </div>
                ))}
                <div className="bg-surface dark:bg-coal-900 p-4 flex flex-col items-center justify-center text-center">
                  <p className="font-mono text-[10px] text-muted/70 dark:text-chalk-muted/70 leading-relaxed">
                    {t('portal.vitalsNote')}
                  </p>
                </div>
              </div>
            </div>

            {/* AI risk + findings */}
            <div className="card p-5 will-fade-up animate-delay-200">
              <SectionHead index="02" title={t('ai.title')} />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center mt-5">
                <div className="flex flex-col items-center md:border-r border-hairline dark:border-coal-700 py-2">
                  <div className="relative w-32 h-32">
                    <svg viewBox="0 0 144 144" className="w-full h-full">
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
                          strokeDashoffset={2 * Math.PI * 54 * (1 - (isPending ? 0 : (record.riskScore || 0)) / 100)}
                          className={`${risk.stroke} transition-all duration-1000 ease-out`}
                          fill="transparent"
                        />
                      </g>
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-3xl font-light tabular-nums text-ink dark:text-chalk leading-none">
                        {isPending ? '—' : (
                          <>
                            {record.riskScore || 0}
                            <span className="font-mono text-sm text-muted dark:text-chalk-muted ml-0.5">%</span>
                          </>
                        )}
                      </span>
                      <span className="microlabel mt-1.5">{t('ai.probability')}</span>
                    </div>
                  </div>
                  <p className={`font-mono text-[11px] mt-3 ${risk.text}`}>
                    {risk.mark && <span className="mr-1">{risk.mark}</span>}{t('ai.riskLine', { label: risk.label })}
                  </p>
                </div>

                <div className="md:col-span-2">
                  <p className="microlabel">{t('ai.biomarkers')}</p>
                  {(record.findings || []).length > 0 ? (
                    <ul className="mt-2 divide-y divide-hairline dark:divide-coal-700">
                      {record.findings.map((finding, idx) => (
                        <li key={idx} className="flex items-start gap-3 py-2.5">
                          <span className="font-mono text-[10px] text-muted/70 dark:text-chalk-muted/70 w-5 shrink-0 pt-0.5">
                            {String(idx + 1).padStart(2, '0')}
                          </span>
                          <span className="text-xs leading-relaxed text-ink/90 dark:text-chalk/90">{td(finding)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="font-mono text-[10px] text-muted/70 dark:text-chalk-muted/70 mt-3">
                      {t('portal.findingsNone')}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Recordings — 3-type audio recording & playback */}
            <div className="card p-5 will-fade-up animate-delay-300">
              <SectionHead index="03" title={t('audio.title')}>
                <div className="flex gap-3">
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
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_AUDIO}
                  onChange={handleFileUpload}
                  className="hidden"
                />

                {record?.audioLogs?.[activeAudioTab]?.available ? (
                  <div>
                    <div className="flex items-center justify-between font-mono text-[10px] text-muted dark:text-chalk-muted">
                      <span className="truncate pr-4">
                        {t('audio.' + activeAudioTab)} · {record.audioLogs[activeAudioTab].status || t('audio.recorded')}
                      </span>
                      <span className="shrink-0">
                        {t('audio.dur')} {record.audioLogs[activeAudioTab].duration || '0:00'}
                      </span>
                    </div>

                    {/* Audio Player Box */}
                    <div className="mt-3 bg-ink dark:bg-coal-850 dark:border dark:border-coal-700 rounded-md p-4 flex items-center gap-4">
                      <button
                        onClick={handleTogglePlay}
                        className="w-10 h-10 rounded bg-med-500 hover:bg-med-400 text-white flex items-center justify-center flex-shrink-0 transition-colors duration-200 active:translate-y-px"
                      >
                        {isPlaying ? <Pause className="w-4 h-4 fill-white" /> : <Play className="w-4 h-4 fill-white ml-0.5" />}
                      </button>

                      <div className="relative flex-1 h-3 bg-white/20 dark:bg-coal-700 rounded overflow-hidden">
                        <div
                          className="absolute top-0 bottom-0 left-0 bg-med-400 transition-all duration-300"
                          style={{ width: `${playProgress}%` }}
                        />
                      </div>

                      <span className="font-mono text-[10px] text-white/60 tabular-nums w-9 text-right shrink-0">
                        {playProgress}%
                      </span>
                    </div>

                    {/* Controls for current recording */}
                    <div className="flex flex-wrap items-center gap-2 mt-3 print-hidden">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadState.busy || deleting || isBrowserRecording}
                        className="btn-line !py-1.5 disabled:opacity-50"
                      >
                        <Upload className="w-3 h-3" /> {t('audio.replace')}
                      </button>
                      <button
                        onClick={handleDeleteAudio}
                        disabled={uploadState.busy || deleting || isBrowserRecording}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-risk-high/40 text-risk-high hover:bg-risk-high/[0.06] dark:border-risk-highd/40 dark:text-risk-highd dark:hover:bg-risk-highd/[0.08] transition-colors duration-200 active:translate-y-px disabled:opacity-50"
                      >
                        <Trash2 className="w-3 h-3" /> {deleting ? t('audio.deleting') : t('audio.delete')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="border border-dashed border-hairline-strong dark:border-coal-600 rounded-md py-6 px-4 text-center">
                    <p className="microlabel mb-2">{t('audio.none')}</p>

                    {isBrowserRecording ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-center gap-2">
                          <span className="w-2.5 h-2.5 bg-risk-high rounded-full animate-pulse" />
                          <span className="font-mono text-xs text-risk-high">
                            {lang === 'th' ? `กำลังบันทึกเสียง (${browserRecordTime}s)` : `Recording audio... (${browserRecordTime}s)`}
                          </span>
                        </div>
                        <button
                          onClick={stopBrowserRecording}
                          className="btn-line border-risk-high text-risk-high hover:bg-risk-high/[0.05]"
                        >
                          {lang === 'th' ? 'หยุดการบันทึก' : 'Stop Recording'}
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <p className="font-mono text-[10px] text-muted/70 dark:text-chalk-muted/70">
                          {t('audio.noneDetail')}
                        </p>
                        <div className="flex flex-wrap justify-center gap-3">
                          <button
                            onClick={startBrowserRecording}
                            disabled={uploadState.busy}
                            className="btn-line hover:border-med-500 hover:text-med-500 disabled:opacity-50"
                          >
                            <Mic className="w-3.5 h-3.5" /> {t('audio.useBrowserMic')}
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

                        <p className="font-mono text-[10px] text-muted/60 dark:text-chalk-muted/60 leading-relaxed">
                          {t('audio.uploadHint')}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Status messages */}
                {uploadState.busy && (
                  <p className="mt-3 font-mono text-[10px] text-med-600 dark:text-med-300">
                    {uploadState.message}
                  </p>
                )}
                {!uploadState.busy && uploadState.message && (
                  <p className="mt-3 font-mono text-[10px] text-med-600 dark:text-med-300">
                    {uploadState.message}
                  </p>
                )}
                {uploadState.error && (
                  <p className="mt-3 font-mono text-[10px] text-risk-high dark:text-risk-highd">
                    {uploadState.error}
                  </p>
                )}

                {/* Summary Table of all 3 audio types */}
                <div className="mt-5 divide-y divide-hairline dark:divide-coal-700 border border-hairline dark:border-coal-700 rounded overflow-hidden">
                  {['lung', 'heart', 'cough'].map((key) => {
                    const log = record?.audioLogs?.[key];
                    const isTabActive = activeAudioTab === key;
                    return (
                      <div
                        key={key}
                        onClick={() => {
                          setActiveAudioTab(key);
                          setIsPlaying(false);
                          setPlayProgress(0);
                        }}
                        className={`flex items-center justify-between px-4 py-2.5 cursor-pointer transition-colors duration-150 ${
                          isTabActive ? 'bg-ink/[0.04] dark:bg-coal-800' : 'bg-surface dark:bg-coal-900 hover:bg-ink/[0.02]'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`w-1.5 h-1.5 rounded-full ${log?.available ? 'bg-med-500' : 'bg-muted/40'}`} />
                          <p className="text-xs font-medium text-ink dark:text-chalk capitalize">{t('audio.' + key)}</p>
                          {log?.available ? (
                            <p className="font-mono text-[10px] text-med-600 dark:text-med-300">
                              {t('audio.recorded')} · {log.duration}
                            </p>
                          ) : (
                            <p className="font-mono text-[10px] text-muted dark:text-chalk-muted">
                              {t('audio.notRecorded')}
                            </p>
                          )}
                        </div>
                        <span className="font-mono text-[10px] text-med-600 dark:text-med-300">
                          {isTabActive ? (lang === 'th' ? 'กำลังเลือก' : 'Active') : (lang === 'th' ? 'เลือก' : 'Select')}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <p className="font-mono text-[10px] text-muted/60 dark:text-chalk-muted/50 text-center uppercase tracking-[0.14em] pb-2 print-hidden">
              {t('colophon')}
            </p>
          </>
        )}

        {/* Print-only signature block */}
        <div className="hidden print-footer" style={{ display: 'none' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '40px', marginTop: '24px' }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: '9pt', color: '#666', marginBottom: '32px' }}>Reviewed by:</p>
              <div style={{ borderTop: '1px solid #999', paddingTop: '4px' }}>
                <p style={{ fontSize: '9pt' }}>Physician name &amp; signature</p>
                <p style={{ fontSize: '8pt', color: '#999' }}>Date: _____ / _____ / _____</p>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: '9pt', color: '#666', marginBottom: '32px' }}>Nurse/Staff:</p>
              <div style={{ borderTop: '1px solid #999', paddingTop: '4px' }}>
                <p style={{ fontSize: '9pt' }}>Name &amp; signature</p>
                <p style={{ fontSize: '8pt', color: '#999' }}>Station: _____________</p>
              </div>
            </div>
          </div>
          <p style={{ fontSize: '7pt', color: '#aaa', textAlign: 'center', marginTop: '16px' }}>
            WellSim Clinical Triage System — AI screening results require physician verification before clinical action.
          </p>
        </div>
      </main>
    </div>
  );
}
