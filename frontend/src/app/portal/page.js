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
import { RefreshCw, Pencil, Check, Upload, Mic, Trash2, CheckCircle, Clock, AlertTriangle, Info, ChevronDown, ChevronUp } from 'lucide-react';
import TopBar from '../../components/TopBar';
import LoadingScreen from '../../components/ui/LoadingScreen';
import SectionHead from '../../components/ui/SectionHead';
import AudioPlayer from '../../components/AudioPlayer';
import AudioTypeTabs from '../../components/AudioTypeTabs';
import VitalsGrid, { summariseVitals } from '../../components/vitals/VitalsGrid';
import { useAudioPlayback } from '../../hooks/useAudioPlayback';
import { AUDIO_TYPES, resolveAudioUrl } from '../../lib/audioTypes';
import { useLang } from '../../i18n/LanguageContext';
import { useToast } from '../../components/ui/Toast';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { dataDictionaryTH } from '../../i18n/translations';
import { clinicalLabel } from '../../i18n/clinicalLabels';
import {
  fetchMyRecord,
  updateMyRecord,
  uploadAudio as apiUploadAudio,
  deleteAudio as apiDeleteAudio,
  fetchMyAnalyses,
  API_URL,
} from '../../services/api';
import { encodeWavFromBlob, formatDuration, ACCEPTED_AUDIO } from '../../lib/audioEncoder';

export default function PortalPage() {
  const router = useRouter();
  const { t, lang } = useLang();
  const { toast } = useToast();
  const confirm = useConfirm();
  const locale = lang === 'th' ? 'th-TH' : 'en-GB';
  const td = (text) => (lang === 'th' && dataDictionaryTH[text]) || text;
  const [user, setUser] = useState(null);
  const [record, setRecord] = useState(null);
  const [analyses, setAnalyses] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Section collapse states
  const [demoCollapsed, setDemoCollapsed] = useState(false);
  const [vitalsCollapsed, setVitalsCollapsed] = useState(false);
  const [statusCollapsed, setStatusCollapsed] = useState(false);
  const [audioCollapsed, setAudioCollapsed] = useState(false);
  const [reviewCollapsed, setReviewCollapsed] = useState(false);

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
      setDemoErr(t('portal.nameRequired'));
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
      setDemoErr(err.message || t('portal.updateFailed'));
    } finally {
      setSavingDemo(false);
    }
  };

  // Patient audio recording & playback states
  const [activeAudioTab, setActiveAudioTab] = useState('lung');
  const [isBrowserRecording, setIsBrowserRecording] = useState(false);
  const [browserRecordTime, setBrowserRecordTime] = useState(0);
  const [uploadState, setUploadState] = useState({ busy: false, message: '', error: '' });
  const [deleting, setDeleting] = useState(false);

  /**
   * Playback of the selected recording — the same hook the clinician
   * dashboard uses. The portal used to carry its own copy of this
   * logic, which meant it also carried the same defect: pressing play
   * after a pause rebuilt the Audio element and restarted the
   * recording from zero.
   */
  const currentAudioUrl = resolveAudioUrl(API_URL, record?.audioLogs?.[activeAudioTab]);
  const player = useAudioPlayback({ url: currentAudioUrl, t });

  const mediaRecorderRef = React.useRef(null);
  const audioChunksRef = React.useRef([]);
  const fileInputRef = React.useRef(null);

  /** The dashboard caps a browser capture at 10 s; so does this. */
  const MAX_RECORD_SECONDS = 10;

  // Recording clock — and the automatic stop. Without the cap the
  // portal recorded until the patient thought to press stop, which
  // meant multi-minute uploads sent as one base64 string.
  useEffect(() => {
    if (!isBrowserRecording) return undefined;
    const interval = setInterval(() => {
      setBrowserRecordTime((prev) => {
        const next = prev + 1;
        if (next >= MAX_RECORD_SECONDS) stopBrowserRecording();
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isBrowserRecording]);

  // Leaving the portal must release the microphone. Playback is
  // released by useAudioPlayback.
  useEffect(() => {
    return () => {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    };
  }, []);

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
          setUploadState({ busy: true, message: t('audio.stepConverting'), error: '' });
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
            setUploadState({ busy: false, message: t('portal.audioSaved'), error: '' });
            await load();
          } else {
            setUploadState({ busy: false, message: '', error: data.error || t('audio.saveFailed') });
          }
        } catch (err) {
          setUploadState({ busy: false, message: '', error: err.message || t('audio.saveFailed') });
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
        error: t('audio.micDenied', { error: err.message }),
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

    setUploadState({ busy: true, message: t('audio.stepUploading'), error: '' });

    try {
      const wav = await encodeWavFromBlob(file);
      await apiUploadAudio({
        patientId: record.id,
        type: activeAudioTab,
        audioBase64: wav.base64,
        duration: formatDuration(wav.durationSec),
        deviceId: 'PATIENT-PORTAL',
      });

      setUploadState({ busy: false, message: t('portal.audioSaved'), error: '' });
      await load();
    } catch (err) {
      setUploadState({ busy: false, message: '', error: err.message || t('audio.saveFailed') });
    } finally {
      setTimeout(() => setUploadState((s) => (s.busy ? s : { ...s, message: '' })), 5000);
    }
  };

  const handleDeleteAudio = async () => {
    if (!record) return;
    const ok = await confirm({
      title: t('confirm.audioTitle'),
      body: t('audio.confirmDelete'),
      confirmLabel: t('common.delete'),
      tone: 'danger',
    });
    if (!ok) return;

    setDeleting(true);
    try {
      await apiDeleteAudio(record.id, activeAudioTab);
      player.stop();
      toast(t('toast.audioDeleted'), { tone: 'success' });
      await load();
    } catch (err) {
      setUploadState({ busy: false, message: '', error: err.message || t('audio.saveFailed') });
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
      const [recRes, anRes] = await Promise.all([
        fetchMyRecord(),
        fetchMyAnalyses().catch(() => ({ analyses: {} })),
      ]);
      setRecord(recRes.patient);
      setAnalyses(anRes.analyses || {});
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

  // The reference bands and the "which way is abnormal" rules used to
  // be written out again here, separately from the dashboard's copy.
  // Both screens now read them from components/vitals/VitalsGrid, so a
  // threshold cannot be changed for the doctor and not for the patient.
  const vitalsSummary = summariseVitals(v);

  const audioRows = AUDIO_TYPES.map((key) => {
    const log = record?.audioLogs?.[key];
    return { key, label: t('audio.' + key), available: !!log?.available, duration: log?.duration };
  });

  if (!user || loading) {
    return (
      <LoadingScreen label={t('portal.loading')} />
    );
  }

  return (
    <div className="min-h-screen bg-paper dark:bg-coal-950 flex flex-col font-sans transition-colors duration-300">

      {/* Top bar */}
      <TopBar
        kicker={t('portal.kicker')}
        width="max-w-3xl"
        user={user}
        onPrint={() => window.print()}
        onLogout={onLogout}
        t={t}
      />

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
            {/* Identity & Demographics */}
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
                      title={t('portal.editProfile')}
                    >
                      <Pencil className="w-3 h-3" />
                      <span>{t('common.edit')}</span>
                    </button>
                  )}
                  <button
                    onClick={() => setDemoCollapsed(v => !v)}
                    className="shrink-0 flex items-center gap-1 font-mono text-[10px] text-muted dark:text-chalk-muted hover:text-ink dark:hover:text-chalk transition-colors duration-200 ml-1"
                    title={demoCollapsed ? 'Show profile' : 'Collapse profile'}
                  >
                    {demoCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                    {demoCollapsed ? (lang === 'th' ? 'ขยาย' : 'Expand') : (lang === 'th' ? 'ย่อ' : 'Collapse')}
                  </button>
                </div>
              </div>

              {!demoCollapsed && (
                isEditingDemo ? (
                  <form onSubmit={handleSaveDemo} className="mt-5 pt-4 border-t border-hairline dark:border-coal-700 animate-fade-in flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-[13px] font-semibold text-ink dark:text-chalk">
                        {t('portal.editProfile')}
                      </h3>
                      <span className="note-sm">{t('portal.editProfileScope')}</span>
                    </div>

                    {demoErr && (
                      <p role="alert" className="text-xs text-risk-high dark:text-risk-highd bg-risk-high/10 p-2 rounded">{demoErr}</p>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="portal-name" className="microlabel block mb-1">{t('modal.fullName')}</label>
                        <input
                          id="portal-name"
                          name="name"
                          type="text"
                          autoComplete="name"
                          value={demoForm.name}
                          onChange={(e) => setDemoForm({ ...demoForm, name: e.target.value })}
                          className="field w-full text-xs"
                          required
                        />
                      </div>
                      <div>
                        <label htmlFor="portal-gender" className="microlabel block mb-1">{t('modal.gender')}</label>
                        <select
                          id="portal-gender"
                          name="gender"
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
                        <label htmlFor="portal-age" className="microlabel block mb-1">{t('modal.age')}</label>
                        <input
                          id="portal-age"
                          name="age"
                          type="number"
                          inputMode="numeric"
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
                          <label htmlFor="portal-weight" className="microlabel block mb-1">{t('modal.weightKg')}</label>
                          <input
                            id="portal-weight"
                            name="weight"
                            type="number"
                            inputMode="decimal"
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
                          <label htmlFor="portal-height" className="microlabel block mb-1">{t('modal.heightCm')}</label>
                          <input
                            id="portal-height"
                            name="height"
                            type="number"
                            inputMode="decimal"
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
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-px bg-hairline dark:bg-coal-700 border border-hairline dark:border-coal-700 rounded overflow-hidden mt-5 animate-fade-in">
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
                          {unit && <span className="font-mono text-[11px] text-muted dark:text-chalk-muted ml-1.5">{unit}</span>}
                        </p>
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>

            {/* 01. Vitals & Lab Results (ผลแล็บและการรวมข้อมูล) */}
            <div className="card p-5 will-fade-up animate-delay-100">
              <div className="flex items-center justify-between gap-3">
                <SectionHead index="01" title={t('vitals.title')} />
                <button
                  onClick={() => setVitalsCollapsed(v => !v)}
                  className="shrink-0 flex items-center gap-1 font-mono text-[10px] text-muted dark:text-chalk-muted hover:text-ink dark:hover:text-chalk transition-colors duration-200 ml-2"
                  title={vitalsCollapsed ? 'Show vitals' : 'Collapse vitals'}
                >
                  {vitalsCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                  {vitalsCollapsed ? (lang === 'th' ? 'ขยาย' : 'Expand') : (lang === 'th' ? 'ย่อ' : 'Collapse')}
                </button>
              </div>

              {!vitalsCollapsed && (
                <div className="mt-4 animate-fade-in">
                  {/* Abnormal count summary */}
                  {vitalsSummary.measured === 0 ? (
                    <p className="note">{t('portal.vitalsNone')}</p>
                  ) : (
                    <div className={`mb-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
                      vitalsSummary.abnormal > 0
                        ? 'bg-risk-mod/[0.08] dark:bg-risk-modd/[0.10] text-risk-mod dark:text-risk-modd border border-risk-mod/20 dark:border-risk-modd/25'
                        : 'bg-risk-low/[0.07] dark:bg-risk-lowd/[0.09] text-risk-low dark:text-risk-lowd border border-risk-low/20 dark:border-risk-lowd/25'
                    }`}>
                      {vitalsSummary.abnormal > 0 ? (
                        <><AlertTriangle className="w-3.5 h-3.5" /> {t('portal.vitalsAbnormal', { n: vitalsSummary.abnormal })}</>
                      ) : (
                        <><CheckCircle className="w-3.5 h-3.5" /> {t('portal.vitalsAllNormal')}</>
                      )}
                    </div>
                  )}

                  <VitalsGrid vitals={v} t={t} idPrefix="portal-vitals">
                    <div className="bg-surface dark:bg-coal-900 p-4 flex flex-col items-center justify-center text-center">
                      <p className="note-sm">{t('portal.vitalsNote')}</p>
                    </div>
                  </VitalsGrid>
                </div>
              )}
            </div>

            {/* 02. Overall screening status (สถานะการคัดกรองของคุณ) */}
            <div className="card p-5 will-fade-up animate-delay-200">
              <div className="flex items-center justify-between gap-3">
                <SectionHead index="02" title={t('portal.statusHeading')} />
                <button
                  onClick={() => setStatusCollapsed(v => !v)}
                  className="shrink-0 flex items-center gap-1 font-mono text-[10px] text-muted dark:text-chalk-muted hover:text-ink dark:hover:text-chalk transition-colors duration-200 ml-2"
                  title={statusCollapsed ? 'Show status' : 'Collapse status'}
                >
                  {statusCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                  {statusCollapsed ? (lang === 'th' ? 'ขยาย' : 'Expand') : (lang === 'th' ? 'ย่อ' : 'Collapse')}
                </button>
              </div>

              {!statusCollapsed && (
                <div className="mt-4 animate-fade-in">
                  {(() => {
                    const hasAny = Object.keys(analyses).length > 0;
                    const anyUnsigned = Object.values(analyses).some(a => a?.review?.status === 'pending' || !a?.review);
                    const allSigned = hasAny && !anyUnsigned;
                    const hasUrgent = record?.riskStatus === 'high' || Object.values(analyses).some(a => {
                      const triage = a?.review?.finalTriage || a?.triage?.level;
                      return triage === 'red';
                    });
                    const hasPending = hasAny && anyUnsigned;

                    let icon, heading, detail, stripCls, iconCls;
                    if (hasUrgent && allSigned) {
                      icon = <AlertTriangle className={`w-5 h-5 shrink-0 ${iconCls}`} />;
                      heading = t('portal.statusUrgent');
                      detail = t('portal.statusUrgentDetail');
                      stripCls = 'bg-risk-high/[0.06] dark:bg-risk-highd/[0.08] border-risk-high/30 dark:border-risk-highd/30';
                      iconCls = 'text-risk-high dark:text-risk-highd';
                    } else if (allSigned) {
                      icon = <CheckCircle className="w-5 h-5 shrink-0 text-risk-low dark:text-risk-lowd" />;
                      heading = t('portal.statusReviewed');
                      detail = t('portal.statusReviewedDetail');
                      stripCls = 'bg-risk-low/[0.05] dark:bg-risk-lowd/[0.07] border-risk-low/30 dark:border-risk-lowd/30';
                      iconCls = 'text-risk-low dark:text-risk-lowd';
                    } else if (hasPending) {
                      icon = <Clock className="w-5 h-5 shrink-0 text-risk-mod dark:text-risk-modd animate-blink" />;
                      heading = t('portal.statusPending');
                      detail = t('portal.statusPendingDetail');
                      stripCls = 'bg-risk-mod/[0.05] dark:bg-risk-modd/[0.07] border-risk-mod/30 dark:border-risk-modd/30';
                      iconCls = 'text-risk-mod dark:text-risk-modd';
                    } else {
                      icon = <Info className="w-5 h-5 shrink-0 text-muted dark:text-chalk-muted" />;
                      heading = t('portal.statusNotScreened');
                      detail = t('portal.statusNotScreenedDetail');
                      stripCls = 'bg-paper dark:bg-coal-900 border-hairline dark:border-coal-700';
                      iconCls = 'text-muted dark:text-chalk-muted';
                    }

                    return (
                      <div className={`flex items-start gap-4 rounded-md border p-4 ${stripCls}`}>
                        <div className="mt-0.5 shrink-0">{icon}</div>
                        <div className="min-w-0">
                          <p className="text-[15px] font-semibold text-ink dark:text-chalk leading-snug">{heading}</p>
                          <p className="note mt-1 leading-relaxed">{detail}</p>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Risk gauge row */}
                  {record && (
                    <div className="mt-4 pt-4 border-t border-hairline dark:border-coal-700 grid grid-cols-1 md:grid-cols-3 gap-5 items-start">
                      {/* Mini gauge */}
                      <div className="flex flex-col items-center py-1 md:border-r border-hairline dark:border-coal-700">
                        <div className="relative w-20 h-20">
                          <svg viewBox="0 0 144 144" className="w-full h-full">
                            {Array.from({ length: 24 }).map((_, i) => (
                              <line key={i} x1="72" y1="4" x2="72" y2={i % 6 === 0 ? '10' : '7'}
                                transform={`rotate(${i * 15} 72 72)`}
                                className="stroke-hairline-strong dark:stroke-coal-600" strokeWidth="1" />
                            ))}
                            <g transform="rotate(-90 72 72)">
                              <circle cx="72" cy="72" r="54" strokeWidth="4"
                                className="stroke-hairline dark:stroke-coal-700" fill="transparent" />
                              <circle cx="72" cy="72" r="54" strokeWidth="4"
                                strokeDasharray={2 * Math.PI * 54}
                                strokeDashoffset={2 * Math.PI * 54 * (1 - (isPending ? 0 : (record.riskScore || 0)) / 100)}
                                className={`${risk.stroke} transition-all duration-1000 ease-out`}
                                fill="transparent" />
                            </g>
                          </svg>
                          <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-xl font-light tabular-nums text-ink dark:text-chalk leading-none">
                              {isPending ? '—' : `${record.riskScore || 0}`}
                            </span>
                            <span className="font-mono text-[9px] uppercase tracking-wider text-muted dark:text-chalk-muted mt-0.5">%</span>
                          </div>
                        </div>
                        <p className={`font-mono text-[10px] mt-1.5 text-center ${risk.text}`}>
                          {risk.mark && <span className="mr-1">{risk.mark}</span>}
                          {t('ai.riskLine', { label: risk.label })}
                        </p>
                        <p className="note-sm mt-1 text-center">{t('ai.probability')}</p>
                      </div>

                      {/* Biomarkers / findings */}
                      <div className="md:col-span-2">
                        <p className="microlabel mb-2">{t('ai.biomarkers')}</p>
                        {(record.findings || []).length > 0 ? (
                          <ul className="divide-y divide-hairline dark:divide-coal-700">
                            {record.findings.map((finding, idx) => (
                              <li key={idx} className="flex items-start gap-3 py-2">
                                <span className="list-index w-5 shrink-0 pt-0.5">{String(idx + 1).padStart(2, '0')}</span>
                                <span className="prose-clinical">{td(finding)}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="note">{t('portal.findingsNone')}</p>
                        )}
                      </div>
                    </div>
                  )}
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
                    audioLogs={record?.audioLogs}
                    t={t}
                    gap="gap-3"
                  />
                </SectionHead>
                <button
                  onClick={() => setAudioCollapsed(v => !v)}
                  className="shrink-0 flex items-center gap-1 font-mono text-[10px] text-muted dark:text-chalk-muted hover:text-ink dark:hover:text-chalk transition-colors duration-200 ml-2"
                  title={audioCollapsed ? 'Show recordings' : 'Collapse recordings'}
                >
                  {audioCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                  {audioCollapsed ? (lang === 'th' ? 'ขยาย' : 'Expand') : (lang === 'th' ? 'ย่อ' : 'Collapse')}
                </button>
              </div>

              {!audioCollapsed && (
                <div className="mt-4 animate-fade-in">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPTED_AUDIO}
                    onChange={handleFileUpload}
                    className="hidden"
                  />

                  {record?.audioLogs?.[activeAudioTab]?.available ? (
                    <div>
                      <div className="flex items-center justify-between gap-4 datum">
                        <span className="truncate">
                          {t('audio.' + activeAudioTab)} · {td(record.audioLogs[activeAudioTab].status) || t('audio.recorded')}
                        </span>
                        <span className="shrink-0">
                          {t('audio.dur')} {record.audioLogs[activeAudioTab].duration || '0:00'}
                        </span>
                      </div>

                      <AudioPlayer
                        player={player}
                        waveform={analyses?.[activeAudioTab]?.waveform}
                        segments={analyses?.[activeAudioTab]?.segments}
                        durationSec={analyses?.[activeAudioTab]?.durationSec || 0}
                        t={t}
                      />

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
                        <div className="space-y-2.5">
                          <div className="flex items-center justify-center gap-2">
                            <span className="w-2.5 h-2.5 bg-risk-high dark:bg-risk-highd rounded-full animate-pulse" />
                            <span className="text-[13px] font-medium text-risk-high dark:text-risk-highd tabular-nums">
                              {t('audio.recordingNow', { s: browserRecordTime })}
                            </span>
                          </div>
                          <p className="note-sm">{t('audio.recordingHint', { max: MAX_RECORD_SECONDS })}</p>
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

                          <p className="note-sm max-w-md mx-auto">{t('audio.uploadHint')}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Status messages */}
                  {uploadState.message && (
                    <p className="note mt-3 !text-med-700 dark:!text-med-300">
                      {uploadState.message}
                    </p>
                  )}
                  {uploadState.error && (
                    <p className="note mt-3 !text-risk-high dark:!text-risk-highd">
                      {uploadState.error}
                    </p>
                  )}

                  {/* Summary Table */}
                  <div className="mt-5 divide-y divide-hairline dark:divide-coal-700 border border-hairline dark:border-coal-700 rounded overflow-hidden">
                    {['lung', 'heart', 'cough'].map((key) => {
                      const log = record?.audioLogs?.[key];
                      const isTabActive = activeAudioTab === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          aria-pressed={isTabActive}
                          onClick={() => setActiveAudioTab(key)}
                          className={`w-full text-left flex items-center justify-between gap-3 px-4 py-3 transition-colors duration-150 ${
                            isTabActive ? 'bg-ink/[0.04] dark:bg-coal-800' : 'bg-surface dark:bg-coal-900 hover:bg-ink/[0.02] dark:hover:bg-coal-850'
                          }`}
                        >
                          <span className="flex items-center gap-2.5 min-w-0">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${log?.available ? 'bg-med-500' : 'bg-hairline-strong dark:bg-coal-600'}`} />
                            <span className="text-[13px] font-medium text-ink dark:text-chalk capitalize">{t('audio.' + key)}</span>
                            {log?.available ? (
                              <span className="datum !text-med-700 dark:!text-med-300">
                                {t('audio.recorded')} · {log.duration}
                              </span>
                            ) : (
                              <span className="datum">{t('audio.notRecorded')}</span>
                            )}
                          </span>
                          <span className="font-mono text-[11px] text-med-700 dark:text-med-300 shrink-0">
                            {isTabActive ? t('portal.rowActive') : t('portal.rowSelect')}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* 04. Screening results & physician review (ผลคัดกรองและการตรวจสอบโดยแพทย์) */}
            <div className="card p-5 will-fade-up animate-delay-400">
              <div className="flex items-center justify-between gap-3">
                <SectionHead index="04" title={t('portal.review.title')} />
                <button
                  onClick={() => setReviewCollapsed(v => !v)}
                  className="shrink-0 flex items-center gap-1 font-mono text-[10px] text-muted dark:text-chalk-muted hover:text-ink dark:hover:text-chalk transition-colors duration-200 ml-2"
                  title={reviewCollapsed ? 'Show review' : 'Collapse review'}
                >
                  {reviewCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                  {reviewCollapsed ? (lang === 'th' ? 'ขยาย' : 'Expand') : (lang === 'th' ? 'ย่อ' : 'Collapse')}
                </button>
              </div>

              {!reviewCollapsed && (
                <div className="mt-4 animate-fade-in">
                  {Object.keys(analyses).length === 0 ? (
                    <div className="text-center py-8 border border-dashed border-hairline-strong dark:border-coal-600 rounded">
                      <p className="microlabel">{t('portal.review.noAnalysis')}</p>
                      <p className="note mt-1.5 max-w-xs mx-auto">{t('portal.review.noAnalysisDetail')}</p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-4">
                      {['lung', 'heart', 'cough'].map((type) => {
                        const a = analyses[type];
                        const audioLog = record?.audioLogs?.[type];

                        if (!audioLog?.available && !a) return null;

                        const reviewStatus = a?.review?.status || 'pending';
                        const isConfirmed = reviewStatus === 'confirmed';
                        const isModified  = reviewStatus === 'modified';
                        const isRejected  = reviewStatus === 'rejected';
                        const isDoctorSigned = isConfirmed || isModified || isRejected;

                        // Status chip config
                        const statusCfg = {
                          pending:   {
                            label: t('portal.review.pending'),
                            dot: 'bg-risk-mod dark:bg-risk-modd',
                            text: 'text-risk-mod dark:text-risk-modd',
                            bg: 'bg-risk-mod/[0.05] dark:bg-risk-modd/[0.07]',
                            border: 'border-risk-mod/20 dark:border-risk-modd/25',
                          },
                          confirmed: {
                            label: t('portal.review.confirmed'),
                            dot: 'bg-risk-low dark:bg-risk-lowd',
                            text: 'text-risk-low dark:text-risk-lowd',
                            bg: 'bg-risk-low/[0.05] dark:bg-risk-lowd/[0.07]',
                            border: 'border-risk-low/20 dark:border-risk-lowd/25',
                          },
                          modified:  {
                            label: t('portal.review.modified'),
                            dot: 'bg-med-500 dark:bg-med-400',
                            text: 'text-med-600 dark:text-med-300',
                            bg: 'bg-med-500/[0.05] dark:bg-med-400/[0.07]',
                            border: 'border-med-500/20 dark:border-med-400/25',
                          },
                          rejected:  {
                            label: t('portal.review.rejected'),
                            dot: 'bg-muted/60 dark:bg-chalk-muted/60',
                            text: 'text-muted dark:text-chalk-muted',
                            bg: 'bg-paper dark:bg-coal-900',
                            border: 'border-hairline dark:border-coal-700',
                          },
                        };
                        const cfg = statusCfg[reviewStatus] || statusCfg.pending;

                        const triageLabel = (level) => {
                          if (level === 'red')    return { text: t('portal.review.triageRed'),    cls: 'text-risk-high dark:text-risk-highd bg-risk-high/[0.06] dark:bg-risk-highd/[0.08] border-risk-high/30 dark:border-risk-highd/30' };
                          if (level === 'yellow') return { text: t('portal.review.triageYellow'), cls: 'text-risk-mod dark:text-risk-modd bg-risk-mod/[0.06] dark:bg-risk-modd/[0.08] border-risk-mod/30 dark:border-risk-modd/30' };
                          if (level === 'green')  return { text: t('portal.review.triageGreen'),  cls: 'text-risk-low dark:text-risk-lowd bg-risk-low/[0.06] dark:bg-risk-lowd/[0.08] border-risk-low/30 dark:border-risk-lowd/30' };
                          return { text: '—', cls: 'text-muted dark:text-chalk-muted bg-paper dark:bg-coal-900 border-hairline dark:border-coal-700' };
                        };

                        const displayKey    = (isModified || isConfirmed) ? (a?.review?.finalLabel  || a?.label)  : (isRejected ? null : a?.label);
                        const displayTriage = (isModified || isConfirmed) ? (a?.review?.finalTriage || a?.triage?.level)  : (isRejected ? null : a?.triage?.level);
                        const displayLabel  = displayKey ? clinicalLabel(displayKey, lang) : null;
                        const triage = triageLabel(displayTriage);

                        const reviewedAtStr = a?.review?.reviewedAt
                          ? new Date(a.review.reviewedAt).toLocaleDateString(
                              lang === 'th' ? 'th-TH' : 'en-GB',
                              { day: '2-digit', month: 'short', year: 'numeric' }
                            )
                          : null;

                        const explainKey = isConfirmed ? 'portal.review.confirmedExplain'
                          : isModified ? 'portal.review.modifiedExplain'
                          : isRejected ? 'portal.review.rejectedExplain'
                          : 'portal.review.pendingExplain';

                        return (
                          <div key={type} className={`border rounded-md overflow-hidden ${cfg.border} ${cfg.bg}`}>
                            {/* Header */}
                            <div className="flex items-center justify-between px-4 py-3 border-b border-hairline dark:border-coal-700 bg-surface dark:bg-coal-900">
                              <div className="flex items-center gap-2.5">
                                <span className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
                                <p className="text-sm font-semibold text-ink dark:text-chalk capitalize">
                                  {t('audio.' + type)} {t('audio.title').split(' ')[0]}
                                </p>
                              </div>
                              <span className={`font-mono text-[11px] font-medium ${cfg.text}`}>
                                {cfg.label}
                              </span>
                            </div>

                            {/* Body */}
                            <div className="px-4 py-4 flex flex-col gap-3">
                              {!a ? (
                                <p className="note">{t('ai.noResult')}</p>
                              ) : isRejected ? (
                                <div className="flex flex-col gap-2">
                                  <p className="prose-clinical">{t('portal.review.rejectedExplain')}</p>
                                  {a.review?.note && (
                                    <div className="bg-surface dark:bg-coal-850 border border-hairline dark:border-coal-700 rounded px-3 py-2.5">
                                      <p className="microlabel mb-1">{t('portal.review.doctorNote')}</p>
                                      <p className="prose-clinical italic">"{a.review.note}"</p>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <>
                                  {/* Finding + triage level */}
                                  {displayLabel && (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                      <div>
                                        <p className="microlabel mb-1.5">
                                          {isDoctorSigned ? t('portal.review.diagnosis') : t('portal.review.aiResult')}
                                        </p>
                                        <p className="text-[15px] font-semibold text-ink dark:text-chalk leading-snug">
                                          {displayLabel}
                                        </p>
                                        {isModified && a?.label && a.label !== displayKey && (
                                          <p className="note-sm mt-1 line-through text-muted dark:text-chalk-muted">
                                            {clinicalLabel(a.label, lang)}
                                          </p>
                                        )}
                                      </div>
                                      {displayTriage && (
                                        <div>
                                          <p className="microlabel mb-1.5">{t('portal.review.triage')}</p>
                                          <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded border ${triage.cls}`}>
                                            {triage.text}
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  {/* Plain-language explanation */}
                                  <p className="note leading-relaxed">{t(explainKey)}</p>
                                </>
                              )}

                              {/* Doctor sign-off */}
                              {isDoctorSigned && a?.review?.doctorName && (
                                <div className="pt-2.5 mt-0.5 border-t border-hairline dark:border-coal-700 flex flex-wrap items-center gap-2">
                                  <span className={`inline-flex items-center gap-1.5 font-mono text-[11px] px-2.5 py-1 rounded-full border ${
                                    isConfirmed
                                      ? 'border-risk-low/40 text-risk-low dark:text-risk-lowd dark:border-risk-lowd/40 bg-risk-low/[0.06]'
                                      : isModified
                                        ? 'border-med-500/40 text-med-600 dark:text-med-300 dark:border-med-400/40 bg-med-500/[0.06]'
                                        : 'border-muted/30 text-muted dark:text-chalk-muted bg-hairline/50 dark:bg-coal-800'
                                  }`}>
                                    {isConfirmed ? <Check className="w-3.5 h-3.5" /> : isModified ? <Pencil className="w-3.5 h-3.5" /> : null}
                                    {a.review.doctorName}
                                  </span>
                                  {reviewedAtStr && (
                                    <span className="datum">{t('portal.review.reviewedAt')} {reviewedAtStr}</span>
                                  )}
                                </div>
                              )}

                              {/* Pending callout */}
                              {!isDoctorSigned && a && reviewStatus === 'pending' && (
                                <div className="flex items-start gap-2.5 bg-risk-mod/[0.05] dark:bg-risk-modd/[0.07] border border-risk-mod/20 dark:border-risk-modd/25 rounded px-3 py-2.5 mt-1">
                                  <Clock className="w-3.5 h-3.5 shrink-0 mt-0.5 text-risk-mod dark:text-risk-modd animate-blink" />
                                  <p className="text-[12px] leading-relaxed text-ink dark:text-chalk">{t('portal.pendingCallout')}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            <p className="microlabel text-center pb-2 print-hidden">
              {t('colophon')}
            </p>
          </>
        )}

        {/* Print-only signature block */}
        <div className="hidden print-footer" style={{ display: 'none' }}>
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
    </div>
  );
}
