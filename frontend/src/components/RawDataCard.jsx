/**
 * WellSim — RawDataCard Component
 * 
 * Displays the raw JSON payload received from the ESP32.
 * Useful for debugging and verification during development.
 * Includes syntax-highlighted JSON with copy functionality.
 */

'use client';

import { useState } from 'react';

export default function RawDataCard({ data, hasNewData }) {
  const [copied, setCopied] = useState(false);

  // Format JSON with indentation, exclude internal server fields
  const formatJson = (obj) => {
    if (!obj) return 'No data received yet.';
    // Show the raw ESP32 payload without server-added fields
    const displayData = { ...obj };
    delete displayData._receivedAt;
    delete displayData._serverTimestamp;
    return JSON.stringify(displayData, null, 2);
  };

  const jsonString = formatJson(data);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(jsonString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      console.warn('Clipboard API not available');
    }
  };

  return (
    <div className={`card p-6 ${hasNewData ? 'animate-data-flash' : ''}`}>
      {/* Card header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-slate-100">
            <svg className="w-5 h-5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
          </div>
          <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">
            Raw JSON
          </h2>
        </div>

        {/* Copy button */}
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg
                     bg-slate-50 text-slate-500 border border-slate-200
                     hover:bg-slate-100 hover:text-slate-700 transition-all duration-200
                     active:scale-95"
        >
          {copied ? (
            <>
              <svg className="w-3.5 h-3.5 text-vitals-green" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Copied
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              Copy
            </>
          )}
        </button>
      </div>

      {/* JSON display */}
      <div className="relative rounded-xl bg-slate-900 p-4 overflow-auto max-h-64">
        <pre className="text-xs font-mono text-slate-300 leading-relaxed whitespace-pre-wrap break-all">
          <code>{jsonString}</code>
        </pre>
      </div>

      {/* Server metadata */}
      {data?._receivedAt && (
        <p className="mt-3 text-[11px] text-slate-400">
          Received by server at{' '}
          <span className="font-medium text-slate-500 tabular-nums">
            {new Date(data._receivedAt).toLocaleString()}
          </span>
        </p>
      )}
    </div>
  );
}
