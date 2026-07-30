/**
 * WellSim — Critical Vitals Emergency Alert Banner
 *
 * Scans active patient queue for severe vital signs and displays
 * an urgent clinical alert banner at the top of the dashboard.
 */

'use client';

import React from 'react';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { useLang } from '../i18n/LanguageContext';

export default function CriticalAlertBanner({ patients = [], onSelectPatient }) {
  const { lang } = useLang();

  // Filter for patients with critical vitals
  const criticalPatients = patients.filter((p) => {
    const v = p.vitals || {};
    const spo2 = Number(v.spo2);
    const hr = Number(v.heartRate);
    const sBP = Number(v.systolicBP);

    return (
      (spo2 > 0 && spo2 < 90) ||
      (hr > 120) ||
      (sBP > 160) ||
      p.riskStatus === 'high'
    );
  });

  if (criticalPatients.length === 0) return null;

  return (
    <div className="bg-risk-high/15 border-b border-risk-high/40 text-risk-high dark:text-risk-highd px-4 py-2.5 flex items-center justify-between gap-3 animate-pulse print-hidden">
      <div className="flex items-center gap-2.5 min-w-0">
        <AlertTriangle className="w-4 h-4 shrink-0 text-risk-high dark:text-risk-highd" />
        <p className="text-xs font-semibold tracking-wide uppercase truncate">
          {lang === 'th' ? (
            <>🚨 เตือนภัยวิกฤต: พบผู้ป่วย {criticalPatients.length} ราย มีสัญญาณชีพอยู่ในขั้นน่ากังวล</>
          ) : (
            <>🚨 CRITICAL ALERT: {criticalPatients.length} patient(s) exhibit high-risk vitals</>
          )}
        </p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {criticalPatients.slice(0, 3).map((p) => (
          <button
            key={p.id}
            onClick={() => onSelectPatient && onSelectPatient(p.id)}
            className="btn-line !py-0.5 !px-2 text-[11px] font-mono border-risk-high/40 hover:bg-risk-high/20"
          >
            {p.name} ({p.id.toUpperCase()})
          </button>
        ))}
      </div>
    </div>
  );
}
