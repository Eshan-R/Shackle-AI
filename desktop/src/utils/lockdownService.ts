/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { UserProfile } from '../types';

export interface LockdownStatus {
  isLockedOut: boolean;        // Cannot access Let's Shackle (first 72 hours)
  isChallengeActive: boolean;   // Active 1-week challenge (next 7 days)
  isPremiumLocked: boolean;     // Locked out of premium features (during lockout OR challenge)
  lockoutTimeLeftMs: number;    // Remaining duration of 72h lockout
  challengeTimeLeftMs: number;  // Remaining duration of 1-week challenge
  initiatedAt: number | null;   // Epoch ms when Strike 3 was reached
  challengeStartAt: number | null; // Epoch ms when challenge phase started
  challengeEndAt: number | null; // Epoch ms when challenge phase ends
}

const STORAGE_LOCKDOWN_KEY = 'shackle_lockdown_data';

export interface LockdownData {
  initiatedAt: number | null;
  challengeStartAt: number | null;
  isCompleted: boolean;
}

// Get the stored lockdown state
export function getLockdownData(): LockdownData {
  const stored = localStorage.getItem(STORAGE_LOCKDOWN_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch (e) {
      console.error("Error parsing lockdown data", e);
    }
  }
  return {
    initiatedAt: null,
    challengeStartAt: null,
    isCompleted: false,
  };
}

// Module-level write lock — localStorage.setItem is synchronous in JS's single
// thread so a true concurrent race is impossible today, but this guard makes
// the intent explicit and protects against future async refactors.
let _lockdownWriteLock = false;

// Save the lockdown state
export function saveLockdownData(data: LockdownData) {
  if (_lockdownWriteLock) {
    console.warn('[LockdownService] Write already in progress, skipping duplicate write.');
    return;
  }
  _lockdownWriteLock = true;
  try {
    localStorage.setItem(STORAGE_LOCKDOWN_KEY, JSON.stringify(data));
  } finally {
    _lockdownWriteLock = false;
  }
}

// Clear lockdown state (factory reset / success)
export function clearLockdownData() {
  if (_lockdownWriteLock) {
    console.warn('[LockdownService] Write already in progress, skipping clear.');
    return;
  }
  _lockdownWriteLock = true;
  try {
    localStorage.removeItem(STORAGE_LOCKDOWN_KEY);
  } finally {
    _lockdownWriteLock = false;
  }
}

// Compute the current lockdown and challenge status
export function getLockdownStatus(profile: UserProfile): LockdownStatus {
  const data = getLockdownData();
  const now = Date.now();

  // 72 Hours in ms = 72 * 60 * 60 * 1000 = 259,200,000 ms
  const LOCKOUT_DURATION = 72 * 60 * 60 * 1000;
  // 1 Week in ms = 7 * 24 * 60 * 60 * 1000 = 604,800,000 ms
  const CHALLENGE_DURATION = 7 * 24 * 60 * 60 * 1000;

  // Let's identify if strikes has reached 3. If so and no lockdown has been initiated yet, return default but trigger-ready
  let initiatedAt = data.initiatedAt;
  let challengeStartAt = data.challengeStartAt;

  // Check if strikes matches 3 and we haven't initiated yet
  // Parse numeric strike count
  const strikesCount = parseStrikes(profile.strikes);
  if (strikesCount >= 3 && !initiatedAt && !data.isCompleted) {
    // Initiate containment!
    initiatedAt = now;
    challengeStartAt = now + LOCKOUT_DURATION;
    saveLockdownData({
      initiatedAt,
      challengeStartAt,
      isCompleted: false,
    });
  }

  if (!initiatedAt || data.isCompleted) {
    return {
      isLockedOut: false,
      isChallengeActive: false,
      isPremiumLocked: false,
      lockoutTimeLeftMs: 0,
      challengeTimeLeftMs: 0,
      initiatedAt: null,
      challengeStartAt: null,
      challengeEndAt: null,
    };
  }

  const lockoutEndTime = initiatedAt + LOCKOUT_DURATION;
  const challengeEndTime = lockoutEndTime + CHALLENGE_DURATION;

  const isLockedOut = now < lockoutEndTime;
  const isChallengeActive = !isLockedOut && now < challengeEndTime;

  // Check if the 1-week challenge is complete and can end
  // User must satisfy:
  // 1. Time has passed the challenge period (or they maintained the streak through the timeline)
  // 2. Maintained a streak (let's say streak >= 7)
  let isPremiumLocked = isLockedOut || isChallengeActive;

  if (now >= challengeEndTime) {
    if (profile.streak >= 7) {
      // Success! Earned prime back
      saveLockdownData({
        initiatedAt: null,
        challengeStartAt: null,
        isCompleted: true,
      });
      isPremiumLocked = false;
      return {
        isLockedOut: false,
        isChallengeActive: false,
        isPremiumLocked: false,
        lockoutTimeLeftMs: 0,
        challengeTimeLeftMs: 0,
        initiatedAt: null,
        challengeStartAt: null,
        challengeEndAt: null,
      };
    } else {
      // Challenge is still active because they haven't met the streak requirement yet!
      // They are "forced to maintain a streak for a week"
      // We keep the challenge active until they reach a 7-day streak.
      isPremiumLocked = true;
    }
  }

  return {
    isLockedOut,
    isChallengeActive: !isLockedOut, // It persists until streak >= 7 is hit if time passed!
    isPremiumLocked,
    lockoutTimeLeftMs: Math.max(0, lockoutEndTime - now),
    challengeTimeLeftMs: Math.max(0, challengeEndTime - now),
    initiatedAt,
    challengeStartAt: lockoutEndTime,
    challengeEndAt: challengeEndTime,
  };
}

// Parse strikes count from text helper
function parseStrikes(strikesStr: string): number {
  if (!strikesStr || strikesStr.toLowerCase() === 'none') {
    return 0;
  }
  const match = strikesStr.match(/\d+/);
  if (match) {
    return parseInt(match[0], 10);
  }
  return 0;
}

// Simulate actions for testing
export function simulateStrike3Lockdown(profile: UserProfile, onSaveProfile: (p: UserProfile) => void) {
  // Set strikes to 3 to initiate programmatically
  const updatedProfile: UserProfile = {
    ...profile,
    strikes: "3 Strikes (Streak Reset)",
    streak: 0,
  };
  
  const now = Date.now();
  saveLockdownData({
    initiatedAt: now,
    challengeStartAt: now + (72 * 60 * 60 * 1000),
    isCompleted: false,
  });

  onSaveProfile(updatedProfile);
}

export function simulatePass72Hours() {
  const data = getLockdownData();
  const LOCKOUT_DURATION = 72 * 60 * 60 * 1000;
  if (data.initiatedAt) {
    // Backdate initiatedAt by 72 hours so it's fully elapsed
    const newInitiated = Date.now() - LOCKOUT_DURATION - 5000; // slightly elapsed
    saveLockdownData({
      ...data,
      initiatedAt: newInitiated,
      challengeStartAt: newInitiated + LOCKOUT_DURATION,
    });
  }
}

export function simulateAddStreakDay(profile: UserProfile, onSaveProfile: (p: UserProfile) => void) {
  // Fast forward streak increment for local debugging
  const updatedProfile: UserProfile = {
    ...profile,
    streak: profile.streak + 1,
  };
  onSaveProfile(updatedProfile);
}

export function simulateStreakReset(profile: UserProfile, onSaveProfile: (p: UserProfile) => void) {
  // Reset streak for failure testing
  const updatedProfile: UserProfile = {
    ...profile,
    streak: 0,
  };
  onSaveProfile(updatedProfile);
}

export function forceCompleteChallenge(profile: UserProfile, onSaveProfile: (p: UserProfile) => void) {
  clearLockdownData();
  
  // Restore strikes to None and clean state
  const updatedProfile: UserProfile = {
    ...profile,
    strikes: "None",
    streak: Math.max(profile.streak, 7), // ensure streak is elegant
  };

  saveLockdownData({
    initiatedAt: null,
    challengeStartAt: null,
    isCompleted: true,
  });

  onSaveProfile(updatedProfile);
}

export function clearAllStrikesAndStatsBackToPristine(profile: UserProfile, onSaveProfile: (p: UserProfile) => void) {
  clearLockdownData();
  
  // Reset all local storage changes
  localStorage.removeItem('shackle_sessions');
  localStorage.removeItem('shackle_leagues_v2');
  localStorage.removeItem('shackle_lockout_data');
  localStorage.removeItem('shackle_session_goal');
  localStorage.removeItem('shackle_focus_running');
  localStorage.removeItem('shackle_username_changes_left');
  
  const pristineProfile: UserProfile = {
    ...profile,
    xp: 0,
    streak: 1,
    strikes: "None",
    tier: "regular",
    level: 1,
    league: "Bronze"
  };

  onSaveProfile(pristineProfile);
}
