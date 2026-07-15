/**
 * WellSim — AudioStatusCard Component
 * 
 * Displays audio recording status and sample rate.
 * Shows animated waveform when actively recording.
 */

'use client';

export default function AudioStatusCard({ audioStatus, sampleRate, hasNewData }) {
  const isRecording = audioStatus === 'recording';
  const displayStatus = audioStatus || '—';
  const displayRate = typeof sampleRate === 'number' ? `${(sampleRate / 1000).toFixed(0)} kHz` : '—';

  return (
    <div className={`card p-6 ${hasNewData ? 'animate-data-flash' : ''}`}>
      {/* Card header */}
      <div className="flex items-center gap-2 mb-5">
        <div className={`p-2 rounded-lg ${isRecording ? 'bg-blue-50' : 'bg-slate-50'}`}>
          <svg className={`w-5 h-5 ${isRecording ? 'text-medical-600' : 'text-slate-400'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </div>
        <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">
          Audio
        </h2>
      </div>

      {/* Status display */}
      <div className="flex items-center gap-3 mb-4">
        {/* Recording indicator */}
        {isRecording && (
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-vitals-red opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-vitals-red" />
          </span>
        )}
        <span className={`text-2xl font-bold capitalize ${isRecording ? 'text-slate-900' : 'text-slate-400'}`}>
          {displayStatus}
        </span>
      </div>

      {/* Animated waveform when recording */}
      {isRecording && (
        <div className="flex items-end justify-center gap-[3px] h-10 mb-4">
          {[...Array(20)].map((_, i) => (
            <div
              key={i}
              className="w-[3px] rounded-full bg-gradient-to-t from-medical-500 to-medical-300"
              style={{
                height: `${Math.random() * 70 + 30}%`,
                animation: `waveform 0.8s ease-in-out ${i * 0.05}s infinite alternate`,
              }}
            />
          ))}
          <style jsx>{`
            @keyframes waveform {
              0% { height: 20%; }
              100% { height: ${Math.random() * 60 + 40}%; }
            }
          `}</style>
        </div>
      )}

      {/* Sample rate */}
      <div className="px-3 py-2.5 bg-slate-50 rounded-xl">
        <p className="text-[10px] text-slate-400 uppercase tracking-wider font-medium mb-0.5">
          Sample Rate
        </p>
        <p className="text-sm font-bold text-slate-700 tabular-nums">
          {displayRate}
        </p>
      </div>
    </div>
  );
}
