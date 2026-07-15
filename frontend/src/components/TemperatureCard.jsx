/**
 * WellSim — TemperatureCard Component
 * 
 * Displays body temperature with a visual indicator,
 * normal/elevated/fever color coding, and a thermometer icon.
 */

'use client';

export default function TemperatureCard({ temperature, hasNewData }) {
  const temp = typeof temperature === 'number' ? temperature : null;

  // Determine status and color based on temperature range
  const getStatus = (t) => {
    if (t === null) return { label: 'No data', color: 'text-slate-400', bg: 'bg-slate-50', dot: 'bg-slate-300' };
    if (t < 36.1) return { label: 'Below Normal', color: 'text-vitals-blue', bg: 'bg-blue-50', dot: 'bg-vitals-blue' };
    if (t <= 37.2) return { label: 'Normal', color: 'text-vitals-green', bg: 'bg-emerald-50', dot: 'bg-vitals-green' };
    if (t <= 38.0) return { label: 'Elevated', color: 'text-vitals-amber', bg: 'bg-amber-50', dot: 'bg-vitals-amber' };
    return { label: 'Fever', color: 'text-vitals-red', bg: 'bg-red-50', dot: 'bg-vitals-red' };
  };

  const status = getStatus(temp);

  return (
    <div className={`card p-6 ${hasNewData ? 'animate-data-flash' : ''}`}>
      {/* Card header */}
      <div className="flex items-center gap-2 mb-5">
        <div className={`p-2 rounded-lg ${status.bg}`}>
          <svg className={`w-5 h-5 ${status.color}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" />
          </svg>
        </div>
        <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">
          Temperature
        </h2>
      </div>

      {/* Large temperature display */}
      <div className="flex items-baseline gap-1 mb-3">
        <span className={`text-4xl font-extrabold tabular-nums ${temp !== null ? 'text-slate-900' : 'text-slate-300'}`}>
          {temp !== null ? temp.toFixed(1) : '—'}
        </span>
        {temp !== null && (
          <span className="text-lg font-semibold text-slate-400">°C</span>
        )}
      </div>

      {/* Status badge */}
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${status.dot}`} />
        <span className={`text-xs font-semibold ${status.color}`}>
          {status.label}
        </span>
      </div>

      {/* Temperature range bar */}
      <div className="mt-4 relative">
        <div className="flex justify-between text-[10px] text-slate-400 mb-1">
          <span>35°C</span>
          <span>37°C</span>
          <span>40°C</span>
        </div>
        <div className="relative w-full h-2 bg-gradient-to-r from-blue-200 via-emerald-200 via-60% to-red-300 rounded-full">
          {/* Position marker */}
          {temp !== null && (
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white rounded-full shadow-md border-2 transition-all duration-700 ease-out"
              style={{
                left: `${Math.min(100, Math.max(0, ((temp - 35) / 5) * 100))}%`,
                borderColor: temp <= 37.2 ? '#10B981' : temp <= 38 ? '#F59E0B' : '#EF4444',
                transform: 'translate(-50%, -50%)',
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
