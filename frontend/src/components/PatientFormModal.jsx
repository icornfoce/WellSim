/**
 * WellSim — Patient Form Modal
 *
 * Reusable modal for creating and editing patient records.
 * Collects demographics and initial vitals; the backend recalculates
 * the AI risk score from the vitals on save.
 */

'use client';

import React, { useState, useEffect } from 'react';
import { X, UserPlus, Save } from 'lucide-react';

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

  const inputClass =
    'w-full mt-1 px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400';
  const labelClass = 'text-[11px] font-bold text-slate-500 uppercase tracking-wide';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/60">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-50 border border-blue-100">
              {mode === 'edit' ? (
                <Save className="w-4 h-4 text-blue-600" />
              ) : (
                <UserPlus className="w-4 h-4 text-blue-600" />
              )}
            </div>
            <h2 className="text-base font-bold text-slate-800">
              {mode === 'edit' ? 'Edit Patient' : 'Add New Patient'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-5">
            {/* Demographics */}
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                Patient Information
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className={labelClass}>Full Name *</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setField('name', e.target.value)}
                    placeholder="e.g. Somchai Jaidee"
                    className={inputClass}
                    autoFocus
                  />
                </div>
                <div>
                  <label className={labelClass}>Age</label>
                  <input
                    type="number"
                    value={form.age}
                    onChange={(e) => setField('age', e.target.value)}
                    placeholder="Years"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Gender</label>
                  <select
                    value={form.gender}
                    onChange={(e) => setField('gender', e.target.value)}
                    className={inputClass}
                  >
                    <option>Male</option>
                    <option>Female</option>
                    <option>Other</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Weight (kg)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={form.weight}
                    onChange={(e) => setField('weight', e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Height (cm)</label>
                  <input
                    type="number"
                    value={form.height}
                    onChange={(e) => setField('height', e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div className="col-span-2">
                  <label className={labelClass}>Check-in Time</label>
                  <input
                    type="text"
                    value={form.checkInTime}
                    onChange={(e) => setField('checkInTime', e.target.value)}
                    placeholder="e.g. 19:15 (defaults to now)"
                    className={inputClass}
                  />
                </div>
              </div>
            </div>

            {/* Vitals */}
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                Initial Vitals &amp; Lab Data
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>SpO2 (%)</label>
                  <input
                    type="number"
                    value={form.vitals.spo2}
                    onChange={(e) => setVital('spo2', e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Heart Rate (bpm)</label>
                  <input
                    type="number"
                    value={form.vitals.heartRate}
                    onChange={(e) => setVital('heartRate', e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Systolic BP</label>
                  <input
                    type="number"
                    value={form.vitals.systolicBP}
                    onChange={(e) => setVital('systolicBP', e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Diastolic BP</label>
                  <input
                    type="number"
                    value={form.vitals.diastolicBP}
                    onChange={(e) => setVital('diastolicBP', e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>WBC (/mcL)</label>
                  <input
                    type="number"
                    value={form.vitals.wbc}
                    onChange={(e) => setVital('wbc', e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Hemoglobin (g/dL)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={form.vitals.hemoglobin}
                    onChange={(e) => setVital('hemoglobin', e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>
              <p className="text-[10px] text-slate-400 mt-2">
                Leave vitals blank to use healthy defaults. AI risk score is calculated automatically.
              </p>
            </div>

            {error && (
              <p className="text-xs font-semibold text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100 bg-slate-50/60">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {mode === 'edit' ? <Save className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />}
              {submitting ? 'Saving...' : mode === 'edit' ? 'Save Changes' : 'Create Patient'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
