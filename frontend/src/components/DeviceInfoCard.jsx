/**
 * WellSim — DeviceInfoCard Component
 * 
 * Displays device identification, last update time, and connection status.
 * This is the primary device overview card on the dashboard.
 */

'use client';

import StatusIndicator from './StatusIndicator';

export default function DeviceInfoCard({ data, status, hasNewData }) {
  const deviceId = data?.device_id || '—';
  const lastUpdate = data?._receivedAt
    ? new Date(data._receivedAt).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
    : 'No data received';

  const connectionStatus = status?.status || 'offline';
  const readingsCount = status?.readings_count || 0;

  return (
    <div className={`card p-6 ${hasNewData ? 'animate-data-flash' : ''}`}>
      {/* Card header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-medical-50">
            <svg className="w-5 h-5 text-medical-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
              <path d="M16 3h-8l-2 4h12z" />
            </svg>
          </div>
          <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">
            Device Info
          </h2>
        </div>
        <StatusIndicator status={connectionStatus} />
      </div>

      {/* Device ID — large display */}
      <div className="mb-4">
        <p className="text-xs text-slate-400 font-medium mb-1">Device ID</p>
        <p className="text-2xl font-bold text-slate-900 tracking-tight font-mono">
          {deviceId}
        </p>
      </div>

      {/* Meta info grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="px-3 py-2.5 bg-slate-50 rounded-xl">
          <p className="text-[10px] text-slate-400 uppercase tracking-wider font-medium mb-0.5">
            Last Update
          </p>
          <p className="text-xs font-semibold text-slate-700 tabular-nums">
            {lastUpdate}
          </p>
        </div>
        <div className="px-3 py-2.5 bg-slate-50 rounded-xl">
          <p className="text-[10px] text-slate-400 uppercase tracking-wider font-medium mb-0.5">
            Total Readings
          </p>
          <p className="text-xs font-semibold text-slate-700 tabular-nums">
            {readingsCount}
          </p>
        </div>
      </div>
    </div>
  );
}
