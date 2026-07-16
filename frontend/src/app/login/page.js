/**
 * WellSim — Login Page
 * 
 * Clinical-themed authentication interface.
 * Validates credentials against the Express backend.
 */

'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, Lock, Mail, Eye, EyeOff, AlertCircle, LogIn } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Check if already logged in
  useEffect(() => {
    const token = localStorage.getItem('wellsim_token');
    if (token) {
      window.location.href = '/';
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
        setError(data.error || 'Login failed. Please try again.');
        setIsLoading(false);
        return;
      }

      // Store token and user info
      localStorage.setItem('wellsim_token', data.token);
      localStorage.setItem('wellsim_user', JSON.stringify(data.user));

      // Redirect to dashboard
      window.location.href = '/';
    } catch (err) {
      setError('Unable to connect to server. Please check your network.');
      setIsLoading(false);
    }
  };

  const fillCredentials = (role) => {
    if (role === 'nurse') {
      setEmail('nurse@wellsim.com');
      setPassword('password123');
    } else {
      setEmail('doctor@wellsim.com');
      setPassword('password123');
    }
    setError('');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-cyan-50/20 flex items-center justify-center p-4">
      
      {/* Background pattern */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-blue-200/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-cyan-200/20 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        
        {/* Logo & Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-600 to-cyan-500 shadow-lg shadow-blue-500/25 mb-4">
            <Activity className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
            Well<span className="text-blue-600">Sim</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Smart Respiratory &amp; Cardiovascular Screening
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 p-8">
          <div className="mb-6">
            <h2 className="text-lg font-bold text-slate-800">Sign in</h2>
            <p className="text-xs text-slate-400 mt-0.5">Enter your credentials to access the triage dashboard</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Error Alert */}
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Email Field */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@wellsim.com"
                  required
                  className="w-full pl-10 pr-4 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition"
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  className="w-full pl-10 pr-10 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 transition"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 text-sm font-bold text-white bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 rounded-xl shadow-sm transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Signing in...
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  Sign in to Dashboard
                </>
              )}
            </button>
          </form>

          {/* Quick Login Presets (for demo/testing) */}
          <div className="mt-6 pt-5 border-t border-slate-100">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">Quick Login (Demo)</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => fillCredentials('nurse')}
                className="px-3 py-2 text-xs font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 transition active:scale-[0.97]"
              >
                🩺 Nurse Login
              </button>
              <button
                onClick={() => fillCredentials('doctor')}
                className="px-3 py-2 text-xs font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 transition active:scale-[0.97]"
              >
                👨‍⚕️ Doctor Login
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-[11px] text-slate-400 mt-6">
          WellSim IoT Healthcare Platform — Prototype v1.1
        </p>
      </div>
    </div>
  );
}
