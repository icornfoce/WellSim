/**
 * WellSim — Full-screen loader.
 *
 * The instrument idiom: the mark, a sweep line, and a mono caption
 * saying what is being waited on. Named, because "loading" on its own
 * does not distinguish verifying a session from fetching a record.
 *
 * Three identical copies of this lived in RouteGuard, the dashboard
 * and the portal.
 */

'use client';

import PulseMark from './PulseMark';

export default function LoadingScreen({ label }) {
  return (
    <div className="min-h-screen bg-paper dark:bg-coal-950 flex items-center justify-center transition-colors duration-300">
      <div className="text-center animate-fade-in" role="status" aria-live="polite">
        <div className="w-8 h-8 mx-auto rounded bg-ink dark:bg-chalk flex items-center justify-center">
          <PulseMark className="w-4 h-4 text-white dark:text-coal-950" />
        </div>
        <div className="relative w-40 h-px bg-hairline dark:bg-coal-700 mx-auto mt-6 overflow-hidden">
          <div className="absolute inset-y-0 w-12 bg-ink dark:bg-chalk animate-sweep" />
        </div>
        <p className="microlabel mt-4">{label}</p>
      </div>
    </div>
  );
}
