/**
 * WellSim — RouteGuard Component (UI v3)
 *
 * Wraps protected pages. Checks for a valid auth token in localStorage.
 * Redirects to /login if not authenticated.
 */

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLang } from '../i18n/LanguageContext';

export default function RouteGuard({ children }) {
  const router = useRouter();
  const { t } = useLang();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('wellsim_token');
    const userStr = localStorage.getItem('wellsim_user');

    if (!token || !userStr) {
      window.location.href = '/login';
      return;
    }

    try {
      const userData = JSON.parse(userStr);
      setUser(userData);
      setIsAuthenticated(true);
    } catch {
      // Invalid user data — force re-login
      localStorage.removeItem('wellsim_token');
      localStorage.removeItem('wellsim_user');
      window.location.href = '/login';
    }

    setIsChecking(false);
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem('wellsim_token');
    localStorage.removeItem('wellsim_user');
    router.push('/login');
  };

  // Quiet instrument-style loader: mark, sweep line, mono caption
  if (isChecking || !isAuthenticated) {
    return (
      <div className="min-h-screen bg-paper dark:bg-coal-950 flex items-center justify-center transition-colors duration-300">
        <div className="text-center animate-fade-in">
          <div className="w-8 h-8 mx-auto rounded bg-ink dark:bg-chalk flex items-center justify-center">
            <svg viewBox="0 0 16 16" className="w-4 h-4 text-white dark:text-coal-950">
              <path d="M1 8h3.2l1.6-4.5 2.9 9 1.9-4.5H15" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="relative w-40 h-px bg-hairline dark:bg-coal-700 mx-auto mt-6 overflow-hidden">
            <div className="absolute inset-y-0 w-12 bg-ink dark:bg-chalk animate-sweep" />
          </div>
          <p className="microlabel mt-4">{t('guard.verifying')}</p>
        </div>
      </div>
    );
  }

  return children;
}
