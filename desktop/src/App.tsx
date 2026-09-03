/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { pywebviewBridge } from './utils/pywebviewBridge';
import { UserProfile, TimerConfigurations, DisplaySettings } from './types';
import { reconcileProfile } from './utils/trialUtils';
import Navigation from './components/Navigation';
import DashboardView from './components/DashboardView';
import LetsShackleView from './components/LetsShackleView';
import ShackleLeaguesView from './components/ShackleLeaguesView';
import UnshackledSessionsView from './components/UnshackledSessionsView';
import ProfileView from './components/ProfileView';
import SettingsView from './components/SettingsView';
import { Menu, X } from 'lucide-react';
import { getStrikeCount, getStrikeColorPalette } from './utils/strikeHelpers';
import { getLockdownStatus } from './utils/lockdownService';
import { motion, AnimatePresence } from 'motion/react';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { auth, fetchUserProfile, saveUserProfile, logOutUser, db } from './utils/firebase';
import { doc, getDoc, writeBatch } from 'firebase/firestore';
import AuthView from './components/AuthView';
import confetti from 'canvas-confetti';

// Unified single source of truth for the local caching identifier
const LKEY_PROFILE = "shackle_profile";

// Builds the initial profile. If Firebase has already restored a signed-in user
// (common on app re-open), seed from their real identity so the UI never briefly
// shows "Guest Unshackler" / empty email between mount and onAuthStateChanged.
function buildBaselineProfile(): UserProfile {
  const user = auth.currentUser;
  return {
    username: user
      ? `@${(user.email?.split('@')[0] || 'unshackler').replace(/[^a-zA-Z0-9_\-+]/g, '')}`
      : 'guest_user',
    displayName: user?.displayName || user?.email?.split('@')[0] || (user ? 'Unshackler' : 'Guest Unshackler'),
    avatarUrl: user?.photoURL || '',
    email: user?.email || '',
    xp: 0,
    streak: 0,
    strikes: 'None',
    tier: 'regular',
    level: 1,
    league: 'Bronze',
    billing_lifecycle: { access_granted: true, status_code: 'TRIAL_ACTIVE', days_remaining_in_trial: 7 },
    gamification: { rest_permits: 2, rest_day_active: false, last_permit_reset: new Date().toISOString() },
    last_session_date: null,
    createdAt: Date.now(),
  };
}


const isPlaceholderProfile = (p: UserProfile): boolean => {
  const placeholderUsernames = ['guest', 'guest_user', '@guest', ''];
  const placeholderNames = ['Guest', 'Guest Unshackler', ''];
  const username = (p.username || '').toLowerCase().trim();
  const displayName = (p.displayName || '').trim();
  return placeholderUsernames.includes(username) || placeholderNames.includes(displayName);
};

export default function App() {
  const [currentView, setCurrentView] = useState<string>('Dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isFocusSessionRunning, setIsFocusSessionRunning] = useState<boolean>(() => {
    return localStorage.getItem('shackle_focus_running') === 'true';
  });
  const [isPywebviewReady, setIsPywebviewReady] = useState<boolean>(false);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [isGuestMode, setIsGuestMode] = useState<boolean>(() => {
    return localStorage.getItem('shackle_guest_mode') === 'true';
  });

  const [profileHydrated, setProfileHydrated] = useState(false);

  const [profile, setProfile] = useState<UserProfile>(() => {
    const cached = localStorage.getItem(LKEY_PROFILE);
    if (cached) {
      try { return JSON.parse(cached); } catch (e) { console.error("Cache parsing fault:", e); }
    }
    return buildBaselineProfile();
  });

  const profileRef = useRef<UserProfile>(profile);
  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  const [timerConfigs, setTimerConfigs] = useState<TimerConfigurations>({
    focusPeriods: "Automatic", focusPeriodsCustom: 25, breakPeriods: "Automatic", breakPeriodsCustom: 5, autoStartBreak: true, soundOnEnd: true
  });

  const [displaySettings, setDisplaySettings] = useState<DisplaySettings>({
    countdownDesign: "Split Flip Clock", mode: "Light", theme: "Granite Beige", glassmorphism: true
  });

  const [sessionsUpdatedCounter, setSessionsUpdatedCounter] = useState(0);

  const handleFocusRunningChange = (running: boolean) => {
    setIsFocusSessionRunning(running);
    localStorage.setItem('shackle_focus_running', String(running));
  };

  // Custom global navigation event listener
  useEffect(() => {
    const handleNavigate = (e: Event) => {
      const customEvt = e as CustomEvent;
      if (customEvt.detail) {
        setCurrentView(customEvt.detail);
      }
    };
    window.addEventListener('navigate', handleNavigate);
    return () => {
      window.removeEventListener('navigate', handleNavigate);
    };
  }, []);

  // Check for post-purchase premium activation via URL search param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('premium_activated') === 'true') {
      confetti({
        particleCount: 150,
        spread: 80,
        origin: { y: 0.6 }
      });
      if (profile) {
        const upgraded: UserProfile = {
          ...profile,
          tier: 'premium',
          billing_lifecycle: {
            access_granted: true,
            status_code: 'PREMIUM_ACTIVE',
            days_remaining_in_trial: 0
          }
        };
        setProfile(upgraded);
        pywebviewBridge.saveProfile(upgraded).catch(console.error);
      }
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [profile]);

  // Guarded save handler to persist locally & into remote Firestore database once profile is hydrated
  const handleUpdateProfile = useCallback(async (newProfile: UserProfile) => {
    setProfile(newProfile);
    if (!profileHydrated) {
      console.warn('[App] Profile not hydrated yet; skipping Firestore write.');
      localStorage.setItem(LKEY_PROFILE, JSON.stringify(newProfile));
      return;
    }
    if (auth.currentUser && isPlaceholderProfile(newProfile)) {
      console.warn('[App] Skipping Firestore write for placeholder profile.');
      localStorage.setItem(LKEY_PROFILE, JSON.stringify(newProfile));
      return;
    }
    try {
      await pywebviewBridge.saveProfile(newProfile);
    } catch (err) {
      console.error("Failed to broadcast profile update:", err);
    }
  }, [profileHydrated]);

  // Helper: apply trial-day and streak-gap reconciliation once after profile load.
  // OLD BROKEN BEHAVIOUR: days_remaining_in_trial was hardcoded to 7 forever;
  // streak never reset when calendar days were skipped.
  const applyReconciliation = useCallback(
    (p: UserProfile): { profile: UserProfile; changed: boolean } => {
      const result = reconcileProfile(p, Date.now());
      if (!result.changed) return { profile: p, changed: false };
      const reconciled: UserProfile = {
        ...p,
        billing_lifecycle: result.billing_lifecycle ?? p.billing_lifecycle,
        streak: result.streak,
      };
      return { profile: reconciled, changed: true };
    },
    []
  );

  // Monitor Auth Status changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        setIsGuestMode(false);
        localStorage.removeItem('shackle_guest_mode');
        setProfileHydrated(false);

        try {
          const result = await pywebviewBridge.getProfile(user.uid);
          let dbProfile: UserProfile;

          switch (result.source) {
            case 'firestore':
            case 'local': {
              dbProfile = result.profile;
              console.log(`[Auth] dbProfile resolved from ${result.source}:`, dbProfile);

              // ── Guest data merge ──────────────────────────────────────────────
              const rawGuest = localStorage.getItem('shackle_guest_profile');
              if (rawGuest) {
                try {
                  const guestProfile: UserProfile = JSON.parse(rawGuest);
                  const guestXp     = guestProfile.xp     || 0;
                  const guestStreak = guestProfile.streak || 0;
                  if (guestXp > 0 || guestStreak > 0) {
                    console.log('[Auth] Merging guest data → authenticated profile', { guestXp, guestStreak });
                    dbProfile.xp     = (dbProfile.xp     || 0) + guestXp;
                    dbProfile.streak = Math.max(dbProfile.streak || 0, guestStreak);
                    dbProfile.last_session_date = guestProfile.last_session_date || dbProfile.last_session_date || null;
                    dbProfile.updatedAt = Date.now();
                  }
                } catch (e) {
                  console.warn('[Auth] Failed to parse guest profile for merge:', e);
                }
                localStorage.removeItem('shackle_guest_profile');
              }

              const placeholderNames = ['Guest', 'Guest Unshackler', ''];
              const needsDisplayNameRepair = !dbProfile.displayName || placeholderNames.includes(dbProfile.displayName);
              const placeholderUsernames = ['guest', 'guest_user', '@guest', ''];
              const cleanUsername = (dbProfile.username || '').toLowerCase().trim();
              const needsUsernameRepair = !cleanUsername || placeholderUsernames.includes(cleanUsername);

              let updated = false;

              if (needsDisplayNameRepair && (user.displayName || user.email)) {
                dbProfile.displayName = user.displayName || user.email?.split('@')[0] || dbProfile.displayName;
                dbProfile.email = dbProfile.email || user.email || '';
                updated = true;
              }

              if (needsUsernameRepair && (user.email || user.displayName)) {
                const base = (user.email?.split('@')[0] || user.displayName || 'unshackler').replace(/[^a-zA-Z0-9_\-+]/g, '');
                dbProfile.username = `@${base}`;
                updated = true;
              }

              if (updated || rawGuest) {
                if (!isPlaceholderProfile(dbProfile)) {
                  console.log('[Auth] Saving to Firestore with updated or rawGuest:', { updated, rawGuest, dbProfile });
                  dbProfile.updatedAt = Date.now();
                  try {
                    await saveUserProfile(user.uid, dbProfile);
                  } catch (err) {
                    console.error("Failed to persist profile repairs/merge:", err);
                  }
                  localStorage.setItem(LKEY_PROFILE, JSON.stringify(dbProfile));
                }
              } else {
                dbProfile.updatedAt = dbProfile.updatedAt ?? Date.now();
                localStorage.setItem(LKEY_PROFILE, JSON.stringify(dbProfile));
              }

              // Reconcile trial days and streak gap before rendering.
              const rec = applyReconciliation(dbProfile);
              if (rec.changed) {
                dbProfile = rec.profile;
                console.log('[Auth] Reconciliation changed profile — persisting.', dbProfile);
                try { await pywebviewBridge.saveProfile(dbProfile); } catch (_) {}
              }

              setProfile(dbProfile);
              setProfileHydrated(true);
              break;
            }

            case 'default': {
              console.log('[Auth] getProfile returned default. Performing defensive Firestore check before fresh creation.');

              // 🛡️ Guard 1: Defensive direct Firestore read to verify user document existence
              try {
                const userDocRef = doc(db, 'users', user.uid);
                const userDocSnap = await getDoc(userDocRef);

                if (userDocSnap.exists()) {
                  const existingDocProfile = userDocSnap.data() as UserProfile;
                  console.log('[Auth] Defensive check: user document ALREADY exists in Firestore! Aborting default creation, using existing profile:', existingDocProfile);
                  existingDocProfile.updatedAt = existingDocProfile.updatedAt ?? Date.now();
                  localStorage.setItem(LKEY_PROFILE, JSON.stringify(existingDocProfile));
                  setProfile(existingDocProfile);
                  setProfileHydrated(true);
                  break;
                }
              } catch (checkErr) {
                console.error('[Auth] Defensive Firestore check encountered error:', checkErr);
              }

              console.log('[Auth] Confirmed: No existing profile doc in Firestore. Creating fresh user profile.');
              const currentActiveState = profileRef.current;
              let baseUsername = (user.email?.split('@')[0] || "unshackler").replace(/[^a-zA-Z0-9_\-+]/g, '');
              let generatedUsername = `@${baseUsername}`;
              let attempts = 0;
              
              try {
                while (attempts < 10) {
                  const normalized = generatedUsername.toLowerCase().replace(/^@/, '');
                  const usernameRef = doc(db, 'usernames', normalized);
                  const usernameSnap = await getDoc(usernameRef);
                  if (!usernameSnap.exists()) {
                    break;
                  }
                  const newSuffix = Math.floor(1000 + Math.random() * 9000);
                  generatedUsername = `@${baseUsername}_${newSuffix}`;
                  attempts++;
                }
              } catch (e) {
                console.error("Failed checking username uniqueness, using fallback:", e);
              }

              const fresh: UserProfile = {
                username: generatedUsername,
                displayName: user.displayName || user.email?.split('@')[0] || "Unshackler Partner",
                email: user.email || '',
                xp: currentActiveState.xp > 0 ? currentActiveState.xp : 0,
                streak: currentActiveState.streak,
                strikes: currentActiveState.strikes || 'None',
                tier: 'regular',
                level: currentActiveState.level > 1 ? currentActiveState.level : 1,
                league: 'Bronze',
                billing_lifecycle: currentActiveState.billing_lifecycle,
                gamification: currentActiveState.gamification,
                createdAt: Date.now(),
                last_league_update: Date.now(),
              };

              const existingSessions = localStorage.getItem('shackle_sessions');
              if (existingSessions) {
                try {
                  fresh.sessions = JSON.parse(existingSessions);
                } catch (e) {}
              }

              const rawGuest2 = localStorage.getItem('shackle_guest_profile');
              if (rawGuest2) {
                try {
                  const guestProfile: UserProfile = JSON.parse(rawGuest2);
                  const guestXp     = guestProfile.xp     || 0;
                  const guestStreak = guestProfile.streak || 0;
                  if (guestXp > 0 || guestStreak > 0) {
                    console.log('[Auth] Seeding fresh profile with guest data', { guestXp, guestStreak });
                    fresh.xp     = (fresh.xp     || 0) + guestXp;
                    fresh.streak = Math.max(fresh.streak || 0, guestStreak);
                    fresh.updatedAt = Date.now();
                  }
                } catch (e) {
                  console.warn('[Auth] Failed to parse guest profile for fresh-merge:', e);
                }
                localStorage.removeItem('shackle_guest_profile');
              }

              // 🛡️ Guard 2: Defense-in-depth Math.max() safe-merge right before Firestore batch write
              if (!isPlaceholderProfile(fresh)) {
                try {
                  const userRef = doc(db, 'users', user.uid);
                  const userSnap = await getDoc(userRef);
                  if (userSnap.exists()) {
                    const remote = userSnap.data() as UserProfile;
                    console.warn('[Auth] Defense check: User doc exists right before batch write. Performing safe-merge:', remote);
                    fresh.xp = Math.max(remote.xp || 0, fresh.xp || 0);
                    fresh.streak = Math.max(remote.streak || 0, fresh.streak || 0);
                    fresh.level = Math.max(remote.level || 1, fresh.level || 1);
                    if (remote.username && !isPlaceholderProfile(remote)) {
                      fresh.username = remote.username;
                    }
                    if (remote.displayName && !isPlaceholderProfile(remote)) {
                      fresh.displayName = remote.displayName;
                    }
                    if (remote.sessions && Array.isArray(remote.sessions) && remote.sessions.length > 0) {
                      fresh.sessions = remote.sessions;
                    }
                  }

                  const batch = writeBatch(db);
                  const normalizedUsername = fresh.username.toLowerCase().replace(/^@/, '');
                  const usernameRef = doc(db, 'usernames', normalizedUsername);
                  
                  batch.set(userRef, fresh, { merge: true });
                  batch.set(usernameRef, { uid: user.uid });
                  await batch.commit();
                } catch (syncErr) {
                  console.error("Failed to persist fresh profile batch to Firestore:", syncErr);
                }
              }

              // Reconcile trial days and streak gap before rendering.
              const freshRec = applyReconciliation(fresh);
              const finalFresh = freshRec.changed ? freshRec.profile : fresh;

              setProfile(finalFresh);

              try {
                await pywebviewBridge.saveProfile(finalFresh);
              } catch (bridgeErr) {
                console.error("Failed to persist fresh profile via pywebviewBridge:", bridgeErr);
              }

              setProfileHydrated(true);
              break;
            }
          }
        } catch (fetchErr) {
          console.warn('[Auth] Firestore profile fetch failed transiently; keeping unhydrated state.', fetchErr);
        }
      } else {
        setProfileHydrated(false);
      }
    });
    return unsubscribe;
  }, []);


  // PyWebView ready event listener - only relevant for desktop app
  useEffect(() => {
    // Only set up listener if we're in a desktop context where pywebview is available
    if (typeof window !== 'undefined' && window.pywebview) {
      const handlePywebviewReady = () => {
        setIsPywebviewReady(true);
        console.log('PyWebView API is ready');
      };

      // Check if PyWebView is already available (in case event already fired)
      if (window.pywebview && window.pywebview.api) {
        setIsPywebviewReady(true);
      } else {
        // Listen for the ready event
        window.addEventListener('pywebviewready', handlePywebviewReady);
      }

      // Cleanup
      return () => {
        window.removeEventListener('pywebviewready', handlePywebviewReady);
      };
    }
  }, []);



  // Initial synchronization on mount — runs in all contexts (desktop shell and browser).
  // The bridge methods fall back gracefully to Firestore/localStorage when pywebview
  // is not present, exactly as getProfile/getSessions already do.
  useEffect(() => {
    const syncData = async () => {
      try {
        if (!auth.currentUser) {
          const res = await pywebviewBridge.getProfile();
          setProfile(res.profile);
        }

        const tc = await pywebviewBridge.getTimerConfigs();
        setTimerConfigs(tc);

        const ds = await pywebviewBridge.getDisplaySettings();
        setDisplaySettings(ds);
      } catch (err) {
        console.error("Failed to sync initial bridge values:", err);
      }
    };
    syncData();
  }, []);

  // Handle active navigation switching
  const handleNavigate = (view: string) => {
    if (isFocusSessionRunning) return;
    
    // Trial gate: when trial has expired, only Dashboard and Profile are accessible.
    // All other tabs are blocked here so clicking them in Navigation does nothing.
    // The paywall UI itself is rendered by DashboardView when billing.access_granted === false.
    const billing = profile.billing_lifecycle;
    const isTrialExpired = billing && !billing.access_granted && billing.status_code === 'TRIAL_EXPIRED';
    const trialFreeViews = ['Dashboard', 'Profile'];
    if (isTrialExpired && !trialFreeViews.includes(view)) {
      return;
    }

    // Check if lockout is active and user tries to go to Let's Shackle
    const lockdown = getLockdownStatus(profile);
    if (view === "Let's Shackle" && lockdown.isLockedOut) {
      return;
    }
    
    setCurrentView(view);
    setMobileMenuOpen(false);
  };

  const forceSyncProfile = async () => {
    const res = await pywebviewBridge.getProfile();
    setProfile(res.profile);
    setSessionsUpdatedCounter(prev => prev + 1);
  };


  // Dynamically map theme colors to main canvas body wrapper
  const getThemeClasses = () => {
    const isDark = displaySettings.mode === 'Dark';
    if (isDark) {
      // High Density Dark (Slate 950 canvas, Slate 900 cards with slate 800 borders, blue highlights)
      return {
        bg: 'bg-slate-950 text-slate-100',
        card: 'bg-slate-900 text-slate-100 border-slate-800/80',
        accentText: 'text-blue-400',
      };
    } else {
      // High Density Light (Slate 50 canvas, white cards with fine slate 200 borders, blue highlights)
      return {
        bg: 'bg-slate-50 text-slate-900',
        card: 'bg-white text-slate-800 border-slate-200',
        accentText: 'text-blue-600',
      };
    }
  };

  const themeVars = getThemeClasses();
  const activeStrikes = getStrikeCount(profile.strikes);
  const palette = getStrikeColorPalette(activeStrikes, displaySettings.mode, displaySettings.theme);

  return (
    <div id="shackle-app-root" className={`min-h-screen flex flex-col md:flex-row font-sans transition-all duration-300 app-bg ${displaySettings.mode === 'Dark' ? 'dark' : ''}`}>
      <style>{`
        /* Dynamic style override injecting the requested psychological strike palettes */
        .app-bg {
          background-color: ${palette.bgHex} !important;
          color: ${palette.textHex} !important;
        }
        
        /* Overwrite cards styles */
        .app-card, 
        .bg-white, 
        .dark\\:bg-slate-900, 
        .bg-slate-50, 
        .dark\\:bg-slate-950, 
        .bg-slate-50\\/50, 
        .bg-slate-100, 
        .dark\\:bg-slate-800, 
        .dark\\:bg-slate-805,
        .bg-orange-50,
        .bg-blue-50,
        .bg-emerald-50,
        .dark\\:bg-orange-950\\/20,
        .dark\\:bg-blue-950\\/20,
        .dark\\:bg-emerald-950\\/20 {
          background-color: ${palette.cardBgHex} !important;
          color: ${palette.textHex} !important;
          border-color: ${palette.borderHex} !important;
        }

        /* Border colors */
        .border-slate-200, 
        .dark\\:border-slate-800, 
        .border-slate-100, 
        .dark\\:border-slate-850, 
        .border-slate-150, 
        .border-slate-205,
        .border-slate-850,
        .border-slate-805,
        .border-slate-50 {
          border-color: ${palette.borderHex} !important;
        }

        /* Foreground text variables */
        .text-slate-900, 
        .dark\\:text-slate-100, 
        .text-slate-800, 
        .dark\\:text-slate-200, 
        .text-slate-700, 
        .dark\\:text-slate-300,
        .text-slate-600,
        .dark\\:text-slate-600 {
          color: ${palette.textHex} !important;
        }

        /* Muted supporting labels */
        .text-slate-400, 
        .dark\\:text-slate-505, 
        .text-slate-500, 
        .dark\\:text-slate-400,
        .text-slate-550 {
          color: ${palette.textMutedHex} !important;
        }

        /* Buttons & Accent Highlights */
        .bg-blue-600, 
        .bg-orange-600, 
        .bg-amber-600,
        .bg-emerald-600,
        .peer-checked\\:bg-blue-600 {
          background-color: ${palette.accentHex} !important;
          color: ${palette.accentTextHex} !important;
          border-color: ${palette.accentHex} !important;
        }

        .text-blue-600, 
        .dark\\:text-blue-400, 
        .text-orange-600, 
        .dark\\:text-orange-400, 
        .text-emerald-600, 
        .dark\\:text-emerald-400,
        .text-blue-650,
        .text-emerald-500 {
          color: ${palette.accentHex} !important;
        }

        /* Dynamic focus elements */
        button:not(.bg-transparent), 
        .btn-interactive {
          transition: all 0.2s ease;
        }

        /* Hover states */
        .hover\\:bg-blue-700:hover, 
        .hover\\:bg-orange-700:hover, 
        .hover\\:bg-emerald-700:hover,
        .hover\\:bg-amber-700:hover,
        .hover\\:bg-slate-200:hover,
        .dark\\:hover\\:bg-slate-700:hover {
          background-color: ${palette.accentHoverBgHex} !important;
          color: ${palette.accentTextHex} !important;
        }

        /* Active highlight for rankings list item */
        .bg-blue-650, .bg-blue-600 {
          background-color: ${palette.accentHex} !important;
        }

        /* Dynamic shadow indicators matching strike psychological state */
        .shadow-sm, .shadow-md {
          box-shadow: 0 4px 12px ${activeStrikes > 0 ? (activeStrikes === 1 ? 'rgba(217, 119, 6, 0.15)' : 'rgba(220, 38, 38, 0.25)') : 'rgba(0,0,0,0.05)'} !important;
        }

        /* Dynamic sidebar background and border matching theme */
        .sidebar-theme, .mobile-header-theme {
          background-color: ${palette.bgHex} !important;
          border-color: ${palette.borderHex} !important;
          color: ${palette.textHex} !important;
        }

        /* Ensure texts inside sidebar contrast properly in light mode */
        .sidebar-theme, 
        .sidebar-theme button, 
        .sidebar-theme span, 
        .sidebar-theme h1, 
        .sidebar-theme h4, 
        .sidebar-theme p,
        .mobile-header-theme {
          color: ${palette.textHex} !important;
        }

        /* Secondary labels inside the sidebar mapping to palette muted state */
        .sidebar-theme .text-slate-400,
        .sidebar-theme .text-slate-500,
        .sidebar-theme .text-slate-600,
        .sidebar-theme .text-slate-505 {
          color: ${palette.textMutedHex} !important;
        }

        .sidebar-theme button:hover:not(.bg-blue-600) {
          background-color: ${palette.isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)'} !important;
          color: ${palette.textHex} !important;
        }

        /* Ensure high contrast for active element contents */
        .sidebar-theme button.bg-blue-600,
        .sidebar-theme button.bg-blue-600 * {
          color: ${palette.accentTextHex} !important;
          background-color: ${palette.accentHex} !important;
          border-color: ${palette.accentHex} !important;
        }

        /* Sub panels / monitor overlay and logs background */
        .sidebar-theme .bg-slate-950\\/80,
        .sidebar-theme .bg-slate-950,
        .sidebar-theme .bg-slate-805,
        .sidebar-theme .bg-slate-805 *,
        .sidebar-theme .bg-slate-800,
        .sidebar-theme .bg-slate-900 {
          background-color: ${palette.isDark ? 'rgba(0, 0, 0, 0.3)' : 'rgba(255, 255, 255, 0.5)'} !important;
          border-color: ${palette.borderHex} !important;
          color: ${palette.textHex} !important;
        }

        /* Ensure borders in the sidebar are styled dynamically */
        .sidebar-theme .border-slate-800,
        .sidebar-theme .border-t {
          border-color: ${palette.borderHex} !important;
        }
      `}</style>
      
      {/* Mobile Header indicator and drawer switches */}
      {(firebaseUser || isGuestMode) && (
        <header className="md:hidden bg-slate-900 text-white mobile-header-theme p-4 flex items-center justify-between border-b border-slate-850 z-40 sticky top-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-blue-600 rounded flex items-center justify-center text-white font-bold text-sm">S</div>
            <span className="text-sm font-sans font-semibold tracking-wider">SHACKLE AI</span>
          </div>
          {!isFocusSessionRunning && (
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-1 hover:bg-white/10 rounded transition-colors"
              title="Toggle Navigation Menu"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          )}
        </header>
      )}

      {/* ── Derived access state ── */}
      {(() => {
        const billing = profile.billing_lifecycle;
        const isTrialExpired = billing && !billing.access_granted && billing.status_code === 'TRIAL_EXPIRED';
        const isNavLocked = !!isTrialExpired;

        return (
          <>
            {/* Main Sidebar Drawer wrapper */}
            {(firebaseUser || isGuestMode) && (
              <div className={`fixed inset-0 md:relative z-30 transform md:transform-none transition-transform duration-300 flex ${
                mobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
              }`}>
                <Navigation 
                  currentView={currentView}
                  onNavigate={handleNavigate}
                  profile={profile}
                  onUpdateProfile={handleUpdateProfile}
                  theme={displaySettings.theme}
                  isFocusActive={isFocusSessionRunning}
                  isGuestMode={isGuestMode}
                  isTrialExpired={isNavLocked}
                />
                {/* Backdrop overlay clicking out on mobile layouts view */}
                {mobileMenuOpen && (
                  <div 
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex-1 bg-slate-950/30 backdrop-blur-xs md:hidden"
                  />
                )}
              </div>
            )}
          </>
        );
      })()}

      {/* Primary content card viewport */}
      <main className="flex-1 p-6 md:p-12 overflow-y-auto max-h-[100vh] scrollbar-thin">
        <div className="max-w-6xl mx-auto w-full">
          <AnimatePresence mode="wait">
            {!firebaseUser && !isGuestMode ? (
              <motion.div
                key="auth-gateway"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.3 }}
              >
                <AuthView 
                  theme={displaySettings.theme}
                  mode={displaySettings.mode === 'Dark' ? 'Dark' : 'Light'}
                  onAuthSuccess={(uid, prof) => {
                    setProfile(prof);
                    setIsGuestMode(false);
                    localStorage.removeItem('shackle_guest_mode');
                  }}
                  onContinueGuest={() => {
                    // Snapshot the current profile so any guest-mode progress
                    // can be merged back when the user eventually signs in.
                    const snap = localStorage.getItem('shackle_profile');
                    if (snap) {
                      localStorage.setItem('shackle_guest_profile', snap);
                    }
                    setIsGuestMode(true);
                    localStorage.setItem('shackle_guest_mode', 'true');
                  }}
                />
              </motion.div>
            ) : (
              <motion.div
                key={currentView}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.25, ease: "easeInOut" }}
              >
                {currentView === 'Dashboard' && (
                  <DashboardView 
                    onNavigate={handleNavigate}
                    profile={profile}
                    theme={displaySettings.theme}
                    mode={displaySettings.mode}
                    onUpdateProfile={handleUpdateProfile}
                  />
                )}

                {currentView === "Let's Shackle" && (() => {
                  // Trial gate: expired users must never reach the timer — redirect to Dashboard paywall.
                  const billing = profile.billing_lifecycle;
                  const isTrialExpired = billing && !billing.access_granted && billing.status_code === 'TRIAL_EXPIRED';
                  if (isTrialExpired) {
                    return (
                      <DashboardView
                        onNavigate={handleNavigate}
                        profile={profile}
                        theme={displaySettings.theme}
                        mode={displaySettings.mode}
                        onUpdateProfile={handleUpdateProfile}
                      />
                    );
                  }
                  return (
                    <LetsShackleView 
                      timerConfigs={timerConfigs}
                      displaySettings={displaySettings}
                      onSessionLogged={forceSyncProfile}
                      onRunningChange={handleFocusRunningChange}
                      profile={profile}
                      onUpdateProfile={handleUpdateProfile}
                      userId={firebaseUser?.uid}
                    />
                  );
                })()}

                {/* Bug 3 fix: Guests must never mount ShackleLeaguesView — they have no real
                    ranked standing and the solo-view promotion logic produces meaningless results.
                    OLD BROKEN BEHAVIOUR: isGuestMode was never checked here, so guests could
                    freely navigate in and see a fabricated "promoted" message. */}
                {currentView === 'Shackle Leagues' && !isGuestMode && (
                  <ShackleLeaguesView 
                    profile={profile}
                    onUpdateProfile={handleUpdateProfile}
                    displaySettings={displaySettings}
                  />
                )}
                {currentView === 'Shackle Leagues' && isGuestMode && (
                  // Redirect stale guest navigation to Dashboard
                  <DashboardView
                    onNavigate={handleNavigate}
                    profile={profile}
                    theme={displaySettings.theme}
                    mode={displaySettings.mode}
                    onUpdateProfile={handleUpdateProfile}
                  />
                )}

                {currentView === 'Un-Shackled Sessions' && (() => {
                  const billing = profile.billing_lifecycle;
                  const isTrialExpired = billing && !billing.access_granted && billing.status_code === 'TRIAL_EXPIRED';
                  if (isTrialExpired) {
                    return (
                      <DashboardView
                        onNavigate={handleNavigate}
                        profile={profile}
                        theme={displaySettings.theme}
                        mode={displaySettings.mode}
                        onUpdateProfile={handleUpdateProfile}
                      />
                    );
                  }
                  return (
                    <UnshackledSessionsView 
                      onClearAll={forceSyncProfile}
                      sessionsUpdatedCounter={sessionsUpdatedCounter}
                    />
                  );
                })()}

                {currentView === 'Profile' && (
                  <ProfileView 
                    profile={profile}
                    onUpdateProfile={handleUpdateProfile}
                    onNavigate={handleNavigate}
                    isFirebaseUser={!!firebaseUser}
                    displaySettings={displaySettings}
                    onLogout={async () => {
                      await logOutUser();
                      setIsGuestMode(false);
                      localStorage.removeItem('shackle_guest_mode');
                    }}
                    onOpenAuth={() => {
                      setIsGuestMode(false);
                      localStorage.removeItem('shackle_guest_mode');
                    }}
                  />
                )}

                {currentView === 'Settings' && (
                  <SettingsView 
                    timerConfigs={timerConfigs}
                    displaySettings={displaySettings}
                    onUpdateTimerConfigs={setTimerConfigs}
                    onUpdateDisplaySettings={setDisplaySettings}
                    onNavigate={handleNavigate}
                    profile={profile}
                  />
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

    </div>
  );
}
