'use client';

import React from 'react';

export default function LabResultChart({ data = {} }) {
  const chartItems = Object.entries(data)
    .filter(([_, val]) => typeof val === 'number' && !isNaN(val))
    .map(([key, val]) => ({
      label: key.toUpperCase(),
      value: Number(val),
    }));

  const displayItems = chartItems.length > 0
    ? chartItems
    : [
        { label: 'SPO2', value: 98 },
        { label: 'HR', value: 72 },
        { label: 'WBC', value: 6.5 },
        { label: 'HGB', value: 14.2 },
      ];

  const max = Math.max(...displayItems.map((d) => d.value), 100);

  return (
    <div className="w-full rounded-md border border-hairline dark:border-coal-700 bg-surface dark:bg-coal-900 p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="microlabel">Biomarker &amp; Lab Trend</p>
        <span className="font-mono text-[10px] text-muted dark:text-chalk-muted">NORMAL RANGE</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {displayItems.map((item, idx) => {
          const pct = Math.min(Math.round((item.value / max) * 100), 100);
          return (
            <div key={idx} className="bg-paper dark:bg-coal-800 p-3 rounded border border-hairline dark:border-coal-700">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] text-muted dark:text-chalk-muted">{item.label}</span>
                <span className="font-mono text-sm font-semibold text-ink dark:text-chalk tabular-nums">{item.value}</span>
              </div>
              <div className="w-full bg-hairline dark:bg-coal-700 h-1.5 rounded-full overflow-hidden mt-2">
                <div
                  className="bg-med-500 h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
