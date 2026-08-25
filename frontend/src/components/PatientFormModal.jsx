/**
 * WellSim — Patient Form Modal (UI v3 "Instrument")
 *
 * Reusable modal for creating and editing patient records.
 * Collects demographics and initial vitals; the backend recalculates
 * the AI risk score from the vitals on save.
 *
 * The dialog frame — Escape, focus trap, scroll lock, focus restore,
 * role="dialog" — lives in components/ui/Dialog. This file is only the
 * form.
 *
 * Three things changed in the form itself:
 *   · every label is bound to its input with htmlFor/id, so tapping a
 *     label focuses the field and a screen reader reads more than
 *     "edit text, blank"
 *   · validation errors are in Thai when the UI is in Thai, announced
 *     through role="alert", and they move focus to the field at fault.
 *     They used to render in English at the bottom of a scrolling form
 *     — below the fold, for a name field at the top
 *   · Escape or a backdrop click on a half-filled form asks before
 *     throwing the work away
 */

'use client';

import React, { useState, useEffect, useRef, useId } from 'react';
import { X } from 'lucide-react';
import { useLang } from '../i18n/LanguageContext';
import Dialog from './ui/Dialog';
import { useConfirm } from './ui/ConfirmDialog';

const EMPTY_FORM = {
  name: '',
  age: '',
  gender: 'Male',
  weight: '',
  height: '',
  checkInTime: '',
  vitals: {
    spo2: '',
    heartRate: '',
    systolicBP: '',
    diastolicBP: '',
    wbc: '',
    hemoglobin: '',
  },
};

/** The six vitals inputs, which differ only by key, label and step. */
const VITAL_FIELDS = [
  { key: 'spo2', labelKey: 'modal.spo2' },
  { key: 'heartRate', labelKey: 'modal.hr' },
  { key: 'systolicBP', labelKey: 'modal.sys' },
  { key: 'diastolicBP', labelKey: 'modal.dia' },
  { key: 'wbc', labelKey: 'modal.wbc' },
  { key: 'hemoglobin', labelKey: 'modal.hgb', step: '0.1' },
];

export default function PatientFormModal({
  open,
  mode = 'add',
  initialData = null,
  onClose,
  onSubmit,
  submitting = false,
}) {
  const { t } = useLang();
  const confirm = useConfirm();
  const uid = useId();
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [invalidField, setInvalidField] = useState('');
  const [dirty, setDirty] = useState(false);
  const formRef = useRef(null);

  // Prefixed so two dialogs on a page can never collide on an id.
  const fid = (name) => uid.replace(/:/g, '') + '-' + name;

  // Sync form state whenever the modal opens or the target patient changes
  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && initialData) {
      setForm({
        name: initialData.name ?? '',
        age: initialData.age ?? '',
        gender: initialData.gender ?? 'Male',
        weight: initialData.weight ?? '',
        height: initialData.height ?? '',
        checkInTime: initialData.checkInTime ?? '',
        vitals: {
          spo2: initialData.vitals?.spo2 ?? '',
          heartRate: initialData.vitals?.heartRate ?? '',
          systolicBP: initialData.vitals?.systolicBP ?? '',
          diastolicBP: initialData.vitals?.diastolicBP ?? '',
          wbc: initialData.vitals?.wbc ?? '',
          hemoglobin: initialData.vitals?.hemoglobin ?? '',
        },
      });
    } else {
      setForm(EMPTY_FORM);
    }
    setError('');
    setInvalidField('');
    setDirty(false);
  }, [open, mode, initialData]);

  const setField = (field, value) => {
    setDirty(true);
    setForm((prev) => ({ ...prev, [field]: value }));
  };
  const setVital = (field, value) => {
    setDirty(true);
    setForm((prev) => ({ ...prev, vitals: { ...prev.vitals, [field]: value } }));
  };

  const preventNegative = (e) => {
    if (e.key === '-' || e.key === 'e' || e.key === 'E') {
      e.preventDefault();
    }
  };

  const sanitizeVal = (val) => {
    if (val === '' || val === null || val === undefined) return '';
    const clean = String(val).replace(/[-eE]/g, '');
    const num = Number(clean);
    return Number.isNaN(num) || num < 0 ? '' : clean;
  };

  const num = (v) => (v === '' || v === null ? undefined : Math.max(0, Number(v)));

  /** Report a validation failure where the user is actually looking. */
  const fail = (field, message) => {
    setError(message);
    setInvalidField(field);
    const el = formRef.current?.querySelector('#' + fid(field));
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el?.focus({ preventScroll: true });
  };

  /** Escape or a backdrop click should not silently bin a filled form. */
  const requestClose = async () => {
    if (!dirty || submitting) {
      onClose();
      return;
    }
    const discard = await confirm({
      title: t('modal.discardTitle'),
      body: t('modal.discardBody'),
      confirmLabel: t('modal.discardConfirm'),
      tone: 'danger',
    });
    if (discard) onClose();
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    setInvalidField('');

    if (!form.name.trim()) return fail('name', t('modal.nameReq'));
    if (form.age !== '' && Number(form.age) < 0) return fail('age', t('modal.ageNeg'));
    if (form.weight !== '' && Number(form.weight) < 0) return fail('weight', t('modal.weightNeg'));
    if (form.height !== '' && Number(form.height) < 0) return fail('height', t('modal.heightNeg'));

    // Only include vitals fields that were actually filled in
    const vitals = {};
    Object.entries(form.vitals).forEach(([k, v]) => {
      const parsed = num(v);
      if (parsed !== undefined && !Number.isNaN(parsed)) vitals[k] = parsed;
    });

    const payload = {
      name: form.name.trim(),
      age: num(form.age) ?? null,
      gender: form.gender,
      weight: num(form.weight) ?? null,
      height: num(form.height) ?? null,
    };
    if (form.checkInTime.trim()) payload.checkInTime = form.checkInTime.trim();
    if (Object.keys(vitals).length) payload.vitals = vitals;

    onSubmit(payload);
  };

  const titleId = fid('title');
  const formId = fid('form');

  return (
    <Dialog open={open} onClose={requestClose} labelledBy={titleId} size="lg">
      {/* Head */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-hairline dark:border-coal-700">
        <div>
          <p className="microlabel">{mode === 'edit' ? t('modal.editKicker') : t('modal.newKicker')}</p>
          <h2 id={titleId} className="text-lg font-light tracking-tight text-ink dark:text-chalk mt-0.5">
            {mode === 'edit' ? t('modal.editTitle') : t('modal.addTitle')}
          </h2>
        </div>
        <button
          type="button"
          onClick={requestClose}
          aria-label={t('common.close')}
          className="tap-target w-7 h-7 rounded border border-hairline-strong dark:border-coal-600 flex items-center justify-center
                     text-muted hover:text-ink hover:border-ink/50
                     dark:text-chalk-muted dark:hover:text-chalk dark:hover:border-chalk/50
                     transition-colors duration-200"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Body */}
      <form id={formId} ref={formRef} onSubmit={handleSubmit} className="flex-1 overflow-y-auto min-h-0">
        <div className="p-5 space-y-6">
          {/* Demographics */}
          <div>
            <div className="flex items-center gap-3 mb-3">
              <span className="font-mono text-[10px] text-med-600 dark:text-med-300">A</span>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink dark:text-chalk">{t('modal.secA')}</p>
              <span className="flex-1 h-px bg-hairline dark:bg-coal-700" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label htmlFor={fid('name')} className="microlabel block mb-1">{t('modal.fullName')}</label>
                <input
                  id={fid('name')}
                  name="name"
                  type="text"
                  value={form.name}
                  onChange={(e) => setField('name', e.target.value)}
                  placeholder={t('modal.namePh')}
                  className="field"
                  required
                  aria-invalid={invalidField === 'name' || undefined}
                  data-autofocus
                />
              </div>
              <div>
                <label htmlFor={fid('age')} className="microlabel block mb-1">{t('modal.age')}</label>
                <input
                  id={fid('age')}
                  name="age"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  onKeyDown={preventNegative}
                  value={form.age}
                  onChange={(e) => setField('age', sanitizeVal(e.target.value))}
                  placeholder={t('modal.agePh')}
                  className="field tabular-nums"
                  aria-invalid={invalidField === 'age' || undefined}
                />
              </div>
              <div>
                <label htmlFor={fid('gender')} className="microlabel block mb-1">{t('modal.gender')}</label>
                <select
                  id={fid('gender')}
                  name="gender"
                  value={form.gender}
                  onChange={(e) => setField('gender', e.target.value)}
                  className="field"
                >
                  <option value="Male">{t('gender.male')}</option>
                  <option value="Female">{t('gender.female')}</option>
                  <option value="Other">{t('gender.other')}</option>
                </select>
              </div>
              <div>
                <label htmlFor={fid('weight')} className="microlabel block mb-1">{t('modal.weightKg')}</label>
                <input
                  id={fid('weight')}
                  name="weight"
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min="0"
                  onKeyDown={preventNegative}
                  value={form.weight}
                  onChange={(e) => setField('weight', sanitizeVal(e.target.value))}
                  className="field tabular-nums"
                  aria-invalid={invalidField === 'weight' || undefined}
                />
              </div>
              <div>
                <label htmlFor={fid('height')} className="microlabel block mb-1">{t('modal.heightCm')}</label>
                <input
                  id={fid('height')}
                  name="height"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  onKeyDown={preventNegative}
                  value={form.height}
                  onChange={(e) => setField('height', sanitizeVal(e.target.value))}
                  className="field tabular-nums"
                  aria-invalid={invalidField === 'height' || undefined}
                />
              </div>
              <div className="col-span-2">
                <label htmlFor={fid('checkInTime')} className="microlabel block mb-1">{t('modal.checkin')}</label>
                <input
                  id={fid('checkInTime')}
                  name="checkInTime"
                  type="text"
                  value={form.checkInTime}
                  onChange={(e) => setField('checkInTime', e.target.value)}
                  placeholder={t('modal.checkinPh')}
                  className="field font-mono !text-[13px]"
                />
              </div>
            </div>
          </div>

          {/* Vitals */}
          <div>
            <div className="flex items-center gap-3 mb-3">
              <span className="font-mono text-[10px] text-med-600 dark:text-med-300">B</span>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink dark:text-chalk">{t('modal.secB')}</p>
              <span className="flex-1 h-px bg-hairline dark:bg-coal-700" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {VITAL_FIELDS.map(({ key, labelKey, step }) => (
                <div key={key}>
                  <label htmlFor={fid(key)} className="microlabel block mb-1">{t(labelKey)}</label>
                  <input
                    id={fid(key)}
                    name={key}
                    type="number"
                    inputMode={step ? 'decimal' : 'numeric'}
                    step={step}
                    min="0"
                    onKeyDown={preventNegative}
                    value={form.vitals[key]}
                    onChange={(e) => setVital(key, sanitizeVal(e.target.value))}
                    className="field tabular-nums"
                  />
                </div>
              ))}
            </div>
            <p className="note-sm mt-2.5">
              {t('modal.note')}
            </p>
          </div>
        </div>
      </form>

      {/* Footer — outside the scroll area, so a validation error sits
          with the button that triggered it instead of at the far end of
          a form the user has already scrolled past. */}
      <div className="border-t border-hairline dark:border-coal-700 px-5 py-4
                      pb-[max(1rem,env(safe-area-inset-bottom))]">
        {error && (
          <div
            role="alert"
            className="border-l-2 border-risk-high dark:border-risk-highd bg-risk-high/[0.05] dark:bg-risk-highd/[0.07] px-3 py-2.5 mb-3 animate-fade-in"
          >
            <p className="text-xs text-risk-high dark:text-risk-highd">{error}</p>
          </div>
        )}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button type="button" onClick={requestClose} className="btn-line">
            {t('common.cancel')}
          </button>
          <button type="submit" form={formId} disabled={submitting} className="btn-ink">
            {submitting ? t('modal.saving') : mode === 'edit' ? t('modal.saveChanges') : t('modal.create')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
