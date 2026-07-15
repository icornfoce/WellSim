/**
 * WellSim — BatteryCard Component
 * 
 * Displays battery level with a visual gauge, percentage,
 * and color-coded status (green/amber/red).
 */

'use client';

export default function BatteryCard({ battery, hasNewData }) {
  const level = typeof battery === 'number' ? battery : null;

  // Determine color based on battery level
  const getColor = (pct) => {
    if (pct === null) return { bar: 'bg-slate-200', text: 'text-slate-400', ring: 'bg-slate-100' };
    if (pct >= 60) return { bar: 'bg-vitals-green', text: 'text-vitals-green', ring: 'bg-emerald-50' };
    if (pct >= 25) return { bar: 'bg-vitals-amber', text: 'text-vitals-amber', ring: 'bg-amber-50' };
    return { bar: 'bg-vitals-red', text: 'text-vitals-red', ring: 'bg-red-50' };
  };

  const color = getColor(level);

  // Battery icon with fill
  const batteryFill = level !== null ? Math.max(4, (level / 100) * 36) : 0;

  return (
    <div className={`card p-6 ${hasNewData ? 'animate-data-flash' : ''}`}>
      {/* Card header */}
      <div className="flex items-center gap-2 mb-5">
        <div className={`p-2 rounded-lg ${color.ring}`}>
          <svg className={`w-5 h-5 ${color.text}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1" y="6" width="18" height="12" rx="2" ry="2" />
            <line x1="23" y1="13" x2="23" y2="11" />
          </svg>
        </div>
        <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">
          Battery
        </h2>
      </div>

      {/* Large percentage display */}
      <div className="flex items-baseline gap-1 mb-4">
        <span className={`text-4xl font-extrabold tabular-nums ${level !== null ? 'text-slate-900' : 'text-slate-300'}`}>
          {level !== null ? level : '—'}
        </span>
        {level !== null && (
          <span className="text-lg font-semibold text-slate-400">%</span>
        )}
      </div>

      {/* Battery progress bar */}
      <div className="relative w-full h-3 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${color.bar}`}
          style={{ width: level !== null ? `${level}%` : '0%' }}
        />
      </div>

      {/* Status label */}
      <p className={`mt-2.5 text-xs font-medium ${color.text}`}>
        {level === null && 'No data'}
        {level !== null && level >= 60 && 'Good'}
        {level !== null && level >= 25 && level < 60 && 'Low — charge soon'}
        {level !== null && level < 25 && 'Critical — charge now'}
      </p>
    </div>
  );
}
