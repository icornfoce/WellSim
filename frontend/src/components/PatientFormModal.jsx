/**
 * WellSim — Patient Form Modal (UI v3 "Instrument")
 *
 * Reusable modal for creating and editing patient records.
 * Collects demographics and initial vitals; the backend recalculates
 * the AI risk score from the vitals on save.
 */

'use client';

import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';

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

export default function PatientFormModal({
  open,
  mode = 'add',
  initialData = null,
  onClose,
  onSubmit,
  submitting = false,
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');

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
  }, [open, mode, initialData]);

  if (!open) return null;

  const setField = (field, value) => setForm(prev => ({ ...prev, [field]: value }));
  const setVital = (field, value) =>
    setForm(prev => ({ ...prev, vitals: { ...prev.vitals, [field]: value } }));

  const num = (v) => (v === '' || v === null ? undefined : Number(v));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Patient name is required.');
      return;
    }

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

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-ink/50 dark:bg-black/60 backdrop-blur-[2px] animate-fade-in"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col will-fade-up !bg-surface dark:!bg-coal-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Head */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-hairline dark:border-coal-700">
          <div>
            <p className="microlabel">{mode === 'edit' ? 'Edit record' : 'New record'}</p>
            <h2 className="text-lg font-light tracking-tight text-ink dark:text-chalk mt-0.5">
              {mode === 'edit' ? 'Edit patient' : 'Add new patient'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-7 h-7 rounded border border-hairline-strong dark:border-coal-600 flex items-center justify-center
                       text-muted hover:text-ink hover:border-ink/50
                       dark:text-chalk-muted dark:hover:text-chalk dark:hover:border-chalk/50
                       transition-colors duration-200"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="p-5 space-y-6">
            {/* Demographics */}
            <div>
              <div className="flex items-center gap-3 mb-3">
                <span className="font-mono text-[10px] text-med-600 dark:text-med-300">A</span>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink dark:text-chalk">Patient information</p>
                <span className="flex-1 h-px bg-hairline dark:bg-coal-700" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="microlabel block mb-1">Full name *</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setField('name', e.target.value)}
                    placeholder="e.g. Somchai Jaidee"
                    className="field"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="microlabel block mb-1">Age</label>
                  <input
                    type="number"
                    value={form.age}
                    onChange={(e) => setField('age', e.target.value)}
                    placeholder="Years"
                    className="field tabular-nums"
                  />
                </div>
                <div>
                  <label className="microlabel block mb-1">Gender</label>
                  <select
                    value={form.gender}
                    onChange={(e) => setField('gender', e.target.value)}
                    className="field"
                  >
                    <option>Male</option>
                    <option>Female</option>
                    <option>Other</option>
                  </select>
                </div>
                <div>
                  <label className="microlabel block mb-1">Weight (kg)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={form.weight}
                    onChange={(e) => setField('weight', e.target.value)}
                    className="field tabular-nums"
                  />
                </div>
                <div>
                  <label className="microlabel block mb-1">Height (cm)</label>
                  <input
                    type="number"
                    value={form.height}
                    onChange={(e) => setField('height', e.target.value)}
                    className="field tabular-nums"
                  />
                </div>
                <div className="col-span-2">
                  <label className="microlabel block mb-1">Check-in time</label>
                  <input
                    type="text"
                    value={form.checkInTime}
                    onChange={(e) => setField('checkInTime', e.target.value)}
                    placeholder="e.g. 19:15 (defaults to now)"
                    className="field font-mono !text-[13px]"
                  />
                </div>
              </div>
            </div>

            {/* Vitals */}
            <div>
              <div className="flex items-center gap-3 mb-3">
                <span className="font-mono text-[10px] text-med-600 dark:text-med-300">B</span>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink dark:text-chalk">Initial vitals &amp; lab data</p>
                <span className="flex-1 h-px bg-hairline dark:bg-coal-700" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="microlabel block mb-1">SpO2 (%)</label>
                  <input
                    type="number"
                    value={form.vitals.spo2}
                    onChange={(e) => setVital('spo2', e.target.value)}
                    className="field tabular-nums"
                  />
                </div>
                <div>
                  <label className="microlabel block mb-1">Heart rate (bpm)</label>
                  <input
                    type="number"
                    value={form.vitals.heartRate}
                    onChange={(e) => setVital('heartRate', e.target.value)}
                    className="field tabular-nums"
                  />
                </div>
                <div>
                  <label className="microlabel block mb-1">Systolic BP</label>
                  <input
                    type="number"
                    value={form.vitals.systolicBP}
                    onChange={(e) => setVital('systolicBP', e.target.value)}
                    className="field tabular-nums"
                  />
                </div>
                <div>
                  <label className="microlabel block mb-1">Diastolic BP</label>
                  <input
                    type="number"
                    value={form.vitals.diastolicBP}
                    onChange={(e) => setVital('diastolicBP', e.target.value)}
                    className="field tabular-nums"
                  />
                </div>
                <div>
                  <label className="microlabel block mb-1">WBC (/mcL)</label>
                  <input
                    type="number"
                    value={form.vitals.wbc}
                    onChange={(e) => setVital('wbc', e.target.value)}
                    className="field tabular-nums"
                  />
                </div>
                <div>
                  <label className="microlabel block mb-1">Hemoglobin (g/dL)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={form.vitals.hemoglobin}
                    onChange={(e) => setVital('hemoglobin', e.target.value)}
                    className="field tabular-nums"
                  />
                </div>
              </div>
              <p className="font-mono text-[10px] text-muted/70 dark:text-chalk-muted/70 mt-2.5">
                LEAVE BLANK FOR HEALTHY DEFAULTS — RISK SCORE IS COMPUTED AUTOMATICALLY
              </p>
            </div>

            {error && (
              <div className="border-l-2 border-risk-high dark:border-risk-highd bg-risk-high/[0.05] dark:bg-risk-highd/[0.07] px-3 py-2.5 animate-fade-in">
                <p className="text-xs text-risk-high dark:text-risk-highd">{error}</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 px-5 py-4 border-t border-hairline dark:border-coal-700">
            <button type="button" onClick={onClose} className="btn-line">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="btn-ink">
              {submitting ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create patient'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
