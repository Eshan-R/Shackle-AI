/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 */

import { useState, useEffect } from 'react';
import { UserProfile } from '../types';
import { pywebviewBridge } from '../utils/pywebviewBridge';
import { auth } from '../utils/firebase';
import { getStrikeColorPalette } from '../utils/strikeHelpers';
import { resolveDisplayName } from '../utils/profileHelpers';
import { 
  Trophy, 
  Shield, 
  Flame, 
  ShieldAlert, 
  Sparkles, 
  AlertTriangle, 
  Lock, 
  Zap, 
  ShieldCheck,
  User
} from 'lucide-react';

interface StandingRow {
  pos: number;
  username: string;
  display_name: string;
  avatar_url?: string;
  xp: number;
  streak: number;
  strikes: number;
  is_current_user: boolean;
}

interface ShackleLeaguesViewProps {
  profile: UserProfile;
  onUpdateProfile: (p: UserProfile) => void;
  displaySettings?: any;
}

// 10 League Levels structure
const LEAGUE_TIERS = [
  "Bronze", 
  "Silver", 
  "Gold", 
  "Sapphire", 
  "Ruby", 
  "Emerald", 
  "Amethyst", 
  "Pearl", 
  "Obsidian", 
  "Diamond"
] as const;

interface LeagueRule {
  promotionLabel: string;
  safeLabel: string;
  demotionLabel: string;
  promotionMin: number;
  promotionMax: number;
  safeMin: number;
  safeMax: number;
  demotionMin: number;
  demotionMax: number;
}

// Exact rule matrix requested by the user
const LEAGUE_RULES: Record<string, LeagueRule> = {
  "Bronze": {
    promotionLabel: "Positions 1 – 15",
    safeLabel: "Positions 16 – 23",
    demotionLabel: "Positions 24 – 30",
    promotionMin: 1, promotionMax: 15,
    safeMin: 16, safeMax: 23,
    demotionMin: 24, demotionMax: 30
  },
  "Silver": {
    promotionLabel: "Positions 1 – 12",
    safeLabel: "Positions 13 – 23",
    demotionLabel: "Positions 24 – 30",
    promotionMin: 1, promotionMax: 12,
    safeMin: 13, safeMax: 23,
    demotionMin: 24, demotionMax: 30
  },
  "Gold": {
    promotionLabel: "Positions 1 – 10",
    safeLabel: "Positions 11 – 23",
    demotionLabel: "Positions 24 – 30",
    promotionMin: 1, promotionMax: 10,
    safeMin: 11, safeMax: 23,
    demotionMin: 24, demotionMax: 30
  },
  "Sapphire": {
    promotionLabel: "Positions 1 – 8",
    safeLabel: "Positions 9 – 23",
    demotionLabel: "Positions 24 – 30",
    promotionMin: 1, promotionMax: 8,
    safeMin: 9, safeMax: 23,
    demotionMin: 24, demotionMax: 30
  },
  "Ruby": {
    promotionLabel: "Positions 1 – 5",
    safeLabel: "Positions 6 – 23",
    demotionLabel: "Positions 24 – 30",
    promotionMin: 1, promotionMax: 5,
    safeMin: 6, safeMax: 23,
    demotionMin: 24, demotionMax: 30
  },
  "Emerald": {
    promotionLabel: "Positions 1 – 5",
    safeLabel: "Positions 6 – 23",
    demotionLabel: "Positions 24 – 30",
    promotionMin: 1, promotionMax: 5,
    safeMin: 6, safeMax: 23,
    demotionMin: 24, demotionMax: 30
  },
  "Amethyst": {
    promotionLabel: "Positions 1 – 5",
    safeLabel: "Positions 6 – 23",
    demotionLabel: "Positions 24 – 30",
    promotionMin: 1, promotionMax: 5,
    safeMin: 6, safeMax: 23,
    demotionMin: 24, demotionMax: 30
  },
  "Pearl": {
    promotionLabel: "Positions 1 – 4",
    safeLabel: "Positions 5 – 23",
    demotionLabel: "Positions 24 – 30",
    promotionMin: 1, promotionMax: 4,
    safeMin: 5, safeMax: 23,
    demotionMin: 24, demotionMax: 30
  },
  "Obsidian": {
    promotionLabel: "Positions 1 – 3",
    safeLabel: "Positions 4 – 23",
    demotionLabel: "Positions 24 – 30",
    promotionMin: 1, promotionMax: 3,
    safeMin: 4, safeMax: 23,
    demotionMin: 24, demotionMax: 30
  },
  "Diamond": {
    promotionLabel: "No higher standard league",
    safeLabel: "Positions 1 – 25",
    demotionLabel: "Positions 26 – 30",
    promotionMin: 0, promotionMax: 0,
    safeMin: 1, safeMax: 25,
    demotionMin: 26, demotionMax: 30
  }
};

export default function ShackleLeaguesView({ profile, onUpdateProfile, displaySettings }: ShackleLeaguesViewProps) {
  // Read current assigned tier from user state, defaulting to Bronze
  const currentAssignedTier = profile.league || 'Bronze';
  const [activeTier, setActiveTier] = useState<string>(currentAssignedTier);
  const [isResetting, setIsResetting] = useState(false);
  const [weeklyXp, setWeeklyXp] = useState(0);

  useEffect(() => {
    const computeWeeklyXp = async () => {
      try {
        if (typeof pywebviewBridge === 'undefined' || !pywebviewBridge.getSessions) {
          return;
        }
        const sessions = await pywebviewBridge.getSessions();
        const now = Date.now();
        const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
        const weekly = sessions
          .filter(s => s.type === 'focus' && s.completed && new Date(s.startTime).getTime() >= oneWeekAgo)
          .reduce((sum, s) => sum + (s.xpEarned || 0), 0);
        setWeeklyXp(weekly);
      } catch (e) {
        console.error("Failed to compute weekly XP:", e);
      }
    };
    computeWeeklyXp();
  }, [profile.xp]);

  const [resetResult, setResetResult] = useState<{
    show: boolean;
    message: string;
    oldTier: string;
    newTier: string;
    finalRank: number;
  } | null>(null);


  // Synchronize active tier selection on profile changes
  useEffect(() => {
    setActiveTier(currentAssignedTier);
  }, [currentAssignedTier]);

  // Weekly league cycle reset check (runs on mount and when profile changes)
  useEffect(() => {
    const checkAndUpdateLeague = async () => {
      if (!profile || !onUpdateProfile) return;

      const lastUpdate = profile.last_league_update;
      const now = Date.now();
      const oneWeekMs = 7 * 24 * 60 * 60 * 1000;

      // If no last update or more than a week ago, run reset
      if (!lastUpdate || (now - lastUpdate) > oneWeekMs) {
        try {
          const oldTier = profile.league || 'Bronze';
          const result = await pywebviewBridge.resetLeagueCycle();
          // Refresh the profile (already saved by resetLeagueCycle)
          const fresh = await pywebviewBridge.getProfile();
          if (fresh && fresh.profile) {
            onUpdateProfile(fresh.profile);
          }
          setResetResult({
            show: true,
            message: result.statusMessage,
            oldTier: oldTier,
            newTier: result.newTier,
            finalRank: result.userRank
          });
          console.log('[LEAGUE] Weekly reset completed:', result);
        } catch (err) {
          console.error('[LEAGUE] Failed to reset league:', err);
        }
      }
    };

    checkAndUpdateLeague();
  }, [profile, onUpdateProfile]);

  // Load or fallback display settings
  const modeSetting = displaySettings?.mode || 'Dark';
  const themeSetting = displaySettings?.theme || 'Granite Beige';
  const isDark = modeSetting === 'Dark';

  // Parse current user's profile strikes count
  const parseProfileStrikes = (): number => {
    if (!profile.strikes || profile.strikes.toLowerCase() === 'none') {
      return 0;
    }
    const match = profile.strikes.match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
  };

  // Determine elegant matching styles for the standout Standing summary card
  const getStandingSummaryStyles = () => {
    if (isDark) {
      if (themeSetting === 'Midnight Slate') {
        return {
          cardBg: "bg-gradient-to-r from-blue-950/40 via-indigo-950/40 to-slate-900/80 border-indigo-500/30",
          glow1: "bg-blue-500/15",
          glow2: "bg-indigo-500/10",
          sub: "text-blue-400 font-black",
          title: "text-slate-100",
          desc: "text-slate-350",
          boxBg: "bg-slate-950/60 border-slate-800/80",
          statLabel: "text-slate-400",
          statVal: "text-white"
        };
      } else if (themeSetting === 'Deep Plum') {
        return {
          cardBg: "bg-gradient-to-r from-purple-950/40 via-fuchsia-950/40 to-slate-900/80 border-purple-500/30",
          glow1: "bg-purple-500/15",
          glow2: "bg-fuchsia-500/10",
          sub: "text-purple-400 font-black",
          title: "text-slate-100",
          desc: "text-slate-350",
          boxBg: "bg-slate-950/60 border-slate-800/80",
          statLabel: "text-slate-400",
          statVal: "text-white"
        };
      } else {
        return {
          cardBg: "bg-gradient-to-r from-amber-950/30 via-slate-900/90 to-slate-900/95 border-amber-500/30",
          glow1: "bg-amber-500/15",
          glow2: "bg-orange-500/10",
          sub: "text-amber-400 font-black",
          title: "text-slate-100",
          desc: "text-slate-300",
          boxBg: "bg-slate-950/60 border-slate-800/80",
          statLabel: "text-slate-400",
          statVal: "text-white"
        };
      }
    } else {
      if (themeSetting === 'Midnight Slate') {
        return {
          cardBg: "bg-gradient-to-r from-blue-50 via-indigo-50/50 to-white border-blue-200",
          glow1: "bg-blue-400/20",
          glow2: "bg-indigo-400/10",
          sub: "text-blue-600 font-black",
          title: "text-slate-900",
          desc: "text-slate-600",
          boxBg: "bg-white/80 border-blue-100",
          statLabel: "text-slate-500",
          statVal: "text-slate-900"
        };
      } else if (themeSetting === 'Deep Plum') {
        return {
          cardBg: "bg-gradient-to-r from-purple-50 via-fuchsia-50/50 to-white border-purple-200",
          glow1: "bg-purple-400/20",
          glow2: "bg-fuchsia-400/10",
          sub: "text-purple-600 font-black",
          title: "text-slate-900",
          desc: "text-slate-600",
          boxBg: "bg-white/80 border-purple-100",
          statLabel: "text-slate-500",
          statVal: "text-slate-900"
        };
      } else {
        return {
          cardBg: "bg-gradient-to-r from-amber-50/80 via-orange-50/40 to-white border-amber-200/80",
          glow1: "bg-amber-400/20",
          glow2: "bg-orange-400/10",
          sub: "text-amber-700 font-black",
          title: "text-slate-900",
          desc: "text-slate-600",
          boxBg: "bg-white/80 border-amber-100",
          statLabel: "text-slate-500",
          statVal: "text-slate-900"
        };
      }
    }
  };

  const styleConfig = getStandingSummaryStyles();

  // Live peer standings, keyed by tier. Populated from the backend when available;
  // stays empty (never fabricated) if the bridge hasn't implemented this yet.
  const [tierPeers, setTierPeers] = useState<Record<string, StandingRow[]>>({});
  const [peersLoading, setPeersLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const tiersToLoad = Array.from(new Set([activeTier, currentAssignedTier]));

    const loadTier = async (tier: string): Promise<StandingRow[]> => {
      if (typeof pywebviewBridge === 'undefined' || !pywebviewBridge.getLeagueUsers) {
        return [];
      }
      try {
        const rows = await pywebviewBridge.getLeagueUsers(tier);
        if (!Array.isArray(rows)) return [];
        const parseStrikesValue = (val: any): number => {
          if (typeof val === 'number') return val;
          if (!val || String(val).toLowerCase() === 'none') return 0;
          const match = String(val).match(/\d+/);
          return match ? parseInt(match[0], 10) : 0;
        };

        const placeholderUsernames = new Set(['guest', 'guest_user', '']);
        const placeholderDisplayNames = new Set(['guest', 'guest unshackler', '']);
        const isPlaceholderPeer = (u: any): boolean => {
          const uname = String(u.username || '').replace(/^@/, '').toLowerCase();
          const dname = String(u.displayName || '').toLowerCase();
          return placeholderUsernames.has(uname) || placeholderDisplayNames.has(dname);
        };

        return rows
          .filter((u: any) => !u.isCurrentUser && !isPlaceholderPeer(u))
          .map((u: any) => ({
            pos: u.rank || 0,
            username: `@${u.username}`,
            display_name: u.displayName,
            avatar_url: u.avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${u.username}`,
            xp: u.xp || 0,
            streak: u.streak || 0,
            strikes: parseStrikesValue(u.strikes),
            is_current_user: false
          }));
      } catch (err) {
        console.error(`Failed to load ${tier} league standings from core engine:`, err);
        return [];
      }
    };

    setPeersLoading(true);
    Promise.all(tiersToLoad.map(loadTier)).then((results) => {
      if (cancelled) return;
      setTierPeers(prev => {
        const next = { ...prev };
        tiersToLoad.forEach((tier, i) => { next[tier] = results[i]; });
        return next;
      });
      setPeersLoading(false);
    });

    return () => { cancelled = true; };
  }, [activeTier, currentAssignedTier]);

  // Merge real peer standings (if any) with the current user's real profile data.
  // No bot-generated competitors are ever injected — a brand-new or guest profile
  // with zero XP/streak/strikes will render exactly that: zero, alone in the tier.
  const buildStandings = (tierName: string): StandingRow[] => {
    const peers = (tierPeers[tierName] || []).map(p => ({ ...p, is_current_user: false }));

    const user = auth.currentUser;
    const rawUser = (profile.username || '').replace(/^@/, '');
    const isPlaceholder = !rawUser || ['guest', 'guest_user'].includes(rawUser.toLowerCase());
    const resolvedUsername = !isPlaceholder
      ? rawUser
      : (profile.email || user?.email)
        ? ((profile.email || user?.email)!.split('@')[0] || 'unshackler').replace(/[^a-zA-Z0-9_\-+]/g, '')
        : 'guest';

    const resolvedDisplayName = resolveDisplayName(profile, user);

    const currentUserRow: StandingRow = {
      pos: 0,
      username: `@${resolvedUsername}`,
      display_name: resolvedDisplayName,
      avatar_url: profile.avatarUrl,
      xp: profile.xp || 0,
      streak: profile.streak || 0,
      strikes: parseProfileStrikes(),
      is_current_user: true
    };

    const sorted = [...peers, currentUserRow].sort((a, b) => b.xp - a.xp);
    return sorted.map((row, index) => ({ ...row, pos: index + 1 }));
  };

  const selectedPresetStandings = buildStandings(activeTier);
  const assignedPresetStandings = buildStandings(currentAssignedTier);
  const hasPeersInSelectedTier = (tierPeers[activeTier] || []).length > 0;
  
  const currentUserRowInAssigned = assignedPresetStandings.find(r => r.is_current_user);
  const userCalculatedRank = currentUserRowInAssigned ? currentUserRowInAssigned.pos : 15;

  const currentUserRowInSelected = selectedPresetStandings.find(r => r.is_current_user);
  const userSelectedRank = currentUserRowInSelected ? currentUserRowInSelected.pos : 15;

  // Active Selected Tier Rule block
  const activeRule = LEAGUE_RULES[activeTier] || LEAGUE_RULES["Bronze"];

  const getInitials = (name: string): string => {
    return name.trim().charAt(0).toUpperCase() || '?';
  };

  return (
    <div className="space-y-6 animate-fade-in w-full max-w-4xl mx-auto py-4">
      
      {/* Page Title */}
      <div className="text-center space-y-1">
        <h1 className="text-3xl font-sans uppercase tracking-widest font-extrabold text-slate-805 dark:text-slate-100 flex items-center justify-center gap-2">
          <Trophy className="w-8 h-8 text-amber-500 animate-pulse" />
          <span>SHACKLE LEAGUES</span>
        </h1>
      </div>

      {/* User Highlights Summary Banner */}
      <div className={`relative overflow-hidden p-5 rounded-2xl shadow-lg border backdrop-blur-md transition-all duration-300 ${styleConfig.cardBg}`}>
        <div className={`absolute right-0 top-0 -mr-6 -mt-6 w-32 h-32 rounded-full blur-2xl pointer-events-none transition-all duration-300 ${styleConfig.glow1}`} />
        <div className={`absolute left-1/3 bottom-0 w-24 h-24 rounded-full blur-xl pointer-events-none transition-all duration-300 ${styleConfig.glow2}`} />
        
        <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1.5 max-w-xl">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full overflow-hidden border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 flex-shrink-0 flex items-center justify-center">
                {profile.avatarUrl ? (
                  <img src={profile.avatarUrl} alt="avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <User className="w-8 h-8 text-slate-400" />
                )}
              </div>
              <div>
                <span className={`text-[10px] font-mono tracking-widest uppercase flex items-center gap-1.5 transition-colors duration-300 ${styleConfig.sub}`}>
                  <Sparkles className="w-3.5 h-3.5 text-amber-500 animate-spin" />
                  Your Active Standing Summary
                </span>
                <h2 className={`text-2xl font-sans font-black tracking-tight transition-colors duration-300 ${styleConfig.title}`}>
                  #{userCalculatedRank} in {currentAssignedTier} League
                </h2>
              </div>
            </div>
            <p className={`text-xs leading-relaxed transition-colors duration-300 ${styleConfig.desc}`}>
              {currentAssignedTier === 'Diamond' ? (
                userCalculatedRank <= 25 
                  ? "🛡️ SAFE ZONE: You are keeping Diamond positioning safely! Keep focus high." 
                  : "⚠️ DANGER ZONE: You are below Rank 25 and face demotion. Put in focus sessions to secure your stay!"
              ) : (
                userCalculatedRank <= (LEAGUE_RULES[currentAssignedTier]?.promotionMax || 15)
                  ? "🔥 PROMOTION ZONE: You are currently ranked in the top slots! Keep up your sessions to lock down promotion." 
                  : userCalculatedRank <= (LEAGUE_RULES[currentAssignedTier]?.safeMax || 23)
                    ? "🛡️ SAFE ZONE: You are secure, but another study session will tip you into the Promotion slot!"
                    : "⚠️ DEMOTION ZONE: Your ranking is currently inside the fallback boundaries. Power up focus to move up!"
              )}
            </p>
          </div>

          <div className="flex gap-2 sm:gap-4 flex-wrap">
            <div className={`border rounded-xl px-4 py-2.5 flex items-center gap-2.5 transition-all duration-300 ${styleConfig.boxBg}`}>
              <Zap className="w-4 h-4 text-amber-400 animate-pulse" />
              <div className="text-left">
                <p className={`text-[9px] font-mono uppercase tracking-wider transition-colors duration-300 ${styleConfig.statLabel}`}>Weekly XP</p>
                <p className={`text-sm font-sans font-extrabold transition-colors duration-300 ${styleConfig.statVal}`}>
                  {weeklyXp} <span className="text-[10px] opacity-70 font-normal">XP this week</span>
                </p>
              </div>
            </div>

            <div className={`border rounded-xl px-4 py-2.5 flex items-center gap-2.5 transition-all duration-300 ${styleConfig.boxBg}`}>
              <Flame className="w-4 h-4 text-orange-500 animate-pulse" />
              <div className="text-left">
                <p className={`text-[9px] font-mono uppercase tracking-wider transition-colors duration-300 ${styleConfig.statLabel}`}>Focus Streak</p>
                <p className={`text-sm font-sans font-extrabold transition-colors duration-300 ${styleConfig.statVal}`}>{profile.streak || 0} <span className="text-[10px] opacity-70 font-normal">Days</span></p>
              </div>
            </div>

            <div className={`border rounded-xl px-4 py-2.5 flex items-center gap-2.5 transition-all duration-300 ${styleConfig.boxBg}`}>
              <ShieldAlert className="w-4 h-4 text-red-500 animate-pulse" />
              <div className="text-left">
                <p className={`text-[9px] font-mono uppercase tracking-wider transition-colors duration-300 ${styleConfig.statLabel}`}>Lock Accents</p>
                <p className={`text-sm font-sans font-extrabold transition-colors duration-300 ${styleConfig.statVal}`}>{profile.strikes || 'None'}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Unlocked Browsable Tier Switching Tabs */}
      <div className="border border-slate-200 dark:border-slate-805 bg-slate-50 dark:bg-slate-950/60 p-2.5 rounded-2xl">
        <div className="text-[9px] font-mono uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2 font-bold pl-2.5">
          Select League Level
        </div>
        
        <div className="flex gap-2 pb-2 overflow-x-auto scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
          {LEAGUE_TIERS.map((tier) => {
            const tierIdx = LEAGUE_TIERS.indexOf(tier);
            const currentTierIdx = LEAGUE_TIERS.indexOf(currentAssignedTier as any);
            
            // Only show current tier and below — hide locked higher tiers
            if (tierIdx > currentTierIdx) return null;

            const isSelected = activeTier.toLowerCase() === tier.toLowerCase();
            const isUserCurrentAssignedTier = currentAssignedTier.toLowerCase() === tier.toLowerCase();
            
            let tierColorClass = "text-amber-600 dark:text-amber-400 bg-amber-500/10";
            if (tier === 'Silver') tierColorClass = "text-slate-400 bg-slate-400/10";
            else if (tier === 'Gold') tierColorClass = "text-yellow-500 bg-yellow-500/10";
            else if (tier === 'Sapphire') tierColorClass = "text-sky-400 bg-sky-500/10";
            else if (tier === 'Ruby') tierColorClass = "text-rose-500 bg-rose-500/10";
            else if (tier === 'Emerald') tierColorClass = "text-emerald-400 bg-emerald-500/10";
            else if (tier === 'Amethyst') tierColorClass = "text-purple-400 bg-purple-500/10";
            else if (tier === 'Pearl') tierColorClass = "text-pink-400 bg-pink-500/10";
            else if (tier === 'Obsidian') tierColorClass = "text-violet-500 bg-violet-500/10";
            else if (tier === 'Diamond') tierColorClass = "text-cyan-400 bg-cyan-500/10";

            return (
              <button
                key={tier}
                onClick={() => setActiveTier(tier)}
                className={`flex-shrink-0 flex items-center justify-between p-2.5 px-4 rounded-xl border-2 transition-all duration-300 text-left ${
                  isSelected 
                    ? 'bg-blue-600 border-blue-500 text-white shadow-md scale-[1.01] cursor-pointer' 
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-805 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700 cursor-pointer'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div className={`p-1.5 rounded-lg ${
                    isSelected ? 'bg-white/10 text-white' : tierColorClass
                  }`}>
                    <Shield className="w-4 h-4 fill-current" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-sans font-black text-xs uppercase tracking-wider">
                        {tier}
                      </span>
                      {isUserCurrentAssignedTier && (
                        <span className={`text-[7px] font-mono px-1 py-0.2 rounded-full font-bold border ${
                          isSelected ? 'bg-white/20 border-white/40 text-white' : 'bg-blue-500/10 border-blue-500/20 text-blue-500'
                        }`}>
                          MY TIER
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Grid container layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Leaderboard Table Grid */}
        <div className="lg:col-span-2 space-y-4 animate-fade-in">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-805 rounded-2xl p-5 shadow-sm space-y-4">
            
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-805 pb-3">
              <div className="flex items-center gap-2">
                <Trophy className="w-4.5 h-4.5 text-blue-500" />
                <span className="text-xs font-sans font-black uppercase tracking-wider text-slate-805 dark:text-slate-205">
                  {activeTier.toUpperCase()} LEAGUE STANDINGS
                </span>
              </div>
              <span className="text-[9px] font-mono text-slate-400 dark:text-slate-500 font-bold uppercase">
                {peersLoading
                  ? 'Syncing standings…'
                  : `✓ Active Competitive Zone (${selectedPresetStandings.length} ${selectedPresetStandings.length === 1 ? 'Competitor' : 'Competitors'})`}
              </span>
            </div>

            {/* Leaderboard scrolling area */}
            <div className="space-y-2.5 max-h-[500px] overflow-y-auto pr-1">
              {selectedPresetStandings.map((row) => {
                const hasStrikes = row.strikes > 0;
                let zoneStyleClass = "border-slate-200 dark:border-slate-805";
                let highlightBorderStr = "";
                
                if (row.is_current_user) {
                  zoneStyleClass = "bg-blue-600/5 dark:bg-blue-600/10 border-blue-500/50 hover:border-blue-500 ring-1 ring-blue-500/20";
                  highlightBorderStr = "border-l-4 border-l-blue-600 dark:border-l-blue-400";
                } else {
                  if (activeTier === "Diamond") {
                    if (row.pos <= 25) {
                      zoneStyleClass = "bg-slate-50/50 dark:bg-slate-950/20";
                    } else {
                      zoneStyleClass = "bg-red-500/5 dark:bg-red-500/10 border-red-500/20";
                      highlightBorderStr = "border-l-4 border-l-red-500";
                    }
                  } else {
                    if (row.pos <= activeRule.promotionMax) {
                      zoneStyleClass = "bg-emerald-500/5 dark:bg-emerald-500/10 border-emerald-500/20";
                      highlightBorderStr = "border-l-4 border-l-emerald-500";
                    } else if (row.pos <= activeRule.safeMax) {
                      zoneStyleClass = "bg-slate-50/50 dark:bg-slate-950/20";
                    } else {
                      zoneStyleClass = "bg-red-500/5 dark:bg-red-500/10 border-red-500/20";
                      highlightBorderStr = "border-l-4 border-l-red-500";
                    }
                  }
                }

                return (
                  <div
                    key={`${row.pos}_${row.username}`}
                    className={`flex items-center justify-between p-3 border transition-all duration-300 gap-4 ${zoneStyleClass} ${highlightBorderStr} rounded-xl`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 shrink-0 flex justify-center">
                        {row.pos === 1 ? (
                          <span className="text-lg" title="1st Place Leader">🥇</span>
                        ) : row.pos === 2 ? (
                          <span className="text-lg" title="2nd Place competitor">🥈</span>
                        ) : row.pos === 3 ? (
                          <span className="text-lg" title="3rd Place competitor">🥉</span>
                        ) : (
                          <span className="font-mono text-xs font-black text-slate-400 dark:text-slate-500">
                            {row.pos}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 min-w-0">
                        {row.is_current_user ? (
                          profile.avatarUrl ? (
                            <img src={profile.avatarUrl} alt={row.display_name} className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 dark:border-slate-800 object-cover shrink-0" referrerPolicy="no-referrer" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-indigo-500 text-white font-sans font-black text-xs flex items-center justify-center shrink-0 shadow-sm border border-indigo-400/20">
                              {getInitials(row.display_name)}
                            </div>
                          )
                        ) : (
                          <img src={row.avatar_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${row.username}`} alt={row.display_name} className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 dark:border-slate-800 object-cover shrink-0" referrerPolicy="no-referrer" />
                        )}

                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-extrabold text-slate-900 dark:text-slate-100 truncate">
                              {row.display_name}
                            </span>
                            {row.is_current_user && (
                              <span className="text-[8px] bg-blue-600 text-white font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider font-mono">
                                YOU
                              </span>
                            )}
                          </div>
                          <span className="text-[9px] font-mono text-slate-400 dark:text-slate-500 truncate">
                            {row.username}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 sm:gap-6 shrink-0">
                      <div className="flex flex-col items-end w-14 sm:w-16">
                        <span className="text-[8px] font-mono text-slate-400 uppercase tracking-wider">Streak</span>
                        <div className="flex items-center gap-1 font-mono font-bold text-xs text-orange-500">
                          <span>{row.streak}</span>
                          <span>🔥</span>
                        </div>
                      </div>

                      <div className="flex flex-col items-end w-16 sm:w-20">
                        <span className="text-[8px] font-mono text-slate-400 uppercase tracking-wider">XP Score</span>
                        <span className="font-mono font-black text-xs text-slate-900 dark:text-slate-100">
                          {row.xp.toLocaleString()}<span className="text-[9px] font-medium text-slate-400 dark:text-slate-500 ml-0.5">XP</span>
                        </span>
                      </div>

                      <div className="flex flex-col items-center w-14 sm:w-16 shrink-0">
                        <span className="text-[8px] font-mono text-slate-400 uppercase tracking-wider mb-0.5">Strikes</span>
                        {hasStrikes ? (
                          <span className="text-[9px] font-mono font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded uppercase flex items-center gap-0.5 animate-pulse">
                            ⚠️ {row.strikes}
                          </span>
                        ) : (
                          <span className="text-[9px] font-mono font-bold text-slate-400 dark:text-slate-600">
                            None
                          </span>
                        )}
                      </div>
                    </div>

                  </div>
                );
              })}
            </div>

            <div className="text-[10px] text-slate-400 dark:text-slate-550 font-mono text-center border-t border-slate-100 dark:border-slate-805 pt-3.5 flex flex-col items-center gap-1">
              <span className="text-indigo-400 font-bold">Requires focus study to move ranks</span>
              {!peersLoading && !hasPeersInSelectedTier && (
                <span className="text-slate-400 dark:text-slate-500 font-normal">
                  You're the only registered competitor in the {activeTier} League so far — standings fill in as more users join.
                </span>
              )}
            </div>

          </div>
        </div>

        {/* Sprint Protocols column */}
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-805 rounded-2xl p-5 shadow-sm space-y-5">
            <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-805 pb-3">
              <Shield className="w-4.5 h-4.5 text-blue-500" />
              <h3 className="text-xs font-sans font-black uppercase tracking-wider text-slate-805 dark:text-slate-205">
                ASCENSION PROTOCOLS
              </h3>
            </div>

            <p className="text-xs text-slate-450 dark:text-slate-400 leading-relaxed font-sans">
              Competitors secure rankings within 30-player slots. Protocols for the <span className="font-bold text-blue-600 dark:text-blue-400">{activeTier} League</span>:
            </p>

            <div className="space-y-2.5 font-sans text-xs">
              <div className="flex items-start gap-3 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300 p-3 rounded-xl border border-emerald-100 dark:border-emerald-900/30">
                <Sparkles className="w-4 h-4 shrink-0 text-emerald-500 mt-0.5 animate-pulse" />
                <div className="space-y-0.5">
                  <strong className="block text-[11px] font-bold uppercase tracking-wider">Promotion Zone (Moves Up)</strong>
                  <span className="text-[11px] leading-relaxed block text-slate-500 dark:text-slate-400">
                    {activeTier === 'Diamond' 
                      ? "No higher standard league exists above Diamond." 
                      : `Power through positions in ${activeRule.promotionLabel} to ascend to next league level.`}
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-3 bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-350 p-3 rounded-xl border border-slate-100 dark:border-slate-805">
                <ShieldCheck className="w-4 h-4 shrink-0 text-slate-400 mt-0.5" />
                <div className="space-y-0.5">
                  <strong className="block text-[11px] font-bold uppercase tracking-wider">Safe Zone (Stays in League)</strong>
                  <span className="text-[11px] leading-relaxed block text-slate-500 dark:text-slate-400">
                    Maintain secure standing within {activeRule.safeLabel} to survive and lock in slot.
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-3 bg-red-500/5 text-rose-800 dark:text-rose-400 p-3 rounded-xl border border-red-500/25">
                <AlertTriangle className="w-4 h-4 shrink-0 text-red-500 mt-0.5" />
                <div className="space-y-0.5">
                  <strong className="block text-[11px] font-bold uppercase tracking-wider">Demotion Zone (Moves Down)</strong>
                  <span className="text-[11px] leading-relaxed block text-slate-550 dark:text-slate-400 animate-pulse">
                    Failing inside {activeRule.demotionLabel} will trigger demotion back to previous league tier level.
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 dark:border-slate-805">
              <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-2 text-center font-mono leading-relaxed">
                The weekly study sprint cycle evaluates your active promotion status automatically at the end of each session cycle.
              </p>
            </div>
          </div>
        </div>

      </div>

      {/* Cycle Reset Evaluation Summary Modal */}
      {resetResult && resetResult.show && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5 animate-scale-up text-center">
            
            <div className="space-y-2">
              <div className="w-14 h-14 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto text-amber-550 border border-amber-500/20">
                <Trophy className="w-7 h-7 text-amber-500 animate-bounce" />
              </div>
              <h3 className="text-xl font-sans font-black uppercase tracking-wider text-slate-900 dark:text-slate-100">
                Sprint Concluded
              </h3>
              <p className="text-[9px] text-indigo-400 font-mono font-bold uppercase tracking-widest">
                WEEK CYCLE EVALUATION SUMMARY
              </p>
            </div>

            <div className="bg-slate-50 dark:bg-slate-950/60 p-4 rounded-xl border border-slate-200 dark:border-slate-805 space-y-4">
              <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed text-center font-semibold font-sans">
                {resetResult.message}
              </p>
              
              <div className="grid grid-cols-2 gap-2 text-center pt-3 border-t border-slate-200 dark:border-slate-800 text-xs font-mono">
                <div className="p-2 bg-slate-900/5 dark:bg-slate-900/40 rounded-lg">
                  <span className="text-slate-400 dark:text-slate-500 block text-[9px] uppercase font-sans font-bold">Past Tier</span>
                  <span className="font-extrabold text-slate-700 dark:text-slate-300 text-sm uppercase">{resetResult.oldTier}</span>
                </div>
                <div className="p-2 bg-slate-900/5 dark:bg-slate-900/40 rounded-lg animate-pulse border border-blue-500/30">
                  <span className="text-blue-500 block text-[9px] uppercase font-sans font-bold">Next Sprint Tier</span>
                  <span className="font-extrabold text-blue-600 dark:text-blue-400 text-sm uppercase">{resetResult.newTier}</span>
                </div>
              </div>
            </div>

            <button
              onClick={() => {
                setResetResult(null);
                
                // Driving true profile sync using the proper 'league' schema structure
                if (profile && onUpdateProfile) {
                  onUpdateProfile({
                    ...profile,
                    league: resetResult?.newTier || profile.league 
                  });
                }
              }}
              className="w-full py-3 bg-blue-600 hover:bg-blue-750 text-white rounded-xl font-sans font-black text-xs uppercase tracking-wider cursor-pointer shadow-sm transition-colors"
            >
              Begin Next Phase
            </button>
          </div>
        </div>
      )}

    </div>
  );
}