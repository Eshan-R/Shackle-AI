/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { UserProfile, TimerConfigurations, DisplaySettings, ShackleSession, BlacklistItem, LeagueUser } from '../types';
import { auth, fetchUserProfile, saveUserProfile, fetchLeagueLeaderboard, db } from '../utils/firebase';
import { doc, updateDoc, arrayUnion, collection, query, orderBy, getDocs } from 'firebase/firestore';
import { getLevelFromXp } from './levelUtils';

// Let's declare the pywebview global object types
declare global {
  interface Window {
    pywebview?: {
      api: {
        // OAuth and navigation (wired in app.py)
        start_google_oauth: () => Promise<{ idToken: string; accessToken?: string } | null>;
        open_external_link: (url: string) => void;
        set_user_id: (userId: string) => Promise<void>;
        get_daemon_status: () => Promise<{
          session_active: boolean;
          strike_count: number;
          last_vision_status: string;
          active_violation_type: string | null;
          grace_seconds_left: number | null;
        }>;
        set_book_mode: (active: boolean) => Promise<boolean>;
        // OS-level app locking bridge methods (wired in app.py)
        lock_apps: (durationMinutes?: number, userId?: string) => Promise<string>; // returns session_id on success
        unlock_apps: () => Promise<boolean>;
        get_available_apps: () => Promise<BlacklistItem[]>;
        get_active_session_id: () => Promise<string>;

        // Blacklist management (wired in app.py)
        add_to_blacklist: (processName: string) => Promise<boolean>;
        remove_from_blacklist: (processName: string) => Promise<boolean>;
        // Filesystem backup bridge methods (wired in app.py)
        save_profile_backup?: (profileData: any) => Promise<void>;
        load_profile_backup?: () => Promise<UserProfile | null>;

        // Kept for forward compatibility if Python-side profile/session methods are added later
        get_profile?: () => Promise<UserProfile>;
        save_profile?: (profile: UserProfile) => Promise<UserProfile>;
        get_timer_configs?: () => Promise<TimerConfigurations>;
        save_timer_configs?: (configs: TimerConfigurations) => Promise<TimerConfigurations>;
        get_display_settings?: () => Promise<DisplaySettings>;
        save_display_settings?: (settings: DisplaySettings) => Promise<DisplaySettings>;
        get_blacklisted_apps?: () => Promise<string[]>;
        save_blacklisted_apps?: (apps: string[]) => Promise<string[]>;
        get_sessions?: () => Promise<ShackleSession[]>;
        add_session?: (session: ShackleSession) => Promise<ShackleSession[]>;
        get_league_users?: (tier: string) => Promise<LeagueUser[]>;
        get_ai_report?: (promptArgs: string) => Promise<string>;
      };
    };
  }
}

// In-Memory Logs for the IPC communication panel
export interface IpcLog {
  timestamp: string;
  direction: 'out' | 'in';
  method: string;
  data: string;
}

let ipcLogListeners: ((logs: IpcLog[]) => void)[] = [];
let ipcLogs: IpcLog[] = [];

// Tracks the canonical session_id given by the backend when lockApps() is called.
// Cleared when unlockApps() is called. Used by addSession to call /v1/session/end.
let activeSessionId: string = '';


function logIpc(direction: 'out' | 'in', method: string, data: any) {
  const log: IpcLog = {
    timestamp: new Date().toLocaleTimeString(),
    direction,
    method,
    data: typeof data === 'object' ? JSON.stringify(data) : String(data),
  };
  ipcLogs = [log, ...ipcLogs].slice(0, 100); // keep last 100
  ipcLogListeners.forEach(listener => listener(ipcLogs));
}

export function subscribeToIpcLogs(listener: (logs: IpcLog[]) => void) {
  ipcLogListeners.push(listener);
  listener(ipcLogs);
  return () => {
    ipcLogListeners = ipcLogListeners.filter(l => l !== listener);
  };
}

function safeParse<T>(key: string, fallback: T): T {
  const data = localStorage.getItem(key);
  if (!data) return fallback;
  try {
    return JSON.parse(data) as T;
  } catch (e) {
    console.warn(`Local storage corruption detected for key "${key}". Resetting to fallback defaults.`, e);
    return fallback;
  }
}

// Build the baseline profile. If Firebase already has a signed-in user (e.g. restored
// from a previous session), seed the fallback with their real identity so the UI never
// shows "Guest" / empty email while Firestore is loading.
function buildDefaultProfile(): UserProfile {
  const user = auth.currentUser;
  return {
    username: user
      ? `@${(user.email?.split('@')[0] || 'unshackler').replace(/[^a-zA-Z0-9_\-+]/g, '')}`
      : 'guest',
    displayName: user?.displayName || user?.email?.split('@')[0] || (user ? 'Unshackler' : 'Guest'),
    avatarUrl: user?.photoURL || '',
    email: user?.email || '',
    xp: 0,
    streak: 0,
    strikes: 'None',
    tier: 'regular',
    level: 1,
    billing_lifecycle: {
      access_granted: true,
      status_code: 'TRIAL_ACTIVE',
      days_remaining_in_trial: 7,
    },
    gamification: {
      rest_permits: 3,
      rest_day_active: false,
    },
    sessions: [],
    last_session_date: null,
  };
}

const defaultTimerConfigs: TimerConfigurations = {
  focusPeriods: "Automatic",
  focusPeriodsCustom: 25,
  breakPeriods: "Automatic",
  breakPeriodsCustom: 5,
  autoStartBreak: true,
  soundOnEnd: true,
};

const defaultDisplaySettings: DisplaySettings = {
  countdownDesign: "Split Flip Clock",
  mode: "Light",
  theme: "Granite Beige",
  glassmorphism: true,
};

const defaultBlacklist: string[] = ["discord.exe", "steam.exe"];

const defaultAvailableApps: BlacklistItem[] = [
  { name: "Discord", processName: "discord.exe", category: "Social Media", icon: "MessageSquare" },
  { name: "Steam Client", processName: "steam.exe", category: "Gaming", icon: "Gamepad2" },
  { name: "Google Chrome", processName: "chrome.exe", category: "Social Media", icon: "Chrome" },
  { name: "Spotify Music", processName: "spotify.exe", category: "Entertainment", icon: "Music" },
  { name: "Web Telegram", processName: "telegram.exe", category: "Social Media", icon: "Send" },
  { name: "WhatsApp", processName: "whatsapp.exe", category: "Social Media", icon: "MessageCircle" },
  { name: "Riot Client / Valorant", processName: "riotclient.exe", category: "Gaming", icon: "Swords" },
  { name: "Minecraft Launcher", processName: "minecraft.exe", category: "Gaming", icon: "Zap" },
  { name: "Epic Games Launcher", processName: "epicgames.exe", category: "Gaming", icon: "Package" },
];

// A new or guest profile starts with genuinely no session history.
// (Previously this seeded 5 fake sessions for anyone with empty localStorage —
// meaning every brand-new install or guest login opened with fabricated history.)
const defaultSessions: ShackleSession[] = [];

export function getStoredLeagues(): Record<string, LeagueUser[]> {
  const saved = localStorage.getItem('shackle_leagues_v2');
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
  }

  // No bot competitors are fabricated here. A fresh install (or a guest with
  // no Firestore access) simply starts with empty tiers — the real leaderboard
  // is populated as real users join, fetched directly from Firestore.
  const initial: Record<string, LeagueUser[]> = {
    Bronze: [],
    Silver: [],
    Gold: []
  };
  localStorage.setItem('shackle_leagues_v2', JSON.stringify(initial));
  return initial;
}

// Local storage names
const LKEY_PROFILE = "shackle_profile";
const LKEY_TIMER_CONFIGS = "shackle_timer_configs";
const LKEY_DISPLAY_SETTINGS = "shackle_display_settings";
const LKEY_BLACKLIST = "shackle_blacklist_apps";
const LKEY_SESSIONS = "shackle_sessions";

// Helper checking if Python PyWebView API is active
export function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && !!window.pywebview && !!window.pywebview.api;
}

export type ProfileResult = 
  | { source: 'firestore'; profile: UserProfile }
  | { source: 'local'; profile: UserProfile }
  | { source: 'default'; profile: UserProfile };

// Helper to check if a profile contains non-placeholder identity or progress evidence
function hasProfileEvidence(p: UserProfile | null | undefined): boolean {
  if (!p) return false;
  const placeholderUsernames = ['guest', 'guest_user', '@guest', ''];
  const placeholderNames = ['Guest', 'Guest Unshackler', ''];
  const username = (p.username || '').toLowerCase().trim();
  const displayName = (p.displayName || '').trim();

  const isCustomUsername = !!username && !placeholderUsernames.includes(username);
  const isCustomDisplayName = !!displayName && !placeholderNames.includes(displayName);
  const hasGamificationProgress = (p.xp || 0) > 0 || (p.streak || 0) > 0 || (p.level || 1) > 1;
  const hasSessions = Array.isArray(p.sessions) && p.sessions.length > 0;

  return isCustomUsername || isCustomDisplayName || hasGamificationProgress || hasSessions;
}

export const pywebviewBridge = {
  getProfile: async (uid?: string): Promise<ProfileResult> => {
    const targetUid = uid || auth.currentUser?.uid;
    console.log('[getProfile] Called with uid:', targetUid);
    logIpc('out', 'get_profile', { uid: targetUid });

    const saved = localStorage.getItem(LKEY_PROFILE);
    let localProfile: UserProfile | null = null;
    if (saved) {
      try {
        localProfile = JSON.parse(saved);
      } catch (e) {
        console.warn("Failed to parse cached profile from localStorage:", e);
      }
    }

    if (targetUid) {
      try {
        const firestoreProfile = await fetchUserProfile(targetUid);
        if (firestoreProfile) {
          console.log('[getProfile] Using Firestore profile:', firestoreProfile);
          logIpc('in', 'get_profile (Firestore)', firestoreProfile);
          localStorage.setItem(LKEY_PROFILE, JSON.stringify(firestoreProfile));
          return { source: 'firestore', profile: firestoreProfile };
        }
      } catch (err) {
        // ⛔ Firestore read failed – do NOT fall back to localStorage
        console.error('[getProfile] Firestore fetch error for authenticated user:', err);
        logIpc('in', 'get_profile (Firestore Error)', String(err));
        throw err; // rethrow so the caller can handle it
      }
    }

    if (hasProfileEvidence(localProfile)) {
      console.log('[getProfile] Using local profile as fallback (evidence found):', localProfile);
      logIpc('in', 'get_profile (LocalStorage Fallback)', localProfile);
      return { source: 'local', profile: localProfile! };
    }

    // Secondary fallback: filesystem backup (desktop only)
    if (isDesktopApp() && window.pywebview?.api?.load_profile_backup) {
      try {
        const backupProfile = await window.pywebview.api.load_profile_backup();
        if (hasProfileEvidence(backupProfile)) {
          console.log('[getProfile] Using filesystem profile backup (evidence found):', backupProfile);
          logIpc('in', 'get_profile (Filesystem Backup Fallback)', backupProfile);
          localStorage.setItem(LKEY_PROFILE, JSON.stringify(backupProfile));
          return { source: 'local', profile: backupProfile! };
        }
      } catch (e) {
        console.warn("Failed to load filesystem profile backup:", e);
      }
    }

    // Tertiary fallback: build a default profile ONLY when there is zero evidence anywhere
    console.log('[getProfile] Truly zero profile evidence found anywhere; building default template.');
    const defaultProfile = buildDefaultProfile();
    logIpc('in', 'get_profile (Default Template Fallback)', defaultProfile);
    return { source: 'default', profile: defaultProfile };
  },


  saveProfile: async (incomingProfile: UserProfile): Promise<UserProfile> => {
    console.log('[saveProfile] Called with profile:', incomingProfile);
    logIpc('out', 'save_profile', incomingProfile);

    let profileToSave = incomingProfile;

    if (auth.currentUser) {
      console.log('[saveProfile] User authenticated, performing safe-merge with Firestore.');
      try {
        const remote = await fetchUserProfile(auth.currentUser.uid);
        if (remote) {
          profileToSave = {
            ...remote,
            ...incomingProfile,
            // Non-destructive safe-merge for core gamification and progress stats
            xp: Math.max(remote.xp || 0, incomingProfile.xp || 0),
            streak: Math.max(remote.streak || 0, incomingProfile.streak || 0),
            level: Math.max(remote.level || 1, incomingProfile.level || 1),
            league: (incomingProfile.league && incomingProfile.league !== 'Bronze')
              ? incomingProfile.league
              : (remote.league || 'Bronze'),
            strikes: (incomingProfile.strikes && incomingProfile.strikes !== 'None')
              ? incomingProfile.strikes
              : (remote.strikes || 'None'),
            penalty_phase: incomingProfile.penalty_phase !== undefined
              ? incomingProfile.penalty_phase
              : remote.penalty_phase,
            // Prevent undefined from overwriting a valid date already in Firestore.
            // undefined here would cause a Firestore write error and also break the
            // backend's end_focus_session day-gate (streak increments on every session).
            last_session_date: incomingProfile.last_session_date ?? remote.last_session_date ?? null,
            updatedAt: Date.now(),
          };
          console.log('[saveProfile] Safe-merged profile result:', profileToSave);
        }
        await saveUserProfile(auth.currentUser.uid, profileToSave);
        logIpc('in', 'save_profile (Firestore Safe-Merge)', profileToSave);
      } catch (err) {
        console.error("Firestore profile save failed:", err);
      }
    } else {
      console.log('[saveProfile] No user signed in, only saved to localStorage.');
    }

    localStorage.setItem(LKEY_PROFILE, JSON.stringify(profileToSave));

    if (isDesktopApp() && window.pywebview?.api?.save_profile_backup) {
      try {
        await window.pywebview.api.save_profile_backup(profileToSave);
        logIpc('in', 'save_profile (Filesystem Backup)', profileToSave);
      } catch (err) {
        console.warn("Failed to write filesystem profile backup:", err);
      }
    }

    return profileToSave;
  },

  getTimerConfigs: async (): Promise<TimerConfigurations> => {
    logIpc('out', 'get_timer_configs', {});
    if (auth.currentUser) {
      try {
        const firestoreProfile = await fetchUserProfile(auth.currentUser.uid);
        if (firestoreProfile && firestoreProfile.timerConfigs !== null && firestoreProfile.timerConfigs !== undefined) {
          logIpc('in', 'get_timer_configs (Firestore)', firestoreProfile.timerConfigs);
          return firestoreProfile.timerConfigs;
        }
      } catch (err) {
        console.error('Firestore timerConfigs fetch failed:', err);
        throw err; // don't fall back to localStorage – propagate error
      }
    }
    const saved = localStorage.getItem(LKEY_TIMER_CONFIGS);
    const c = saved ? JSON.parse(saved) : defaultTimerConfigs;
    logIpc('in', 'get_timer_configs (Fallback Local)', c);
    return c;
  },

  saveTimerConfigs: async (configs: TimerConfigurations): Promise<TimerConfigurations> => {
    logIpc('out', 'save_timer_configs', configs);
    localStorage.setItem(LKEY_TIMER_CONFIGS, JSON.stringify(configs));
    logIpc('in', 'save_timer_configs (Fallback Local)', configs);

    if (auth.currentUser) {
      try {
        const res = await pywebviewBridge.getProfile();
        const currentProfile = res.profile;
        if (currentProfile) {
          currentProfile.timerConfigs = configs;
          await pywebviewBridge.saveProfile(currentProfile);
          logIpc('in', 'save_timer_configs (Firestore via saveProfile)', configs);
        }
      } catch (err) {
        console.error("Firestore timerConfigs save failed:", err);
      }
    }

    return configs;
  },

  getDisplaySettings: async (): Promise<DisplaySettings> => {
    logIpc('out', 'get_display_settings', {});
    if (auth.currentUser) {
      try {
        const firestoreProfile = await fetchUserProfile(auth.currentUser.uid);
        if (firestoreProfile && firestoreProfile.displaySettings !== null && firestoreProfile.displaySettings !== undefined) {
          logIpc('in', 'get_display_settings (Firestore)', firestoreProfile.displaySettings);
          return firestoreProfile.displaySettings;
        }
      } catch (err) {
        console.error('Firestore displaySettings fetch failed:', err);
        throw err; // don't fall back to localStorage – propagate error
      }
    }
    const saved = localStorage.getItem(LKEY_DISPLAY_SETTINGS);
    const s = saved ? JSON.parse(saved) : defaultDisplaySettings;
    logIpc('in', 'get_display_settings (Fallback Local)', s);
    return s;
  },

  saveDisplaySettings: async (settings: DisplaySettings): Promise<DisplaySettings> => {
    logIpc('out', 'save_display_settings', settings);
    localStorage.setItem(LKEY_DISPLAY_SETTINGS, JSON.stringify(settings));
    logIpc('in', 'save_display_settings (Fallback Local)', settings);

    if (auth.currentUser) {
      try {
        const res = await pywebviewBridge.getProfile();
        const currentProfile = res.profile;
        if (currentProfile) {
          currentProfile.displaySettings = settings;
          await pywebviewBridge.saveProfile(currentProfile);
          logIpc('in', 'save_display_settings (Firestore via saveProfile)', settings);
        }
      } catch (err) {
        console.error("Firestore displaySettings save failed:", err);
      }
    }

    return settings;
  },

  getBlacklistedApps: async (): Promise<string[]> => {
    logIpc('out', 'get_blacklisted_apps', {});
    if (auth.currentUser) {
      try {
        const firestoreProfile = await fetchUserProfile(auth.currentUser.uid);
        if (firestoreProfile && firestoreProfile.blacklistedApps !== null && firestoreProfile.blacklistedApps !== undefined) {
          logIpc('in', 'get_blacklisted_apps (Firestore)', firestoreProfile.blacklistedApps);
          return firestoreProfile.blacklistedApps;
        }
      } catch (err) {
        console.warn("Firestore blacklistedApps fetch failed, falling back to localStorage:", err);
      }
    }
    const saved = localStorage.getItem(LKEY_BLACKLIST);
    const b = saved ? JSON.parse(saved) : defaultBlacklist;
    logIpc('in', 'get_blacklisted_apps (Fallback Local)', b);
    return b;
  },

  saveBlacklistedApps: async (apps: string[]): Promise<string[]> => {
    logIpc('out', 'save_blacklisted_apps', apps);
    localStorage.setItem(LKEY_BLACKLIST, JSON.stringify(apps));
    logIpc('in', 'save_blacklisted_apps (Fallback Local)', apps);

    if (auth.currentUser) {
      try {
        const res = await pywebviewBridge.getProfile();
        const currentProfile = res.profile;
        if (currentProfile) {
          currentProfile.blacklistedApps = apps;
          await pywebviewBridge.saveProfile(currentProfile);
          logIpc('in', 'save_blacklisted_apps (Firestore via saveProfile)', apps);
        }
      } catch (err) {
        console.error("Firestore blacklistedApps save failed:", err);
      }
    }

    return apps;
  },

  getSessions: async (): Promise<ShackleSession[]> => {
    logIpc('out', 'get_sessions', {});
    if (auth.currentUser) {
      try {
        // Read from the user document's sessions array
        const firestoreProfile = await fetchUserProfile(auth.currentUser.uid);
        if (firestoreProfile && Array.isArray(firestoreProfile.sessions) && firestoreProfile.sessions.length > 0) {
          const sessions = firestoreProfile.sessions.map((s: any) => ({
            id: s.id || 'sess_' + Math.random().toString(36).substring(2, 11),
            startTime: s.startTime || new Date().toISOString(),
            duration: s.duration || 0,
            type: s.type || 'focus',
            xpEarned: s.xpEarned || 0,
            completed: s.completed !== undefined ? s.completed : true,
            blacklistedAppsPrevented: s.blacklistedAppsPrevented || [],
            strikes: s.strikes || 0,
          }));
          // Sort by startTime descending (most recent first)
          sessions.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
          logIpc('in', 'get_sessions (Firestore Profile Array)', sessions);
          return sessions;
        }
      } catch (err) {
        console.error('Failed to fetch sessions from Firestore profile array:', err);
      }
    }
    // Fallback to localStorage
    const saved = localStorage.getItem(LKEY_SESSIONS);
    const s = saved ? JSON.parse(saved) : defaultSessions;
    logIpc('in', 'get_sessions (Fallback Local)', s);
    return s.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  },

  addSession: async (session: Omit<ShackleSession, 'id'> & { strikes?: number }): Promise<{ session: ShackleSession; newXp?: number; newStreak?: number; newLevel?: number }> => {
    const newSession: ShackleSession = {
      ...session,
      id: "sess_" + Math.random().toString(36).substring(2, 11),
    };
    logIpc('out', 'add_session', newSession);

    // 1. Fetch baseline active profile – handle errors
    let currentProfile: UserProfile;
    try {
      const result = await pywebviewBridge.getProfile();
      currentProfile = result.profile;
    } catch (err) {
      console.error('[addSession] Failed to fetch profile:', err);
      throw new Error('Could not load your profile. Please check your connection and try again.');
    }

    // 2. Append new session to local sessions storage
    const savedSessions = localStorage.getItem(LKEY_SESSIONS);
    const sessionsList: ShackleSession[] = savedSessions ? JSON.parse(savedSessions) : defaultSessions;
    sessionsList.push(newSession);
    localStorage.setItem(LKEY_SESSIONS, JSON.stringify(sessionsList));

    const isFocus = newSession.type === 'focus';
    const xpEarned = isFocus ? (newSession.xpEarned || 0) : 0;
    const sessionDurationMinutes = newSession.duration || xpEarned || 0;
    const isPhase2 = currentProfile.penalty_phase === 2;

    // 3. Compute baseline local stat increments
    let newXp = (currentProfile.xp || 0) + xpEarned;
    let newStreak = currentProfile.streak || 0;
    if (newSession.completed && isFocus) {
      if (!isPhase2 || sessionDurationMinutes >= 30) {
        newStreak = newStreak + 1;
      }
    }
    let newLevel = getLevelFromXp(newXp).level;

    // 4. Update local League Leaderboard XP if focus session earned XP
    if (isFocus && xpEarned > 0) {
      const currentTier = currentProfile.league || 'Bronze';
      const leagues = getStoredLeagues();
      const leagueList = leagues[currentTier] || [];
      const userIdx = leagueList.findIndex((u: any) => u.isCurrentUser);

      if (userIdx !== -1) {
        leagueList[userIdx].xp += xpEarned;
      } else {
        leagueList.push({
          rank: leagueList.length + 1,
          username: currentProfile.username || 'user',
          displayName: currentProfile.displayName || 'User',
          xp: xpEarned,
          isCurrentUser: true
        });
      }

      leagueList.sort((a: any, b: any) => b.xp - a.xp);
      leagueList.forEach((item: any, index: number) => { item.rank = index + 1; });
      leagues[currentTier] = leagueList;
      localStorage.setItem('shackle_leagues_v2', JSON.stringify(leagues));
    }

    // 5. If user is signed in AND we have a valid backend session ID, call /v1/session/end
    if (auth.currentUser && isFocus && activeSessionId) {
      try {
        const sid = activeSessionId;
        const endResp = await fetch(
          `http://127.0.0.1:8080/v1/session/end?user_id=${auth.currentUser.uid}&xp_earned=${xpEarned}&session_id=${sid}&duration_minutes=${sessionDurationMinutes}`,
          { method: 'POST', signal: AbortSignal.timeout(5000) }
        );
        if (endResp.ok) {
          const endData = await endResp.json();
          if (endData.xp !== undefined) newXp = endData.xp;
          if (endData.streak !== undefined) newStreak = endData.streak;
          if (endData.level !== undefined) newLevel = endData.level;
          logIpc('in', 'session/end (Backend)', { newXp, newStreak, newLevel });
        }
      } catch (endErr) {
        console.warn('session/end backend call failed (falling back to local stat calculations):', endErr);
      }
    } else if (auth.currentUser && isFocus && !activeSessionId) {
      console.warn('[addSession] Skipping /v1/session/end — no valid backend session ID (user may not have been authenticated when session started).');
    }

    // 6. Build the full, updated profile containing the NEW stats, timestamp, and updated sessions list
    const updatedProfile: UserProfile = {
      ...currentProfile,
      xp: newXp,
      streak: newStreak,
      level: newLevel,
      sessions: sessionsList,
      updatedAt: Date.now()
    };

    // 7. Save updated profile locally in localStorage (immediate availability)
    localStorage.setItem(LKEY_PROFILE, JSON.stringify(updatedProfile));

    logIpc('in', 'add_session (Success)', { newSession, newXp, newStreak, newLevel });
    return { session: newSession, newXp, newStreak, newLevel };
  },



  clearSessions: async (): Promise<boolean> => {
    logIpc('out', 'clear_sessions', {});
    localStorage.setItem(LKEY_SESSIONS, JSON.stringify([]));
    if (auth.currentUser) {
      try {
        const userRef = doc(db, 'users', auth.currentUser.uid);
        await updateDoc(userRef, { sessions: [] });
        logIpc('in', 'clear_sessions (Firestore)', true);
      } catch (err) {
        console.warn('Failed to clear Firestore sessions:', err);
      }
    }
    logIpc('in', 'clear_sessions (Local)', true);
    return true;
  },

  lockApps: async (durationMinutes?: number, userId?: string): Promise<string> => {
    logIpc('out', 'lock_apps', { durationMinutes, userId });
    if (isDesktopApp()) {
      try {
        const sessionId = await window.pywebview!.api.lock_apps(durationMinutes, userId);
        if (sessionId) {
          // Only store real backend-issued IDs; empty string = session failed to start
          activeSessionId = sessionId;
          logIpc('in', 'lock_apps (Python Result)', { sessionId });
          return sessionId;
        } else {
          logIpc('in', 'lock_apps (Python Result)', 'FAILED — no session ID returned');
          activeSessionId = '';
          return '';
        }
      } catch (err) {
        console.error("Pywebview API Error: lock_apps", err);
        activeSessionId = '';
      }
    }
    logIpc('in', 'lock_apps (Fallback Simulation)', '');
    return '';
  },

  unlockApps: async (): Promise<boolean> => {
    logIpc('out', 'unlock_apps', 'UNSHACKLED - Process blocker deactivated.');
    if (isDesktopApp()) {
      try {
        const success = await window.pywebview!.api.unlock_apps();
        logIpc('in', 'unlock_apps (Python Result)', success);
        activeSessionId = ''; // clear tracked session
        return success;
      } catch (err) {
        console.error("Pywebview API Error: unlock_apps", err);
      }
    }
    activeSessionId = '';
    logIpc('in', 'unlock_apps (Fallback Simulation)', true);
    return true;
  },

  getAvailableApps: async (): Promise<BlacklistItem[]> => {
    logIpc('out', 'get_available_apps', {});
    if (isDesktopApp()) {
      try {
        const list = await window.pywebview!.api.get_available_apps();
        logIpc('in', 'get_available_apps (Python)', list);
        return list;
      } catch (err) {
        console.error("Pywebview API Error: get_available_apps", err);
      }
    }
    logIpc('in', 'get_available_apps (Fallback Local)', defaultAvailableApps);
    return defaultAvailableApps;
  },

  add_to_blacklist: async (processName: string): Promise<boolean> => {
    logIpc('out', 'add_to_blacklist', { processName });
    if (isDesktopApp()) {
      try {
        const success = await window.pywebview!.api.add_to_blacklist(processName);
        logIpc('in', 'add_to_blacklist (Python)', success);
        return success;
      } catch (err) {
        console.error("Pywebview API Error: add_to_blacklist", err);
      }
    }
    // In browser mode, actual persistence is handled by saveBlacklistedApps;
    // this call just ensures the live daemon list stays in sync on desktop.
    logIpc('in', 'add_to_blacklist (Fallback no-op)', true);
    return true;
  },

  remove_from_blacklist: async (processName: string): Promise<boolean> => {
    logIpc('out', 'remove_from_blacklist', { processName });
    if (isDesktopApp()) {
      try {
        const success = await window.pywebview!.api.remove_from_blacklist(processName);
        logIpc('in', 'remove_from_blacklist (Python)', success);
        return success;
      } catch (err) {
        console.error("Pywebview API Error: remove_from_blacklist", err);
      }
    }
    logIpc('in', 'remove_from_blacklist (Fallback no-op)', true);
    return true;
  },

  getLeagueUsers: async (tier: string): Promise<LeagueUser[]> => {
    logIpc('out', 'get_league_users (Direct Firestore Route)', { tier });

    // 1. If the user is authenticated, this is the real, canonical source of truth —
    // fetched directly from Firestore rather than through a backend route. A genuinely
    // empty result (nobody else registered in this tier yet) is honored as-is; we never
    // paper over an empty tier with fabricated competitors.
    if (auth.currentUser) {
      try {
        const firestoreList = await fetchLeagueLeaderboard(tier);
        logIpc('in', 'get_league_users (Firestore Direct)', { count: firestoreList.length });
        return firestoreList;
      } catch (err) {
        console.warn("Direct Firestore league query failed, falling back to local solo view:", err);
      }
    }

    // 2. Guest / offline fallback: show the real local profile as a solo standing.
    // No bot competitors are ever generated here.
    const savedProfile = localStorage.getItem(LKEY_PROFILE);
    const localProfile: UserProfile = savedProfile ? JSON.parse(savedProfile) : buildDefaultProfile();

    const soloList: LeagueUser[] = [
      {
        rank: 1,
        username: localProfile.username || 'guest',
        displayName: localProfile.displayName || 'Guest',
        xp: localProfile.xp || 0,
        isCurrentUser: true
      }
    ];

    logIpc('in', 'get_league_users (Local Solo Fallback)', soloList);
    return soloList;
  },

  resetLeagueCycle: async (): Promise<{ statusMessage: string; newTier: any; userRank: number }> => {
    logIpc('out', 'reset_league_cycle', {});

    const savedProf = localStorage.getItem(LKEY_PROFILE);
    const profile: UserProfile = savedProf ? JSON.parse(savedProf) : buildDefaultProfile();

    const currentTier = profile.league || 'Bronze';
    const tiers: any[] = ['Bronze', 'Silver', 'Gold', 'Sapphire', 'Ruby', 'Emerald', 'Amethyst', 'Pearl', 'Obsidian', 'Diamond'];
    const currentTierIndex = tiers.indexOf(currentTier);

    // Determine the user's real rank for this cycle directly from Firestore — no
    // bot-filled leaderboard is generated here. Guests/offline users have no real
    // competitors to rank against, so they're honestly treated as rank 1 of 1.
    let userRank = 1;
    let totalUsers = 1;

    if (auth.currentUser) {
      try {
        const firestoreList = await fetchLeagueLeaderboard(currentTier);
        totalUsers = firestoreList.length || 1;
        const idx = firestoreList.findIndex((u: any) => u.isCurrentUser);
        userRank = idx !== -1 ? idx + 1 : 1;
      } catch (err) {
        console.warn("Direct Firestore league query failed during cycle reset, defaulting to solo standing:", err);
      }
    }

    let newTier = currentTier;
    let statusMessage = "";

    // Scale the promotion/demotion cutoffs to however many real competitors exist,
    // rather than assuming a fixed 30-player board.
    const promotionCutoff = Math.max(1, Math.ceil(totalUsers * (10 / 30)));
    const demotionCutoff = Math.max(promotionCutoff, totalUsers - Math.ceil(totalUsers * (5 / 30)));

    if (totalUsers <= 1) {
      statusMessage = `CYCLE CLOSED! You're the only registered competitor in the ${currentTier.toUpperCase()} LEAGUE this cycle — your position is secured until more competitors join.`;
    } else if (userRank <= promotionCutoff) {
      if (currentTierIndex < tiers.length - 1) {
        newTier = tiers[currentTierIndex + 1];
        statusMessage = `PROMOTED! You finished at Rank ${userRank} and moved up to the prestigious ${newTier.toUpperCase()} LEAGUE! 🎉 Keep up the fantastic focus sessions!`;
      } else {
        statusMessage = `CHAMPION! You finished at Rank ${userRank} and successfully defended your position in the supreme ${currentTier.toUpperCase()} LEAGUE! 🏆 Master of focus!`;
      }
    } else if (userRank > demotionCutoff) {
      if (currentTierIndex > 0) {
        newTier = tiers[currentTierIndex - 1];
        statusMessage = `DEMOTED! You finished at Rank ${userRank} in the demotion zone and dropped to the ${newTier.toUpperCase()} LEAGUE. Push your limits next cycle!`;
      } else {
        statusMessage = `SURVIVED! You finished at Rank ${userRank} in the danger zone, but since you are already in the BRONZE LEAGUE, you stay here. Lock in next cycle!`;
      }
    } else {
      statusMessage = `SAFE ZONE! You finished at Rank ${userRank} of the leaderboard. Your position is secured in the ${currentTier.toUpperCase()} LEAGUE for the next cycle.`;
    }

    // Update the profile with new league and timestamp
    const updatedProfile: UserProfile = {
      ...profile,
      league: newTier,
      last_league_update: Date.now(),
    };

    // Save to Firestore and local storage via the bridge
    await pywebviewBridge.saveProfile(updatedProfile);

    logIpc('in', 'reset_league_cycle (Real Standings)', { newTier, userRank, totalUsers });
    return { statusMessage, newTier, userRank };
  },

  getAiReport: async (sessionArgs: { duration: number, preventsCount: number, completed: boolean, appNames: string[] }): Promise<string> => {
    const promptArgs = JSON.stringify(sessionArgs);
    logIpc('out', 'get_ai_report', promptArgs);
    
    // Standard client side query back-end (direct HTTP call to FastAPI)
    try {
      const response = await fetch('http://127.0.0.1:8080/api/generate-report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sessionArgs),
      });
      if (response.ok) {
        const data = await response.json();
        logIpc('in', 'get_ai_report (Express server)', data.report.substring(0, 45) + '...');
        return data.report;
      }
    } catch (e) {
      console.warn("Express server report failed, using standard generator", e);
    }

    // Offline / fallback static beautiful report generators!
    const genericReports = [
      `### Shackle AI - Performance Summary\n\nExcellent discipline! You logged **${sessionArgs.duration} minutes** of pristine focus.\n\n* **Distraction Shielding**: Ironclad. You successfully shielded distractions from **${sessionArgs.appNames.join(', ') || 'all blacklisted apps'}**.\n* **Growth metrics**: Your deep workflow retention rate was estimated at **94%**.\n* **Coaching Tip**: We observed high typing cadence immediately after minutes 10 and 22. Maintain structured, low-stress intervals to avoid physical exhaustion!`,
      `### Shackle AI - Focus Review\n\nSolid progress, though you closed the session at **${sessionArgs.duration} minutes** of focus.\n\n* **distraction Shield**: Actively blocked background items like **${sessionArgs.appNames.join(', ') || 'distracting apps'}** ${sessionArgs.preventsCount} times.\n* **Deep State Coach**: When transitioning between tasks, practice 1 minute of box breathing rather than opening alternative tabs. This preserves working memory bandwidth!\n* **Streak preservation**: Keep it up tomorrow to maintain your **streak!**`
    ];

    const report = sessionArgs.completed ? genericReports[0] : genericReports[1];
    logIpc('in', 'get_ai_report (Fallback Mock)', report.substring(0, 45) + '...');
    return report;
  },  

  startFocusSession: async (sessionPlan: {
    totalSessionMinutes: number;
    numberOfBreaks: number;
    breakDuration: number;
    focusIntervalLength: number;
    phases: { type: 'focus' | 'break'; index: number; total: number; durationSeconds: number }[];
  }) => {
    logIpc('out', 'start_focus_session', sessionPlan);
    // Try PyWebView API first (if desktop app)
    if (isDesktopApp() && (window as any).pywebview!.api) {
      // If there's a specialized start_focus_session endpoint on python side, call it, otherwise fallback to standard logs
      const api = (window as any).pywebview!.api;
      if (typeof (api as any).start_focus_session === 'function') {
        try {
          await (api as any).start_focus_session(JSON.stringify(sessionPlan));
          logIpc('in', 'start_focus_session (Python API)', true);
          return;
        } catch (err) {
          console.error("Pywebview API Error on start_focus_session", err);
          // Fall through to fallback
        }
      }
    }
    logIpc('in', 'start_focus_session (Fallback)', true);
  },

  openExternalLink: async (url: string): Promise<void> => {
    logIpc('out', 'open_external_link', url);
    if (isDesktopApp()) {
      window.pywebview!.api.open_external_link(url);
    } else {
      window.open(url, '_blank');
    }
  },

  getDaemonStatus: async (): Promise<{
    session_active: boolean;
    strike_count: number;
    last_vision_status: string;
    active_violation_type: string | null;
    grace_seconds_left: number | null;
  } | null> => {
    logIpc('out', 'get_daemon_status', {});
    if (isDesktopApp()) {
      try {
        const status = await window.pywebview!.api.get_daemon_status();
        logIpc('in', 'get_daemon_status (Python)', status);
        return status;
      } catch (err) {
        console.error("Pywebview API Error: get_daemon_status", err);
      }
    }
    return null;
  },

  getElevenLabsVoices: async (): Promise<{ name: string; id: string }[]> => {
    logIpc('out', 'get_elevenlabs_voices', {});
    try {
      const response = await fetch('http://127.0.0.1:8080/v1/voices');
      if (!response.ok) throw new Error('Failed to fetch voices');
      const voices = await response.json();
      logIpc('in', 'get_elevenlabs_voices (Backend API)', voices);
      return voices;
    } catch (e) {
      logIpc('in', 'get_elevenlabs_voices (Error)', String(e));
      throw e;
    }
  },

  playRoastStream: async (roastText: string, voiceId?: string): Promise<void> => {
    logIpc('out', 'play_roast_stream', { roastText, voiceId });
    try {
      const response = await fetch('http://127.0.0.1:8080/v1/roast/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roast_text: roastText, voice_id: voiceId })
      });
      if (!response.ok) throw new Error('Failed to stream roast audio');
      const blob = await response.blob();
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      await audio.play();
      logIpc('in', 'play_roast_stream (Success)', true);
    } catch (e) {
      logIpc('in', 'play_roast_stream (Error)', String(e));
      console.warn('Failed to stream and play roast audio:', e);
    }
  },

  setBookMode: async (active: boolean): Promise<boolean> => {
    logIpc('out', 'set_book_mode', { active });
    localStorage.setItem('shackle_book_mode', JSON.stringify(active));
    if (isDesktopApp() && (window as any).pywebview?.api?.set_book_mode) {
      try {
        const res = await (window as any).pywebview.api.set_book_mode(active);
        logIpc('in', 'set_book_mode (Python)', res);
        return res;
      } catch (err) {
        console.error("Pywebview API Error: set_book_mode", err);
      }
    }
    return true;
  }
};
