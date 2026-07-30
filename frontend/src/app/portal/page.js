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
import { LogOut, RefreshCw, Pencil, Check, Upload, Printer } from 'lucide-react';
import ThemeToggle from '../../components/ThemeToggle';
import LangToggle from '../../components/LangToggle';
import { useLang } from '../../i18n/LanguageContext';
import { dataDictionaryTH } from '../../i18n/translations';
import { fetchMyRecord, updateMyRecord, uploadAudio as apiUploadAudio } from '../../services/api';
import { encodeWavFromBlob, formatDuration } from '../../lib/audioEncoder';

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

  // Patient audio upload
  const [uploadingType, setUploadingType] = useState(null);
  const [uploadMsg, setUploadMsg] = useState('');

  const handleAudioUpload = async (type, event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !record) return;

    setUploadingType(type);
    setUploadMsg(lang === 'th' ? 'กำลังแปลงและอัปโหลดไฟล์เสียง…' : 'Converting and uploading audio…');

    try {
      const wav = await encodeWavFromBlob(file);
      await apiUploadAudio({
        patientId: record.id,
        type,
        audioBase64: wav.base64,
        duration: formatDuration(wav.durationSec),
        deviceId: 'PATIENT-PORTAL',
      });

      setUploadMsg(lang === 'th' ? 'อัปโหลดเสียงเรียบร้อยแล้ว!' : 'Upload successful! AI screening updated.');
      await load();
    } catch (err) {
      setError(err.message || 'Failed to upload audio.');
    } finally {
      setUploadingType(null);
      setTimeout(() => setUploadMsg(''), 4000);
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
                        value={demoForm.age}
                        onChange={(e) => setDemoForm({ ...demoForm, age: e.target.value })}
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
                          value={demoForm.weight}
                          onChange={(e) => setDemoForm({ ...demoForm, weight: e.target.value })}
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
                          value={demoForm.height}
                          onChange={(e) => setDemoForm({ ...demoForm, height: e.target.value })}
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

            {/* Recordings — upload or show status */}
            <div className="card p-5 will-fade-up animate-delay-300">
              <SectionHead index="03" title={t('audio.title')} />

              {uploadMsg && (
                <div className="mt-3 px-3 py-2 rounded border border-med-500/30 bg-med-500/[0.06] text-xs text-med-600 dark:text-med-300 animate-fade-in">
                  {uploadMsg}
                </div>
              )}

              <div className="mt-4 divide-y divide-hairline dark:divide-coal-700 border border-hairline dark:border-coal-700 rounded overflow-hidden">
                {audioRows.map((row) => (
                  <div key={row.key} className="flex items-center justify-between px-4 py-3 bg-surface dark:bg-coal-900">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="text-xs font-medium text-ink dark:text-chalk capitalize">{row.label}</p>
                      {row.available ? (
                        <p className="font-mono text-[10px] text-med-600 dark:text-med-300">
                          {t('audio.recorded')} · {row.duration}
                        </p>
                      ) : (
                        <p className="font-mono text-[10px] text-muted dark:text-chalk-muted">
                          {t('audio.notRecorded')}
                        </p>
                      )}
                    </div>
                    <label className={`btn-line !py-1 !px-2.5 text-[11px] flex items-center gap-1.5 cursor-pointer ${
                      uploadingType === row.key ? 'opacity-50 pointer-events-none' : ''
                    }`}>
                      <Upload className="w-3 h-3" />
                      <span>{uploadingType === row.key
                        ? (lang === 'th' ? 'กำลังอัปโหลด…' : 'Uploading…')
                        : (row.available
                          ? (lang === 'th' ? 'อัปโหลดใหม่' : 'Re-upload')
                          : (lang === 'th' ? 'อัปโหลดเสียง' : 'Upload'))
                      }</span>
                      <input
                        type="file"
                        accept="audio/*"
                        className="hidden"
                        disabled={uploadingType === row.key}
                        onChange={(e) => handleAudioUpload(row.key, e)}
                      />
                    </label>
                  </div>
                ))}
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
