/**
 * WellSim — Register Page (UI v3 "Instrument")
 *
 * Creates a real staff account against the Express backend
 * (POST /api/auth/register), then signs the user straight in.
 */

'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Eye, EyeOff } from 'lucide-react';
import ThemeToggle from '../../components/ThemeToggle';
import LangToggle from '../../components/LangToggle';
import PulseMark from '../../components/ui/PulseMark';
import { useLang } from '../../i18n/LanguageContext';
import { register } from '../../services/api';

export default function RegisterPage() {
  const { t } = useLang();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('nurse');
  const [station, setStation] = useState('');
  const [staffCode, setStaffCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Already signed in → go straight to the dashboard
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

    // Client-side checks mirror the backend rules
    if (name.trim().length < 2) {
      setError(t('register.errName'));
      return;
    }
    if (password.length < 6) {
      setError(t('register.errPass'));
      return;
    }
    if (password !== confirm) {
      setError(t('register.errMatch'));
      return;
    }

    setIsLoading(true);
    try {
      const data = await register({
        name: name.trim(),
        email: email.trim(),
        password,
        role,
        station: station.trim(),
        staffCode: role === 'patient' ? undefined : staffCode.trim(),
      });

      // Auto-login with the returned token
      localStorage.setItem('wellsim_token', data.token);
      localStorage.setItem('wellsim_user', JSON.stringify(data.user));
      window.location.href = data.user.role === 'patient' ? '/portal' : '/';
    } catch (err) {
      setError(err.message || t('login.netError'));
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-paper dark:bg-coal-950 transition-colors duration-300 flex items-center justify-center p-4 py-16">

      {/* Brand — pinned to the page corner like a letterhead */}
      <div className="fixed top-5 left-5 sm:top-6 sm:left-6 flex items-center gap-3 animate-fade-in z-10">
        <div className="w-7 h-7 rounded bg-ink dark:bg-chalk flex items-center justify-center">
          <PulseMark className="w-4 h-4 text-white dark:text-coal-950" />
        </div>
        <div className="leading-tight">
          <p className="text-[15px] font-semibold tracking-tight text-ink dark:text-chalk">WellSim</p>
          <p className="microlabel">{t('brand.tagline')}</p>
        </div>
      </div>

      <div className="fixed top-5 right-5 sm:top-6 sm:right-6 animate-fade-in z-10 flex items-center gap-2">
        <LangToggle />
        <ThemeToggle />
      </div>

      {/* One thin ECG trace along the bottom */}
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

      {/* Registration card */}
      <div className="w-full max-w-sm will-fade-up">
        <div className="card p-7">
          <p className="microlabel">{t('register.kicker')}</p>
          <h1 className="text-2xl font-light tracking-tight text-ink dark:text-chalk mt-1.5">{t('register.title')}</h1>
          <p className="text-xs text-muted dark:text-chalk-muted mt-1.5 leading-relaxed">
            {t('register.subtitle')}
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {error && (
              <div role="alert" className="border-l-2 border-risk-high dark:border-risk-highd bg-risk-high/[0.05] dark:bg-risk-highd/[0.07] px-3 py-2.5 animate-fade-in">
                <p className="text-xs text-risk-high dark:text-risk-highd">{error}</p>
              </div>
            )}

            <div>
              <label htmlFor="reg-name" className="microlabel block mb-1.5">{t('register.fullName')}</label>
              <input
                id="reg-name"
                name="name"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('register.namePh')}
                required
                className="field"
                autoFocus
              />
            </div>

            <div>
              <label htmlFor="reg-email" className="microlabel block mb-1.5">{t('login.email')}</label>
              <input
                id="reg-email"
                name="email"
                type="email"
                autoComplete="username"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@wellsim.com"
                required
                className="field"
              />
            </div>

            {/* Role — segmented control */}
            <div>
              {/* Three buttons, not a field: a <label> here pointed at
                  nothing. A labelled group is what this actually is. */}
              <p className="microlabel block mb-1.5" id="reg-role-label">{t('register.role')}</p>
              <div className="grid grid-cols-3 gap-2" role="group" aria-labelledby="reg-role-label">
                <button
                  type="button"
                  onClick={() => setRole('nurse')}
                  aria-pressed={role === 'nurse'}
                  className={role === 'nurse' ? 'btn-ink !py-2' : 'btn-line !py-2'}
                >
                  {t('register.nurse')}
                </button>
                <button
                  type="button"
                  onClick={() => setRole('doctor')}
                  aria-pressed={role === 'doctor'}
                  className={role === 'doctor' ? 'btn-ink !py-2' : 'btn-line !py-2'}
                >
                  {t('register.doctor')}
                </button>
                <button
                  type="button"
                  onClick={() => setRole('patient')}
                  aria-pressed={role === 'patient'}
                  className={role === 'patient' ? 'btn-ink !py-2' : 'btn-line !py-2'}
                >
                  {t('register.patient')}
                </button>
              </div>
            </div>

            {role !== 'patient' && (
              <div>
                <label htmlFor="reg-station" className="microlabel block mb-1.5">{t('register.station')} <span className="normal-case tracking-normal">{t('register.optional')}</span></label>
                <input
                  id="reg-station"
                  name="station"
                  type="text"
                  autoComplete="organization"
                  value={station}
                  onChange={(e) => setStation(e.target.value)}
                  placeholder={role === 'doctor' ? t('register.stationPhDoctor') : t('register.stationPhNurse')}
                  className="field"
                />
              </div>
            )}

            {/* Clinical roles decide whether an AI result becomes a
                finding, so they cannot be self-assigned from a public
                form. The server rejects the request without this. */}
            {role !== 'patient' && (
              <div>
                <label htmlFor="reg-staffcode" className="microlabel block mb-1.5">{t('register.staffCode')}</label>
                <input
                  id="reg-staffcode"
                  name="staffCode"
                  type="password"
                  value={staffCode}
                  onChange={(e) => setStaffCode(e.target.value)}
                  placeholder={t('register.staffCodePh')}
                  className="field"
                  autoComplete="off"
                />
                <p className="note-sm mt-1.5">
                  {t('register.staffCodeNote')}
                </p>
              </div>
            )}

            <div>
              <label htmlFor="reg-password" className="microlabel block mb-1.5">{t('login.password')}</label>
              <div className="relative">
                <input
                  id="reg-password"
                  name="new-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('register.passwordPh')}
                  required
                  minLength={6}
                  className="field !pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? t('a11y.hidePassword') : t('a11y.showPassword')}
                  className="tap-target absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink dark:text-chalk-muted dark:hover:text-chalk transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="reg-confirm" className="microlabel block mb-1.5">{t('register.confirm')}</label>
              <input
                id="reg-confirm"
                name="confirm-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={t('register.confirmPh')}
                required
                minLength={6}
                className="field"
              />
              {confirm.length > 0 && (
                <p className={`font-mono text-[10px] mt-1.5 ${
                  password === confirm
                    ? 'text-med-600 dark:text-med-300'
                    : 'text-risk-high dark:text-risk-highd'
                }`}>
                  {password === confirm ? t('register.match') : t('register.noMatch')}
                </p>
              )}
            </div>

            <button type="submit" disabled={isLoading} className="btn-ink w-full !py-2.5">
              {isLoading ? (
                <>
                  <span className="relative w-16 h-px bg-white/30 dark:bg-coal-950/30 overflow-hidden inline-block">
                    <span className="absolute inset-y-0 w-6 bg-white dark:bg-coal-950 animate-sweep" />
                  </span>
                  {t('register.submitting')}
                </>
              ) : (
                t('register.submit')
              )}
            </button>
          </form>

          <p className="text-xs text-muted dark:text-chalk-muted mt-5 pt-5 border-t border-hairline dark:border-coal-700 text-center">
            {t('register.have')}{' '}
            <Link href="/login" className="font-medium text-med-600 dark:text-med-300 hover:underline underline-offset-2">
              {t('register.signIn')}
            </Link>
          </p>
        </div>

        <p className="microlabel text-center mt-5">
          {t('login.footer')}
        </p>
      </div>
    </div>
  );
}
