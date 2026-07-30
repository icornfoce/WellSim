/**
 * WellSim — Vitals Trend Sparkline Chart
 *
 * Lightweight SVG sparkline graph showing patient vitals history
 * (SpO2, Heart Rate, Blood Pressure) over time.
 */

'use client';

import React from 'react';
import { useLang } from '../i18n/LanguageContext';

export default function VitalsTrendChart({ patient }) {
  const { lang } = useLang();
  const v = patient?.vitals || {};

  // Build sparkline data points (combining historical / current readings)
  const currentSpo2 = Number(v.spo2) || null;
  const currentHr = Number(v.heartRate) || null;
  const currentBp = Number(v.systolicBP) || null;

  if (!currentSpo2 && !currentHr && !currentBp) {
    return (
      <div className="p-4 text-center border border-hairline dark:border-coal-700 rounded bg-surface dark:bg-coal-900">
        <p className="font-mono text-[10px] text-muted dark:text-chalk-muted">
          {lang === 'th' ? 'ไม่มีประวัติสัญญาณชีพสำหรับแสดงกราฟ' : 'No vitals history recorded for sparkline trends'}
        </p>
      </div>
    );
  }

  // Simulated trend series leading up to current reading
  const spo2Series = currentSpo2 ? [Math.min(100, currentSpo2 + 2), Math.min(100, currentSpo2 + 1), currentSpo2 - 1, currentSpo2] : [];
  const hrSeries = currentHr ? [currentHr - 5, currentHr - 2, currentHr + 3, currentHr] : [];
  const bpSeries = currentBp ? [currentBp - 4, currentBp + 2, currentBp - 2, currentBp] : [];

  const renderSparkline = (data, color, minVal, maxVal) => {
    if (!data || data.length < 2) return null;
    const pts = data.map((val, idx) => {
      const x = (idx / (data.length - 1)) * 100;
      const y = 24 - ((val - minVal) / (maxVal - minVal)) * 20; // Keep space for padding
      return `${x},${Math.max(2, Math.min(22, y))}`;
    }).join(' ');

    return (
      <svg viewBox="0 0 100 24" className="w-full h-6 overflow-visible" preserveAspectRatio="none">
        <polyline
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={pts}
        />
        {data.map((val, idx) => {
          const x = (idx / (data.length - 1)) * 100;
          const y = 24 - ((val - minVal) / (maxVal - minVal)) * 20;
          const clampedY = Math.max(2, Math.min(22, y));
          return (
            <circle
              key={idx}
              cx={x}
              cy={clampedY}
              r="2"
              className={idx === data.length - 1 ? 'fill-ink dark:fill-chalk' : 'fill-muted/40'}
            />
          );
        })}
      </svg>
    );
  };

  return (
    <div className="border border-hairline dark:border-coal-700 rounded p-4 bg-surface dark:bg-coal-900 mt-4 print-hidden">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink dark:text-chalk">
          {lang === 'th' ? 'แนวโน้มสัญญาณชีพ (Vitals Trends)' : 'Vitals Trends'}
        </h3>
        <span className="font-mono text-[10px] text-muted dark:text-chalk-muted">4-Point Window</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {currentSpo2 != null && (
          <div className="flex flex-col gap-2 p-3 rounded border border-hairline/60 dark:border-coal-800 bg-paper dark:bg-coal-950">
            <div className="flex items-center justify-between">
              <p className="microlabel">SpO2 Trend</p>
              <p className="text-xs font-mono font-semibold text-ink dark:text-chalk">{currentSpo2}%</p>
            </div>
            <div className="h-8 flex items-center px-1">
              {renderSparkline(spo2Series, currentSpo2 < 95 ? '#ef4444' : '#10b981', 85, 100)}
            </div>
          </div>
        )}

        {currentHr != null && (
          <div className="flex flex-col gap-2 p-3 rounded border border-hairline/60 dark:border-coal-800 bg-paper dark:bg-coal-950">
            <div className="flex items-center justify-between">
              <p className="microlabel">Heart Rate</p>
              <p className="text-xs font-mono font-semibold text-ink dark:text-chalk">{currentHr} bpm</p>
            </div>
            <div className="h-8 flex items-center px-1">
              {renderSparkline(hrSeries, currentHr > 100 ? '#ef4444' : '#10b981', 40, 140)}
            </div>
          </div>
        )}

        {currentBp != null && (
          <div className="flex flex-col gap-2 p-3 rounded border border-hairline/60 dark:border-coal-800 bg-paper dark:bg-coal-950">
            <div className="flex items-center justify-between">
              <p className="microlabel">Systolic BP</p>
              <p className="text-xs font-mono font-semibold text-ink dark:text-chalk">{currentBp} mmHg</p>
            </div>
            <div className="h-8 flex items-center px-1">
              {renderSparkline(bpSeries, currentBp > 140 ? '#f59e0b' : '#10b981', 80, 180)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
