/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface BillingLifecycle {
  access_granted: boolean;
  status_code: 'TRIAL_ACTIVE' | 'TRIAL_EXPIRED' | 'PREMIUM_ACTIVE';
  days_remaining_in_trial: number;
}

export interface Gamification {
  rest_permits: number;
  rest_day_active: boolean;
  last_permit_reset?: string; // ISO date of last weekly reset
}

export interface UserProfile {
  username: string;
  displayName: string;
  avatarUrl?: string;
  email: string;
  xp: number;
  streak: number;
  strikes: string; // "None" or details
  tier: 'premium' | 'regular';
  level: number;
  league?: 'Bronze' | 'Silver' | 'Gold' | 'Sapphire' | 'Ruby' | 'Emerald' | 'Amethyst' | 'Pearl' | 'Obsidian' | 'Diamond';
  last_league_update?: number; // epoch ms – records when the user was last placed/promoted in a league
  billing_lifecycle?: BillingLifecycle;
  gamification?: Gamification;
  penalty_phase?: number;
  last_session_date?: string | null; // 'YYYY-MM-DD' – used to gate once-per-day streak increments
  createdAt?: number;
  premium_start_date?: number;
  premium_end_date?: number;
  updatedAt?: number;
  // Stored as sub-fields on the Firestore profile document
  timerConfigs?: TimerConfigurations;
  displaySettings?: DisplaySettings;
  blacklistedApps?: string[];
  sessions?: ShackleSession[];
  useVoiceClone?: boolean;
  voiceFileName?: string;
  voiceCloneData?: string;
  voiceMode?: 'clone' | 'preset';
  presetVoiceId?: string;
}

export interface BlacklistAppItem {
  id: string;
  name: string;
  process: string;
  enabled: boolean;
  isCustom?: boolean;
}

export interface TimerConfigurations {
  focusPeriods: 'Automatic' | '25 minutes' | '50 minutes' | 'Custom';
  focusPeriodsCustom: number; // in mins
  breakPeriods: 'Automatic' | '5 minutes' | '10 minutes' | 'Custom';
  breakPeriodsCustom: number; // in mins
  autoStartBreak: boolean;
  soundOnEnd: boolean;
  // Custom app entries added via the SettingsView blacklist panel
  blacklistItems?: BlacklistAppItem[];
}

export interface DisplaySettings {
  countdownDesign: 'Radial' | 'Minimal' | 'Split Flip Clock';
  mode: 'Light' | 'Dark' | 'Auto';
  theme: 'Granite Beige' | 'Midnight Slate' | 'Deep Plum';
  glassmorphism: boolean;
}

export interface ShackleSession {
  id: string;
  startTime: string;
  duration: number; // minutes
  type: 'focus' | 'break';
  xpEarned: number;
  completed: boolean;
  blacklistedAppsPrevented: string[];
  strikes?: number;
}

export interface BlacklistItem {
  name: string;
  processName: string; // e.g. "discord.exe" or "Discord"
  category: string; // e.g. "Gaming", "Social Media", "Entertainment"
  icon: string;
}

export interface LeagueUser {
  rank: number;
  username: string;
  displayName: string;
  xp: number;
  isCurrentUser?: boolean;
}
