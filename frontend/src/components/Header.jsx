/**
 * WellSim — Header Component
 * 
 * Top navigation bar with branding, live clock, and connection indicator.
 */

'use client';

import { useState, useEffect } from 'react';

export default function Header({ isConnected, lastUpdated }) {
  const [currentTime, setCurrentTime] = useState(new Date());

  // Update clock every second
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (date) =>
    date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

  const formatDate = (date) =>
    date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

  return (
    <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-slate-200/60">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* ── Branding ── */}
          <div className="flex items-center gap-3">
            {/* Logo mark */}
            <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-medical-500 to-medical-700 shadow-medical">
              <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
              {/* Live pulse dot */}
              {isConnected && (
                <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                  <span className="animate-ping-ring absolute inline-flex h-full w-full rounded-full bg-vitals-green opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-vitals-green" />
                </span>
              )}
            </div>

            <div>
              <h1 className="text-lg font-bold text-slate-900 tracking-tight leading-none">
                Well<span className="text-medical-600">Sim</span>
              </h1>
              <p className="text-[10px] font-medium text-slate-400 uppercase tracking-widest leading-none mt-0.5">
                IoT Health Monitor
              </p>
            </div>
          </div>

          {/* ── Center — Live Status ── */}
          <div className="hidden md:flex items-center gap-2 px-4 py-1.5 rounded-full bg-slate-50 border border-slate-100">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-vitals-green animate-pulse' : 'bg-vitals-red'}`} />
            <span className="text-xs font-medium text-slate-500">
              {isConnected ? 'Live Data Stream' : 'Waiting for Device'}
            </span>
          </div>

          {/* ── Right — Clock ── */}
          <div className="text-right">
            <p className="text-sm font-semibold text-slate-800 tabular-nums">
              {formatTime(currentTime)}
            </p>
            <p className="text-[11px] text-slate-400">
              {formatDate(currentTime)}
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}
