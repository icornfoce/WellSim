/**
 * WellSim — StatusIndicator Component
 * 
 * Displays online/offline status with a pulsing dot and label.
 * Online: green pulse  |  Offline: red static dot
 */

'use client';

export default function StatusIndicator({ status, className = '' }) {
  const isOnline = status === 'online';

  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      {/* Pulsing status dot */}
      <span className="relative flex h-3 w-3">
        {isOnline && (
          <span className="animate-ping-ring absolute inline-flex h-full w-full rounded-full bg-vitals-green opacity-75" />
        )}
        <span
          className={`relative inline-flex rounded-full h-3 w-3 ${
            isOnline ? 'bg-vitals-green' : 'bg-vitals-red'
          }`}
        />
      </span>

      {/* Status label */}
      <span
        className={`text-sm font-semibold ${
          isOnline ? 'text-vitals-green' : 'text-vitals-red'
        }`}
      >
        {isOnline ? 'Online' : 'Offline'}
      </span>
    </div>
  );
}
