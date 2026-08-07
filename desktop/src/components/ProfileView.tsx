/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { UserProfile, DisplaySettings } from '../types';

const HARDCODED_VOICES = [
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel (Sweet & Soft)" },
  { id: "pNInz6obpgDQ51u15GIh", name: "Adam (Deep & Executive)" },
  { id: "ErXwobaYko0etXvtvl73", name: "Antoni (Energetic Narrator)" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella (Clear & Friendly)" },
  { id: "VR6A1rx146tKjiKffxAy", name: "Arnold (Deep & Cinematic)" }
];
import { pywebviewBridge } from '../utils/pywebviewBridge';
import { getLevelFromXp } from '../utils/levelUtils';
import { 
  ArrowLeft, 
  User, 
  ChevronDown, 
  ChevronUp, 
  Check, 
  EyeOff, 
  Download, 
  AlertTriangle, 
  Sparkles, 
  RefreshCw,
  Mail,
  Lock,
  Smartphone,
  Server,
  FileText,
  LogOut,
  UserCheck,
  Mic,
  Volume2,
  Cloud,
  Trophy
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { auth, logOutUser } from '../utils/firebase';
import { doc, deleteDoc } from 'firebase/firestore';
import { db } from '../utils/firebase';
import { FirebaseError } from 'firebase/app';

interface ProfileViewProps {
  profile: UserProfile;
  onUpdateProfile: (p: UserProfile) => void;
  onNavigate: (view: string) => void;
  isFirebaseUser?: boolean;
  onLogout?: () => void;
  onOpenAuth?: () => void;
  displaySettings?: DisplaySettings;
}

export default function ProfileView({ 
  profile, 
  onUpdateProfile, 
  onNavigate, 
  isFirebaseUser = false, 
  onLogout, 
  onOpenAuth,
  displaySettings
}: ProfileViewProps) {
  const [expandedCard, setExpandedCard] = useState<string | null>('identity');
  const isGlass = displaySettings?.glassmorphism;

  // Identity Form state
  const [newName, setNewName] = useState(profile.displayName || "");
  const [newEmail, setNewEmail] = useState(profile.email || "");
  const [newUsername, setNewUsername] = useState(profile.username || "");
  const [usernameChangesLeft, setUsernameChangesLeft] = useState(() => {
    const stored = localStorage.getItem('shackle_username_changes_left');
    return stored !== null ? parseInt(stored, 10) : 2;
  });
  const [avatarUrlInput, setAvatarUrlInput] = useState(profile.avatarUrl || "");
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Password / Security mock states
  const [securitySuccess, setSecuritySuccess] = useState("");
  const [tfaActive, setTfaActive] = useState(false);
  const [strictLock, setStrictLock] = useState(true);

  // Plan & Subscription states
  const [weeklyReports, setWeeklyReports] = useState(true);

  // Cloud Sync state
  const [cloudSyncEnabled, setCloudSyncEnabled] = useState(false);

  // Voice Cloning / Custom Roast Audio configuration parameters
  const [useVoiceClone, setUseVoiceClone] = useState(profile.useVoiceClone || false);
  const [voiceFileName, setVoiceFileName] = useState(profile.voiceFileName || "");
  const [voiceAudioInput, setVoiceAudioInput] = useState(profile.voiceCloneData || "");
  const [voiceMode, setVoiceMode] = useState<'clone' | 'preset'>(profile.voiceMode || 'preset');
  const [presetVoiceId, setPresetVoiceId] = useState<string>(profile.presetVoiceId || 'pNInz6obpgDQ51u15GIh');
  const [voiceOptions, setVoiceOptions] = useState<{ name: string; id: string }[]>(HARDCODED_VOICES);
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const fetchVoices = async () => {
    setIsLoadingVoices(true);
    setVoiceError(null);
    try {
      if (typeof pywebviewBridge !== 'undefined' && pywebviewBridge.getElevenLabsVoices) {
        const voices = await pywebviewBridge.getElevenLabsVoices();
        if (voices && voices.length > 0) {
          setVoiceOptions(voices);
          // Validate that the currently-saved preset voice ID exists in this account.
          // If not (e.g. stale hardcoded ID), silently switch to the first available voice.
          const currentVoiceExists = voices.some((v: { id: string }) => v.id === presetVoiceId);
          if (!currentVoiceExists) {
            console.warn(`[ProfileView] Preset voice ID '${presetVoiceId}' not found in account. Switching to '${voices[0].id}'.`);
            setPresetVoiceId(voices[0].id);
          }
        } else {
          setVoiceError("No voices found. Check API key.");
        }
      }
    } catch (err) {
      setVoiceError("Failed to load voices. Retry?");
    } finally {
      setIsLoadingVoices(false);
    }
  };

  useEffect(() => {
    fetchVoices();
  }, []);

  // =====================================================================
  // GAMIFIED EXPONENTIAL LEVEL CALCULATION SYSTEM
  // =====================================================================
  const totalXp = profile.xp || 0; // Cumulative experience tracker
  const levelInfo = getLevelFromXp(totalXp);
  const isVoiceFeatureLocked = levelInfo.level < 3; // Feature lock threshold logic

  // Save updated details back to bridge
  const handleSaveIdentity = async () => {
    let finalUsername = profile.username;
    let newChangesLeft = usernameChangesLeft;

    if (newUsername !== profile.username) {
      if (usernameChangesLeft > 0) {
        finalUsername = newUsername;
        newChangesLeft = usernameChangesLeft - 1;
        setUsernameChangesLeft(newChangesLeft);
        localStorage.setItem('shackle_username_changes_left', newChangesLeft.toString());
      } else {
        setNewUsername(profile.username);
        alert("You have reached the limit of username changes (0 remaining).");
        return;
      }
    }

    const updated = {
      ...profile,
      displayName: newName,
      email: newEmail,
      username: finalUsername,
      avatarUrl: avatarUrlInput || undefined,
      useVoiceClone: useVoiceClone,
      voiceFileName: voiceFileName || undefined,
      voiceCloneData: voiceAudioInput || undefined,
      voiceMode: voiceMode,
      presetVoiceId: presetVoiceId,
    };

    if (typeof pywebviewBridge !== 'undefined' && pywebviewBridge.saveProfile) {
      const saved = await pywebviewBridge.saveProfile(updated);
      onUpdateProfile(saved);
    } else {
      onUpdateProfile(updated); 
    }
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };


  const toggleCard = (card: string) => {
    setExpandedCard(expandedCard === card ? null : card);
  };

  return (
    <div className="space-y-6 animate-fade-in w-full max-w-3xl mx-auto py-4 relative">
      
      {/* Title block with back arrow */}
      <div className="flex items-center gap-3 text-slate-800 dark:text-slate-200">
        <button
          onClick={() => onNavigate('Dashboard')}
          className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-805 rounded-lg transition-colors cursor-pointer"
          title="Back to Dashboard"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-sans font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wide">Profile Manager</h1>
      </div>

       {/* Main visual avatar and username center group */}
      <div className="flex flex-col items-center text-center space-y-3 py-4 bg-slate-50/40 dark:bg-slate-950/20 border border-slate-200/60 dark:border-slate-800/80 rounded-2xl p-6">
        <div className="w-20 h-20 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 flex items-center justify-center text-slate-400 shadow-sm overflow-hidden relative group">
          {profile.avatarUrl ? (
            <img src={profile.avatarUrl} alt="avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <User className="w-10 h-10 stroke-[1.5]" />
          )}
        </div>

        <div className="space-y-1 w-full max-w-xs mx-auto">
          <div className="flex items-center justify-center gap-1.5 flex-wrap">
            <h2 className="text-lg font-sans text-slate-900 dark:text-slate-100 font-bold">
              {profile.displayName || "Guest"}
            </h2>
            {isFirebaseUser ? (
              <span className="inline-flex items-center gap-1 text-[9px] font-mono uppercase bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded-md font-bold">
                <UserCheck className="w-3 h-3" />
                Verified
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[9px] font-mono uppercase bg-slate-500/15 text-slate-600 dark:text-slate-400 px-1.5 py-0.5 rounded-md font-bold">
                Guest Mode
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 dark:text-slate-500 font-mono font-bold">
            {(() => {
              const raw = (profile.username || '').replace(/^@/, '');
              const isPlaceholder = !raw || ['guest', 'guest_user'].includes(raw.toLowerCase());
              if (!isPlaceholder) return `@${raw}`;
              if (profile.email) return `@${profile.email.split('@')[0].replace(/[^a-zA-Z0-9_\-+]/g, '')}`;
              return "@guest";
            })()}
          </p>

          {/* ===================================================================== */}
          {/* NEW GAMIFIED LEVEL PROGRESS UI COMPONENT                             */}
          {/* ===================================================================== */}
          <div className="pt-2 pb-1 space-y-1">
            <div className="flex items-center justify-between text-[10px] font-mono font-bold">
              <span className="text-blue-600 dark:text-blue-400 flex items-center gap-1 bg-blue-500/10 px-2 py-0.5 rounded">
                <Trophy className="w-3 h-3" /> LVL {levelInfo.level}
              </span>
              <span className="text-slate-450 dark:text-slate-500">
                {Math.round(levelInfo.currentLevelXp)} / {Math.round(levelInfo.nextLevelRequirement)} XP
              </span>
            </div>
            <div className="w-full h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden shadow-inner">
              <div 
                className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-500"
                style={{ width: `${levelInfo.percent}%` }}
              />
            </div>
          </div>
        </div>

        <div className="pt-1">
          {isFirebaseUser ? (
            <button
              onClick={onLogout}
              className="py-1.5 px-3.5 bg-red-50 hover:bg-red-100 dark:bg-red-950/20 dark:hover:bg-red-900/20 border border-red-200 dark:border-red-900/30 text-red-600 dark:text-red-400 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out Account</span>
            </button>
          ) : (
            <button
              onClick={onOpenAuth}
              className="py-1.5 px-3.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Authenticate / Join Shackle AI</span>
            </button>
          )}
        </div>
      </div>

      {/* Accordion groups container column */}
      <div className="space-y-4">
        
        {/* Card 1: Account Identity Config Panel */}
        <div className={`${isGlass ? 'glass-panel' : 'bg-white dark:bg-slate-900 border border-slate-250 dark:border-slate-805'} rounded-xl overflow-hidden shadow-sm transition-all focus-within:ring-1 focus-within:ring-blue-500`}>
          <button
            onClick={() => toggleCard('identity')}
            className="w-full px-5 py-4 text-left flex justify-between items-center bg-slate-50/50 dark:bg-slate-950/25 border-b border-slate-150 dark:border-slate-805 hover:bg-slate-50 dark:hover:bg-slate-950/40 transition-colors cursor-pointer"
          >
            <div className="space-y-0.5">
              <h3 className="text-sm font-sans font-bold text-slate-900 dark:text-slate-100">
                Account Identity (Configure details)
              </h3>
              <p className="text-[10px] text-slate-400 dark:text-slate-500">
                Update account info, profile visuals, and change study lock security rules.
              </p>
            </div>
            {expandedCard === 'identity' ? (
              <ChevronUp className="w-4.5 h-4.5 text-blue-600 dark:text-blue-400 shrink-0" />
            ) : (
              <ChevronDown className="w-4.5 h-4.5 text-slate-400 shrink-0" />
            )}
          </button>

          <AnimatePresence initial={false}>
            {expandedCard === 'identity' && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="p-5 border-t border-slate-100 dark:border-slate-800/60 space-y-5 bg-white dark:bg-slate-900 font-sans">
                  
                  <div className="space-y-3.5">
                    <h4 className="font-mono text-[10px] text-slate-450 dark:text-slate-500 uppercase tracking-wider font-bold">User Info Settings</h4>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-505 dark:text-slate-400 font-bold uppercase tracking-wider font-mono">Display Name</label>
                        <input
                          type="text"
                          value={newName}
                          onChange={(e) => setNewName(e.target.value)}
                          placeholder="E.g. Guest"
                          className="w-full px-3 py-1.5 bg-slate-50/50 dark:bg-slate-950 border border-slate-205 dark:border-slate-800 rounded-lg outline-none focus:border-blue-500 font-sans text-xs text-slate-800 dark:text-slate-200 transition-colors"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-550 dark:text-slate-405 font-bold uppercase tracking-wider font-mono">Email Address</label>
                        <input
                          type="email"
                          value={newEmail}
                          onChange={(e) => setNewEmail(e.target.value)}
                          placeholder="e.g. user@domain.com"
                          className="w-full px-3 py-1.5 bg-slate-50/50 dark:bg-slate-950 border border-slate-205 dark:border-slate-800 rounded-lg outline-none focus:border-blue-500 font-sans text-xs text-slate-800 dark:text-slate-200 transition-colors"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-505 dark:text-slate-400 font-bold uppercase tracking-wider font-mono flex items-center justify-between">
                        <span>Username</span>
                        <span className="text-[10px] px-2 py-0.5 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-amber-600 dark:text-amber-400 rounded font-bold">
                          {usernameChangesLeft} change{usernameChangesLeft !== 1 ? 's' : ''} remaining
                        </span>
                      </label>
                      <input
                        type="text"
                        value={newUsername}
                        onChange={(e) => {
                          if (usernameChangesLeft > 0 || e.target.value === profile.username) {
                            setNewUsername(e.target.value);
                          }
                        }}
                        disabled={usernameChangesLeft <= 0}
                        placeholder="E.g. username"
                        className="w-full px-3 py-1.5 bg-slate-50/50 dark:bg-slate-950 border border-slate-205 dark:border-slate-800 rounded-lg outline-none focus:border-blue-500 font-sans text-xs text-slate-800 dark:text-slate-200 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                      />
                      {usernameChangesLeft <= 0 && (
                        <p className="text-[9px] text-red-500 font-bold">Username change limit reached (0 remaining).</p>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] text-slate-550 dark:text-slate-405 font-bold uppercase tracking-wider font-mono block">Profile Photo (Local Image Selector)</label>
                      <div className="flex items-center gap-4 p-3 bg-slate-50/60 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 rounded-lg">
                        <div className="w-12 h-12 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-center overflow-hidden shrink-0">
                          {avatarUrlInput ? (
                            <img src={avatarUrlInput} alt="Preview" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          ) : (
                            <User className="w-6 h-6 text-slate-400" />
                          )}
                        </div>
                        <div className="space-y-1 flex-1">
                          <input
                            type="file"
                            id="avatar-file-input"
                            accept="image/*"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                const reader = new FileReader();
                                reader.onloadend = () => {
                                  if (typeof reader.result === 'string') {
                                    setAvatarUrlInput(reader.result);
                                  }
                                };
                                reader.readAsDataURL(file);
                              }
                            }}
                            className="hidden"
                          />
                          <div className="flex items-center gap-2">
                            <label
                              htmlFor="avatar-file-input"
                              className="px-3 py-1 bg-white dark:bg-slate-900 border border-slate-205 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-950 text-slate-700 dark:text-slate-300 rounded text-xs font-semibold cursor-pointer shadow-2xs transition-all active:scale-95"
                            >
                              Choose Image file
                            </label>
                            {avatarUrlInput && (
                              <button
                                type="button"
                                onClick={() => setAvatarUrlInput("")}
                                className="text-[10px] text-red-500 hover:text-red-600 font-bold hover:underline"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                          <p className="text-[9px] text-slate-400 dark:text-slate-500">
                            Upload a JPG, PNG, or SVG from your system. Less than 2MB recommended.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end pt-1">
                      <button
                        onClick={handleSaveIdentity}
                        className="py-1.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                      >
                        {saveSuccess ? <Check className="w-4 h-4" /> : null}
                        <span>{saveSuccess ? 'Changes Saved' : 'Save Details'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Sub-Group 2: Locks / Security */}
                  <div className="space-y-3.5 border-t border-slate-100 dark:border-slate-800/60 pt-4">
                    <h4 className="font-mono text-[10px] text-slate-450 dark:text-slate-500 uppercase tracking-wider font-bold">Locks / Security (Manage Toggles)</h4>
                    
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-950/40 border border-slate-150 dark:border-slate-800 rounded-lg">
                        <div className="max-w-[80%] space-y-0.5">
                          <label className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer">
                            <Lock className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                            <span>Strict Study Locks</span>
                          </label>
                          <p className="text-[10px] text-slate-400 dark:text-slate-500">Prevent Task Manager bypass, force locker daemon to restart if terminated.</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={strictLock}
                            onChange={(e) => setStrictLock(e.target.checked)}
                            className="sr-only peer" 
                          />
                          <div className="w-9 h-5 bg-slate-200 dark:bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600 toggle-switch-small"></div>
                        </label>
                      </div>

                      <div className="relative p-3 bg-slate-50 dark:bg-slate-950/40 border border-slate-150 dark:border-slate-800 rounded-lg overflow-hidden">
                        <div className="flex items-center justify-between opacity-40 select-none pointer-events-none filter blur-[1px]">
                          <div className="max-w-[80%] space-y-0.5">
                            <label className="text-xs font-bold text-slate-800 dark:text-slate-205 flex items-center gap-1.5 cursor-pointer">
                              <Smartphone className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                              <span>Two-Factor Authentication (2FA)</span>
                            </label>
                            <p className="text-[10px] text-slate-400 dark:text-slate-500">Require an instant login authentication ticket on your mobile app.</p>
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input 
                              type="checkbox" 
                              disabled={true}
                              checked={false}
                              onChange={() => {}}
                              className="sr-only peer" 
                            />
                            <div className="w-9 h-5 bg-slate-200 dark:bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600 toggle-switch-small"></div>
                          </label>
                        </div>
                        {/* 2FA lock overlay */}
                        <div className="absolute inset-0 flex items-center justify-center bg-slate-50/10 dark:bg-slate-900/10 backdrop-blur-[0.5px]">
                          <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 shadow-md rounded-lg px-3 py-1.5 flex items-center gap-1.5">
                            <Lock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                            <span className="text-[9px] font-mono font-bold uppercase text-amber-600 dark:text-amber-400">Coming with the mobile app</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pt-2">
                      <button
                        onClick={() => {
                          setSecuritySuccess("Change request transmitted. Enter your current desktop pin to approve.");
                          setTimeout(() => setSecuritySuccess(""), 5000);
                        }}
                        className="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <EyeOff className="w-3.5 h-3.5" />
                        <span>Request Password Reset Link</span>
                      </button>

                      {securitySuccess && (
                        <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold animate-pulse">
                          {securitySuccess}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* ===================================================================== */}
                  {/* GAMIFIED VOICE CUSTOMIZATION & CLONING PANEL                         */}
                  {/* ===================================================================== */}
                  <div className="space-y-4 border-t border-slate-100 dark:border-slate-800/60 pt-4">
                    <h4 className="font-mono text-[10px] text-slate-450 dark:text-slate-500 uppercase tracking-wider font-bold">
                      Voice Customization
                    </h4>
                    
                    {/* 1. Preset Voice Selector (Always Accessible to All Levels) */}
                    <div className="space-y-2 p-3 bg-slate-50 dark:bg-slate-950/40 border border-slate-150 dark:border-slate-800 rounded-lg">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                          <Volume2 className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                          <span>Select Narrator Voice</span>
                        </label>
                        {isLoadingVoices && (
                          <RefreshCw className="w-3.5 h-3.5 text-blue-500 animate-spin" />
                        )}
                        {voiceError && (
                          <button 
                            type="button"
                            onClick={fetchVoices}
                            className="text-[9px] font-mono text-red-500 hover:underline flex items-center gap-1 cursor-pointer"
                          >
                            <span>{voiceError}</span>
                            <RefreshCw className="w-2.5 h-2.5" />
                          </button>
                        )}
                      </div>
                      <select 
                        value={presetVoiceId}
                        onChange={(e) => setPresetVoiceId(e.target.value)}
                        disabled={isLoadingVoices || !!voiceError}
                        className={`w-full max-w-xs p-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-805 rounded-lg text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500 font-sans ${
                          isLoadingVoices || voiceError ? 'opacity-50 cursor-not-allowed' : ''
                        }`}
                      >
                        {voiceOptions.map((voice) => (
                          <option key={voice.id} value={voice.id}>
                            {voice.name}
                          </option>
                        ))}
                      </select>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500">
                        Choose your preferred AI narrator persona for real-time speech telemetry and roasts.
                      </p>
                    </div>

                    {/* 2. Custom Voice Cloning Section (Gated behind Level 3) */}
                    <div className="space-y-3 relative">
                      <div className="flex items-center justify-between">
                        <h4 className="font-mono text-[10px] text-slate-450 dark:text-slate-500 uppercase tracking-wider font-bold">
                          Custom Voice Cloning
                        </h4>
                        {isVoiceFeatureLocked && (
                          <span className="text-[9px] font-mono font-bold uppercase text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded flex items-center gap-1 animate-pulse">
                            <Lock className="w-2.5 h-2.5" /> Locked Until Level 3
                          </span>
                        )}
                      </div>

                      <div className={`space-y-3.5 transition-all duration-300 ${isVoiceFeatureLocked ? 'opacity-40 select-none pointer-events-none filter blur-[1px]' : ''}`}>
                        <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-950/40 border border-slate-150 dark:border-slate-800 rounded-lg">
                          <div className="max-w-[80%] space-y-0.5">
                            <label className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer">
                              <Mic className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                              <span>Enable Custom Voice Cloning</span>
                            </label>
                            <p className="text-[10px] text-slate-400 dark:text-slate-500">Clone a custom voice reference audio sample for personalized text-to-speech generation.</p>
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input 
                              type="checkbox" 
                              disabled={isVoiceFeatureLocked}
                              checked={useVoiceClone}
                              onChange={(e) => setUseVoiceClone(e.target.checked)}
                              className="sr-only peer" 
                            />
                            <div className="w-9 h-5 bg-slate-200 dark:bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600 toggle-switch-small"></div>
                          </label>
                        </div>

                        {useVoiceClone && !isVoiceFeatureLocked && (
                          <div className="space-y-3.5 p-3 bg-slate-50/60 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 rounded-lg transition-all">
                            {/* Mode selector */}
                            <div className="flex items-center gap-4 text-xs font-sans pb-1.5 border-b border-slate-200/50 dark:border-slate-800/50">
                              <span className="font-bold text-slate-500 dark:text-slate-400">Voice Mode:</span>
                              <label className="flex items-center gap-1.5 cursor-pointer">
                                <input 
                                  type="radio" 
                                  name="voiceMode" 
                                  value="preset" 
                                  checked={voiceMode === 'preset'} 
                                  onChange={() => setVoiceMode('preset')} 
                                  className="text-blue-500 focus:ring-blue-500"
                                />
                                <span className={voiceMode === 'preset' ? 'font-bold text-blue-600 dark:text-blue-400' : 'text-slate-600 dark:text-slate-350'}>Preset Voice</span>
                              </label>
                              <label className="flex items-center gap-1.5 cursor-pointer">
                                <input 
                                  type="radio" 
                                  name="voiceMode" 
                                  value="clone" 
                                  checked={voiceMode === 'clone'} 
                                  onChange={() => setVoiceMode('clone')} 
                                  className="text-blue-500 focus:ring-blue-500"
                                />
                                <span className={voiceMode === 'clone' ? 'font-bold text-blue-600 dark:text-blue-400' : 'text-slate-600 dark:text-slate-350'}>Custom Audio Sample</span>
                              </label>
                            </div>

                            {voiceMode === 'clone' && (
                              <div className="space-y-2.5">
                                <label className="text-[10px] text-slate-550 dark:text-slate-405 font-bold uppercase tracking-wider font-mono block">Voice Sample Input (.mp3, .wav, .m4a)</label>
                                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                                  <input
                                    type="file"
                                    id="voice-file-input"
                                    accept="audio/*"
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (file) {
                                        setVoiceFileName(file.name);
                                        const reader = new FileReader();
                                        reader.onloadend = () => {
                                          if (typeof reader.result === 'string') {
                                            setVoiceAudioInput(reader.result);
                                          }
                                        };
                                        reader.readAsDataURL(file);
                                      }
                                    }}
                                    className="hidden"
                                  />
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <label
                                      htmlFor="voice-file-input"
                                      className="px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-205 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-950 text-slate-700 dark:text-slate-300 rounded text-xs font-semibold cursor-pointer shadow-2xs transition-all active:scale-95 flex items-center gap-1.5"
                                    >
                                      <Volume2 className="w-3.5 h-3.5 text-slate-500" />
                                      <span>{voiceFileName ? "Replace Reference Audio" : "Upload Voice Template"}</span>
                                    </label>
                                    {voiceFileName && (
                                      <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 max-w-xs truncate">
                                        {voiceFileName}
                                      </span>
                                    )}
                                    {voiceAudioInput && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setVoiceAudioInput("");
                                          setVoiceFileName("");
                                        }}
                                        className="text-[10px] text-red-500 hover:text-red-600 font-bold hover:underline ml-1"
                                      >
                                        Remove
                                      </button>
                                    )}
                                  </div>
                                </div>
                                
                                {voiceAudioInput && (
                                  <div className="pt-1">
                                    <audio src={voiceAudioInput} controls className="w-full h-8 opacity-80 max-w-md bg-transparent" />
                                  </div>
                                )}
                                <p className="text-[9px] text-slate-400 dark:text-slate-500">
                                  Provide a clear sample clip of 10–60 seconds. This profile asset is encoded locally to populate ElevenLabs voice allocation hooks.
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Overlay prompt explaining how to break the lock */}
                      {isVoiceFeatureLocked && (
                        <div className="absolute inset-x-0 bottom-0 top-6 flex flex-col items-center justify-center text-center p-4 bg-slate-50/10 dark:bg-slate-900/10 rounded-xl backdrop-grayscale-25 z-10">
                          <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 shadow-xl rounded-xl p-4 max-w-xs space-y-1.5">
                            <div className="w-8 h-8 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto shadow-2xs">
                              <Lock className="w-4 h-4" />
                            </div>
                            <h5 className="text-xs font-bold text-slate-900 dark:text-slate-100">Custom Voice Cloning Locked</h5>
                            <p className="text-[10px] text-slate-450 dark:text-slate-500 leading-normal">
                              Complete focus blocks to reach **Level 3** to upload custom voice samples for personalized AI audio profiles.
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Card 2: Plan & Subscription Config Panel */}
        <div className={`${isGlass ? 'glass-panel' : 'bg-white dark:bg-slate-900 border border-slate-250 dark:border-slate-805'} rounded-xl overflow-hidden shadow-sm transition-all focus-within:ring-1 focus-within:ring-blue-500`}>
          <button
            onClick={() => toggleCard('subscription')}
            className="w-full px-5 py-4 text-left flex justify-between items-center bg-slate-50/50 dark:bg-slate-950/25 border-b border-slate-150 dark:border-slate-805 hover:bg-slate-50 dark:hover:bg-slate-950/40 transition-colors cursor-pointer"
          >
            <div className="space-y-0.5">
              <h3 className="text-sm font-sans font-bold text-slate-900 dark:text-slate-100">
                Plan &amp; Subscription (Toggles &amp; Tier selector)
              </h3>
              <p className="text-[10px] text-slate-400 dark:text-slate-500">
                Current active tier: {profile.tier === 'premium' ? 'Premium Shackler' : 'Regular Shackler'}. Adjust levels, billing settings, and automated metrics options.
              </p>
            </div>
            {expandedCard === 'subscription' ? (
              <ChevronUp className="w-4.5 h-4.5 text-blue-600 dark:text-blue-400 shrink-0" />
            ) : (
              <ChevronDown className="w-4.5 h-4.5 text-slate-400 shrink-0" />
            )}
          </button>

          <AnimatePresence initial={false}>
            {expandedCard === 'subscription' && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="p-5 border-t border-slate-100 dark:border-slate-800/60 space-y-5 bg-white dark:bg-slate-900 font-sans">
                                   <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="font-mono text-[10px] text-slate-455 dark:text-slate-500 uppercase tracking-wider font-bold">Active Subscription</h4>
                    </div>

                    <div className="p-4 bg-slate-50 dark:bg-slate-950/40 border border-slate-150 dark:border-slate-800 rounded-xl max-w-sm flex items-center justify-between">
                      <div className="space-y-1">
                        <div className="text-xs font-black text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                          {profile.tier === 'premium' ? (
                            <>
                              <Sparkles className="w-4 h-4 text-amber-500 fill-current" />
                              <span>Premium Shackler</span>
                            </>
                          ) : (
                            <>
                              <User className="w-4 h-4 text-blue-500" />
                              <span>Regular Shackler (Free Tier)</span>
                            </>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
                          {profile.tier === 'premium'
                            ? "Auto-renews at $9.99/mo via Razorpay"
                            : "Baseline enforcement features active"}
                        </p>
                      </div>
                      <span className={`text-[9px] font-mono font-black uppercase px-2 py-0.5 rounded-full border ${
                        profile.tier === 'premium'
                          ? "bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400"
                          : "bg-slate-500/10 border-slate-500/20 text-slate-500"
                      }`}>
                        Active
                      </span>
                    </div>
                  </div>

                  <div className="space-y-3.5 border-t border-slate-100 dark:border-slate-800/60 pt-4">
                    <h4 className="font-mono text-[10px] text-slate-450 dark:text-slate-500 uppercase tracking-wider font-bold">Billing settings toggles</h4>
                    
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-950/40 border border-slate-150 dark:border-slate-800 rounded-lg">
                        <div className="max-w-[80%] space-y-0.5">
                          <label className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer">
                            <Mail className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                            <span>Monthly study insight report</span>
                          </label>
                          <p className="text-[10px] text-slate-455 dark:text-slate-500">Deliver comprehensive focus metrics, background apps block reviews directly to your inbox.</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={weeklyReports}
                            onChange={(e) => setWeeklyReports(e.target.checked)}
                            className="sr-only peer" 
                          />
                          <div className="w-9 h-5 bg-slate-200 dark:bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600 toggle-switch-small"></div>
                        </label>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-slate-150 dark:border-slate-800/60 pt-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 bg-slate-50/50 dark:bg-slate-950/20 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800">
                    <div className="space-y-0.5">
                      <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">Receipts & Payment Gateways</h4>
                      <p className="text-[10px] text-slate-455 dark:text-slate-500">Manage transaction histories, check subscription details securely via Razorpay.</p>
                    </div>
                    <button 
                      onClick={() => pywebviewBridge.openExternalLink('http://0.0.0.0:8080/static/checkout.html?user_id=' + encodeURIComponent(profile.username))}
                      className="py-1.5 px-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-950 active:scale-95 transition-all cursor-pointer shadow-xs"
                    >
                      Open Payment Portal
                    </button>
                  </div>

                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Card 3: Data & Privacy Config Panel */}
        <div className={`${isGlass ? 'glass-panel' : 'bg-white dark:bg-slate-900 border border-slate-250 dark:border-slate-805'} rounded-xl overflow-hidden shadow-sm transition-all focus-within:ring-1 focus-within:ring-blue-500`}>
          <button
            onClick={() => toggleCard('privacy')}
            className="w-full px-5 py-4 text-left flex justify-between items-center bg-slate-50/50 dark:bg-slate-950/25 border-b border-slate-150 dark:border-slate-805 hover:bg-slate-50 dark:hover:bg-slate-950/40 transition-colors cursor-pointer"
          >
            <div className="space-y-0.5">
              <h3 className="text-sm font-sans font-bold text-slate-900 dark:text-slate-100">
                Data &amp; Privacy (Toggle details &amp; Export)
              </h3>
              <p className="text-[10px] text-slate-400 dark:text-slate-500">
                Configure cloud backup synchronization, download focus log backup, or purge account.
              </p>
            </div>
            {expandedCard === 'privacy' ? (
              <ChevronUp className="w-4.5 h-4.5 text-blue-600 dark:text-blue-400 shrink-0" />
            ) : (
              <ChevronDown className="w-4.5 h-4.5 text-slate-400 shrink-0" />
            )}
          </button>

          <AnimatePresence initial={false}>
            {expandedCard === 'privacy' && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="p-5 border-t border-slate-100 dark:border-slate-800/60 space-y-5 bg-white dark:bg-slate-900 font-sans">
                  
                  <div className="space-y-3">
                    <h4 className="font-mono text-[10px] text-slate-450 dark:text-slate-500 uppercase tracking-wider font-bold">Cloud Sync Preferences</h4>
                    
                    <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-950/40 border border-slate-150 dark:border-slate-800 rounded-lg">
                      <div className="max-w-[80%] space-y-0.5">
                        <label className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer">
                          <Cloud className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                          <span>Enable Cloud Sync Backup</span>
                        </label>
                        <p className="text-[10px] text-slate-455 dark:text-slate-500">Auto backup database focus indices, streak histories securely across active computers.</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={cloudSyncEnabled}
                          onChange={(e) => setCloudSyncEnabled(e.target.checked)}
                          className="sr-only peer" 
                        />
                        <div className="w-9 h-5 bg-slate-200 dark:bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600 toggle-switch-small"></div>
                      </label>
                    </div>

                    {cloudSyncEnabled && (
                      <div className="py-2.5 px-3 bg-blue-50/10 dark:bg-blue-950/10 border border-dashed border-blue-200 dark:border-blue-900/40 rounded-lg flex items-center gap-2">
                        <RefreshCw className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 animate-spin" />
                        <span className="text-[10px] text-blue-600 dark:text-blue-400 font-bold font-mono">Sync active with remote Firestore profile database...</span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-3.5 border-t border-slate-100 dark:border-slate-800/60 pt-4">
                    <h4 className="font-mono text-[10px] text-slate-450 dark:text-slate-500 uppercase tracking-wider font-bold">Focus Logs Backups & Exporters</h4>
                    <p className="text-[11px] text-slate-550 dark:text-slate-400">
                      Download study periods archive data logs securely on-demand:
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button
                        onClick={async () => {
                          let list = [];
                          if (typeof pywebviewBridge !== 'undefined' && pywebviewBridge.getSessions) {
                            list = await pywebviewBridge.getSessions();
                          }
                          const json = JSON.stringify(list, null, 2);
                          const blob = new Blob([json], { type: 'application/json' });
                          const url = URL.createObjectURL(blob);
                          const link = document.createElement('a');
                          link.href = url;
                          link.download = `shackle_raw_export_${Date.now()}.json`;
                          document.body.appendChild(link);
                          link.click();
                          document.body.removeChild(link);
                        }}
                        className="py-2 px-3 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-350 flex items-center justify-center gap-2 active:scale-95 transition-all cursor-pointer shadow-2xs"
                      >
                        <Download className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                        <span>Download JSON dump</span>
                      </button>

                      <button
                        onClick={async () => {
                          let list = [];
                          if (typeof pywebviewBridge !== 'undefined' && pywebviewBridge.getSessions) {
                            list = await pywebviewBridge.getSessions();
                          }
                          const header = "id,startTime,duration,type,xpEarned,completed\n";
                          const rows = list.map(item => 
                            `"${item.id}","${item.startTime}","${item.duration}","${item.type}","${item.xpEarned}","${item.completed}"`
                          ).join("\n");
                          const blob = new Blob([header + rows], { type: 'text/csv' });
                          const url = URL.createObjectURL(blob);
                          const link = document.createElement('a');
                          link.href = url;
                          link.download = `shackle_focus_history_${Date.now()}.csv`;
                          document.body.appendChild(link);
                          link.click();
                          document.body.removeChild(link);
                        }}
                        className="py-2 px-3 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-350 flex items-center justify-center gap-2 active:scale-95 transition-all cursor-pointer shadow-2xs"
                      >
                        <FileText className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                        <span>Export CSV Log data</span>
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3 border-t border-slate-100 dark:border-slate-800/60 pt-4">
                    <h4 className="font-mono text-[10px] text-red-600 dark:text-red-400 uppercase tracking-wider font-bold">Danger Zone Action Details</h4>
                    <p className="text-[10px] text-slate-455 dark:text-slate-500">Purging triggers absolute removal of all local registries, streak counters, focus session logs, and custom setup blacklist cards.</p>
                    
                    <button
                                  onClick={async () => {
                        if (confirm("DELETE ACCOUNT: Are you 100% sure you want to terminate your account profile? All EXP, streaks, and strike cards will perish.")) {
                          try {
                            // 1. Release any active app lock before wiping state
                            if (typeof pywebviewBridge !== 'undefined' && pywebviewBridge.unlockApps) {
                              await pywebviewBridge.unlockApps();
                            }

                            const user = auth.currentUser;

                            // 2. Delete the user's Firestore document so their data
                            //    is actually removed from the server (not just locally)
                            if (user) {
                              try {
                                const userRef = doc(db, 'users', user.uid);
                                await deleteDoc(userRef);
                              } catch (firestoreErr) {
                                console.warn("Firestore doc deletion failed — continuing with local wipe:", firestoreErr);
                              }
                            }

                            // 3. Delete the Firebase Auth account itself.
                            //    This requires a recent sign-in — catch that specific error
                            //    and surface a clear message instead of failing silently.
                            if (user) {
                              try {
                                await user.delete();
                              } catch (deleteErr) {
                                const isRecentLoginRequired =
                                  deleteErr instanceof FirebaseError &&
                                  deleteErr.code === 'auth/requires-recent-login';
                                if (isRecentLoginRequired) {
                                  alert(
                                    "For security, Firebase requires a recent sign-in before deleting your account.\n\n" +
                                    "Please sign out, sign back in, then immediately use 'Delete Account' again."
                                  );
                                  // Bail out — don't wipe localStorage or redirect,
                                  // so the user can sign out/in and retry.
                                  return;
                                }
                                // Non-auth error — log and continue with sign-out + local wipe
                                console.warn("Auth account deletion failed — continuing with sign-out:", deleteErr);
                              }
                            }

                            // 4. Sign out of Firebase Auth (clears IndexedDB session,
                            //    preventing auto-rehydration on next load)
                            try {
                              await logOutUser();
                            } catch (authErr) {
                              console.warn("Auth sign-out failed during account deletion:", authErr);
                            }

                          } catch (err) {
                            console.warn("Bridge detach skip during local reset:", err);
                          } finally {
                            // 5. Clear local storage and redirect
                            localStorage.clear();
                            window.location.href = "/";
                          }
                        }
                      }}                    
                      className="w-full py-2 bg-red-50 dark:bg-red-950/20 hover:bg-red-100/70 dark:hover:bg-red-900/20 border border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-400 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs active:scale-95 transition-all"
                    >
                      <AlertTriangle className="w-4 h-4 text-red-500" />
                      <span>Delete and Purge Account Details</span>
                    </button>
                  </div>

                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

      </div>

    </div>
  );
}