import React from 'react';

/**
 * Simple placeholder chart for lab results.
 * In a real app you could swap this for Chart.js, Recharts, or D3.
 */
export default function LabResultChart({ data }: { data: Array<{ label: string; value: number }> }) {
  // Determine max value for scaling
  const max = Math.max(...data.map((d) => d.value), 10);
  return (
    <div className="w-full overflow-x-auto py-4">
      <h3 className="text-lg font-medium mb-2">ผลการตรวจ Lab (Trend)</h3>
      <svg viewBox="0 0 100 50" className="w-full h-32">
        {data.map((d, i) => {
          const barHeight = (d.value / max) * 40;
          const x = i * (100 / data.length) + 5;
          const y = 45 - barHeight;
          return (
            <g key={i}>
              <rect x={x} y={y} width="8" height={barHeight} fill="#4f46e5" />
              <text x={x + 4} y="48" fontSize="3" textAnchor="middle" fill="currentColor">{d.label}</text>
            </g>
          );
        })}
        <line x1="0" y1="45" x2="100" y2="45" stroke="currentColor" strokeWidth="0.5" />
      </svg>
    </div>
  );
}
