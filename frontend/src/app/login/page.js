/**
 * WellSim — Login Page (UI v3 "Instrument")
 *
 * Quiet, editorial sign-in. Validates credentials against the
 * Express backend. Theme-aware; one thin ECG trace as the only
 * ornament — and even that is telemetry.
 */

'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import ThemeToggle from '../../components/ThemeToggle';
import LangToggle from '../../components/LangToggle';
import { useLang } from '../../i18n/LanguageContext';

function PulseMark({ className = 'w-4 h-4' }) {
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

export default function LoginPage() {
  const router = useRouter();
  const { t } = useLang();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Check if already logged in
  useEffect(() => {
    const token = localStorage.getItem('wellsim_token');
    if (token) {
      let role = null;
      try {
        role = JSON.parse(localStorage.getItem('wellsim_user') || 'null')?.role;
      } catch { /* ignore */ }
      window.location.href = role === 'patient' ? '/portal' : '/';
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const API_URL = 'https://wellsim-backend.onrender.com';
      const response = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || t('login.failed'));
        setIsLoading(false);
        return;
      }

      // Store token and user info
      localStorage.setItem('wellsim_token', data.token);
      localStorage.setItem('wellsim_user', JSON.stringify(data.user));

      // Redirect by role: patients go to their portal
      window.location.href = data.user.role === 'patient' ? '/portal' : '/';
    } catch (err) {
      setError(t('login.netError'));
      setIsLoading(false);
    }
  };

  const fillCredentials = (role) => {
    if (role === 'nurse') {
      setEmail('nurse@wellsim.com');
    } else if (role === 'patient') {
      setEmail('patient@wellsim.com');
    } else {
      setEmail('doctor@wellsim.com');
    }
    setPassword('password123');
    setError('');
  };

  return (
    <div className="min-h-screen bg-paper dark:bg-coal-950 transition-colors duration-300 flex items-center justify-center p-4">

      {/* Brand — pinned to the page corner like a letterhead */}
      <div className="fixed top-5 left-5 sm:top-6 sm:left-6 flex items-center gap-3 animate-fade-in">
        <div className="w-7 h-7 rounded bg-ink dark:bg-chalk flex items-center justify-center">
          <PulseMark className="w-4 h-4 text-white dark:text-coal-950" />
        </div>
        <div className="leading-tight">
          <p className="text-[15px] font-semibold tracking-tight text-ink dark:text-chalk">WellSim</p>
          <p className="microlabel">{t('brand.tagline')}</p>
        </div>
      </div>

      <div className="fixed top-5 right-5 sm:top-6 sm:right-6 animate-fade-in flex items-center gap-2">
        <LangToggle />
        <ThemeToggle />
      </div>

      {/* One thin ECG trace along the bottom — telemetry as ornament */}
      <svg
        viewBox="0 0 1200 60"
        preserveAspectRatio="none"
        className="fixed bottom-16 left-0 w-full h-14 pointer-events-none text-med-600/25 dark:text-med-300/20"
        aria-hidden="true"
      >
        <path
          d="M0 30 H180 L200 30 210 10 224 50 234 30 H480 L500 30 510 14 524 46 534 30 H780 L800 30 810 8 824 52 834 30 H1080 L1100 30 1110 16 1124 44 1134 30 H1200"
          fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
          strokeDasharray="520" className="animate-ecg"
        />
      </svg>

      {/* Sign-in card */}
      <div className="w-full max-w-sm will-fade-up">
        <div className="card p-7">
          <p className="microlabel">{t('login.kicker')}</p>
          <h1 className="text-2xl font-light tracking-tight text-ink dark:text-chalk mt-1.5">{t('login.title')}</h1>
          <p className="text-xs text-muted dark:text-chalk-muted mt-1.5 leading-relaxed">
            {t('login.subtitle')}
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {error && (
              <div className="border-l-2 border-risk-high dark:border-risk-highd bg-risk-high/[0.05] dark:bg-risk-highd/[0.07] px-3 py-2.5 animate-fade-in">
                <p className="text-xs text-risk-high dark:text-risk-highd">{error}</p>
              </div>
            )}

            <div>
              <label className="microlabel block mb-1.5">{t('login.email')}</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@wellsim.com"
                required
                className="field"
              />
            </div>

            <div>
              <label className="microlabel block mb-1.5">{t('login.password')}</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="field !pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink dark:text-chalk-muted dark:hover:text-chalk transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={isLoading} className="btn-ink w-full !py-2.5">
              {isLoading ? (
                <>
                  <span className="relative w-16 h-px bg-white/30 dark:bg-coal-950/30 overflow-hidden inline-block">
                    <span className="absolute inset-y-0 w-6 bg-white dark:bg-coal-950 animate-sweep" />
                  </span>
                  {t('login.submitting')}
                </>
              ) : (
                t('login.submit')
              )}
            </button>
          </form>

          {/* Demo access */}
          <div className="mt-6 pt-5 border-t border-hairline dark:border-coal-700">
            <p className="microlabel mb-2.5">{t('login.demo')}</p>
            <div className="grid grid-cols-3 gap-2">
              <button onClick={() => fillCredentials('nurse')} className="btn-line font-mono !text-[11px] uppercase tracking-wider">
                {t('login.nurse')}
              </button>
              <button onClick={() => fillCredentials('doctor')} className="btn-line font-mono !text-[11px] uppercase tracking-wider">
                {t('login.doctor')}
              </button>
              <button onClick={() => fillCredentials('patient')} className="btn-line font-mono !text-[11px] uppercase tracking-wider">
                {t('login.patientDemo')}
              </button>
            </div>
            <p className="text-xs text-muted dark:text-chalk-muted mt-4 text-center">
              {t('login.noAccount')}{' '}
              <a href="/register" className="font-medium text-med-600 dark:text-med-300 hover:underline underline-offset-2">
                {t('login.create')}
              </a>
            </p>
          </div>
        </div>

        <p className="font-mono text-[10px] text-muted/60 dark:text-chalk-muted/50 text-center uppercase tracking-[0.14em] mt-5">
          {t('login.footer')}
        </p>
      </div>
    </div>
  );
}
