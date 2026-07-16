/**
 * WellSim — Clinical Triage & AI Analysis Dashboard
 * 
 * A professional, highly scannable medical web application for triage nurses
 * and clinic doctors. Integrates real-time patient queue, lab data fusion,
 * bio-acoustics playback, and AI recommendation engines.
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Activity, 
  User, 
  Wifi, 
  Clock, 
  AlertTriangle, 
  CheckCircle, 
  HelpCircle, 
  ChevronRight, 
  FileText, 
  Volume2, 
  Play, 
  Pause, 
  Printer, 
  RefreshCw,
  Search,
  Filter,
  Check,
  TrendingDown,
  Info,
  LogOut
} from 'lucide-react';
import { useDeviceData } from '../hooks/useDeviceData';
import RouteGuard from '../components/RouteGuard';
import { fetchPatients, updatePatientVitals as apiUpdateVitals } from '../services/api';

// Audio logs are client-side only (not stored in DB yet)
const DEFAULT_AUDIO_LOGS = {
  lung: { available: true, status: 'Recorded via WellSim IoT Device (INMP441 - I2S)', duration: '0:12' },
  heart: { available: true, status: 'Recorded via WellSim IoT Device (INMP441 - I2S)', duration: '0:15' },
  cough: { available: false, status: 'Not recorded', duration: '0:00' }
};

export default function Page() {
  return (
    <RouteGuard>
      {({ user, onLogout }) => <Dashboard user={user} onLogout={onLogout} />}
    </RouteGuard>
  );
}

function Dashboard({ user, onLogout }) {
  const { deviceStatus } = useDeviceData();
  const [patients, setPatients] = useState([]);
  const [patientsLoaded, setPatientsLoaded] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState('p1');
  const [activeAudioTab, setActiveAudioTab] = useState('lung'); // lung, heart, cough
  const [isPlaying, setIsPlaying] = useState(false);
  const [playProgress, setPlayProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Input editing state for vitals/lab data
  const [isEditing, setIsEditing] = useState(false);
  const [editedVitals, setEditedVitals] = useState({});

  // Get active patient
  const patient = patients.find(p => p.id === selectedPatientId) || patients[0];

  // Load patients from backend on mount
  const loadPatients = useCallback(async () => {
    try {
      const res = await fetchPatients();
      if (res.success && res.patients) {
        // Add client-side audio logs to each patient
        const patientsWithAudio = res.patients.map(p => ({
          ...p,
          audioLogs: p.audioLogs || DEFAULT_AUDIO_LOGS,
        }));
        setPatients(patientsWithAudio);
        if (!selectedPatientId && patientsWithAudio.length > 0) {
          setSelectedPatientId(patientsWithAudio[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to load patients:', err.message);
    } finally {
      setPatientsLoaded(true);
    }
  }, [selectedPatientId]);

  useEffect(() => {
    loadPatients();
  }, [loadPatients]);

  // Auto update system time
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Show loading screen while waiting for the API to fetch patients
  if (!patientsLoaded || !patient) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="relative w-12 h-12 mx-auto mb-4">
            <div className="absolute inset-0 rounded-full border-4 border-blue-100" />
            <div className="absolute inset-0 rounded-full border-4 border-blue-500 border-t-transparent animate-spin" />
          </div>
          <p className="text-sm font-semibold text-slate-505">Loading Patient Data...</p>
        </div>
      </div>
    );
  }

  // Audio Playback simulation
  useEffect(() => {
    let interval;
    if (isPlaying) {
      interval = setInterval(() => {
        setPlayProgress(prev => {
          if (prev >= 100) {
            setIsPlaying(false);
            return 0;
          }
          return prev + 5;
        });
      }, 500);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [isPlaying]);

  // Set up edits
  useEffect(() => {
    if (patient) {
      setEditedVitals({ ...patient.vitals });
    }
    setIsPlaying(false);
    setPlayProgress(0);
  }, [selectedPatientId, patient]);

  // BMI Calculator
  const calculateBMI = (w, h) => {
    if (!w || !h) return '—';
    const heightInMeters = h / 100;
    return (w / (heightInMeters * heightInMeters)).toFixed(1);
  };

  const getBMICategory = (bmi) => {
    const val = parseFloat(bmi);
    if (isNaN(val)) return '';
    if (val < 18.5) return 'Underweight';
    if (val < 25.0) return 'Normal weight';
    if (val < 30.0) return 'Overweight';
    return 'Obese';
  };

  // Status Colors helper
  const getRiskColor = (status) => {
    switch (status) {
      case 'high': return { bg: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500', label: 'High Risk' };
      case 'moderate': return { bg: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500', label: 'Moderate' };
      case 'low': return { bg: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500', label: 'Low Risk' };
      default: return { bg: 'bg-slate-50 text-slate-500 border-slate-200', dot: 'bg-slate-400', label: 'Pending' };
    }
  };

  const saveVitals = async () => {
    try {
      // Send updated vitals to backend — backend recalculates risk
      const res = await apiUpdateVitals(patient.id, editedVitals);
      if (res.success && res.patient) {
        // Update local state with backend response
        setPatients(prev => prev.map(p => {
          if (p.id === res.patient.id) {
            return { ...p, ...res.patient, audioLogs: p.audioLogs };
          }
          return p;
        }));
      }
    } catch (err) {
      console.error('Failed to save vitals:', err.message);
      alert('Failed to save vitals. Please try again.');
    }
    setIsEditing(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      
      {/* ─── 1. TOP BAR / HEADER ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 bg-white border-b border-slate-200/80 shadow-sm px-4 sm:px-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between h-16">
          
          {/* Logo & Name */}
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 shadow-md">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-1.5">
                Well<span className="text-blue-600 font-extrabold">Sim</span>
                <span className="text-[11px] font-semibold text-blue-500 px-2 py-0.5 bg-blue-50 rounded-full border border-blue-100">
                  Triage Panel
                </span>
              </span>
            </div>
          </div>

          {/* System Status Indicators */}
          <div className="hidden md:flex items-center gap-6 text-xs text-slate-500 font-medium">
            <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-full border border-slate-100">
              <span className={`w-2.5 h-2.5 rounded-full ${deviceStatus?.status === 'online' ? 'bg-emerald-500 animate-pulse' : 'bg-red-400'}`} />
              <span>IoT Device: {deviceStatus?.status === 'online' ? 'Connected' : 'Offline'}</span>
            </div>
            
            <div className="flex items-center gap-1.5">
              <Wifi className="w-4 h-4 text-slate-400" />
              <span>RSSI: {deviceStatus?.wifi_strength ? `${deviceStatus.wifi_strength} dBm` : 'N/A'}</span>
            </div>

            <div className="flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-slate-400" />
              <span className="font-mono tabular-nums">
                {currentTime.toLocaleTimeString('en-US', { hour12: false })}
              </span>
            </div>
          </div>

          {/* User Profile & Logout */}
          <div className="flex items-center gap-3 pl-3 border-l border-slate-200">
            <div className="w-8 h-8 rounded-full bg-blue-50 border border-blue-200 flex items-center justify-center">
              <User className="w-4 h-4 text-blue-600" />
            </div>
            <div className="text-left hidden sm:block">
              <p className="text-xs font-bold text-slate-800">{user?.name || 'Staff'}</p>
              <p className="text-[10px] text-slate-400 capitalize">{user?.role || 'Unknown'} — {user?.station || 'General Clinic'}</p>
            </div>
            <button
              onClick={onLogout}
              className="ml-2 p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* ─── MAIN CONTENT CONTAINER ──────────────────────────────────────── */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ─── 2. PATIENT QUEUE & TRIAGE LIST (1/3 Width) ─────────────────── */}
        <section className="lg:col-span-1 flex flex-col gap-4">
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden flex flex-col h-[calc(100vh-12rem)] min-h-[500px]">
            
            {/* Search/Header */}
            <div className="p-4 border-b border-slate-100 bg-slate-50/50">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                  <span>Patient Queue</span>
                  <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full">
                    {patients.length}
                  </span>
                </h2>
                <button className="text-xs text-blue-600 font-semibold hover:underline flex items-center gap-1">
                  <RefreshCw className="w-3 h-3" /> Refresh
                </button>
              </div>

              {/* Search Bar */}
              <div className="relative">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                <input 
                  type="text" 
                  placeholder="Search patients..."
                  className="w-full pl-9 pr-4 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100 p-2 space-y-1">
              {patients.map((item) => {
                const colors = getRiskColor(item.riskStatus);
                const isSelected = item.id === selectedPatientId;
                return (
                  <button
                    key={item.id}
                    onClick={() => setSelectedPatientId(item.id)}
                    className={`w-full text-left p-3 rounded-xl transition-all duration-200 flex items-center justify-between border ${
                      isSelected 
                        ? 'bg-blue-50/60 border-blue-200 shadow-sm' 
                        : 'border-transparent hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {/* Color coded circle */}
                      <div className={`w-2.5 h-2.5 rounded-full ${colors.dot}`} />
                      <div>
                        <p className="text-sm font-bold text-slate-800">{item.name}</p>
                        <div className="flex items-center gap-2 text-xs text-slate-400 mt-1">
                          <span>Age: {item.age}</span>
                          <span>•</span>
                          <span className="flex items-center gap-0.5">
                            <Clock className="w-3 h-3" /> {item.checkInTime}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase ${colors.bg}`}>
                        {colors.label}
                      </span>
                      <ChevronRight className="w-4 h-4 text-slate-300" />
                    </div>
                  </button>
                );
              })}
            </div>

          </div>
        </section>

        {/* ─── 3. SELECTED PATIENT DETAILS & DATA FUSION PANEL (2/3 Width) ── */}
        <section className="lg:col-span-2 flex flex-col gap-6">

          {/* Patient Header Details */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-100">
              <div>
                <span className="text-[10px] uppercase font-bold text-blue-500 tracking-wider">Currently Active Triage Record</span>
                <h1 className="text-2xl font-extrabold text-slate-900 mt-0.5">{patient.name}</h1>
                <p className="text-xs text-slate-400 mt-0.5">Patient ID: {patient.id.toUpperCase()}</p>
              </div>

              {/* Status card */}
              <div className="flex items-center gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100">
                <div className="text-right">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">AI Screening Risk</p>
                  <p className="text-sm font-bold text-slate-700 capitalize">{patient.riskStatus} Risk</p>
                </div>
                <div className={`w-3.5 h-3.5 rounded-full ${getRiskColor(patient.riskStatus).dot} animate-pulse`} />
              </div>
            </div>

            {/* Demographics details */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 pt-6 text-sm">
              <div>
                <p className="text-xs text-slate-400 font-medium">Age</p>
                <p className="font-bold text-slate-800 mt-0.5">{patient.age} years</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 font-medium">Gender</p>
                <p className="font-bold text-slate-800 mt-0.5">{patient.gender}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 font-medium">Weight</p>
                <p className="font-bold text-slate-800 mt-0.5">{patient.weight} kg</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 font-medium">Height</p>
                <p className="font-bold text-slate-800 mt-0.5">{patient.height} cm</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 font-medium">BMI Category</p>
                <p className="font-bold text-slate-800 mt-0.5 flex items-center gap-1.5">
                  <span>{calculateBMI(patient.weight, patient.height)}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500 font-normal">
                    {getBMICategory(calculateBMI(patient.weight, patient.height))}
                  </span>
                </p>
              </div>
            </div>
          </div>

          {/* Vitals Data Fusion (Inputs and Values) */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6">
            <div className="flex justify-between items-center mb-5">
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-500" />
                <span>Lab Results &amp; Data Fusion</span>
              </h2>
              {isEditing ? (
                <div className="flex gap-2">
                  <button 
                    onClick={() => setIsEditing(false)}
                    className="px-3 py-1 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={saveVitals}
                    className="px-3 py-1 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition flex items-center gap-1"
                  >
                    <Check className="w-3.5 h-3.5" /> Save Changes
                  </button>
                </div>
              ) : (
                <button 
                  onClick={() => setIsEditing(true)}
                  className="px-3 py-1 text-xs font-semibold rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition"
                >
                  Edit Vitals
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              
              {/* SpO2 Saturation */}
              <div className={`p-4 rounded-xl border transition ${
                patient.vitals.spo2 < 95 ? 'bg-red-50/50 border-red-200' : 'bg-slate-50/50 border-slate-100'
              }`}>
                <div className="flex justify-between items-start">
                  <p className="text-[11px] font-bold text-slate-400 uppercase">SpO2 (Oxygen)</p>
                  {patient.vitals.spo2 < 95 && <AlertTriangle className="w-3.5 h-3.5 text-red-500" />}
                </div>
                {isEditing ? (
                  <input 
                    type="number" 
                    value={editedVitals.spo2 || ''}
                    onChange={(e) => setEditedVitals(prev => ({ ...prev, spo2: parseInt(e.target.value) || 0 }))}
                    className="w-full mt-1.5 p-1 bg-white border border-slate-200 rounded text-xl font-bold focus:outline-none"
                  />
                ) : (
                  <p className={`text-2xl font-extrabold mt-1.5 ${patient.vitals.spo2 < 95 ? 'text-red-700' : 'text-slate-800'}`}>
                    {patient.vitals.spo2}%
                  </p>
                )}
                <p className="text-[10px] text-slate-400 mt-1">Normal: 95% - 100%</p>
              </div>

              {/* Heart Rate */}
              <div className={`p-4 rounded-xl border transition ${
                patient.vitals.heartRate > 100 ? 'bg-red-50/50 border-red-200' : 'bg-slate-50/50 border-slate-100'
              }`}>
                <div className="flex justify-between items-start">
                  <p className="text-[11px] font-bold text-slate-400 uppercase">Heart Rate</p>
                  {patient.vitals.heartRate > 100 && <AlertTriangle className="w-3.5 h-3.5 text-red-500" />}
                </div>
                {isEditing ? (
                  <input 
                    type="number" 
                    value={editedVitals.heartRate || ''}
                    onChange={(e) => setEditedVitals(prev => ({ ...prev, heartRate: parseInt(e.target.value) || 0 }))}
                    className="w-full mt-1.5 p-1 bg-white border border-slate-200 rounded text-xl font-bold focus:outline-none"
                  />
                ) : (
                  <p className={`text-2xl font-extrabold mt-1.5 ${patient.vitals.heartRate > 100 ? 'text-red-700' : 'text-slate-800'}`}>
                    {patient.vitals.heartRate} <span className="text-xs font-normal text-slate-400">bpm</span>
                  </p>
                )}
                <p className="text-[10px] text-slate-400 mt-1">Normal: 60 - 100 bpm</p>
              </div>

              {/* Blood Pressure */}
              <div className={`p-4 rounded-xl border transition ${
                patient.vitals.systolicBP > 140 ? 'bg-amber-50/50 border-amber-200' : 'bg-slate-50/50 border-slate-100'
              }`}>
                <div className="flex justify-between items-start">
                  <p className="text-[11px] font-bold text-slate-400 uppercase">Blood Pressure</p>
                  {patient.vitals.systolicBP > 140 && <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />}
                </div>
                {isEditing ? (
                  <div className="flex items-center gap-1 mt-1.5">
                    <input 
                      type="number" 
                      value={editedVitals.systolicBP || ''}
                      onChange={(e) => setEditedVitals(prev => ({ ...prev, systolicBP: parseInt(e.target.value) || 0 }))}
                      className="w-1/2 p-1 bg-white border border-slate-200 rounded text-lg font-bold focus:outline-none"
                    />
                    <span>/</span>
                    <input 
                      type="number" 
                      value={editedVitals.diastolicBP || ''}
                      onChange={(e) => setEditedVitals(prev => ({ ...prev, diastolicBP: parseInt(e.target.value) || 0 }))}
                      className="w-1/2 p-1 bg-white border border-slate-200 rounded text-lg font-bold focus:outline-none"
                    />
                  </div>
                ) : (
                  <p className={`text-2xl font-extrabold mt-1.5 ${patient.vitals.systolicBP > 140 ? 'text-amber-700' : 'text-slate-800'}`}>
                    {patient.vitals.systolicBP}/{patient.vitals.diastolicBP} <span className="text-xs font-normal text-slate-400">mmHg</span>
                  </p>
                )}
                <p className="text-[10px] text-slate-400 mt-1">Normal: &lt; 120/80 mmHg</p>
              </div>

              {/* WBC Count */}
              <div className={`p-4 rounded-xl border transition ${
                patient.vitals.wbc > 11000 ? 'bg-amber-50/50 border-amber-200' : 'bg-slate-50/50 border-slate-100'
              }`}>
                <p className="text-[11px] font-bold text-slate-400 uppercase">WBC Count</p>
                {isEditing ? (
                  <input 
                    type="number" 
                    value={editedVitals.wbc || ''}
                    onChange={(e) => setEditedVitals(prev => ({ ...prev, wbc: parseInt(e.target.value) || 0 }))}
                    className="w-full mt-1.5 p-1 bg-white border border-slate-200 rounded text-xl font-bold focus:outline-none"
                  />
                ) : (
                  <p className="text-2xl font-extrabold mt-1.5 text-slate-800">
                    {patient.vitals.wbc.toLocaleString()} <span className="text-xs font-normal text-slate-400">/mcL</span>
                  </p>
                )}
                <p className="text-[10px] text-slate-400 mt-1">Normal: 4,500 - 11,000</p>
              </div>

              {/* Hemoglobin */}
              <div className={`p-4 rounded-xl border transition ${
                patient.vitals.hemoglobin < 12 ? 'bg-amber-50/50 border-amber-200' : 'bg-slate-50/50 border-slate-100'
              }`}>
                <p className="text-[11px] font-bold text-slate-400 uppercase">Hemoglobin</p>
                {isEditing ? (
                  <input 
                    type="number" 
                    step="0.1"
                    value={editedVitals.hemoglobin || ''}
                    onChange={(e) => setEditedVitals(prev => ({ ...prev, hemoglobin: parseFloat(e.target.value) || 0 }))}
                    className="w-full mt-1.5 p-1 bg-white border border-slate-200 rounded text-xl font-bold focus:outline-none"
                  />
                ) : (
                  <p className="text-2xl font-extrabold mt-1.5 text-slate-800">
                    {patient.vitals.hemoglobin} <span className="text-xs font-normal text-slate-400">g/dL</span>
                  </p>
                )}
                <p className="text-[10px] text-slate-400 mt-1">Normal: 12.0 - 17.5 g/dL</p>
              </div>

              {/* Empty slot / placeholder for extension */}
              <div className="p-4 rounded-xl border border-dashed border-slate-200 flex flex-col justify-center items-center text-center">
                <Info className="w-4 h-4 text-slate-300 mb-1" />
                <p className="text-[10px] text-slate-400 uppercase font-medium">Future Data Fusion</p>
                <p className="text-[9px] text-slate-300">ECG / Spirometer</p>
              </div>

            </div>
          </div>

          {/* IoT Bio-Acoustics Card */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
            
            {/* Header Tabs */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 p-4 bg-slate-50/40 gap-3">
              <div className="flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-blue-500" />
                <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">IoT Bio-Acoustics</h2>
              </div>

              <div className="flex p-0.5 bg-slate-100 rounded-lg self-start sm:self-auto">
                {['lung', 'heart', 'cough'].map((tab) => (
                  <button
                    key={tab}
                    onClick={() => {
                      setActiveAudioTab(tab);
                      setIsPlaying(false);
                      setPlayProgress(0);
                    }}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition capitalize ${
                      activeAudioTab === tab 
                        ? 'bg-white text-slate-800 shadow-sm' 
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {tab} sound
                  </button>
                ))}
              </div>
            </div>

            {/* Audio detail area */}
            <div className="p-6">
              {patient.audioLogs[activeAudioTab].available ? (
                <div className="space-y-4">
                  
                  {/* Status metadata */}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      {patient.audioLogs[activeAudioTab].status}
                    </span>
                    <span className="font-mono text-slate-400">Duration: {patient.audioLogs[activeAudioTab].duration}</span>
                  </div>

                  {/* Visual Wave Player */}
                  <div className="bg-slate-900 rounded-xl p-5 flex items-center gap-4">
                    <button
                      onClick={() => setIsPlaying(!isPlaying)}
                      className="w-11 h-11 rounded-full bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center flex-shrink-0 transition active:scale-95"
                    >
                      {isPlaying ? <Pause className="w-5 h-5 fill-white" /> : <Play className="w-5 h-5 fill-white ml-0.5" />}
                    </button>

                    {/* Fake Spectrogram/Waveform Visualizer */}
                    <div className="flex-1 h-12 flex items-center gap-[3px] relative overflow-hidden">
                      {/* Playhead progress overlay */}
                      <div 
                        className="absolute top-0 bottom-0 left-0 bg-blue-500/10 border-r-2 border-blue-500 transition-all duration-300"
                        style={{ width: `${playProgress}%` }}
                      />

                      {/* Random wave bars */}
                      {[...Array(38)].map((_, i) => {
                        const active = (i / 38) * 100 <= playProgress;
                        return (
                          <div
                            key={i}
                            className={`flex-1 rounded-full transition-all duration-300 ${
                              active ? 'bg-blue-500 h-8' : 'bg-slate-700 h-4'
                            }`}
                            style={{
                              height: `${Math.sin(i * 0.4) * 16 + 24}px`
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                  <AlertTriangle className="w-8 h-8 text-slate-300 mb-2" />
                  <p className="text-xs font-bold text-slate-500">Audio Log Not Found</p>
                  <p className="text-[10px] text-slate-400 mt-1">This specific diagnostic audio was not recorded by WellSim IoT device.</p>
                </div>
              )}
            </div>
          </div>

          {/* ─── 4. WELLSIM AI ANALYSIS & RECOMMENDATION ENGINE ───────────── */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6">
            
            {/* Title */}
            <div className="flex items-center gap-2 mb-6">
              <Activity className="w-4 h-4 text-blue-500" />
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">AI Analysis &amp; Decision Engine</h2>
            </div>

            {/* Score and Findings Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
              
              {/* Score Gauge representation */}
              <div className="md:col-span-1 flex flex-col items-center text-center p-4 border-r border-slate-100">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wide">Risk Probability</span>
                
                {/* Circular Score display */}
                <div className="relative w-32 h-32 flex items-center justify-center mt-3">
                  {/* Gauge Background ring */}
                  <svg className="absolute w-full h-full transform -rotate-90">
                    <circle cx="64" cy="64" r="50" strokeWidth="8" stroke="#E2E8F0" fill="transparent" />
                    <circle 
                      cx="64" 
                      cy="64" 
                      r="50" 
                      strokeWidth="10" 
                      stroke={patient.riskStatus === 'high' ? '#EF4444' : patient.riskStatus === 'moderate' ? '#F59E0B' : '#10B981'} 
                      strokeDasharray={2 * Math.PI * 50}
                      strokeDashoffset={2 * Math.PI * 50 * (1 - patient.riskScore / 100)}
                      strokeLinecap="round"
                      fill="transparent" 
                    />
                  </svg>
                  <span className="text-3xl font-extrabold text-slate-800">{patient.riskScore}%</span>
                </div>

                <span className={`mt-3 text-xs font-bold px-3 py-1 rounded-full uppercase border ${
                  getRiskColor(patient.riskStatus).bg
                }`}>
                  {getRiskColor(patient.riskStatus).label}
                </span>
              </div>

              {/* Key Findings Bullet points */}
              <div className="md:col-span-2 space-y-3">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                  <TrendingDown className="w-3.5 h-3.5" /> AI Diagnostic Biomarkers
                </h3>
                <ul className="space-y-2 text-xs text-slate-600">
                  {patient.findings.map((finding, idx) => (
                    <li key={idx} className="flex items-start gap-2.5 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 flex-shrink-0" />
                      <span>{finding}</span>
                    </li>
                  ))}
                </ul>
              </div>

            </div>

            {/* Action Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6 pt-6 border-t border-slate-100">
              <button 
                onClick={() => alert(`Triage for ${patient.name} approved. Sent to duty doctor.`)}
                className="px-4 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition shadow-sm active:scale-98"
              >
                Approve Triage &amp; Send
              </button>
              <button 
                onClick={() => alert(`Triggering re-recording on WellSim IoT device...`)}
                className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50 border border-slate-200 rounded-xl transition active:scale-98"
              >
                Re-take IoT Recording
              </button>
              <button 
                onClick={() => window.print()}
                className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50 border border-slate-200 rounded-xl transition flex items-center justify-center gap-1.5 active:scale-98"
              >
                <Printer className="w-4 h-4" /> Print Summary
              </button>
            </div>

          </div>

        </section>

      </main>
      
    </div>
  );
}
