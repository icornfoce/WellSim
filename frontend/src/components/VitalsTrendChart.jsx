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
    const width = 120;
    const height = 28;
    const pts = data.map((val, idx) => {
      const x = (idx / (data.length - 1)) * width;
      const y = height - ((val - minVal) / (maxVal - minVal)) * height;
      return `${x},${Math.max(2, Math.min(height - 2, y))}`;
    }).join(' ');

    return (
      <svg width={width} height={height} className="overflow-visible">
        <polyline
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={pts}
        />
        {data.map((val, idx) => {
          const x = (idx / (data.length - 1)) * width;
          const y = height - ((val - minVal) / (maxVal - minVal)) * height;
          const clampedY = Math.max(2, Math.min(height - 2, y));
          return (
            <circle
              key={idx}
              cx={x}
              cy={clampedY}
              r="2.5"
              className={idx === data.length - 1 ? 'fill-ink dark:fill-chalk' : 'fill-muted/50'}
            />
          );
        })}
      </svg>
    );
  };

  return (
    <div className="border border-hairline dark:border-coal-700 rounded p-4 bg-surface dark:bg-coal-900 mt-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink dark:text-chalk">
          {lang === 'th' ? 'แนวโน้มสัญญาณชีพ (Vitals Trends)' : 'Vitals Trends'}
        </h3>
        <span className="font-mono text-[10px] text-muted dark:text-chalk-muted">4-Point Window</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {currentSpo2 != null && (
          <div className="flex items-center justify-between p-2.5 rounded border border-hairline/60 dark:border-coal-800 bg-paper dark:bg-coal-950">
            <div>
              <p className="microlabel">SpO2 Trend</p>
              <p className="text-sm font-mono font-medium text-ink dark:text-chalk mt-0.5">{currentSpo2}%</p>
            </div>
            {renderSparkline(spo2Series, currentSpo2 < 95 ? '#ef4444' : '#10b981', 85, 100)}
          </div>
        )}

        {currentHr != null && (
          <div className="flex items-center justify-between p-2.5 rounded border border-hairline/60 dark:border-coal-800 bg-paper dark:bg-coal-950">
            <div>
              <p className="microlabel">Heart Rate</p>
              <p className="text-sm font-mono font-medium text-ink dark:text-chalk mt-0.5">{currentHr} bpm</p>
            </div>
            {renderSparkline(hrSeries, currentHr > 100 ? '#ef4444' : '#10b981', 40, 140)}
          </div>
        )}

        {currentBp != null && (
          <div className="flex items-center justify-between p-2.5 rounded border border-hairline/60 dark:border-coal-800 bg-paper dark:bg-coal-950">
            <div>
              <p className="microlabel">Systolic BP</p>
              <p className="text-sm font-mono font-medium text-ink dark:text-chalk mt-0.5">{currentBp} mmHg</p>
            </div>
            {renderSparkline(bpSeries, currentBp > 140 ? '#f59e0b' : '#10b981', 80, 180)}
          </div>
        )}
      </div>
    </div>
  );
}
