/**
 * WellSim — AI Screening Result & Physician Review
 *
 * The two-layer assessment, rendered:
 *
 *   Layer 1  the engine's label, confidence, evidence and triage level
 *   Layer 2  the physician's confirm / modify / reject verdict
 *
 * Nothing here is presented as a diagnosis. Until a doctor signs it,
 * every result is stamped "awaiting physician confirmation", and the
 * review controls are only rendered for doctor accounts — the API
 * enforces the same rule with a 403, so hiding the buttons is a
 * convenience, not the security boundary.
 */

'use client';

import React, { useState } from 'react';
import {
  Check,
  X,
  Pencil,
  RefreshCw,
  AlertTriangle,
  Stethoscope,
  ShieldCheck,
  Clock,
} from 'lucide-react';
import SpectrogramView from './SpectrogramView';
import { useLang } from '../i18n/LanguageContext';

/** Classification labels the engine can emit, with clinical wording. */
const LABEL_TEXT = {
  en: {
    normal_breath_sounds: 'Normal breath sounds',
    wheeze: 'Wheeze',
    fine_crackles: 'Fine crackles',
    coarse_crackles: 'Coarse crackles',
    wheeze_and_crackles: 'Wheeze with crackles',
    regular_rhythm: 'Regular rhythm',
    irregular_rhythm: 'Irregular rhythm',
    irregular_rhythm_with_murmur_signal: 'Irregular rhythm with murmur',
    murmur_signal_present: 'Murmur signal present',
    tachycardia_signal: 'Fast rate (tachycardia signal)',
    bradycardia_signal: 'Slow rate (bradycardia signal)',
    dry_cough: 'Dry cough',
    productive_cough: 'Productive cough',
    no_cough_detected: 'No cough detected',
    inconclusive: 'Inconclusive',
  },
  th: {
    normal_breath_sounds: 'เสียงหายใจปกติ',
    wheeze: 'เสียงหวีด (Wheeze)',
    fine_crackles: 'เสียงกรอบแกรบละเอียด (Fine crackles)',
    coarse_crackles: 'เสียงกรอบแกรบหยาบ (Coarse crackles)',
    wheeze_and_crackles: 'เสียงหวีดร่วมกับกรอบแกรบ',
    regular_rhythm: 'จังหวะหัวใจสม่ำเสมอ',
    irregular_rhythm: 'จังหวะหัวใจไม่สม่ำเสมอ',
    irregular_rhythm_with_murmur_signal: 'จังหวะไม่สม่ำเสมอร่วมกับเสียงฟู่',
    murmur_signal_present: 'พบสัญญาณเสียงฟู่ (Murmur)',
    tachycardia_signal: 'อัตราการเต้นเร็ว',
    bradycardia_signal: 'อัตราการเต้นช้า',
    dry_cough: 'ไอแห้ง',
    productive_cough: 'ไอมีเสมหะ',
    no_cough_detected: 'ไม่พบเสียงไอ',
    inconclusive: 'สรุปผลไม่ได้',
  },
};

/** Labels a doctor may choose when overriding, grouped by recording type. */
const OVERRIDE_OPTIONS = {
  lung: ['normal_breath_sounds', 'wheeze', 'fine_crackles', 'coarse_crackles', 'wheeze_and_crackles', 'inconclusive'],
  heart: ['regular_rhythm', 'irregular_rhythm', 'murmur_signal_present', 'irregular_rhythm_with_murmur_signal', 'tachycardia_signal', 'bradycardia_signal', 'inconclusive'],
  cough: ['no_cough_detected', 'dry_cough', 'productive_cough', 'inconclusive'],
};

const TRIAGE = {
  red:    { dot: 'bg-risk-high dark:bg-risk-highd',  text: 'text-risk-high dark:text-risk-highd',  ring: 'border-risk-high/40 dark:border-risk-highd/40', bg: 'bg-risk-high/[0.06] dark:bg-risk-highd/[0.09]' },
  yellow: { dot: 'bg-risk-mod dark:bg-risk-modd',    text: 'text-risk-mod dark:text-risk-modd',    ring: 'border-risk-mod/40 dark:border-risk-modd/40',  bg: 'bg-risk-mod/[0.06] dark:bg-risk-modd/[0.09]' },
  green:  { dot: 'bg-risk-low dark:bg-risk-lowd',    text: 'text-risk-low dark:text-risk-lowd',    ring: 'border-risk-low/40 dark:border-risk-lowd/40',  bg: 'bg-risk-low/[0.06] dark:bg-risk-lowd/[0.09]' },
};

export default function AIAnalysisPanel({
  analysis,
  type,
  canReview,
  running,
  progress = 0,
  isDark = false,
  onRun,
  onReview,
  reviewSubmitting,
}) {
  const { t, lang } = useLang();
  const [mode, setMode] = useState(null); // null | 'modify' | 'reject'
  const [note, setNote] = useState('');
  const [overrideLabel, setOverrideLabel] = useState('');
  const [overrideTriage, setOverrideTriage] = useState('');
  const [error, setError] = useState('');

  const labelText = (key) =>
    LABEL_TEXT[lang]?.[key] || LABEL_TEXT.en[key] || String(key || '').replace(/_/g, ' ');

  const resetForm = () => {
    setMode(null);
    setNote('');
    setOverrideLabel('');
    setOverrideTriage('');
    setError('');
  };

  const submit = async (action) => {
    setError('');
    if (action === 'reject' && !note.trim()) {
      setError(t('ai.errRejectNote'));
      return;
    }
    if (action === 'modify' && !overrideLabel && !overrideTriage) {
      setError(t('ai.errModifyEmpty'));
      return;
    }
    try {
      await onReview({
        action,
        finalLabel: overrideLabel || undefined,
        finalTriage: overrideTriage || undefined,
        note: note.trim(),
      });
      resetForm();
    } catch (e) {
      setError(e.message);
    }
  };

  // ─── No analysis yet ───────────────────────────────────────────────
  if (!analysis) {
    return (
      <div className="border border-dashed border-hairline-strong dark:border-coal-600 rounded-md py-7 px-4 text-center">
        <p className="microlabel">{t('ai.noResult')}</p>
        <p className="font-mono text-[10px] text-muted/70 dark:text-chalk-muted/70 mt-2 max-w-md mx-auto leading-relaxed">
          {t('ai.noResultDetail')}
        </p>
        <button onClick={onRun} disabled={running} className="btn-ink mt-4 disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${running ? 'animate-spin' : ''}`} />
          {running ? t('ai.running') : t('ai.run')}
        </button>
      </div>
    );
  }

  // ─── Engine could not read the recording ───────────────────────────
  if (analysis.status === 'error') {
    return (
      <div className={`border rounded-md p-4 ${TRIAGE.yellow.ring} ${TRIAGE.yellow.bg}`}>
        <div className="flex items-start gap-3">
          <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${TRIAGE.yellow.text}`} />
          <div className="min-w-0">
            <p className={`text-xs font-semibold ${TRIAGE.yellow.text}`}>
              {t('ai.cannotAnalyse')} · {analysis.error}
            </p>
            <p className="text-xs text-ink/80 dark:text-chalk/80 mt-1.5 leading-relaxed">
              {analysis.message}
            </p>
            <button onClick={onRun} disabled={running} className="btn-line mt-3 !py-1.5">
              <RefreshCw className={`w-3 h-3 ${running ? 'animate-spin' : ''}`} /> {t('ai.retry')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const review = analysis.review || { status: 'pending' };
  const isReviewed = review.status !== 'pending';
  const isRejected = review.status === 'rejected';

  // The effective verdict: the doctor's if they gave one, else the AI's
  const shownLabel = review.finalLabel || analysis.label;
  const shownTriage = review.finalTriage || analysis.triage?.level || 'green';
  const tri = TRIAGE[shownTriage] || TRIAGE.green;

  const confidencePct = Math.round((analysis.confidence || 0) * 100);
  const qualityPct = Math.round((analysis.quality?.score || 0) * 100);

  return (
    <div className="space-y-4">

      {/* ─── Review status banner ─────────────────────────────────── */}
      <div
        className={`flex items-start gap-2.5 px-3.5 py-2.5 rounded border ${
          isReviewed
            ? isRejected
              ? 'border-risk-high/40 bg-risk-high/[0.06] dark:border-risk-highd/40 dark:bg-risk-highd/[0.08]'
              : 'border-med-600/40 bg-med-600/[0.05] dark:border-med-300/40 dark:bg-med-300/[0.07]'
            : 'border-hairline-strong dark:border-coal-600 bg-paper dark:bg-coal-850'
        }`}
      >
        {isReviewed ? (
          isRejected
            ? <X className="w-3.5 h-3.5 shrink-0 mt-0.5 text-risk-high dark:text-risk-highd" />
            : <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5 text-med-600 dark:text-med-300" />
        ) : (
          <Clock className="w-3.5 h-3.5 shrink-0 mt-0.5 text-muted dark:text-chalk-muted animate-blink" />
        )}
        <div className="min-w-0 flex-1">
          <p className={`font-mono text-[10px] uppercase tracking-[0.12em] ${
            isReviewed
              ? isRejected
                ? 'text-risk-high dark:text-risk-highd'
                : 'text-med-700 dark:text-med-300'
              : 'text-muted dark:text-chalk-muted'
          }`}>
            {review.status === 'pending' && t('ai.statusPending')}
            {review.status === 'confirmed' && t('ai.statusConfirmed')}
            {review.status === 'modified' && t('ai.statusModified')}
            {review.status === 'rejected' && t('ai.statusRejected')}
          </p>
          {isReviewed && (
            <p className="text-[11px] text-ink/75 dark:text-chalk/75 mt-1 leading-relaxed">
              {review.doctorName} · {new Date(review.reviewedAt).toLocaleString()}
              {review.note && <span className="block mt-0.5 italic">“{review.note}”</span>}
            </p>
          )}
          {!isReviewed && (
            <p className="text-[11px] text-muted dark:text-chalk-muted mt-1 leading-relaxed">
              {t('ai.pendingDetail')}
            </p>
          )}
        </div>
      </div>

      {/* ─── Verdict header ───────────────────────────────────────── */}
      <div className={`rounded border ${tri.ring} ${tri.bg} p-4`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="microlabel">
              {isRejected ? t('ai.aiSaidRejected') : review.finalLabel ? t('ai.physicianDx') : t('ai.aiScreening')}
            </p>
            <p className={`text-[22px] font-light leading-tight mt-1 ${isRejected ? 'line-through opacity-60' : ''} text-ink dark:text-chalk`}>
              {labelText(shownLabel)}
            </p>
            {review.finalLabel && review.finalLabel !== analysis.label && (
              <p className="font-mono text-[10px] text-muted dark:text-chalk-muted mt-1.5">
                {t('ai.aiOriginally')}: {labelText(analysis.label)} ({confidencePct}%)
              </p>
            )}
          </div>

          <div className="flex items-center gap-4 shrink-0">
            {/* Triage level */}
            <div className="text-right">
              <p className="microlabel">{t('ai.triage')}</p>
              <p className={`flex items-center justify-end gap-1.5 font-mono text-xs mt-1 ${tri.text}`}>
                <span className={`w-2 h-2 rounded-[1px] ${tri.dot} ${shownTriage === 'red' ? 'animate-blink' : ''}`} />
                {t(`triage.${shownTriage}`)}
              </p>
            </div>

            {/* Confidence — the number the proposal promises */}
            <div className="text-right border-l border-hairline dark:border-coal-700 pl-4">
              <p className="microlabel">{t('ai.confidence')}</p>
              <p className="text-xl font-light tabular-nums text-ink dark:text-chalk leading-none mt-1">
                {confidencePct}
                <span className="font-mono text-[11px] text-muted dark:text-chalk-muted ml-0.5">%</span>
              </p>
            </div>
          </div>
        </div>

        {/* Confidence bar */}
        <div className="relative h-[3px] mt-3.5 bg-hairline dark:bg-coal-700">
          <div
            className={`absolute inset-y-0 left-0 transition-all duration-700 ${tri.dot}`}
            style={{ width: `${confidencePct}%` }}
          />
        </div>

        {/* Triage reasoning */}
        {(analysis.triage?.reasons || []).length > 0 && (
          <ul className="mt-3 space-y-1">
            {analysis.triage.reasons.map((r, i) => (
              <li key={i} className="flex gap-2 text-[11px] text-ink/75 dark:text-chalk/75 leading-relaxed">
                <span className={`shrink-0 ${tri.text}`}>·</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ─── Spectrogram + flagged segments ───────────────────────── */}
      <SpectrogramView
        spectrogram={analysis.spectrogram}
        segments={analysis.segments}
        progress={progress}
        isDark={isDark}
      />

      {/* ─── Measured evidence ────────────────────────────────────── */}
      <div>
        <p className="microlabel">{t('ai.evidence')}</p>
        <ul className="mt-2 divide-y divide-hairline dark:divide-coal-700">
          {(analysis.evidence || []).map((line, i) => (
            <li key={i} className="flex items-start gap-3 py-2">
              <span className="font-mono text-[10px] text-muted/70 dark:text-chalk-muted/70 w-5 shrink-0 pt-0.5">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="text-xs leading-relaxed text-ink/90 dark:text-chalk/90">{line}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* ─── Differentials & signal quality ───────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-hairline dark:bg-coal-700 border border-hairline dark:border-coal-700 rounded overflow-hidden">
        <div className="bg-surface dark:bg-coal-900 p-3.5">
          <p className="microlabel">{t('ai.differentials')}</p>
          {(analysis.differentials || []).length ? (
            <ul className="mt-2 space-y-1">
              {analysis.differentials.map((d, i) => (
                <li key={i} className="text-xs text-ink/85 dark:text-chalk/85 leading-relaxed">— {d}</li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted dark:text-chalk-muted mt-2">{t('ai.noDifferentials')}</p>
          )}
        </div>

        <div className="bg-surface dark:bg-coal-900 p-3.5">
          <p className="microlabel">{t('ai.signalQuality')}</p>
          <p className="text-xl font-light tabular-nums text-ink dark:text-chalk mt-1.5 leading-none">
            {qualityPct}
            <span className="font-mono text-[11px] text-muted dark:text-chalk-muted ml-1">%</span>
          </p>
          <div className="relative h-[3px] mt-2.5 bg-hairline dark:bg-coal-700">
            <div
              className={`absolute inset-y-0 left-0 ${qualityPct < 50 ? 'bg-risk-mod dark:bg-risk-modd' : 'bg-med-600 dark:bg-med-300'}`}
              style={{ width: `${qualityPct}%` }}
            />
          </div>
          <p className="font-mono text-[10px] text-muted dark:text-chalk-muted mt-2 leading-relaxed">
            {analysis.quality?.duration}s · {t('ai.peak')} {analysis.quality?.peakAmplitude}
            {(analysis.quality?.issues || []).length > 0 && (
              <span className="block text-risk-mod dark:text-risk-modd mt-1">
                ⚠ {analysis.quality.issues.join(', ')}
              </span>
            )}
          </p>
        </div>
      </div>

      {/* ─── Layer 2: physician review ────────────────────────────── */}
      <div className="pt-4 border-t border-hairline dark:border-coal-700 print-hidden">
        {canReview ? (
          <>
            <div className="flex items-center gap-2 mb-3">
              <Stethoscope className="w-3.5 h-3.5 text-med-600 dark:text-med-300" />
              <p className="microlabel !text-med-700 dark:!text-med-300">{t('ai.reviewTitle')}</p>
            </div>

            {mode === null ? (
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  onClick={() => submit('confirm')}
                  disabled={reviewSubmitting}
                  className="btn-ink flex-1 disabled:opacity-50"
                >
                  <Check className="w-3.5 h-3.5" /> {t('ai.confirm')}
                </button>
                <button onClick={() => setMode('modify')} className="btn-line flex-1">
                  <Pencil className="w-3 h-3" /> {t('ai.modify')}
                </button>
                <button
                  onClick={() => setMode('reject')}
                  className="btn-line flex-1 !border-risk-high/40 !text-risk-high hover:!bg-risk-high/[0.06]
                             dark:!border-risk-highd/40 dark:!text-risk-highd"
                >
                  <X className="w-3 h-3" /> {t('ai.reject')}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {mode === 'modify' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="microlabel block mb-1.5">{t('ai.yourDiagnosis')}</label>
                      <select
                        value={overrideLabel}
                        onChange={(e) => setOverrideLabel(e.target.value)}
                        className="field"
                      >
                        <option value="">{t('ai.keepAiLabel')}</option>
                        {(OVERRIDE_OPTIONS[type] || OVERRIDE_OPTIONS.lung).map((key) => (
                          <option key={key} value={key}>{labelText(key)}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="microlabel block mb-1.5">{t('ai.yourTriage')}</label>
                      <select
                        value={overrideTriage}
                        onChange={(e) => setOverrideTriage(e.target.value)}
                        className="field"
                      >
                        <option value="">{t('ai.keepAiTriage')}</option>
                        <option value="red">{t('triage.red')}</option>
                        <option value="yellow">{t('triage.yellow')}</option>
                        <option value="green">{t('triage.green')}</option>
                      </select>
                    </div>
                  </div>
                )}

                <div>
                  <label className="microlabel block mb-1.5">
                    {mode === 'reject' ? t('ai.noteRequired') : t('ai.noteOptional')}
                  </label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    placeholder={t('ai.notePlaceholder')}
                    className="field resize-none"
                  />
                  <p className="font-mono text-[10px] text-muted/70 dark:text-chalk-muted/70 mt-1.5">
                    {t('ai.feedbackNote')}
                  </p>
                </div>

                {error && (
                  <p className="text-xs text-risk-high dark:text-risk-highd">{error}</p>
                )}

                <div className="flex gap-2">
                  <button onClick={resetForm} className="btn-line">{t('common.cancel')}</button>
                  <button
                    onClick={() => submit(mode)}
                    disabled={reviewSubmitting}
                    className="btn-ink flex-1 disabled:opacity-50"
                  >
                    {reviewSubmitting ? t('ai.saving') : mode === 'modify' ? t('ai.saveDiagnosis') : t('ai.confirmReject')}
                  </button>
                </div>
              </div>
            )}

            {isReviewed && mode === null && (
              <p className="font-mono text-[10px] text-muted/70 dark:text-chalk-muted/70 mt-2.5">
                {t('ai.reReview')}
              </p>
            )}
          </>
        ) : (
          <div className="flex items-start gap-2.5">
            <Stethoscope className="w-3.5 h-3.5 shrink-0 mt-0.5 text-muted dark:text-chalk-muted" />
            <p className="text-[11px] text-muted dark:text-chalk-muted leading-relaxed">
              {t('ai.nurseNotice')}
            </p>
          </div>
        )}
      </div>

      {/* ─── Provenance ───────────────────────────────────────────── */}
      <p className="font-mono text-[10px] text-muted/60 dark:text-chalk-muted/50 leading-relaxed pt-1">
        {analysis.modelVersion} · {analysis.method} · {analysis.processingMs}ms ·{' '}
        {new Date(analysis.analyzedAt).toLocaleString()}
        <button
          onClick={onRun}
          disabled={running}
          className="ml-2 underline hover:text-ink dark:hover:text-chalk disabled:opacity-50"
        >
          {running ? t('ai.running') : t('ai.rerun')}
        </button>
      </p>
    </div>
  );
}
