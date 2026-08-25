/**
 * WellSim — RouteGuard Component (UI v3)
 *
 * Wraps protected pages. Checks for a valid auth token in localStorage.
 * Redirects to /login if not authenticated.
 */

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import LoadingScreen from './ui/LoadingScreen';
import { useLang } from '../i18n/LanguageContext';
import { verifySession } from '../services/api';

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
      setIsChecking(false);
      router.replace('/login');
      return;
    }

    verifySession()
      .then((data) => {
        if (data.user) {
          setUser(data.user);
          localStorage.setItem('wellsim_user', JSON.stringify(data.user));
        } else {
          try {
            setUser(JSON.parse(userStr));
          } catch (e) {}
        }
        setIsAuthenticated(true);
        setIsChecking(false);
      })
      .catch((err) => {
        console.error('Session verification error:', err);
        localStorage.removeItem('wellsim_token');
        localStorage.removeItem('wellsim_user');
        setIsChecking(false);
        router.replace('/login');
      });
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem('wellsim_token');
    localStorage.removeItem('wellsim_user');
    router.replace('/login');
  };

  // Quiet instrument-style loader: mark, sweep line, mono caption
  if (isChecking || !isAuthenticated) {
    return (
      <LoadingScreen label={t('guard.verifying')} />
    );
  }

  return children;
}
