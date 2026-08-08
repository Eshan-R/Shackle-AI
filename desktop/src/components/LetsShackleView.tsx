/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { pywebviewBridge } from '../utils/pywebviewBridge';
import { TimerConfigurations, DisplaySettings, ShackleSession, UserProfile } from '../types';
import { calculateFocusSession } from '../utils/focusSessionAlgorithm';
import { Play, Pause, RotateCcw, ShieldCheck, ShieldAlert, BrainCircuit, Sparkles, AlertCircle, Award, Lock, BookOpen, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { getStrikeCount, getStrikeColorPalette } from '../utils/strikeHelpers';
import { getLockdownStatus } from '../utils/lockdownService';
import { getLevelFromXp } from '../utils/levelUtils';

declare global {
  interface Window {
    __shackleAudioContext?: AudioContext;
    playRoastAudio?: (url: string, text?: string) => void;
    showStrikeToast?: (count: number, reason: string) => void;
    showRoastText?: (text: string) => void;
  }
}

interface LetsShackleViewProps {
  timerConfigs: TimerConfigurations;
  displaySettings: DisplaySettings;
  onSessionLogged: () => void;
  onRunningChange?: (running: boolean) => void;
  profile?: UserProfile;
  onUpdateProfile?: (p: UserProfile) => void;
  userId?: string; // Firebase UID
}

const getCurrentStrikeCount = (profile?: UserProfile): number => {
  if (!profile || !profile.strikes || profile.strikes.toLowerCase() === 'none') return 0;
  const match = profile.strikes.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
};

// Highly polished 3D physical split flip card component
function FlipPlate({ value }: { value: string }) {
  const [currentValue, setCurrentValue] = useState(value);
  const [nextValue, setNextValue] = useState(value);
  const [isFlipping, setIsFlipping] = useState(false);

  useEffect(() => {
    if (value !== currentValue) {
      setNextValue(value);
      setIsFlipping(true);
      const timer = setTimeout(() => {
        setCurrentValue(value);
        setIsFlipping(false);
      }, 500); // 500ms total flip duration
      return () => clearTimeout(timer);
    }
  }, [value, currentValue]);

  return (
    <div 
      className="relative w-32 h-44 rounded-xl select-none text-slate-900 dark:text-slate-100"
      style={{ perspective: "600px" }}
    >
      {/* 1. Static Top (shows next value in advance) */}
      <div className="absolute inset-x-0 top-0 h-1/2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-t-xl overflow-hidden flex items-end justify-center shadow-xs">
        <span 
          className="text-7xl font-sans font-bold tracking-tighter absolute"
          style={{ transform: "translateY(50%)" }}
        >
          {nextValue}
        </span>
        <div className="absolute inset-0 bg-gradient-to-b from-black/5 to-transparent dark:from-black/20 pointer-events-none" />
      </div>

      {/* 2. Static Bottom (shows current value until flip finishes) */}
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-800 border-t-0 rounded-b-xl overflow-hidden flex items-start justify-center shadow-xs">
        <span 
          className="text-7xl font-sans font-bold tracking-tighter absolute"
          style={{ transform: "translateY(-50%)" }}
        >
          {currentValue}
        </span>
        <div className="absolute inset-0 bg-gradient-to-t from-black/5 to-transparent dark:from-black/15 pointer-events-none" />
      </div>

      {/* 3. Flipping Top Card (falls down: rotates from 0deg to -90deg) */}
      <div 
        className="absolute inset-x-0 top-0 h-1/2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-t-xl overflow-hidden flex items-end justify-center origin-bottom shadow-xs"
        style={{ 
          transform: isFlipping ? "rotateX(-90deg)" : "rotateX(0deg)",
          transition: isFlipping ? "transform 250ms ease-in, opacity 250ms ease-in" : "none",
          zIndex: isFlipping ? 30 : 10,
          opacity: isFlipping ? 0 : 1,
          backfaceVisibility: "hidden"
        }}
      >
        <span 
          className="text-7xl font-sans font-bold tracking-tighter absolute"
          style={{ transform: "translateY(50%)" }}
        >
          {currentValue}
        </span>
        <div className="absolute inset-0 bg-gradient-to-b from-black/5 to-transparent dark:from-black/20 pointer-events-none" />
        <div 
          className="absolute inset-0 bg-black pointer-events-none transition-opacity duration-250"
          style={{ opacity: isFlipping ? 0.3 : 0 }}
        />
      </div>

      {/* 4. Flipping Bottom Card (reveals: rotates from 90deg to 0deg) */}
      <div 
        className="absolute inset-x-0 bottom-0 h-1/2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-800 border-t-0 rounded-b-xl overflow-hidden flex items-start justify-center origin-top shadow-xs"
        style={{ 
          transform: isFlipping ? "rotateX(0deg)" : "rotateX(90deg)",
          transition: isFlipping ? "transform 250ms ease-out 250ms, opacity 250ms ease-out 250ms" : "none",
          zIndex: isFlipping ? 35 : 10,
          opacity: isFlipping ? 1 : 0,
          backfaceVisibility: "hidden"
        }}
      >
        <span 
          className="text-7xl font-sans font-bold tracking-tighter absolute"
          style={{ transform: "translateY(-50%)" }}
        >
          {nextValue}
        </span>
        <div className="absolute inset-0 bg-gradient-to-t from-black/5 to-transparent dark:from-black/15 pointer-events-none" />
        <div 
          className="absolute inset-0 bg-black pointer-events-none transition-opacity duration-250"
          style={{ opacity: isFlipping ? 0 : 0.4 }}
        />
      </div>

      {/* 5. Horizontal split line & side hinges */}
      <div className="absolute top-[49%] left-0 right-0 h-[2.5px] bg-slate-100 dark:bg-slate-900 z-40" />
      <div className="absolute top-[49.5%] left-0 right-0 h-[1px] bg-slate-350 dark:bg-black/40 z-45" />
      <div className="absolute left-[-2px] top-[46%] w-[4px] h-[8%] bg-slate-300 dark:bg-slate-850 rounded-r-xs z-50 border border-slate-400/20" />
      <div className="absolute right-[-2px] top-[46%] w-[4px] h-[8%] bg-slate-300 dark:bg-slate-850 rounded-l-xs z-50 border border-slate-400/20" />
    </div>
  );
}

export default function LetsShackleView({ timerConfigs, displaySettings, onSessionLogged, onRunningChange, profile, onUpdateProfile, userId }: LetsShackleViewProps) {
  const isPremiumLocked = profile ? getLockdownStatus(profile).isPremiumLocked : false;
  const [isConfigured, setIsConfigured] = useState(false);
  const [inputMinutes, setInputMinutes] = useState(25);
  const [skipBreaks, setSkipBreaks] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(25 * 60);
  const [sessionType, setSessionType] = useState<'focus' | 'break'>('focus');
  const [focusIndex, setFocusIndex] = useState(1); // Track "Focus: X of 4"
  const [preventedProcesses, setPreventedProcesses] = useState<string[]>([]);
  const [totalSeconds, setTotalSeconds] = useState(25 * 60);
  const [isBlockingActive, setIsBlockingActive] = useState(false);
  const [showWarning, setShowWarning] = useState<boolean>(false);
  const [currentStrike, setCurrentStrike] = useState<number>(0);
  const [infractionReason, setInfractionReason] = useState<string>("");
  const [graceSecondsLeft, setGraceSecondsLeft] = useState<number | null>(null);
  const [activeViolationType, setActiveViolationType] = useState<string | null>(null);
  const [lastVisionStatus, setLastVisionStatus] = useState<string>("compliant");
  const [isBookMode, setIsBookMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('shackle_book_mode');
    return saved !== null ? JSON.parse(saved) : false;
  });

  const handleToggleBookMode = (active: boolean) => {
    setIsBookMode(active);
    if (typeof pywebviewBridge !== 'undefined' && pywebviewBridge.setBookMode) {
      pywebviewBridge.setBookMode(active);
    }
  };

  // Keep the ref in sync whenever the state updates
  useEffect(() => {
    preventedProcessesRef.current = preventedProcesses;
  }, [preventedProcesses]);

  // Sync running status upwards to lockdown other UI pages during studies
  useEffect(() => {
    if (onRunningChange) {
      onRunningChange(isRunning);
    }
  }, [isRunning, onRunningChange]);

  // Focus Session Phases for Microsoft Focus Session division rules
  const [sessionPhases, setSessionPhases] = useState<{
    type: 'focus' | 'break';
    index: number;
    total: number;
    durationSeconds: number;
  }[]>([]);
  const [currentPhaseIndex, setCurrentPhaseIndex] = useState(0);

  // Calculate session metrics in real-time
  const sessionInfo = useMemo(() => {
    return calculateFocusSession(inputMinutes, skipBreaks);
  }, [inputMinutes, skipBreaks]);

  // Setup Theme Colors config to match the active general theme
  const setupTheme = useMemo(() => {
    switch (displaySettings.theme) {
      case 'Midnight Slate':
        return {
          text: 'text-blue-600 dark:text-blue-400',
          border: 'border-blue-500/20 dark:border-blue-400/20',
          borderFocus: 'focus:border-blue-500',
          bgSubtle: 'bg-blue-50/40 dark:bg-blue-950/20',
          bgActive: 'bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white',
          presetActive: 'bg-blue-600 border-blue-600 text-white shadow-xs',
          checkboxCheckedBg: 'peer-checked:bg-blue-600 peer-checked:border-blue-600',
          checkboxIcon: 'text-blue-600 dark:text-blue-400',
          ringAccent: 'stroke-blue-500 dark:stroke-blue-400',
          cardGradient: 'from-blue-50/10 dark:from-slate-900/10',
          badgeText: 'text-blue-600 dark:text-blue-400',
          badgeBg: 'bg-blue-50/50 dark:bg-blue-950/20',
          badgeBorder: 'border-blue-150/30',
          numberColor: 'text-blue-950 dark:text-blue-200'
        };
      case 'Deep Plum':
        return {
          text: 'text-purple-600 dark:text-purple-400',
          border: 'border-purple-500/20 dark:border-purple-400/20',
          borderFocus: 'focus:border-purple-500',
          bgSubtle: 'bg-purple-50/40 dark:bg-purple-950/20',
          bgActive: 'bg-purple-600 hover:bg-purple-700 dark:bg-purple-500 dark:hover:bg-purple-600 text-white',
          presetActive: 'bg-purple-600 border-purple-600 text-white shadow-xs',
          checkboxCheckedBg: 'peer-checked:bg-purple-600 peer-checked:border-purple-600',
          checkboxIcon: 'text-purple-600 dark:text-purple-400',
          ringAccent: 'stroke-purple-500 dark:stroke-purple-400',
          cardGradient: 'from-purple-50/10 dark:from-slate-900/10',
          badgeText: 'text-purple-600 dark:text-purple-400',
          badgeBg: 'bg-purple-50/50 dark:bg-purple-950/20',
          badgeBorder: 'border-purple-150/30',
          numberColor: 'text-purple-950 dark:text-purple-200'
        };
      default: // Granite Beige
        return {
          text: 'text-amber-800 dark:text-amber-400',
          border: 'border-amber-500/20 dark:border-amber-400/20',
          borderFocus: 'focus:border-amber-500 dark:focus:border-amber-400',
          bgSubtle: 'bg-amber-50/30 dark:bg-amber-950/20',
          bgActive: 'bg-amber-700 hover:bg-amber-800 dark:bg-amber-500 dark:hover:bg-amber-600 text-white',
          presetActive: 'bg-amber-700 border-amber-700 text-white shadow-xs',
          checkboxCheckedBg: 'peer-checked:bg-amber-700 peer-checked:border-amber-700',
          checkboxIcon: 'text-amber-700 dark:text-amber-400',
          ringAccent: 'stroke-amber-600 dark:stroke-amber-400',
          cardGradient: 'from-amber-50/10 dark:from-slate-900/10',
          badgeText: 'text-amber-850 dark:text-amber-400',
          badgeBg: 'bg-amber-50/50 dark:bg-amber-950/20',
          badgeBorder: 'border-amber-150/30',
          numberColor: 'text-amber-950 dark:text-amber-200'
        };
    }
  }, [displaySettings.theme]);

  // Session Goal state
  const [sessionGoal, setSessionGoal] = useState(() => {
    return localStorage.getItem('shackle_session_goal') || "";
  });

  const handleSaveGoal = (val: string) => {
    setSessionGoal(val);
    localStorage.setItem('shackle_session_goal', val);
  };

  // AI Coaching Report & Toast state
  const [showReportModal, setShowReportModal] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [aiReportText, setAiReportText] = useState("");
  const [roastAudioUrl, setRoastAudioUrl] = useState<string | null>(null);
  const [isRoastPlaying, setIsRoastPlaying] = useState<boolean>(false);
  const [strikeToast, setStrikeToast] = useState<{ count: number; reason: string } | null>(null);
  const [roastText, setRoastText] = useState<string | null>(null);
  const [isRoastDismissed, setIsRoastDismissed] = useState<boolean>(false);

  // Theme-matched palette for toast notifications
  const toastPalette = useMemo(() => {
    return getStrikeColorPalette(
      getStrikeCount(profile?.strikes),
      'Dark',
      displaySettings?.theme || 'Granite Beige'
    );
  }, [profile?.strikes, displaySettings?.theme]);

  // Persistent AudioContext created on first user gesture (session start).
  // Reusing it for roast audio bypasses browser autoplay restrictions.
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Plays roast audio via AudioContext (bypasses autoplay) with fallback to Audio element
  const playRoastWithContext = async (url: string) => {
    if (isRoastPlaying) return; // prevent overlapping/duplicate playback
    setIsRoastPlaying(true);
    const ctx = window.__shackleAudioContext || audioContextRef.current || new (window.AudioContext || (window as any).webkitAudioContext)();
    try {
      if (ctx.state === 'suspended') await ctx.resume();
      const response = await fetch(url);
      if (!response.ok) {
        // Read body text for a diagnostic message before discarding the response.
        const body = await response.text().catch(() => '(unreadable body)');
        console.warn(`[RoastAudio] HTTP ${response.status} ${response.statusText} for ${url} — skipping decode. Body: ${body}`);
        return;
      }
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      await new Promise<void>((resolve) => {
        source.onended = () => resolve();
        source.start();
      });
    } catch (e) {
      console.warn('[RoastAudio] AudioContext playback failed, falling back to Audio element:', e);
      try {
        const audio = new Audio(url);
        await new Promise<void>((resolve) => {
          audio.onended = () => resolve();
          audio.onerror = () => resolve();
          audio.play().catch(err => {
            console.warn('[RoastAudio] Fallback play also failed:', err);
            resolve();
          });
        });
      } catch (fallbackErr) {
        console.warn('[RoastAudio] Audio fallback error:', fallbackErr);
      }
    } finally {
      setIsRoastPlaying(false);
    }
  };

  // Register global handlers so the Python daemon can trigger roast audio & toasts
  useEffect(() => {
    window.playRoastAudio = (url: string, text?: string) => {
      setRoastAudioUrl(url);
      if (text) {
        setRoastText(text);
        setIsRoastDismissed(false);
      }
      playRoastWithContext(url);
    };
    window.showStrikeToast = (count: number, reason: string) => {
      setStrikeToast({ count, reason });
      setTimeout(() => setStrikeToast(null), 6000);
    };
    window.showRoastText = (text: string) => {
      setRoastText(text);
      setIsRoastDismissed(false);
    };
    return () => {
      delete window.playRoastAudio;
      delete window.showStrikeToast;
      delete window.showRoastText;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [lastCompletedSession, setLastCompletedSession] = useState<{
    duration: number;
    preventsCount: number;
    completed: boolean;
    appNames: string[];
    xpEarned: number;
  } | null>(null);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const blockSimulatorIntervalRef = useRef<NodeJS.Timeout | null>(null);
  // Ref mirroring preventedProcesses so handleIntervalComplete always reads
  // the most up-to-date list regardless of when the isRunning effect was created.
  const preventedProcessesRef = useRef<string[]>([]);
  // Guards against React Strict Mode calling the setState updater twice,
  // which would otherwise invoke handleIntervalComplete() more than once.
  const hasCompletedRef = useRef<boolean>(false);
  // Tracks the daemon's per-session strike counter across polls.
  // Initialised to -1 (sentinel: "not yet observed this session").
  // Only ever increases — never lets a daemon reset overwrite cumulative profile.strikes.
  const sessionStrikeCountRef = useRef<number>(-1);
  // Snapshot of profile.strikes (as an integer) captured at session start.
  const sessionBaseStrikesRef = useRef<number>(0);

  // Formulate the customized minutes based on configurations
  const getDurationMinutes = (type: 'focus' | 'break') => {
    if (type === 'focus') {
      if (timerConfigs.focusPeriods === 'Automatic') return 25;
      if (timerConfigs.focusPeriods === '25 minutes') return 25;
      if (timerConfigs.focusPeriods === '50 minutes') return 50;
      return timerConfigs.focusPeriodsCustom || 25;
    } else {
      if (timerConfigs.breakPeriods === 'Automatic') return 5;
      if (timerConfigs.breakPeriods === '5 minutes') return 5;
      if (timerConfigs.breakPeriods === '10 minutes') return 10;
      return timerConfigs.breakPeriodsCustom || 5;
    }
  };

  // Reset timer on config change
  useEffect(() => {
    if (!isConfigured) {
      const mins = getDurationMinutes(sessionType);
      setSecondsLeft(mins * 60);
      setTotalSeconds(mins * 60);
      setIsRunning(false);
    }
  }, [timerConfigs, sessionType, isConfigured]);

  // Clean intervals on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (blockSimulatorIntervalRef.current) clearInterval(blockSimulatorIntervalRef.current);
      pywebviewBridge.unlockApps(); // safety fallback
    };
  }, []);

  const [notifiedInfractions, setNotifiedInfractions] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Short circuit: If the application isn't currently locked down/running, completely drop monitoring
    if (!isConfigured) {
      setNotifiedInfractions(new Set()); // Flush previous histories
      setGraceSecondsLeft(null);
      setActiveViolationType(null);
      // Reset session-level strike tracking so next session starts from a clean baseline.
      sessionStrikeCountRef.current = -1;
      sessionBaseStrikesRef.current = 0;
      return;
    }

    const verifyActiveViolations = async () => {
      try {
        if (typeof pywebviewBridge !== 'undefined') {
          
          // 1. QUERY LOCAL DAEMON STATUS FOR REAL-TIME METRICS & GRACE STATE
          if (pywebviewBridge.getDaemonStatus) {
            const daemonStatus = await pywebviewBridge.getDaemonStatus();
            if (daemonStatus) {
              const daemonCount: number = daemonStatus.strike_count ?? 0;

              // Capture the profile's pre-session strike baseline on the very first
              // successful poll of this session (sentinel value = -1).
              if (sessionStrikeCountRef.current === -1) {
                sessionStrikeCountRef.current = 0;
                sessionBaseStrikesRef.current = getCurrentStrikeCount(profile);
              }

              // Only update the profile when the daemon's session counter has
              // strictly grown — never let a daemon reset (0) overwrite the
              // cumulative career strike count.
              if (daemonCount > sessionStrikeCountRef.current) {
                const delta = daemonCount - sessionStrikeCountRef.current;
                sessionStrikeCountRef.current = daemonCount;

                const newTotal = sessionBaseStrikesRef.current + daemonCount;
                let strikesText = 'None';
                if (newTotal >= 3) {
                  strikesText = `${newTotal} Strikes (Streak Reset)`;
                } else if (newTotal > 0) {
                  strikesText = `${newTotal} Strike${newTotal > 1 ? 's' : ''}`;
                }

                if (profile && onUpdateProfile && strikesText !== profile.strikes) {
                  console.log(`[SHACKLE] Session strike +${delta} → total ${newTotal} (base ${sessionBaseStrikesRef.current} + session ${daemonCount})`);
                  onUpdateProfile({ ...profile, strikes: strikesText });
                }
              }
              // If daemonCount === 0 and sentinel already consumed, the session
              // just started or daemon was reset — do NOT touch profile.strikes.

              setGraceSecondsLeft(daemonStatus.grace_seconds_left);
              setActiveViolationType(daemonStatus.active_violation_type);
              setLastVisionStatus(daemonStatus.last_vision_status);
            }
          }

          // 2. EXISTING TELEMETRY TRACKER LOGIC
          if (pywebviewBridge.getSessions) {
            const sessionsList = await pywebviewBridge.getSessions();
            const currentRunningSession = sessionsList.find((s: any) => !s.completed);
            
            if (currentRunningSession && currentRunningSession.blacklistedAppsPrevented) {
              const rawViolations: string[] = currentRunningSession.blacklistedAppsPrevented;
              
              setNotifiedInfractions((prevSet) => {
                const freshSet = new Set(prevSet);
                let stateChanged = false;

                rawViolations.forEach((appName) => {
                  if (!freshSet.has(appName)) {
                    freshSet.add(appName);
                    stateChanged = true;
                    console.log(`[SHACKLE ALERT] Intercepted execution instance of: ${appName}`);
                  }
                });

                return stateChanged ? freshSet : prevSet;
              });
            }
          }
        }
      } catch (err) {
        console.warn("Failed to catch edge telemetry snapshot:", err);
      }
    };

    // Poll the background daemon frame state every 1000ms for real-time responsiveness
    const telemetryIntervalId = setInterval(verifyActiveViolations, 1000);

    // CRITICAL: Return a clean tear-down function to wipe this interval out completely
    // when user finishes the session, breaks out, or switches views
    return () => {
      clearInterval(telemetryIntervalId);
    };
  }, [isConfigured, profile, onUpdateProfile]);

  const [sessionError, setSessionError] = useState<string | null>(null);

  // Main countdown hook (Corrected to isolate countdown flow and prevent alert cascade)
  useEffect(() => {
    if (isRunning) {
      const startSession = async () => {
        setSessionError(null);
        let sessionId = '';
        if (typeof pywebviewBridge !== 'undefined' && pywebviewBridge.lockApps) {
          sessionId = await pywebviewBridge.lockApps(
            Math.round(sessionInfo.totalSessionMinutes),
            userId
          );
        }

        if (!sessionId && typeof window !== 'undefined' && (window as any).pywebview) {
          // Session failed to start in desktop app
          setIsRunning(false);
          setSessionError("Failed to start session. Please check your connection and authentication.");
          setTimeout(() => setSessionError(null), 5000);
          return;
        }

        setIsBlockingActive(true);
        // Reset the completion guard each time a new session phase starts
        hasCompletedRef.current = false;

        // Clean setup for the primary countdown seconds-ticker
        timerRef.current = setInterval(() => {
          setSecondsLeft(prev => {
            if (prev <= 1) {
              return 0;
            }
            return prev - 1;
          });
        }, 1000);

        // Real telemetry sync loop
        blockSimulatorIntervalRef.current = setInterval(async () => {
          try {
            if (typeof pywebviewBridge !== 'undefined' && pywebviewBridge.getSessions) {
              const sessionsList = await pywebviewBridge.getSessions();
              const currentRunningSession = sessionsList.find((s: any) => !s.completed);
              
              if (currentRunningSession && currentRunningSession.blacklistedAppsPrevented) {
                const rawViolations: string[] = currentRunningSession.blacklistedAppsPrevented;
                
                if (rawViolations.length > 0) {
                  setPreventedProcesses(prev => {
                    const uniqueApps = new Set([...prev, ...rawViolations]);
                    return Array.from(uniqueApps);
                  });
                }
              }
            }
          } catch (err) {
            console.warn("Telemetry polling skip inside countdown window:", err);
          }
        }, 4000);
      };

      startSession();
    } else {
      // Complete teardown and release when paused/stopped
      if (timerRef.current) clearInterval(timerRef.current);
      if (blockSimulatorIntervalRef.current) clearInterval(blockSimulatorIntervalRef.current);
      
      if (typeof pywebviewBridge !== 'undefined' && pywebviewBridge.unlockApps) {
        pywebviewBridge.unlockApps();
      }
      setIsBlockingActive(false);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (blockSimulatorIntervalRef.current) clearInterval(blockSimulatorIntervalRef.current);
    };
  }, [isRunning]);

  // Fire completion exactly once when the timer reaches zero.
  // This lives outside the setInterval updater to avoid React Strict Mode double-invocation.
  useEffect(() => {
    if (secondsLeft === 0 && isRunning && !hasCompletedRef.current) {
      hasCompletedRef.current = true;
      handleIntervalComplete();
    }
  }, [secondsLeft, isRunning]);

  const handleIntervalComplete = async () => {
    setIsRunning(false);
    setIsBlockingActive(false);

    // Audio tone
    if (timerConfigs.soundOnEnd) {
      try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // A5 high note pitch
        gainNode.gain.setValueAtTime(0.2, audioCtx.currentTime);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.5);
      } catch (err) {
        console.warn("Oscillator audio could not play due to user gesture limits", err);
      }
    }

    // Save session log and calculate XP 
    const isFocus = sessionType === 'focus';
    const originalMins = Math.round(totalSeconds / 60);

    // Focus sessions gain strictly 1 XP per minute focused (1:1 conversion rate)
    const calculatedXp = isFocus ? originalMins : 0;

    const loggedSess = {
      duration: originalMins,
      type: sessionType,
      xpEarned: calculatedXp,
      completed: true,
      // Read from ref, not closed-over state — ref is always up-to-date even though
      // the isRunning effect (which defines this function) was created at session start.
      blacklistedAppsPrevented: [...preventedProcessesRef.current],
      startTime: new Date().toISOString(),
      strikes: getCurrentStrikeCount(profile)
    };

    // Show the AI report modal immediately — do not wait for addSession to succeed.
    // This ensures the user always sees their session summary, even if saving fails.
    setLastCompletedSession({
      duration: originalMins,
      preventsCount: preventedProcesses.length,
      completed: true,
      appNames: preventedProcesses,
      xpEarned: calculatedXp
    });
    onSessionLogged();
    console.log('[DEBUG] Setting showReportModal to true');
    setShowReportModal(true);

    // Advance or reset session phases before the async save
    const nextIndex = currentPhaseIndex + 1;
    if (nextIndex < sessionPhases.length) {
      const nextPhase = sessionPhases[nextIndex];
      setCurrentPhaseIndex(nextIndex);
      setSessionType(nextPhase.type);
      setFocusIndex(nextPhase.index);
      setSecondsLeft(nextPhase.durationSeconds);
      setTotalSeconds(nextPhase.durationSeconds);
    } else {
      // Entire sprint completed!
      setIsConfigured(false);
      setFocusIndex(1);
      setSessionType('focus');
      const fallbackSecs = 25 * 60;
      setSecondsLeft(fallbackSecs);
      setTotalSeconds(fallbackSecs);
    }
    setPreventedProcesses([]);

    // Save session to backend — errors are logged but do not hide the modal
    try {
      const { session: savedSession, newXp, newStreak, newLevel } = await pywebviewBridge.addSession(loggedSess);

      // Unlock apps only after session is saved — unlockApps clears activeSessionId
      await pywebviewBridge.unlockApps();

      // Update profile with authoritative XP + streak from backend response, ensuring new session is included
      if (onUpdateProfile && profile && (newXp !== undefined || newStreak !== undefined || newLevel !== undefined)) {
        const currentSessions = profile.sessions || [];
        const updatedSessions = currentSessions.some(s => s.id === savedSession.id)
          ? currentSessions
          : [...currentSessions, savedSession];

        const updatedProfile = {
          ...profile,
          xp: newXp !== undefined ? newXp : profile.xp,
          level: newLevel !== undefined ? newLevel : getLevelFromXp(newXp || profile.xp).level,
          streak: newStreak !== undefined ? newStreak : profile.streak,
          sessions: updatedSessions,
        };
        onUpdateProfile(updatedProfile);
      }
    } catch (err) {
      console.error('Failed to save session:', err);
      // Intentionally not alerting — modal is already visible, save will retry on next load
    }
  };

  const terminateSessionEarly = async () => {
    setIsRunning(false);
    setIsBlockingActive(false);

    const isFocus = sessionType === 'focus';
    const timeCompletedMins = Math.floor((totalSeconds - secondsLeft) / 60);

    if (isFocus) {
      // Inflict penalty for exiting active focus lock prematurely
      try {
        const { profile: p } = await pywebviewBridge.getProfile();
        const currentStrikes = getStrikeCount(p.strikes);
        const nextStrikes = Math.min(currentStrikes + 1, 3);
        let strikesText = "None";
        let nextStreak = p.streak;
        if (nextStrikes > 0) {
          strikesText = `${nextStrikes} Strike${nextStrikes > 1 ? 's' : ''}`;
        }
        if (nextStrikes >= 3) {
          nextStreak = 0; // reset streak
          strikesText = `${nextStrikes} Strikes (Streak Reset)`;
          alert("PENALTY INFLICTED: 3 strikes incurred. Your current study streak has been reset to 0.");
        } else {
          alert(`STRIKE INFLICTED: Exiting focus session early earned 1 Strike. Compliance status deteriorated! (${nextStrikes}/3)`);
        }
        const updatedProfile = {
          ...p,
          strikes: strikesText,
          streak: nextStreak
        };
        // Save to backend database
        const savedProfile = await pywebviewBridge.saveProfile(updatedProfile);
        
        // Dispatch simultaneously to update Navigation components across the UI layout
        if (onUpdateProfile) {
          onUpdateProfile(savedProfile);
        }
      } catch (err) {
        console.error("Failed to apply early exit penalty:", err);
      }
    }

    if (timeCompletedMins >= 1) {
      // Partially saved, wins 1 XP per focus minute (strict 1:1 conversion rate)
      const calculatedXp = isFocus ? timeCompletedMins : 0;
      const loggedSess = {
        duration: timeCompletedMins,
        type: sessionType,
        xpEarned: calculatedXp,
        completed: false,
        blacklistedAppsPrevented: [...preventedProcesses],
        startTime: new Date().toISOString(),
        strikes: getCurrentStrikeCount(profile)
      };

      // Show the AI report modal immediately — do not wait for save
      setLastCompletedSession({
        duration: timeCompletedMins,
        preventsCount: preventedProcesses.length,
        completed: false,
        appNames: preventedProcesses,
        xpEarned: calculatedXp
      });
      console.log('[DEBUG] Setting showReportModal to true');
      setShowReportModal(true);

      // Save session to backend — errors are logged but do not hide the modal
      try {
        const { session: savedSession2, newXp, newStreak, newLevel } = await pywebviewBridge.addSession(loggedSess);

        // Unlock apps only after session is saved — unlockApps clears activeSessionId
        await pywebviewBridge.unlockApps();

        // Update profile with authoritative XP from backend (partial session still earns XP), ensuring new session is included
        if (onUpdateProfile && profile && (newXp !== undefined || newStreak !== undefined || newLevel !== undefined)) {
          const currentSessions = profile.sessions || [];
          const updatedSessions = currentSessions.some(s => s.id === savedSession2.id)
            ? currentSessions
            : [...currentSessions, savedSession2];

          const updatedProfile = {
            ...profile,
            xp: newXp !== undefined ? newXp : profile.xp,
            level: newLevel !== undefined ? newLevel : getLevelFromXp(newXp || profile.xp).level,
            streak: newStreak !== undefined ? newStreak : profile.streak,
            sessions: updatedSessions,
          };
          onUpdateProfile(updatedProfile);
        }
      } catch (err) {
        console.error('Failed to save session:', err);
        // Modal stays visible — save failure is non-blocking
      }
    }
    
    onSessionLogged();

    // Reset countdown
    const mins = getDurationMinutes(sessionType);
    setSecondsLeft(mins * 60);
    setPreventedProcesses([]);
    setIsConfigured(false);
  };

  const triggerAiReportGeneration = async () => {
    if (!lastCompletedSession) return;
    setIsGeneratingReport(true);
    try {
      const report = await pywebviewBridge.getAiReport({
        duration: lastCompletedSession.duration,
        preventsCount: lastCompletedSession.preventsCount,
        completed: lastCompletedSession.completed,
        appNames: lastCompletedSession.appNames
      });
      setAiReportText(report);
    } catch (err) {
      setAiReportText("### Connection Issue\nFailed to invoke AI coach context. Ensure your API key is correctly active.");
    } finally {
      setIsGeneratingReport(false);
    }
  };

  // Convert seconds remaining to elegant mm:ss format
  const formatTime = () => {
    const mins = Math.floor(secondsLeft / 60);
    const secs = secondsLeft % 60;
    const strMins = mins.toString().padStart(2, '0');
    const strSecs = secs.toString().padStart(2, '0');
    return { strMins, strSecs, mins, secs };
  };

  const { strMins, strSecs } = formatTime();

  return (
    <>
      {!isConfigured ? (
        <div className="flex flex-col items-center justify-center min-h-[75vh] md:min-h-[80vh] space-y-8 animate-fade-in py-6 max-w-2xl mx-auto text-center">
        {/* Page Title */}
        <h1 className="text-3xl md:text-5xl font-sans uppercase tracking-[0.2em] font-extralight text-slate-800 dark:text-slate-100">
          LET'S SHACKLE
        </h1>

        {sessionError && (
          <div className="w-full max-w-md bg-red-500/10 border border-red-500/30 text-red-500 p-3 rounded-xl text-center animate-fade-in flex items-center justify-center gap-2 text-xs font-medium">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{sessionError}</span>
          </div>
        )}

        {/* Setup Card */}
        <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xl text-left space-y-6 animate-fade-in">
          <div className="border-b border-slate-100 dark:border-slate-800 pb-4">
            <h2 className="text-md font-sans font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
              <Sparkles className={`w-4 h-4 ${setupTheme.text}`} />
              Prepare Focus Sprint
            </h2>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
              Configure your duration and objective before locking into work mode.
            </p>
          </div>

          {/* Focus Minutes Configuration - Styled exactly like the referenced image */}
          <div className="space-y-4">
            <label className="text-[10px] font-mono text-slate-450 dark:text-slate-400 uppercase tracking-widest font-black block text-center">
              Focus Duration
            </label>
            
            {/* Custom Focus duration card matching the reference image */}
            <div className="flex border border-slate-350 dark:border-slate-850 bg-slate-50 dark:bg-slate-950 rounded-xl overflow-hidden w-56 mx-auto shadow-sm">
              {/* Left Display Plate - matches card background bg-white / dark:bg-slate-900 with text-black numbers */}
              <div className="flex-1 flex flex-col items-center justify-center py-5 select-none transition-colors duration-200 bg-white dark:bg-slate-900">
                <span className={`text-5xl font-sans font-light tracking-tight tabular-nums leading-none ${setupTheme.numberColor}`}>
                  {inputMinutes}
                </span>
                <span className="text-xs text-slate-400 font-sans mt-1.5 font-medium">mins</span>
              </div>

              {/* Central Divider Thin Line */}
              <div className="w-[1px] bg-slate-350 dark:bg-slate-800" />

              {/* Right Button Panel */}
              <div className="w-14 flex flex-col">
                {/* Increase Arrow Button */}
                <button
                  type="button"
                  onClick={() => setInputMinutes((prev) => Math.min(180, prev + 5))}
                  className="flex-1 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-900 active:bg-slate-200 dark:active:bg-slate-800 text-slate-500 dark:text-slate-400 border-b border-slate-350 dark:border-slate-800 transition-colors cursor-pointer"
                  title="Increase Duration"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                  </svg>
                </button>

                {/* Decrease Arrow Button */}
                <button
                  type="button"
                  onClick={() => setInputMinutes((prev) => Math.max(5, prev - 5))}
                  className="flex-1 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-900 active:bg-slate-200 dark:active:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors cursor-pointer"
                  title="Decrease Duration"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Quick Preset Buttons */}
            <div className="flex gap-1.5 w-full justify-center">
              {[25, 45, 60, 120].map((mins) => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => setInputMinutes(mins)}
                  className={`px-3 py-1.5 text-[10px] font-black rounded-lg border transition-all active:scale-95 cursor-pointer ${
                    inputMinutes === mins
                      ? setupTheme.presetActive
                      : 'bg-slate-50/50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900'
                  }`}
                >
                  {mins}m
                </button>
              ))}
            </div>

            {/* Break Count Text and Checkbox styled exactly like the provided image */}
            <div className="pt-2 text-center space-y-3 border-t border-slate-100 dark:border-slate-800/60 pb-1">
              <p className="text-sm text-slate-700 dark:text-slate-300 font-sans tracking-tight">
                You'll have {sessionInfo.numberOfBreaks} {sessionInfo.numberOfBreaks === 1 ? 'break' : 'breaks'}
              </p>
              
              <div className="flex items-center justify-center select-none">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={skipBreaks}
                    onChange={(e) => setSkipBreaks(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className={`w-5 h-5 border-2 border-slate-350 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 rounded-md flex items-center justify-center transition-all shadow-xs ${setupTheme.checkboxCheckedBg}`}>
                    {skipBreaks && (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth="3.5"
                        stroke="currentColor"
                        className="w-3.5 h-3.5 text-white"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    )}
                  </div>
                  <span className="text-sm font-medium text-slate-705 dark:text-slate-400">
                    Skip breaks
                  </span>
                </label>
              </div>
            </div>
          </div>

          {/* Session Goal Input */}
          <div className="space-y-2">
            <label className="text-[10px] font-mono text-slate-550 dark:text-slate-400 uppercase tracking-widest font-bold block">
              Define Goal for this Session
            </label>
            <input
              type="text"
              value={sessionGoal}
              onChange={(e) => handleSaveGoal(e.target.value)}
              placeholder="E.g. Code profile system page and compile linter..."
              className={`w-full px-3.5 py-2.5 bg-slate-50/50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl outline-none font-sans text-xs text-slate-801 dark:text-slate-200 placeholder:text-slate-400 transition-colors shadow-2xs ${setupTheme.borderFocus}`}
            />
          </div>

          {/* Save & Ready Start Button */}
          <button
            type="button"
            onClick={() => {
              const finalMins = inputMinutes > 0 ? inputMinutes : 25;
              const info = calculateFocusSession(finalMins, skipBreaks);
              const phases: {
                type: 'focus' | 'break';
                index: number;
                total: number;
                durationSeconds: number;
              }[] = [];

              if (info.numberOfBreaks === 0) {
                phases.push({
                  type: 'focus',
                  index: 1,
                  total: 1,
                  durationSeconds: Math.round(info.focusIntervalLength * 60)
                });
              } else {
                const totalFocus = info.numberOfBreaks + 1;
                const focusSecs = Math.round(info.focusIntervalLength * 60);
                const breakSecs = Math.round(info.breakDuration * 60);

                for (let i = 1; i <= totalFocus; i++) {
                  phases.push({
                    type: 'focus',
                    index: i,
                    total: totalFocus,
                    durationSeconds: focusSecs
                  });
                  if (i <= info.numberOfBreaks) {
                    phases.push({
                      type: 'break',
                      index: i,
                      total: info.numberOfBreaks,
                      durationSeconds: breakSecs
                    });
                  }
                }
              }

              setSessionPhases(phases);
              setCurrentPhaseIndex(0);

              if (phases.length > 0) {
                setSecondsLeft(phases[0].durationSeconds);
                setTotalSeconds(phases[0].durationSeconds);
                setSessionType(phases[0].type);
                setFocusIndex(phases[0].index);
              }

              // Fire RPC call with fully calculated plan
              pywebviewBridge.startFocusSession({
                totalSessionMinutes: info.totalSessionMinutes,
                numberOfBreaks: info.numberOfBreaks,
                breakDuration: info.breakDuration,
                focusIntervalLength: info.focusIntervalLength,
                phases: phases
              });

              // Create and resume AudioContext to unlock autoplay
              if (!window.__shackleAudioContext) {
                const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
                if (ctx.state === 'suspended') {
                  ctx.resume().catch(() => {});
                }
                window.__shackleAudioContext = ctx;
                audioContextRef.current = ctx;
                setAudioContext(ctx);
              } else if (window.__shackleAudioContext.state === 'suspended') {
                window.__shackleAudioContext.resume().catch(() => {});
              }

              setIsConfigured(true);
            }}
            className={`w-full py-3 rounded-xl font-bold text-xs uppercase tracking-wider shadow-sm active:scale-[0.98] transition-all cursor-pointer ${setupTheme.bgActive}`}
          >
            Lock Duration & Open Timer
          </button>
        </div>
      </div>
      ) : (
        <div className="flex flex-col items-center justify-center min-h-[75vh] md:min-h-[80vh] space-y-8 animate-fade-in py-6 max-w-2xl mx-auto text-center">
      
      {/* Page Title from Image 2 */}
      <h1 className="text-3xl md:text-4xl font-sans uppercase tracking-widest font-bold text-slate-900 dark:text-slate-100">
        LET'S SHACKLE
      </h1>

      {sessionError && (
        <div className="w-full max-w-md bg-red-500/10 border border-red-500/30 text-red-500 p-3 rounded-xl text-center animate-fade-in flex items-center justify-center gap-2 text-xs font-medium">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{sessionError}</span>
        </div>
      )}

      {/* Prominent Grace Period Countdown Warning Banner */}
      {graceSecondsLeft !== null && activeViolationType !== null && (
        <div className="w-full max-w-md animate-bounce bg-red-500/10 border border-red-500/35 rounded-xl p-4 text-left shadow-lg backdrop-blur-md">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-red-500/20 rounded-lg text-red-500">
              <span className="animate-pulse block w-2.5 h-2.5 rounded-full bg-red-500" />
            </div>
            <div className="flex-1 space-y-1">
              <h4 className="text-xs font-mono font-bold text-red-500 uppercase tracking-wider">
                WARNING: {activeViolationType.replace('_', ' ').toUpperCase()}
              </h4>
              <p className="text-sm text-slate-750 dark:text-slate-200 font-sans font-semibold">
                {activeViolationType === 'dark_room' && "Turn your lights back on! Workspace visibility critically low."}
                {activeViolationType === 'distracted' && "Focus on your screen! Looking away detected."}
                {(activeViolationType === 'absent' || activeViolationType === 'abandoned') && "Return to your seat! Workspace abandoned."}
                {activeViolationType !== 'dark_room' && activeViolationType !== 'distracted' && activeViolationType !== 'absent' && activeViolationType !== 'abandoned' && "Infraction detected. Correct your posture or environment."}
              </p>
              <div className="text-xs font-mono font-bold text-red-500 flex items-center gap-1.5 pt-1">
                <span>Grace ends in</span>
                <span className="text-sm font-sans font-extrabold bg-red-500 text-white px-2 py-0.5 rounded-md tabular-nums animate-pulse">
                  {graceSecondsLeft}s
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Theme Color Configurations for Countdown Renders */}
      {(() => {
        const getDisplayThemeVars = () => {
          switch (displaySettings.theme) {
            case 'Midnight Slate':
              return {
                accentColor: '#3B82F6',
                accentTailwind: 'text-blue-600 dark:text-blue-400',
                accentBg: 'bg-blue-600',
                pulseDot: 'bg-blue-600',
                circleStroke: 'stroke-blue-500 dark:stroke-blue-400'
              };
            case 'Deep Plum':
              return {
                accentColor: '#A855F7',
                accentTailwind: 'text-purple-600 dark:text-purple-400',
                accentBg: 'bg-purple-600',
                pulseDot: 'bg-purple-600',
                circleStroke: 'stroke-purple-500 dark:stroke-purple-400'
              };
            default: // Granite Beige
              return {
                accentColor: '#70624E',
                accentTailwind: 'text-amber-700 dark:text-amber-400',
                accentBg: 'bg-amber-700 dark:bg-amber-600',
                pulseDot: 'bg-amber-700 dark:bg-amber-400',
                circleStroke: 'stroke-amber-600 dark:stroke-amber-400'
              };
          }
        };

        const activeTheme = getDisplayThemeVars();
        const countdownStyle = displaySettings.countdownDesign || 'Split Flip Clock';
        const isGlass = displaySettings.glassmorphism;

        // Container class styled conditionally for Glassmorphism
        const glassmorphicContainerClass = isGlass
          ? "backdrop-blur-xl bg-white/40 dark:bg-slate-950/40 border border-white/25 dark:border-white/10 shadow-xl"
          : "bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-inner";

        const goalContainerClass = isGlass
          ? "backdrop-blur-md bg-white/20 dark:bg-slate-950/25 border border-white/20 dark:border-white/10 shadow-lg text-left animate-fade-in"
          : "bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800 shadow-sm text-left animate-fade-in";

        return (
          <>
            {/* Countdown timer render block based on countdownDesign preference */}
            <div className="w-full max-w-md flex justify-center relative">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={`${countdownStyle}-${sessionType}`}
                  layout
                  initial={{ opacity: 0, scale: 0.95, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -10 }}
                  transition={{ 
                    duration: 0.35, 
                    ease: [0.25, 0.1, 0.25, 1],
                    layout: { type: "spring", stiffness: 380, damping: 30 }
                  }}
                  className="w-full flex justify-center"
                >
                  {countdownStyle === 'Radial' ? (
                    <div className={`${glassmorphicContainerClass} p-8 rounded-2xl w-full max-w-md flex flex-col justify-center items-center gap-4`}>
                      <div className="relative w-64 h-64 flex items-center justify-center">
                        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 200 200">
                          {/* Ring background track */}
                          <circle
                            cx="100"
                            cy="100"
                            r="85"
                            className="stroke-slate-200 dark:stroke-slate-800/80 fill-none"
                            strokeWidth="8"
                          />
                          {/* Animated dynamic completion ring */}
                          <motion.circle
                            cx="100"
                            cy="100"
                            r="85"
                            className={`fill-none ${activeTheme.circleStroke}`}
                            strokeWidth="9"
                            strokeLinecap="round"
                            initial={{ strokeDashoffset: 534 }}
                            animate={{ strokeDashoffset: 534 - (534 * (secondsLeft / totalSeconds)) }}
                            style={{
                              strokeDasharray: 534,
                            }}
                            transition={{ duration: 0.8, ease: "easeOut" }}
                          />
                        </svg>
                        {/* Digital clock inside circle */}
                        <div className="absolute inset-0 flex flex-col items-center justify-center select-none">
                          <span className="text-4xl md:text-5xl font-mono font-black text-slate-900 dark:text-slate-100 tracking-tight">
                            {strMins}:{strSecs}
                          </span>
                          <span className={`text-[10px] font-mono font-black uppercase tracking-widest ${activeTheme.accentTailwind} mt-1.5`}>
                            {sessionType === 'focus' ? 'FOCUS LOCK' : 'RELAX'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : countdownStyle === 'Minimal' ? (
                    <div className={`${glassmorphicContainerClass} p-10 rounded-2xl w-full max-w-md flex flex-col justify-center items-center py-14 relative overflow-hidden`}>
                      {/* Minimalist central text display with delicate borders */}
                      <div className="relative z-10 space-y-1 select-none">
                        <div className="text-6xl md:text-7xl font-sans font-extralight tracking-tight text-slate-800 dark:text-slate-100 tabular-nums flex items-center justify-center">
                          <span>{strMins}</span>
                          <span className="text-slate-300 dark:text-slate-700 animate-pulse mx-2">:</span>
                          <span>{strSecs}</span>
                        </div>
                        <div className="flex items-center justify-center gap-2 pt-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${activeTheme.pulseDot} animate-pulse`} />
                          <span className="text-[10px] font-mono font-bold tracking-widest text-slate-405 dark:text-slate-500 uppercase">
                            {sessionType === 'focus' ? 'Active Focus Bout' : 'Resting'}
                          </span>
                        </div>
                      </div>

                      {/* Aesthetic hairline corner angles */}
                      <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-slate-350/50 dark:border-slate-800" />
                      <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-slate-350/50 dark:border-slate-800" />
                      <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-slate-350/50 dark:border-slate-800" />
                      <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-slate-350/50 dark:border-slate-800" />
                    </div>
                  ) : (
                    /* Original Authentic Physical Split Flip Clock */
                    <div className={`${glassmorphicContainerClass} p-8 rounded-2xl w-full max-w-md flex justify-center items-center gap-6`}>
                      {/* Minutes Plate */}
                      <FlipPlate value={strMins} />

                      {/* Separator dots */}
                      <div className="flex flex-col gap-3">
                        <div className={`w-3.5 h-3.5 rounded-full ${activeTheme.pulseDot} animate-pulse`} />
                        <div className={`w-3.5 h-3.5 rounded-full ${activeTheme.pulseDot} animate-pulse`} />
                      </div>

                      {/* Seconds Plate */}
                      <FlipPlate value={strSecs} />
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>

              {/* Centered Overlays for Strike Toast & Roast Text Toast */}
              <AnimatePresence mode="popLayout">
                {strikeToast ? (
                  <motion.div
                    key="strike-toast-overlay"
                    initial={{ y: 80, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -80, opacity: 0 }}
                    transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute inset-0 z-30 flex flex-col items-center justify-center p-6 text-center rounded-2xl backdrop-blur-md border shadow-2xl overflow-hidden"
                    style={{
                      background: `linear-gradient(135deg, ${toastPalette.accentHex}50 0%, ${toastPalette.cardBgHex}E6 60%, ${toastPalette.bgHex}F2 100%)`,
                      borderColor: `${toastPalette.borderHex}AA`,
                    }}
                  >
                    <button
                      onClick={() => setStrikeToast(null)}
                      className="absolute top-3 right-3 text-slate-400 hover:text-white text-lg p-1.5 transition-colors cursor-pointer"
                      aria-label="Dismiss strike toast"
                    >
                      ✕
                    </button>

                    <div className="space-y-3 max-w-sm">
                      <div className="inline-flex items-center justify-center p-3 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30 animate-pulse mb-1">
                        <ShieldAlert className="w-8 h-8" />
                      </div>

                      <h2 className="text-2xl md:text-3xl font-black uppercase tracking-wider text-white">
                        Strike {strikeToast.count}
                      </h2>

                      <div className="space-y-1">
                        <span className="text-xs font-mono font-bold uppercase tracking-widest text-rose-400 block">
                          Reason:
                        </span>
                        <p className="text-sm md:text-base font-semibold text-slate-100 leading-snug">
                          {strikeToast.reason}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                ) : roastText && !isRoastDismissed ? (
                  <motion.div
                    key="roast-toast-overlay"
                    initial={{ y: 80, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -80, opacity: 0 }}
                    transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute inset-0 z-30 flex flex-col items-center justify-center p-6 text-center rounded-2xl backdrop-blur-md border shadow-2xl overflow-hidden"
                    style={{
                      background: `linear-gradient(135deg, ${toastPalette.accentHex}40 0%, ${toastPalette.cardBgHex}E6 60%, ${toastPalette.bgHex}F2 100%)`,
                      borderColor: `${toastPalette.borderHex}AA`,
                    }}
                  >
                    <button
                      onClick={() => setIsRoastDismissed(true)}
                      className="absolute top-3 right-3 text-slate-400 hover:text-white text-lg p-1.5 transition-colors cursor-pointer"
                      aria-label="Dismiss roast toast"
                    >
                      ✕
                    </button>

                    <div className="space-y-3 max-w-sm">
                      <div className="inline-flex items-center justify-center p-2.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 animate-bounce mb-1">
                        <Sparkles className="w-6 h-6" />
                      </div>

                      <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-amber-300">
                        Shackle AI Says
                      </h3>

                      <p className="text-base md:text-lg font-medium italic text-slate-100 leading-relaxed px-2">
                        "{roastText}"
                      </p>

                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.5, duration: 0.4 }}
                        className="pt-2"
                      >
                        <button
                          onClick={() => setIsRoastDismissed(true)}
                          className="px-5 py-2 bg-amber-500 hover:bg-amber-600 active:scale-95 text-slate-950 font-bold text-xs uppercase tracking-wider rounded-xl shadow-md transition-all cursor-pointer"
                        >
                          Got It
                        </button>
                      </motion.div>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>

              {/* Small re-open affordance badge when roast text is dismissed */}
              {roastText && isRoastDismissed && (
                <motion.button
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  onClick={() => setIsRoastDismissed(false)}
                  className="absolute -top-3 left-1/2 -translate-x-1/2 z-40 px-3 py-1 bg-amber-500/90 hover:bg-amber-500 text-slate-950 rounded-full font-sans font-bold text-[10px] uppercase tracking-wider shadow-lg backdrop-blur-md flex items-center gap-1.5 cursor-pointer transition-all hover:scale-105"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>View AI Roast</span>
                </motion.button>
              )}
            </div>

            {/* Subtitles: Current Status from Image 2 */}
            {(() => {
              const currentPhase = sessionPhases[currentPhaseIndex];
              const nextPhase = sessionPhases[currentPhaseIndex + 1];
              const totalPhasesOfSameType = currentPhase ? currentPhase.total : 1;
              return (
                <div className="space-y-1">
                  <h3 className="text-xl font-sans text-slate-700 dark:text-slate-300 font-light">
                    {sessionType === 'focus' ? 'Focus Session' : 'Relax/Break Period'} : {focusIndex} of {totalPhasesOfSameType}
                  </h3>
                  <p className="text-sm text-slate-450 font-medium font-sans">
                    Next up: {nextPhase ? (nextPhase.type === 'focus' ? `Focus Period ${nextPhase.index}` : `Break ${nextPhase.index}`) : 'Sprint Completed'}
                  </p>
                </div>
              );
            })()}

            {/* Dynamic Session Goal Panel matching the requested design with Glassmorphism overrides */}
            {isRunning ? (
              <div className={`${goalContainerClass} w-full max-w-md p-5 relative overflow-hidden bg-gradient-to-br from-blue-50/10 to-transparent dark:from-slate-900/10`}>
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-[10px] font-mono uppercase tracking-widest font-black flex items-center gap-1.5 ${activeTheme.accentTailwind}`}>
                    <span className={`w-2 h-2 rounded-full ${activeTheme.pulseDot} animate-ping`} />
                    Active Session Goal
                  </span>
                  {preventedProcesses.length > 0 && (
                    <span className="text-[10px] bg-red-50 dark:bg-red-950/30 text-red-650 dark:text-red-450 px-2 py-0.5 rounded font-mono font-bold animate-pulse">
                      Shielded: {preventedProcesses.length} attempts
                    </span>
                  )}
                </div>
                <p className="text-slate-805 dark:text-slate-205 font-sans font-bold text-sm tracking-tight leading-relaxed">
                  {sessionGoal.trim() || "Stay laser focused on your studies!"}
                </p>
                
                {preventedProcesses.length > 0 && (
                  <div className="mt-3.5 pt-3 border-t border-slate-105/40 dark:border-slate-800">
                    <p className="text-[9px] font-mono text-slate-400 dark:text-slate-505 uppercase tracking-wider font-bold mb-1.5">
                      Shield intercepts ({preventedProcesses.length})
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {preventedProcesses.map((app) => (
                        <span key={app} className="text-[10px] bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 px-2.5 py-0.5 rounded-md font-mono flex items-center gap-1 border border-slate-205 dark:border-slate-800">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                          {app}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className={`${goalContainerClass} w-full max-w-md p-5 space-y-3`}>
                <div className="space-y-0.5">
                  <label className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase tracking-widest font-bold block">
                    Session Goal
                  </label>
                  <p className="text-[10px] text-slate-400 dark:text-slate-505 font-medium">
                    Objective selected for this Shackle bout.
                  </p>
                </div>
                <p className="text-xs bg-slate-50/50 dark:bg-slate-950/40 p-3 rounded-lg border border-slate-100 dark:border-slate-900 text-slate-700 dark:text-slate-300 font-medium">
                  {sessionGoal.trim() || "(No Goal Specified)"}
                </p>
              </div>
            )}
          </>
        );
      })()}

      {/* Action triggers */}
      <div className="flex flex-col items-center gap-3 pt-3">
        {/* Central Play toggle - disappears when running */}
        {!isRunning ? (
          <button
            onClick={() => setIsRunning(true)}
            className="p-5 text-white rounded-full shadow-md transform transition-all duration-200 bg-blue-600 hover:bg-blue-700 hover:scale-105 active:scale-95 cursor-pointer"
            title="Engage focus and lock desktop shield"
          >
            <Play className="w-6 h-6 fill-current translate-x-0.5" />
          </button>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="text-[10px] font-mono font-bold tracking-widest text-blue-600 dark:text-blue-400 uppercase flex items-center gap-2 px-4 py-2 bg-blue-50/50 dark:bg-blue-950/20 rounded-full border border-blue-150/30 animate-pulse select-none">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-600 dark:bg-blue-400" />
              Locked Focus Active
            </div>
          </div>
        )}

        {/* Book Mode Toggle Pill */}
        <div className="flex items-center gap-2.5 bg-white/70 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800/80 px-3.5 py-1 rounded-full shadow-2xs backdrop-blur-xs">
          <BookOpen className="w-3.5 h-3.5 text-blue-500 shrink-0" />
          <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Book Mode</span>
          <label className="relative inline-flex items-center cursor-pointer ml-1">
            <input 
              type="checkbox" 
              checked={isBookMode}
              onChange={(e) => handleToggleBookMode(e.target.checked)}
              className="sr-only peer" 
            />
            <div className="w-8 h-4.5 bg-slate-200 dark:bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-blue-600 toggle-switch-small"></div>
          </label>
        </div>
      </div>

      {/* ========================================== */}
      {/* NEW: DARK DISCIPLINARY STRIKE OVERLAY     */}
      {/* ========================================== */}
      {showWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 transition-all duration-300">
          <div className="w-full max-w-md transform overflow-hidden rounded-2xl bg-zinc-950 border-2 border-red-900/80 p-6 text-center shadow-[0_0_50px_rgba(153,27,27,0.3)]">
            
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-950/60 border border-red-700/40 text-red-500 mb-4 animate-pulse">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-8 h-8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>

            <h2 className="text-3xl font-black tracking-widest text-red-500 uppercase">
              STRIKE {currentStrike}
            </h2>

            <div className="my-4 h-px bg-gradient-to-r from-transparent via-red-900/60 to-transparent" />

            <div className="space-y-1">
              <p className="text-xs font-semibold tracking-wider text-zinc-500 uppercase">
                Contract Infraction
              </p>
              <p className="text-md font-bold text-zinc-200 bg-red-950/30 border border-red-950 rounded-xl py-3.5 px-4 shadow-inner">
                {infractionReason || "Unauthorized workflow distraction detected."}
              </p>
            </div>

            <button
              onClick={() => setShowWarning(false)}
              className="mt-6 w-full rounded-xl bg-red-950/40 hover:bg-red-900/30 border border-red-800/60 py-3 font-bold text-red-400 transition-all duration-200"
            >
              Acknowledge & Clear Focus Space
            </button>
          </div>
        </div>
      )}
        </div>
      )}

      {/* AI Coaching summary report overlay */}
      <AnimatePresence>
        {showReportModal && lastCompletedSession && (
          <div className="fixed inset-0 bg-slate-950/45 backdrop-blur-sm z-[999] flex items-center justify-center p-4 animate-fade-in">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-900 rounded-xl p-6 max-w-lg w-full shadow-xl space-y-5 border border-slate-200 dark:border-slate-800 max-h-[90vh] overflow-y-auto"
            >
              {/* Heading */}
              <div className="flex items-center gap-3 text-blue-600 dark:text-blue-400 font-sans border-b border-slate-100 dark:border-slate-800 pb-4">
                <Award className="w-5 h-5" />
                <h2 className="text-lg font-bold uppercase tracking-wider">Focus Session Recorded!</h2>
              </div>

              {/* Prominent Session Duration Summary Header */}
              <div className="text-center py-4 bg-gradient-to-b from-blue-500/10 via-indigo-500/5 to-transparent rounded-2xl border border-blue-500/20 shadow-inner">
                <p className="text-[11px] font-mono text-slate-400 dark:text-slate-500 uppercase tracking-widest font-bold">Session Duration</p>
                <p className="text-5xl font-sans font-black text-blue-600 dark:text-blue-400 mt-1">
                  {lastCompletedSession.duration} <span className="text-2xl font-bold">min</span>
                </p>
              </div>

              {/* Log Stats layout */}
              <div className="grid grid-cols-2 gap-4 bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg border border-slate-200/50 dark:border-slate-700">
                <div>
                  <p className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase tracking-wider font-bold">Invested Time</p>
                  <p className="text-md font-bold text-slate-800 dark:text-slate-200">{lastCompletedSession.duration} Minutes</p>
                </div>
                <div>
                  <p className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase tracking-wider font-bold">Earned Rewards</p>
                  <p className="text-md font-bold text-blue-600 dark:text-blue-450">+{lastCompletedSession.xpEarned} XP</p>
                </div>
                <div className="col-span-2">
                  <p className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase tracking-wider font-bold">Guarded Procs</p>
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mt-0.5">
                    {lastCompletedSession.appNames.length > 0 
                      ? `Blocked ${lastCompletedSession.preventsCount} attempts from: ${lastCompletedSession.appNames.join(', ')}` 
                      : 'None detected (Perfect offline compliance!)'}
                  </p>
                </div>
              </div>

              {/* Coach text zone */}
              <div className="space-y-4">
                {aiReportText ? (
                  <div className="bg-blue-50/20 dark:bg-blue-950/10 border border-blue-100/60 dark:border-blue-900/30 p-4 rounded-lg text-left text-xs text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap font-sans">
                    {/* Filter headers or formatting if required */}
                    {aiReportText}
                  </div>
                ) : (
                  <div className="text-center py-4 space-y-2">
                    <BrainCircuit className="w-8 h-8 mx-auto text-blue-600 dark:text-blue-400 animate-pulse" />
                    <div>
                      <p className="font-bold text-sm text-slate-800 dark:text-slate-200">AI-powered coaching reports are coming soon.</p>
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Our Gemini-powered coach will analyze your distraction shielding metrics once the feature is fully stabilized.</p>
                    </div>
                  </div>
                )}
              </div>

              {/* CTA zone */}
              <div className="flex flex-col gap-2">
                {/* AI Coach Report — Coming Soon badge.
                    triggerAiReportGeneration and the backend route are preserved;
                    swap this block back to the <button> once the Gemini fallback model is stable. */}
                {!aiReportText && (
                  <div
                    aria-disabled="true"
                    className="w-full py-2.5 rounded-lg flex items-center justify-center gap-2 font-semibold text-xs uppercase tracking-wider border border-dashed border-slate-600/50 text-slate-500 dark:text-slate-500 bg-slate-800/30 cursor-not-allowed select-none"
                  >
                    <Sparkles className="w-3.5 h-3.5 opacity-60" />
                    <span>AI Coach Report — Coming Soon</span>
                  </div>
                )}

                <button
                  onClick={() => {
                    setShowReportModal(false);
                    setAiReportText("");
                  }}
                  className="w-full py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-lg text-center text-xs font-semibold cursor-pointer transition-colors"
                >
                  {isConfigured ? "Begin Next Phase" : "Return to Setup"}
                </button>
              </div>

            </motion.div>
          </div>
        )}
      </AnimatePresence>



      {/* Roast Audio Toast – triggered by daemon via window.playRoastAudio(url) */}
      {roastAudioUrl && (
        <div className="fixed bottom-4 right-4 z-[9999] bg-slate-900 dark:bg-slate-800 text-white p-4 rounded-xl shadow-2xl flex items-center gap-3 max-w-sm border border-slate-700 animate-fade-in">
          <span className="text-xl shrink-0">💬</span>
          <span className="text-sm font-medium flex-1">Shackle AI has a roast for you!</span>
          <button
            onClick={() => playRoastWithContext(roastAudioUrl)}
            disabled={isRoastPlaying}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0 transition-colors ${
              isRoastPlaying
                ? 'bg-blue-600/50 text-blue-200 cursor-not-allowed opacity-70'
                : 'bg-blue-600 hover:bg-blue-700 text-white cursor-pointer'
            }`}
          >
            {isRoastPlaying ? 'Playing...' : 'Replay 🔊'}
          </button>
          <button
            onClick={() => setRoastAudioUrl(null)}
            className="text-slate-400 hover:text-slate-200 text-sm shrink-0 transition-colors"
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}
