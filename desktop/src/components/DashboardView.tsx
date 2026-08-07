/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { UserProfile, ShackleSession } from '../types';
import { pywebviewBridge } from '../utils/pywebviewBridge';
import { Play, Flame, Shield, Trophy, Layout, Clock, Sparkles, Lock, ShieldAlert, RefreshCw, AlertTriangle, CheckCircle, Terminal } from 'lucide-react';
import { motion } from 'motion/react';
import confetti from 'canvas-confetti';
import { 
  getLockdownStatus, 
  simulateStrike3Lockdown, 
  simulatePass72Hours, 
  simulateAddStreakDay, 
  simulateStreakReset, 
  forceCompleteChallenge,
  clearAllStrikesAndStatsBackToPristine
} from '../utils/lockdownService';
import { doc, updateDoc } from "firebase/firestore";
import { db, auth } from "../utils/firebase";
import { resolveDisplayName } from "../utils/profileHelpers";
import { getLevelFromXp } from "../utils/levelUtils";


interface DashboardViewProps {
  onNavigate: (view: string) => void;
  profile: UserProfile;
  theme?: 'Granite Beige' | 'Midnight Slate' | 'Deep Plum';
  mode?: 'Light' | 'Dark';
  onUpdateProfile?: (p: UserProfile) => void;
}

const phrases = [
  "Let's shackle your distractions",
  "Time to enter deep work state",
  "Break the chains of social media",
  "Unlock your ultimate academic potential",
  "Stay focused, achieve greatness",
  "Ready for an ironclad study grind?",
  "Silence the digital noise",
  "Your focus fortress awaits"
];

export default function DashboardView({ onNavigate, profile, theme = 'Granite Beige', mode = 'Light', onUpdateProfile }: DashboardViewProps) {
  const [greetingPhrase, setGreetingPhrase] = useState("Let's shackle your distractions");
  const [displayedXp, setDisplayedXp] = useState(profile.xp);
  const [xpChanged, setXpChanged] = useState(false);

  // Locate this block near the top of DashboardView component:
  useEffect(() => {
    if (profile.xp !== displayedXp) {
      setDisplayedXp(profile.xp);
      setXpChanged(true);
      
      const timer = setTimeout(() => setXpChanged(false), 1200);
      return () => clearTimeout(timer);
    }
  }, [profile.xp]);

  const [recentSessions, setRecentSessions] = useState<ShackleSession[]>([]);
  const [stats, setStats] = useState({
    totalCompleted: 0,
    totalMinutes: 0,
    preventedCount: 0,
  });

  const [dailyGoalMinutes, setDailyGoalMinutes] = useState<number>(() => {
    return parseInt(localStorage.getItem('shackle_daily_focus_goal_minutes') || '60', 10);
  });
  const [todayMinutes, setTodayMinutes] = useState(0);
  const [todayCompletedCount, setTodayCompletedCount] = useState(0);
  const [todayPreventedCount, setTodayPreventedCount] = useState(0);
  const [hasCelebrated, setHasCelebrated] = useState(false);

  const [showDevPanel, setShowDevPanel] = useState(false);
  const [tick, setTick] = useState(0);

  // Gate the dev simulator panel to the single UID set in VITE_DEV_UID.
  // Any build without that env var set (testers, prod) gets `undefined`,
  // so the check fails closed — the button and panel are invisible.
  const isDevUser = !!import.meta.env.VITE_DEV_UID &&
    auth.currentUser?.uid === import.meta.env.VITE_DEV_UID;

  const [activationError, setActivationError] = useState<string | null>(null);
  const [activationSuccessMsg, setActivationSuccessMsg] = useState<string | null>(null);
  const [isActivatingRestDay, setIsActivatingRestDay] = useState(false);

  // Weekly rest permit reset logic (2 per week, non-stackable)
  useEffect(() => {
    if (!profile.gamification || !onUpdateProfile) return;
    
    const now = new Date();
    const lastResetStr = profile.gamification.last_permit_reset;
    const lastReset = lastResetStr ? new Date(lastResetStr) : new Date(0);
    const oneWeekMs = 7 * 24 * 60 * 60 * 1000;

    if (now.getTime() - lastReset.getTime() > oneWeekMs) {
      console.log("Weekly reset detected: Restoring 2 non-stackable permits.");
      const updatedProfile: UserProfile = {
        ...profile,
        gamification: {
          ...profile.gamification,
          rest_permits: 2,
          last_permit_reset: now.toISOString()
        }
      };
      pywebviewBridge.saveProfile(updatedProfile);
      onUpdateProfile(updatedProfile);
    }
  }, [profile.gamification?.last_permit_reset, onUpdateProfile]);

  // Helper to determine if a date is today
  const isDateToday = (dateString: string) => {
    try {
      const d = new Date(dateString);
      const today = new Date();
      return d.getDate() === today.getDate() &&
             d.getMonth() === today.getMonth() &&
             d.getFullYear() === today.getFullYear();
    } catch (e) {
      return false;
    }
  };

  const fetchSessionStats = () => {
    pywebviewBridge.getSessions().then(sess => {
      setRecentSessions(sess.slice(0, 3));
      const completed = sess.filter(s => s.completed && s.type === 'focus');
      const mins = completed.reduce((acc, curr) => acc + curr.duration, 0);
      const prevs = sess.reduce((acc, curr) => acc + (curr.blacklistedAppsPrevented?.length || 0), 0);
      setStats({
        totalCompleted: completed.length,
        totalMinutes: mins,
        preventedCount: prevs
      });

      // Today's specific metrics
      const todaySessions = sess.filter(s => s.completed && s.type === 'focus' && isDateToday(s.startTime));
      const todayMins = todaySessions.reduce((acc, curr) => acc + curr.duration, 0);
      setTodayMinutes(todayMins);
      setTodayCompletedCount(todaySessions.length);

      const todayPrevs = sess.filter(s => isDateToday(s.startTime))
        .reduce((acc, curr) => acc + (curr.blacklistedAppsPrevented?.length || 0), 0);
      setTodayPreventedCount(todayPrevs);
    });
  };

  // Randomize greeting phrase once on mount
  useEffect(() => {
    const idx = Math.floor(Math.random() * phrases.length);
    setGreetingPhrase(phrases[idx]);
  }, []);

  // Fetch sessions on mount, then every 60 s — decoupled from the 1-second tick
  // so we don't hammer Firestore (~3,600 reads/hour) just to update the countdown display.
  useEffect(() => {
    fetchSessionStats();
    const sessionRefreshInterval = setInterval(fetchSessionStats, 60_000);
    return () => clearInterval(sessionRefreshInterval);
  }, []);

  // 1-second tick — used only for the lockdown/challenge countdown display
  useEffect(() => {
    const interval = setInterval(() => {
      setTick(prev => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const triggerCelebration = () => {
    confetti({
      particleCount: 80,
      angle: 60,
      spread: 70,
      origin: { x: 0.1, y: 0.85 },
      colors: theme === 'Midnight Slate' 
        ? ['#2563eb', '#3b82f6', '#06b6d4', '#22d3ee'] 
        : theme === 'Granite Beige'
          ? ['#d97706', '#f59e0b', '#fbbf24', '#f59e0b']
          : ['#7c3aed', '#a855f7', '#ec4899', '#f43f5e']
    });
    confetti({
      particleCount: 80,
      angle: 120,
      spread: 70,
      origin: { x: 0.9, y: 0.85 },
      colors: theme === 'Midnight Slate' 
        ? ['#2563eb', '#3b82f6', '#06b6d4', '#22d3ee'] 
        : theme === 'Granite Beige'
          ? ['#d97706', '#f59e0b', '#fbbf24', '#f59e0b']
          : ['#7c3aed', '#a855f7', '#ec4899', '#f43f5e']
    });
  };

  useEffect(() => {
    if (todayMinutes >= dailyGoalMinutes && todayMinutes > 0 && !hasCelebrated) {
      triggerCelebration();
      setHasCelebrated(true);
    } else if (todayMinutes < dailyGoalMinutes) {
      setHasCelebrated(false);
    }
  }, [todayMinutes, dailyGoalMinutes, hasCelebrated]);

  const handleUpdateGoal = (mins: number) => {
    setDailyGoalMinutes(mins);
    localStorage.setItem('shackle_daily_focus_goal_minutes', mins.toString());
  };

  const lockdown = getLockdownStatus(profile);

  const handleSimulateStrike3 = () => {
    if (onUpdateProfile) {
      simulateStrike3Lockdown(profile, onUpdateProfile);
    }
  };

  const handleSimulatePass72 = () => {
    simulatePass72Hours();
    setTick(p => p + 1);
    if (onUpdateProfile) {
      pywebviewBridge.getProfile().then(res => onUpdateProfile(res.profile));
    }
  };

  const handleSimulateAddStreak = () => {
    if (onUpdateProfile) {
      simulateAddStreakDay(profile, onUpdateProfile);
    }
  };

  const handleSimulateStreakReset = () => {
    if (onUpdateProfile) {
      simulateStreakReset(profile, onUpdateProfile);
    }
  };

  const handleActivateRestDay = async () => {
    const curGamification = profile.gamification || { rest_permits: 2, rest_day_active: false };
    if (curGamification.rest_day_active) return;
    if (curGamification.rest_permits <= 0) return;

    setIsActivatingRestDay(true);
    setActivationError(null);
    setActivationSuccessMsg(null);

    try {
      // 1. Grab the current authenticated user's ID
      const user = auth.currentUser;
      if (!user) {
        throw new Error('Authentication required. Please log in to freeze your streak.');
      }

      // 2. Prepare the updated gamification sub-object
      const updatedGamification = {
        ...curGamification,
        rest_permits: Math.max(0, curGamification.rest_permits - 1),
        rest_day_active: true
      };

      // 3. Persist directly to your cloud production Firestore first
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        "gamification.rest_permits": Math.max(0, curGamification.rest_permits - 1),
        "gamification.rest_day_active": true
      });

      // 4. Update the local desktop environment profile state
      const updatedProfile: UserProfile = {
        ...profile,
        gamification: updatedGamification
      };

      await pywebviewBridge.saveProfile(updatedProfile);
      if (onUpdateProfile) {
        onUpdateProfile(updatedProfile);
      }

      // 5. Fire visual feedback and rewards
      setActivationSuccessMsg("Rest Protocol Activated! Your daily streak is now frozen and secured.");
      confetti({
        particleCount: 60,
        spread: 60,
        origin: { y: 0.75 },
        colors: ['#22d3ee', '#06b6d4', '#e0f7fa', '#ffffff'] // Ice blue + white frost sparks
      });

      setTimeout(() => {
        setActivationSuccessMsg(null);
      }, 5000);

    } catch (err: any) {
      console.error("Firestore Rest Activation Error:", err);
      setActivationError(err.message || "Endpoint error encountered. Rolling back state.");
    } finally {
      setIsActivatingRestDay(false);
    }
  };

  const handleUpgradeNow = async () => {
    const upgraded = {
      ...profile,
      billing_lifecycle: {
        access_granted: true,
        status_code: "PREMIUM_ACTIVE" as const,
        days_remaining_in_trial: 9999
      }
    };
    await pywebviewBridge.saveProfile(upgraded);
    if (onUpdateProfile) {
      onUpdateProfile(upgraded);
    }
    confetti({
      particleCount: 150,
      spread: 80,
      origin: { y: 0.6 }
    });
  };

  const handleSimulateTrialExpiry = async () => {
    const updated = {
      ...profile,
      billing_lifecycle: {
        access_granted: false,
        status_code: "TRIAL_EXPIRED" as const,
        days_remaining_in_trial: 0
      }
    };
    await pywebviewBridge.saveProfile(updated);
    if (onUpdateProfile) onUpdateProfile(updated);
  };

  const handleSimulateRestoreTrial = async () => {
    const updated = {
      ...profile,
      billing_lifecycle: {
        access_granted: true,
        status_code: "TRIAL_ACTIVE" as const,
        days_remaining_in_trial: 10
      }
    };
    await pywebviewBridge.saveProfile(updated);
    if (onUpdateProfile) onUpdateProfile(updated);
  };

  const handleSimulateAddPermit = async () => {
    const gam = profile.gamification || { rest_permits: 2, rest_day_active: false };
    if (gam.rest_permits >= 2) {
      setActivationError("Weekly limit reached. You can only have 2 active permits.");
      return;
    }
    const updated = {
      ...profile,
      gamification: {
        ...gam,
        rest_permits: Math.min(2, gam.rest_permits + 1)
      }
    };
    await pywebviewBridge.saveProfile(updated);
    if (onUpdateProfile) onUpdateProfile(updated);
  };

  const handleSimulateDepletePermits = async () => {
    const gam = profile.gamification || { rest_permits: 2, rest_day_active: false };
    const updated = {
      ...profile,
      gamification: {
        ...gam,
        rest_permits: 0
      }
    };
    await pywebviewBridge.saveProfile(updated);
    if (onUpdateProfile) onUpdateProfile(updated);
  };

  const handleSimulateToggleRestDay = async () => {
    const gam = profile.gamification || { rest_permits: 2, rest_day_active: false };
    const updated = {
      ...profile,
      gamification: {
        ...gam,
        rest_day_active: !gam.rest_day_active
      }
    };
    await pywebviewBridge.saveProfile(updated);
    if (onUpdateProfile) onUpdateProfile(updated);
  };

  const handleForceComplete = () => {
    if (onUpdateProfile) {
      forceCompleteChallenge(profile, onUpdateProfile);
    }
  };

  const handleResetAllChanges = () => {
    if (confirm("🔄 RESET DETECTED: Wiping strikes, lockouts, and resetting your profile stats back to pristine default setup. Are you sure?")) {
      if (onUpdateProfile) {
        clearAllStrikesAndStatsBackToPristine(profile, onUpdateProfile);
      }
    }
  };

  function formatTimeLeft(ms: number): string {
    if (ms <= 0) return "00:00:00";
    const totalSecs = Math.floor(ms / 1000);
    const secs = totalSecs % 60;
    const totalMins = Math.floor(totalSecs / 60);
    const mins = totalMins % 60;
    const hrs = Math.floor(totalMins / 60);
    return `${hrs.toString().padStart(2, '0')}h ${mins.toString().padStart(2, '0')}m ${secs.toString().padStart(2, '0')}s`;
  }

  // Determine dynamic gradient classes and glass styling based on the active theme
  let gradientClasses = "from-purple-600 via-fuchsia-500 to-pink-500"; // Deep Plum / Default
  let buttonGlassClass = "bg-purple-600/15 hover:bg-purple-600/25 text-purple-700 dark:text-purple-200 border-purple-500/40 shadow-purple-500/10 hover:shadow-purple-500/20";
  let streakGlassClass = "";

  if (mode === 'Dark') {
    if (theme === 'Midnight Slate') {
      gradientClasses = "from-blue-600 via-indigo-600 to-cyan-500";
      buttonGlassClass = "bg-blue-600/15 hover:bg-blue-600/25 text-blue-700 dark:text-blue-200 border-blue-500/40 shadow-blue-500/10 hover:shadow-blue-500/20";
      streakGlassClass = "bg-slate-900/45 dark:bg-slate-900/45 backdrop-blur-md border border-blue-500/30 text-blue-300 shadow-lg shadow-blue-950/40";
    } else if (theme === 'Granite Beige') {
      gradientClasses = "from-amber-600 via-yellow-500 to-orange-500";
      buttonGlassClass = "bg-amber-600/15 hover:bg-amber-600/25 text-amber-800 dark:text-amber-100 border-amber-500/40 shadow-amber-500/10 hover:shadow-amber-500/20";
      streakGlassClass = "bg-[#252320]/45 dark:bg-[#252320]/45 backdrop-blur-md border border-amber-550/30 text-amber-200 shadow-lg shadow-amber-950/30";
    } else { // Deep Plum
      streakGlassClass = "bg-[#1F1024]/45 dark:bg-[#1F1024]/45 backdrop-blur-md border border-fuchsia-500/30 text-fuchsia-200 shadow-lg shadow-purple-950/40";
    }
  } else { // Light Mode
    if (theme === 'Midnight Slate') {
      gradientClasses = "from-blue-600 via-indigo-600 to-cyan-500";
      buttonGlassClass = "bg-blue-600/15 hover:bg-blue-600/25 text-blue-700 dark:text-blue-200 border-blue-500/40 shadow-blue-500/10 hover:shadow-blue-500/20";
      streakGlassClass = "bg-blue-50/60 backdrop-blur-md border border-blue-300 text-blue-900 shadow-md shadow-blue-100/50";
    } else if (theme === 'Granite Beige') {
      gradientClasses = "from-amber-600 via-yellow-500 to-orange-500";
      buttonGlassClass = "bg-amber-600/15 hover:bg-amber-600/25 text-amber-850 dark:text-amber-100 border-amber-500/40 shadow-amber-500/10 hover:shadow-amber-500/20";
      streakGlassClass = "bg-stone-100/60 backdrop-blur-md border border-stone-300 text-stone-900 shadow-md shadow-stone-200/50";
    } else { // Deep Plum
      streakGlassClass = "bg-purple-50/60 backdrop-blur-md border border-fuchsia-250 text-purple-900 shadow-md shadow-purple-100/50";
    }
  }

  // Determine custom colors for the XP and Level stats badge
  let xpCardBgClass = "bg-[#1F1024]/15 border-fuchsia-500/20 text-fuchsia-100 shadow-purple-950/10";
  let xpBarBgClass = "bg-gradient-to-r from-fuchsia-600 to-pink-500 shadow-[0_0_8px_rgba(236,72,153,0.4)]";
  let xpTextColor = "text-fuchsia-500 dark:text-fuchsia-400";

  if (mode === 'Dark') {
    if (theme === 'Midnight Slate') {
      xpCardBgClass = "bg-slate-900/35 border-blue-500/15 text-blue-100 shadow-blue-950/20";
      xpBarBgClass = "bg-gradient-to-r from-blue-600 to-cyan-400 shadow-[0_0_8px_rgba(59,130,246,0.4)]";
      xpTextColor = "text-blue-500 dark:text-blue-400";
    } else if (theme === 'Granite Beige') {
      xpCardBgClass = "bg-[#252320]/35 border-amber-550/15 text-amber-100 shadow-amber-950/10";
      xpBarBgClass = "bg-gradient-to-r from-amber-600 to-orange-450 shadow-[0_0_8px_rgba(245,158,11,0.4)]";
      xpTextColor = "text-amber-600 dark:text-amber-400";
    }
  } else { // Light Mode
    if (theme === 'Midnight Slate') {
      xpCardBgClass = "bg-blue-50/40 border-blue-200/50 text-blue-950 shadow-md shadow-blue-100/30";
      xpBarBgClass = "bg-gradient-to-r from-blue-500 to-cyan-500";
      xpTextColor = "text-blue-600 dark:text-blue-505";
    } else if (theme === 'Granite Beige') {
      xpCardBgClass = "bg-stone-50/45 border-stone-200/60 text-stone-950 shadow-md shadow-stone-250/20";
      xpBarBgClass = "bg-gradient-to-r from-amber-500 to-orange-500";
      xpTextColor = "text-amber-700 dark:text-amber-500";
    } else { // Deep Plum
      xpCardBgClass = "bg-purple-50/40 border-fuchsia-250/50 text-purple-950 shadow-md shadow-purple-100/30";
      xpBarBgClass = "bg-gradient-to-r from-purple-500 to-pink-500";
      xpTextColor = "text-purple-600 dark:text-purple-500";
    }
  }

  const billing = profile.billing_lifecycle || {
    access_granted: true,
    status_code: "TRIAL_ACTIVE" as const,
    days_remaining_in_trial: 7
  };

  const gamification = profile.gamification || {
    rest_permits: 2,
    rest_day_active: false
  };

  if (!billing.access_granted && billing.status_code === 'TRIAL_EXPIRED') {
    return (
      <div className="min-h-[72vh] flex flex-col justify-center items-center px-4 py-8 animate-fade-in w-full max-w-lg mx-auto text-center relative">
        <div className="absolute top-1/2 left-1/2 w-[400px] h-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500/10 blur-3xl pointer-events-none" />
        
        <div className="relative z-10 w-full p-8 rounded-3xl border border-red-500/20 bg-slate-900/80 dark:bg-slate-950/80 backdrop-blur-xl shadow-2xl space-y-6 flex flex-col items-center">
          <div className="p-4 rounded-full bg-red-500/10 border border-red-500/30 text-red-500 animate-pulse">
            <Lock className="w-10 h-10" />
          </div>

          <h2 className="text-3xl font-sans font-black tracking-tight text-white animate-pulse">
            Your trial has ended
          </h2>

          <p className="text-sm leading-relaxed text-slate-350 dark:text-slate-400">
            Your focus history, league placements, and streaks are securely preserved in our database. Upgrade to Premium to unlock your environment and continue training.
          </p>

          <div className="w-full pt-4">
            <button
              onClick={() => pywebviewBridge.openExternalLink('http://127.0.0.1:8000/static/checkout.html?user_id=' + encodeURIComponent(profile.username))}
              className="w-full py-4 px-6 bg-gradient-to-r from-red-600 via-fuchsia-600 to-indigo-600 hover:from-red-500 hover:via-fuchsia-500 hover:to-indigo-500 text-white font-sans font-black text-sm tracking-widest uppercase rounded-2xl shadow-lg hover:shadow-fuchsia-500/20 active:scale-95 transition-all duration-300 cursor-pointer"
            >
              Get Premium
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[72vh] flex flex-col justify-center items-center space-y-8 animate-fade-in w-full max-w-4xl mx-auto py-4 relative">
      {/* Animated Gradient Pulse Effect - dramatically scaled up for immersive depth */}
      <div 
        className={`absolute top-1/2 left-1/2 w-[700px] h-[700px] md:w-[950px] md:h-[950px] rounded-full bg-gradient-to-tr ${gradientClasses} pointer-events-none animate-gradient-pulse z-0`} 
      />

      {/* Upper Section */}
      <div className="relative z-10 w-full mb-2">
        {/* Integrated Streak & Defense Console Widget */}
        <div 
          className="absolute -top-16 right-0 md:right-[-1.5rem] flex flex-col items-end gap-1.5 z-50 select-none scale-110 md:scale-125 origin-top-right transition-all duration-300"
        >
          {/* Main Visual Stats Badge */}
          <div className={`flex items-center gap-2.5 px-3 py-1.5 rounded-2xl border backdrop-blur-md shadow-md transition-all duration-300 ${streakGlassClass}`}>
            <div className="flex items-center gap-1.5" title="Current Focus Streak">
              <Flame className={`w-4 h-4 fill-current animate-pulse ${
                gamification.rest_day_active
                  ? 'text-cyan-400 dark:text-cyan-300 drop-shadow-[0_0_8px_rgba(34,211,238,0.7)] fill-cyan-400'
                  : theme === 'Midnight Slate' 
                    ? 'text-blue-500 dark:text-blue-400' 
                    : theme === 'Granite Beige'
                      ? 'text-orange-500 dark:text-orange-400' 
                      : 'text-fuchsia-500 dark:text-fuchsia-400'
              }`} />
              <span className="text-xs font-sans font-black text-current">{profile.streak}d</span>
              {gamification.rest_day_active && (
                <span className="text-[8px] uppercase tracking-wider font-extrabold px-1 py-0.5 rounded bg-cyan-500/20 text-cyan-600 dark:text-cyan-300 border border-cyan-400/30">
                  🔒 FROZEN
                </span>
              )}
            </div>

            <div className="h-3.5 w-px bg-slate-300/40 dark:bg-slate-700/40" />

            <div className="flex items-center gap-1" title="Available Rest Permits">
              <Shield className={`w-3.5 h-3.5 ${gamification.rest_day_active ? 'text-cyan-400 animate-spin-slow' : 'text-emerald-500'}`} />
              <span className="text-xs font-mono font-bold text-current">{gamification.rest_permits}</span>
            </div>
          </div>

          {/* Trigger Button & Tooltip container */}
          <div className="relative group flex flex-col items-end">
            <button
              disabled={gamification.rest_day_active || gamification.rest_permits === 0 || isActivatingRestDay}
              onClick={handleActivateRestDay}
              className={`px-2.5 py-1 text-[9px] font-mono font-bold uppercase rounded-lg border shadow-sm select-none transition-all duration-300 cursor-pointer ${
                gamification.rest_day_active
                  ? 'bg-cyan-500/10 border-cyan-500/20 text-cyan-600 dark:text-cyan-400 !cursor-not-allowed'
                  : gamification.rest_permits === 0
                    ? 'bg-slate-500/10 border-slate-500/20 text-slate-500 dark:text-slate-400 !cursor-not-allowed'
                    : 'bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:scale-105 active:scale-95'
              }`}
            >
              {isActivatingRestDay 
                ? "Engaging..."
                : gamification.rest_day_active 
                  ? "Rest Protocol Engaged" 
                  : "Activate Rest Day"}
            </button>

            {/* Micro-Tooltip for 0 Permits */}
            {gamification.rest_permits === 0 && !gamification.rest_day_active && (
              <span className="absolute top-7 right-0 scale-0 group-hover:scale-100 transition-all duration-200 rounded-lg bg-slate-900/90 dark:bg-slate-950/90 border border-slate-700/50 p-2 text-[9px] text-slate-200 font-sans z-50 w-44 text-right shadow-lg backdrop-blur-sm">
                Earn more XP or upgrade to unlock permits.
              </span>
            )}
          </div>
        </div>

        <div className="text-center space-y-4 py-8">
          <motion.p 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-slate-600 dark:text-slate-350 italic text-lg tracking-wide md:text-2xl font-medium selection:bg-blue-100"
          >
            {greetingPhrase}
          </motion.p>
   
          <div className="flex flex-col items-center justify-center space-y-2">
            <motion.h1 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1, duration: 0.6 }}
              className="text-5xl md:text-7xl font-sans tracking-tight font-extralight text-slate-800 dark:text-slate-100"
            >
              Hello, <span className="font-extrabold text-blue-600 dark:text-blue-400">{resolveDisplayName(profile, auth.currentUser)}</span>
            </motion.h1>

            {/* Trial active countdown banner badge */}
            {billing.status_code === 'TRIAL_ACTIVE' && (
              <motion.div 
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="inline-flex items-center gap-1.5 px-3 py-1 text-[11px] font-mono font-bold tracking-tight rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 shadow-sm animate-pulse"
                title={`${billing.days_remaining_in_trial} days remaining in trial subscription`}
              >
                <span>⏱️</span>
                <span>{billing.days_remaining_in_trial} days left in trial</span>
              </motion.div>
            )}

            {/* Premium plan 5-day expiry warning banner */}
            {profile.tier === 'premium' && profile.premium_end_date && (
              (() => {
                const daysLeft = Math.max(1, Math.ceil((profile.premium_end_date - Date.now() / 1000) / 86400));
                if (daysLeft <= 5) {
                  return (
                    <motion.div 
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.2 }}
                      className="inline-flex items-center gap-2 px-4 py-1.5 text-xs font-sans font-bold tracking-tight rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/30 shadow-sm animate-pulse"
                    >
                      <span>⚠️</span>
                      <span>Your Premium plan expires in {daysLeft} {daysLeft === 1 ? 'day' : 'days'}. <a href="http://127.0.0.1:8000/v1/billing/checkout" target="_blank" rel="noreferrer" className="underline font-extrabold hover:text-rose-500 ml-1">Renew now</a></span>
                    </motion.div>
                  );
                }
                return null;
              })()
            )}
          </div>

          {/* Activation Success/Error message banner */}
          {activationSuccessMsg && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }} 
              animate={{ opacity: 1, y: 0 }} 
              className="max-w-md mx-auto mt-4 p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-450 text-[11px] font-mono font-bold rounded-xl flex items-center justify-center gap-2 shadow-sm"
            >
              <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
              <span>{activationSuccessMsg}</span>
            </motion.div>
          )}

          {activationError && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }} 
              animate={{ opacity: 1, y: 0 }} 
              className="max-w-md mx-auto mt-4 p-3 bg-rose-500/10 border border-rose-500/20 text-rose-650 dark:text-rose-450 text-[11px] font-mono font-bold rounded-xl flex items-center justify-center gap-2 shadow-sm"
            >
              <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
              <span>{activationError}</span>
            </motion.div>
          )}

          {/* Level and XP progress block with Framer Motion count-up animation */}
          <motion.div 
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.6 }}
            className={`relative max-w-md mx-auto p-4 rounded-2xl border backdrop-blur-md transition-all duration-300 ${xpCardBgClass} ${xpChanged ? 'scale-[1.03] ring-2 ring-blue-500/20' : ''}`}
          >
            {/* Top text row: Level and numeric XP with sparkling indicators */}
            {(() => {
              const levelInfo = getLevelFromXp(displayedXp);
              return (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <Sparkles className={`w-4 h-4 animate-spin-slow ${xpTextColor}`} />
                      <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Study Tier Progress
                      </span>
                    </div>
                    <div className="text-right">
                      <span className={`text-xl font-sans font-black tracking-tight ${xpTextColor}`}>
                        Level {levelInfo.level}
                      </span>
                    </div>
                  </div>

                  {/* XP Progress Bar */}
                  <div className="w-full bg-slate-250 dark:bg-slate-800/85 h-3.5 rounded-full overflow-hidden relative p-0.5 border border-slate-300/30 dark:border-slate-700/30">
                    <motion.div 
                      className={`h-full rounded-full ${xpBarBgClass}`}
                      animate={{ width: `${levelInfo.percent}%` }}
                      transition={{ type: "spring", stiffness: 60, damping: 15 }}
                    />
                  </div>

                  {/* Numeric XP count-up details */}
                  <div className="flex items-center justify-between mt-2.5 text-[11px] font-mono font-bold text-slate-500 dark:text-slate-400">
                    <span className="flex items-center gap-1">
                      <span>{Math.round(levelInfo.currentLevelXp)}</span>
                      <span className="opacity-50">/</span>
                      <span>{Math.round(levelInfo.nextLevelRequirement)} XP</span>
                    </span>
                    <div className="flex items-center gap-1">
                      <span className="opacity-50">Total Gained:</span>
                      <motion.span 
                        key={profile.xp}
                        animate={xpChanged ? { scale: [1, 1.25, 1], color: ["#3b82f6", "#10b981", "#3b82f6"] } : {}}
                        transition={{ duration: 0.6 }}
                        className={`${xpChanged ? 'font-black' : ''}`}
                      >
                        {displayedXp} XP
                      </motion.span>
                    </div>
                  </div>
                </>
              );
            })()}
          </motion.div>
        </div>
      </div>
 
      {/* Lockdown Status Card */}
      {lockdown.initiatedAt !== null && (
        <div className="relative z-10 w-full max-w-xl mx-auto bg-slate-900/90 dark:bg-slate-950/90 border border-red-500/30 p-5 rounded-2xl shadow-xl space-y-4 text-center backdrop-blur-md animate-fade-in">
          <div className="flex items-center justify-center gap-2">
            <ShieldAlert className="w-5 h-5 text-red-500 animate-pulse" />
            <h2 className="text-xs font-sans font-black tracking-widest text-red-500 uppercase">
              CONTAINMENT ACTIVE: STRIKE 3 PENALTY
            </h2>
          </div>

          <p className="text-xs text-slate-300 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
            {lockdown.isLockedOut 
              ? "You have breached focus discipline 3 times. The 'Let's Shackle' focus engine and premium privileges are fully locked out for 72 hours." 
              : "The 72-hour lockout has elapsed! You are now in the 1-Week Streak Challenge. Build and maintain a 7-day streak to restore premium status."}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            {/* Countdown box */}
            <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800 flex flex-col justify-center items-center">
              <span className="text-[10px] text-slate-500 font-mono font-bold tracking-widest uppercase mb-1">
                {lockdown.isLockedOut ? "Lockout Countdown" : "Challenge End Countdown"}
              </span>
              <span className="text-lg font-mono font-bold text-red-400">
                {lockdown.isLockedOut 
                  ? formatTimeLeft(lockdown.lockoutTimeLeftMs)
                  : formatTimeLeft(lockdown.challengeTimeLeftMs)}
              </span>
            </div>

            {/* Streak metrics box */}
            <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800 flex flex-col justify-center items-center">
              <span className="text-[10px] text-slate-500 font-mono font-bold tracking-widest uppercase mb-1">
                Streak Challenge Rank
              </span>
              <span className="text-lg font-mono font-bold text-orange-450">
                {profile.streak} / 7 Days
              </span>
              <span className="text-[9px] text-slate-400 mt-0.5">
                {profile.streak >= 7 ? "✓ Target Met! Complete phase to reclaim privileges." : "Keep studying daily to level up!"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Developer Control Panel (Simulator Console) — only visible to the dev UID */}
      {isDevUser && (
      <div className="relative z-10 w-full max-w-xl mx-auto flex flex-col items-center space-y-4">
        <button
          onClick={() => setShowDevPanel(!showDevPanel)}
          className="text-[10px] text-slate-400 hover:text-slate-200 bg-slate-900/40 border border-slate-800 px-3 py-1 rounded-full flex items-center gap-1.5 cursor-pointer font-mono font-bold uppercase transition"
        >
          <Terminal className="w-3.5 h-3.5 text-blue-400" />
          <span>{showDevPanel ? "Hide Simulator Terminal" : "Show Simulator Terminal"}</span>
        </button>

        {showDevPanel && (
          <div className="w-full bg-slate-950/95 border border-slate-800 p-4 rounded-xl space-y-3 font-mono text-left shadow-lg scale-95 transition-all">
            <div className="flex items-center justify-between border-b border-slate-850 pb-2">
              <span className="text-[10px] text-emerald-500 font-bold tracking-wider">SHACKLE PENALTY SIMULATOR</span>
              <span className="text-[8px] bg-emerald-500/10 text-emerald-500 px-1.5 py-0.5 rounded font-bold">READY</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <button
                onClick={handleSimulateStrike3}
                className="p-2 border border-rose-900/60 hover:bg-rose-900/20 text-rose-400 rounded text-[10px] text-left transition cursor-pointer"
              >
                1. Force Strike 3 Lockdown
              </button>
              <button
                disabled={lockdown.initiatedAt === null || !lockdown.isLockedOut}
                onClick={handleSimulatePass72}
                className="p-2 border border-amber-900/60 hover:bg-amber-900/20 text-amber-500 rounded text-[10px] text-left disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
              >
                2. Fast-Forward 72h Lockout
              </button>
              <button
                disabled={lockdown.initiatedAt === null}
                onClick={handleSimulateAddStreak}
                className="p-2 border border-orange-900/60 hover:bg-orange-900/20 text-orange-400 rounded text-[10px] text-left disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
              >
                3. Add 1 Challenge Streak Day
              </button>
              <button
                disabled={lockdown.initiatedAt === null}
                onClick={handleSimulateStreakReset}
                className="p-2 border border-red-900/60 hover:bg-red-900/20 text-red-400 rounded text-[10px] text-left disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
              >
                4. Reset Streak to 0
              </button>
              <button
                onClick={handleSimulateTrialExpiry}
                className="p-2 border border-red-900/50 hover:bg-red-900/10 text-red-400 rounded text-[10px] text-left transition cursor-pointer"
              >
                5. Defuse/Expire Trial (Paywall Lock)
              </button>
              <button
                onClick={handleSimulateRestoreTrial}
                className="p-2 border border-amber-600/50 hover:bg-amber-600/10 text-amber-400 rounded text-[10px] text-left transition cursor-pointer"
              >
                6. Reset Active Trial (10 days)
              </button>
              <button
                onClick={handleSimulateAddPermit}
                className="p-2 border border-blue-900/40 hover:bg-blue-900/10 text-blue-400 rounded text-[10px] text-left transition cursor-pointer"
              >
                7. Grant +1 Rest Permit
              </button>
              <button
                onClick={handleSimulateDepletePermits}
                className="p-2 border border-slate-800 hover:bg-slate-800/20 text-slate-400 rounded text-[10px] text-left transition cursor-pointer"
              >
                8. Deplete Permits to 0
              </button>
              <button
                onClick={handleSimulateToggleRestDay}
                className="p-2 border border-cyan-900/40 hover:bg-cyan-900/10 text-cyan-400 rounded text-[10px] text-left transition cursor-pointer sm:col-span-2"
              >
                9. Toggle Rest Day Active State ({gamification.rest_day_active ? "Currently ON" : "Currently OFF"})
              </button>
            </div>

            <div className="pt-2 border-t border-slate-900 space-y-2">
              {lockdown.initiatedAt !== null && (
                <button
                  onClick={handleForceComplete}
                  className="w-full p-2 bg-emerald-950/80 hover:bg-emerald-900/20 border border-emerald-800 text-emerald-400 text-center rounded text-[10px] font-bold cursor-pointer transition"
                >
                  Force Complete Challenge & Restore Premium
                </button>
              )}
              
              <button
                onClick={handleResetAllChanges}
                className="w-full p-2 bg-blue-950/80 hover:bg-blue-900/20 border border-blue-850 text-blue-400 text-center rounded text-[10px] font-bold cursor-pointer transition flex items-center justify-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5 text-blue-400" />
                <span>Clear All Strikes & Reset Profile to Defaults</span>
              </button>
            </div>
          </div>
        )}
      </div>
      )}

      {/* Primary CTA button as positioned in Mockup 1 */}
      <div className="flex justify-center py-4 relative z-10">
        <motion.button
          whileHover={lockdown.isLockedOut ? {} : { scale: 1.05 }}
          whileTap={lockdown.isLockedOut ? {} : { scale: 0.95 }}
          disabled={lockdown.isLockedOut}
          onClick={() => !lockdown.isLockedOut && onNavigate('Let\'s Shackle')}
          className={`px-8 py-4 backdrop-blur-md border-2 rounded-xl font-sans font-black text-xs tracking-widest uppercase shadow-xl flex items-center gap-3 transition-all duration-300 ${
            lockdown.isLockedOut 
              ? 'bg-rose-950/20 border-rose-900/30 text-rose-450 opacity-60 cursor-not-allowed shadow-none' 
              : buttonGlassClass + ' cursor-pointer'
          }`}
        >
          {lockdown.isLockedOut ? (
            <>
              <Lock className="w-4 h-4 text-rose-400" />
              <span>72h Lockout Active</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-current text-blue-500 dark:text-blue-400" />
              <span>Run Focus Session</span>
            </>
          )}
        </motion.button>
      </div>
    </div>
  );
}
