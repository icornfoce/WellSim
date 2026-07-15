/**
 * WellSim — Main Dashboard Page
 * 
 * Assembles all card components into a responsive grid layout.
 * Uses the useDeviceData hook for real-time polling and state management.
 */

'use client';

import Header from '../components/Header';
import DeviceInfoCard from '../components/DeviceInfoCard';
import BatteryCard from '../components/BatteryCard';
import TemperatureCard from '../components/TemperatureCard';
import AudioStatusCard from '../components/AudioStatusCard';
import WifiSignalCard from '../components/WifiSignalCard';
import RawDataCard from '../components/RawDataCard';
import { useDeviceData } from '../hooks/useDeviceData';

export default function DashboardPage() {
  const {
    deviceData,
    deviceStatus,
    isLoading,
    error,
    lastUpdated,
    hasNewData,
  } = useDeviceData();

  const isConnected = deviceStatus?.status === 'online';

  return (
    <div className="min-h-screen bg-slate-50">
      <Header isConnected={isConnected} lastUpdated={lastUpdated} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* ── Page Title Section ── */}
        <div className="mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold text-slate-900">
                Device Dashboard
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                Real-time monitoring of connected ESP32 sensors
              </p>
            </div>

            {/* Last updated indicator */}
            <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-xl border border-slate-100 shadow-card">
              <div className={`w-2 h-2 rounded-full ${
                isConnected ? 'bg-vitals-green animate-pulse' : 'bg-slate-300'
              }`} />
              <span className="text-xs text-slate-500">
                {lastUpdated
                  ? `Updated ${lastUpdated.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}`
                  : 'Waiting for data...'}
              </span>
            </div>
          </div>
        </div>

        {/* ── Loading State ── */}
        {isLoading && !deviceData && (
          <div className="flex flex-col items-center justify-center py-32">
            <div className="relative w-16 h-16 mb-6">
              <div className="absolute inset-0 rounded-full border-4 border-medical-100" />
              <div className="absolute inset-0 rounded-full border-4 border-medical-500 border-t-transparent animate-spin" />
            </div>
            <p className="text-lg font-semibold text-slate-600">
              Connecting to devices...
            </p>
            <p className="text-sm text-slate-400 mt-1">
              Waiting for ESP32 sensor data
            </p>
          </div>
        )}

        {/* ── Empty State (no data yet, not loading) ── */}
        {!isLoading && !deviceData && (
          <div className="flex flex-col items-center justify-center py-24">
            {/* Empty state illustration */}
            <div className="relative w-24 h-24 mb-6">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-medical-100 to-medical-50 flex items-center justify-center">
                <svg className="w-12 h-12 text-medical-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                  <path d="M16 3h-8l-2 4h12z" />
                  <circle cx="12" cy="14" r="2" />
                </svg>
              </div>
              <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-vitals-amber flex items-center justify-center animate-bounce">
                <span className="text-white text-xs font-bold">!</span>
              </div>
            </div>

            <h3 className="text-xl font-bold text-slate-700 mb-2">
              No Devices Connected
            </h3>
            <p className="text-sm text-slate-400 max-w-md text-center mb-6">
              Send data from your ESP32 device to see real-time monitoring.
              The dashboard will update automatically.
            </p>

            {/* Quick start code snippet */}
            <div className="bg-slate-900 rounded-xl p-4 max-w-lg w-full">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-3 h-3 rounded-full bg-vitals-red" />
                <div className="w-3 h-3 rounded-full bg-vitals-amber" />
                <div className="w-3 h-3 rounded-full bg-vitals-green" />
                <span className="text-xs text-slate-500 ml-2">Test with curl</span>
              </div>
              <pre className="text-xs text-slate-300 font-mono overflow-x-auto whitespace-pre">
{`curl -X POST http://localhost:3001/api/device/data \\
  -H "Content-Type: application/json" \\
  -d '{
    "device_id": "ESP32-001",
    "timestamp": "${new Date().toISOString()}",
    "audio_status": "recording",
    "sample_rate": 16000,
    "temperature": 36.7,
    "battery": 92,
    "wifi_strength": -58
  }'`}
              </pre>
            </div>
          </div>
        )}

        {/* ── Dashboard Cards Grid ── */}
        {deviceData && (
          <div className="space-y-6">
            {/* Top row — Device Info (spans full width on mobile) */}
            <div className="opacity-0 animate-fade-in">
              <DeviceInfoCard
                data={deviceData}
                status={deviceStatus}
                hasNewData={hasNewData}
              />
            </div>

            {/* Metrics grid — responsive columns */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
              <div className="opacity-0 animate-fade-in animate-delay-100">
                <BatteryCard
                  battery={deviceData.battery}
                  hasNewData={hasNewData}
                />
              </div>
              <div className="opacity-0 animate-fade-in animate-delay-200">
                <TemperatureCard
                  temperature={deviceData.temperature}
                  hasNewData={hasNewData}
                />
              </div>
              <div className="opacity-0 animate-fade-in animate-delay-300">
                <AudioStatusCard
                  audioStatus={deviceData.audio_status}
                  sampleRate={deviceData.sample_rate}
                  hasNewData={hasNewData}
                />
              </div>
              <div className="opacity-0 animate-fade-in animate-delay-400">
                <WifiSignalCard
                  wifiStrength={deviceData.wifi_strength}
                  hasNewData={hasNewData}
                />
              </div>
            </div>

            {/* Raw JSON — full width */}
            <div className="opacity-0 animate-fade-in animate-delay-500">
              <RawDataCard
                data={deviceData}
                hasNewData={hasNewData}
              />
            </div>

            {/* ── Future Modules Placeholder Banner ── */}
            <div className="opacity-0 animate-fade-in animate-delay-600">
              <div className="relative overflow-hidden rounded-2xl border border-dashed border-slate-200 bg-gradient-to-r from-slate-50 to-medical-50/30 p-6">
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-xl bg-medical-100/50">
                    <svg className="w-6 h-6 text-medical-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2a4 4 0 0 0-4 4v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4z" />
                      <circle cx="12" cy="15" r="2" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-600 mb-1">
                      Future Modules
                    </h3>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      AI-powered respiratory analysis, cardiovascular risk scoring,
                      patient history tracking, and persistent database storage
                      will be integrated here. The modular architecture supports
                      seamless expansion.
                    </p>
                    <div className="flex flex-wrap gap-2 mt-3">
                      {['AI Analysis', 'Disease Prediction', 'Patient History', 'Database', 'Authentication'].map((label) => (
                        <span
                          key={label}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-slate-400 bg-white/80 rounded-lg border border-slate-100"
                        >
                          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <path d="M8 12h8" />
                          </svg>
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-slate-100 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-slate-400">
              WellSim IoT Healthcare Platform — Prototype v1.0
            </p>
            <p className="text-xs text-slate-300">
              Respiratory &amp; Cardiovascular Screening System
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
