/**
 * WellSim — The mark: a hand-drawn pulse trace.
 *
 * Was copy-pasted into five files (both dashboards, login, register,
 * RouteGuard). Five copies of one logo is five chances for it to drift.
 */

export default function PulseMark({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path
        d="M1 8h3.2l1.6-4.5 2.9 9 1.9-4.5H15"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
