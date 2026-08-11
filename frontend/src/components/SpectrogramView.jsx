/**
 * WellSim — Log-Mel Spectrogram Viewer
 *
 * Renders the exact time–frequency representation the analysis engine
 * classified, with the anomaly segments it flagged drawn on top.
 *
 * This is the "explainable" half of the design: a physician can see
 * *where* in the recording the engine found something and check it
 * against what they hear, rather than being handed a bare verdict.
 */

'use client';

import React, { useRef, useEffect, useState } from 'react';
import { useLang } from '../i18n/LanguageContext';

/** Ink-on-paper heatmap ramp — dark = high energy, matching the print aesthetic. */
function rampLight(v) {
  // 0 → paper white, 1 → deep clinical green-black
  const t = Math.max(0, Math.min(1, v));
  const r = Math.round(246 - t * 226);
  const g = Math.round(246 - t * 170);
  const b = Math.round(244 - t * 190);
  return [r, g, b];
}

function rampDark(v) {
  const t = Math.max(0, Math.min(1, v));
  // 0 → near-black, 1 → med-300 green
  const r = Math.round(11 + t * 84);
  const g = Math.round(13 + t * 186);
  const b = Math.round(12 + t * 166);
  return [r, g, b];
}

const SEGMENT_STYLE = {
  wheeze:      { color: '#C4453C', label: 'WHEEZE' },
  crackle:     { color: '#A97B22', label: 'CRACKLE' },
  heart_sound: { color: '#0E7C66', label: 'S1/S2' },
  cough:       { color: '#A97B22', label: 'COUGH' },
};

export default function SpectrogramView({
  spectrogram,
  segments = [],
  progress = 0,
  isDark = false,
  height = 132,
}) {
  const canvasRef = useRef(null);
  const [hovered, setHovered] = useState(null);
  const { t } = useLang();

  const matrix = spectrogram?.matrix || [];
  const duration = spectrogram?.durationSec || 0;
  const maxHz = spectrogram?.maxHz || 4000;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !matrix.length) return;

    const cols = matrix.length;
    const rows = matrix[0]?.length || 1;

    // Draw at native matrix resolution, then let CSS scale it up.
    // imageSmoothing keeps the result readable rather than blocky.
    canvas.width = cols;
    canvas.height = rows;

    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(cols, rows);
    const ramp = isDark ? rampDark : rampLight;

    for (let x = 0; x < cols; x++) {
      for (let y = 0; y < rows; y++) {
        // Row 0 of the matrix is the lowest mel band — flip so low
        // frequencies sit at the bottom, as a spectrogram should read.
        const value = matrix[x][rows - 1 - y] ?? 0;
        const [r, g, b] = ramp(value);
        const i = (y * cols + x) * 4;
        image.data[i] = r;
        image.data[i + 1] = g;
        image.data[i + 2] = b;
        image.data[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  }, [matrix, isDark]);

  if (!matrix.length) return null;

  const pct = (t) => (duration > 0 ? (t / duration) * 100 : 0);

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-1.5">
        <p className="microlabel">{t('ai.spectrogram')}</p>
        <p className="datum">
          0–{Math.round(maxHz / 1000 * 10) / 10} kHz · {duration}s
        </p>
      </div>

      <div
        className="relative rounded border border-hairline dark:border-coal-700 overflow-hidden bg-paper dark:bg-coal-950"
        style={{ height }}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ imageRendering: 'auto' }}
        />

        {/* Anomaly overlays — where the engine says it found something */}
        {segments.map((seg, i) => {
          const style = SEGMENT_STYLE[seg.type] || SEGMENT_STYLE.wheeze;
          const left = pct(seg.start);
          const width = Math.max(0.6, pct(seg.end) - pct(seg.start));
          return (
            <div
              key={i}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              className="absolute top-0 bottom-0 cursor-help transition-opacity duration-200"
              style={{
                left: `${left}%`,
                width: `${width}%`,
                backgroundColor: `${style.color}2E`,
                borderLeft: `1.5px solid ${style.color}`,
                borderRight: width > 1.5 ? `1.5px solid ${style.color}` : 'none',
                opacity: hovered === null || hovered === i ? 1 : 0.35,
              }}
              title={`${style.label} · ${seg.start}s – ${seg.end}s${
                seg.dominantHz ? ` · ${seg.dominantHz} Hz` : ''
              }${seg.widthMs ? ` · ${seg.widthMs} ms` : ''}`}
            />
          );
        })}

        {/* Playhead */}
        {progress > 0 && (
          <div
            className="absolute top-0 bottom-0 w-px bg-white mix-blend-difference pointer-events-none"
            style={{ left: `${progress}%` }}
          />
        )}

        {/* Frequency axis ticks. Drawn over the heatmap, so each label
            carries its own plate rather than relying on a text-shadow
            that disappeared over mid-tone bands at 8px. */}
        <div className="absolute left-0 top-0 bottom-0 w-10 pointer-events-none flex flex-col justify-between py-1">
          {[maxHz, maxHz / 2, 0].map((hz, i) => (
            <span
              key={i}
              className="font-mono text-[10px] tabular-nums ml-1 px-1 rounded-[2px]
                         bg-paper/85 text-ink dark:bg-coal-950/85 dark:text-chalk"
            >
              {hz >= 1000 ? `${Math.round(hz / 100) / 10}k` : Math.round(hz)}
            </span>
          ))}
        </div>
      </div>

      {/* Legend — only the segment types actually present */}
      {segments.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
          {[...new Set(segments.map((s) => s.type))].map((type) => {
            const style = SEGMENT_STYLE[type] || SEGMENT_STYLE.wheeze;
            const count = segments.filter((s) => s.type === type).length;
            return (
              <span key={type} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-[1px]" style={{ backgroundColor: style.color }} />
                <span className="datum !text-ink dark:!text-chalk">
                  {style.label} ×{count}
                </span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
