/**
 * WellSim — Instrument tick: where a reading sits against its band.
 *
 * The shaded run is the reference range; the tick is the measurement.
 * A number alone says "94"; this says "94, just under the line".
 */

export default function TickBar({ value, min, max, okMin, okMax, tone = 'ok' }) {
  const clamp = (val, a, b) => Math.min(Math.max(Number(val) || 0, a), b);
  const pct = ((clamp(value, min, max) - min) / (max - min)) * 100;
  const okStart = ((okMin - min) / (max - min)) * 100;
  const okWidth = ((okMax - okMin) / (max - min)) * 100;
  const tickCls =
    tone === 'bad'
      ? 'bg-risk-high dark:bg-risk-highd'
      : tone === 'warn'
        ? 'bg-risk-mod dark:bg-risk-modd'
        : 'bg-med-600 dark:bg-med-300';

  return (
    <div className="relative h-[3px] mt-3 bg-hairline dark:bg-coal-700">
      <div
        className="absolute inset-y-0 bg-ink/[0.09] dark:bg-white/[0.09]"
        style={{ left: `${okStart}%`, width: `${okWidth}%` }}
      />
      <div
        className={`absolute -top-[4px] w-[2px] h-[11px] transition-all duration-700 ${tickCls}`}
        style={{ left: `calc(${pct}% - 1px)` }}
      />
    </div>
  );
}
