/**
 * WellSim — WifiSignalCard Component
 * 
 * Displays WiFi signal strength with animated signal bars
 * and color-coded dBm value.
 */

'use client';

export default function WifiSignalCard({ wifiStrength, hasNewData }) {
  const rssi = typeof wifiStrength === 'number' ? wifiStrength : null;

  // Classify signal strength
  const getSignalInfo = (dbm) => {
    if (dbm === null) return { level: 0, label: 'No data', color: 'text-slate-400', barColor: 'bg-slate-200' };
    if (dbm >= -50) return { level: 4, label: 'Excellent', color: 'text-vitals-green', barColor: 'bg-vitals-green' };
    if (dbm >= -60) return { level: 3, label: 'Good', color: 'text-vitals-green', barColor: 'bg-vitals-green' };
    if (dbm >= -70) return { level: 2, label: 'Fair', color: 'text-vitals-amber', barColor: 'bg-vitals-amber' };
    return { level: 1, label: 'Weak', color: 'text-vitals-red', barColor: 'bg-vitals-red' };
  };

  const signal = getSignalInfo(rssi);

  // Signal bar heights (4 bars, increasing height)
  const barHeights = [6, 12, 18, 24];

  return (
    <div className={`card p-6 ${hasNewData ? 'animate-data-flash' : ''}`}>
      {/* Card header */}
      <div className="flex items-center gap-2 mb-5">
        <div className={`p-2 rounded-lg ${rssi !== null ? 'bg-blue-50' : 'bg-slate-50'}`}>
          <svg className={`w-5 h-5 ${rssi !== null ? 'text-medical-600' : 'text-slate-400'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.55a11 11 0 0 1 14.08 0" />
            <path d="M1.42 9a16 16 0 0 1 21.16 0" />
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
            <line x1="12" y1="20" x2="12.01" y2="20" />
          </svg>
        </div>
        <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">
          WiFi Signal
        </h2>
      </div>

      {/* RSSI value */}
      <div className="flex items-baseline gap-1 mb-1">
        <span className={`text-4xl font-extrabold tabular-nums ${rssi !== null ? 'text-slate-900' : 'text-slate-300'}`}>
          {rssi !== null ? rssi : '—'}
        </span>
        {rssi !== null && (
          <span className="text-lg font-semibold text-slate-400">dBm</span>
        )}
      </div>

      {/* Signal quality label */}
      <p className={`text-xs font-semibold mb-4 ${signal.color}`}>
        {signal.label}
      </p>

      {/* Signal strength bars */}
      <div className="flex items-end gap-1.5 h-7">
        {barHeights.map((height, idx) => {
          const isActive = idx < signal.level;
          return (
            <div
              key={idx}
              className={`w-4 rounded-sm transition-all duration-500 ${
                isActive ? signal.barColor : 'bg-slate-100'
              } ${isActive && rssi !== null ? `animate-wifi-${Math.min(idx + 1, 3)}` : ''}`}
              style={{ height: `${height}px` }}
            />
          );
        })}
      </div>
    </div>
  );
}
