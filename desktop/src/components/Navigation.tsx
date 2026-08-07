/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { UserProfile } from '../types';
import { pywebviewBridge, subscribeToIpcLogs, IpcLog } from '../utils/pywebviewBridge';
import { Play, Home, Trophy, ListCollapse, User, Settings, ShieldAlert, Terminal, Sparkles, Menu } from 'lucide-react';
import { getStrikeCount, getStrikeColorPalette } from '../utils/strikeHelpers';
import { getLockdownStatus } from '../utils/lockdownService';

import { auth } from '../utils/firebase';
import { resolveDisplayName } from '../utils/profileHelpers';

interface NavigationProps {
  currentView: string;
  onNavigate: (view: string) => void;
  profile: UserProfile;
  onUpdateProfile?: (p: UserProfile) => void;
  theme?: 'Granite Beige' | 'Midnight Slate' | 'Deep Plum';
  isFocusActive?: boolean;
}

export default function Navigation({ currentView, onNavigate, profile, onUpdateProfile, theme = 'Granite Beige', isFocusActive = false }: NavigationProps) {
  const [ipcLogs, setIpcLogs] = useState<string[]>([]);
  const [showTerminal, setShowTerminal] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const user = auth.currentUser;
  const safeProfile: UserProfile = profile || {
    username: user
      ? (user.email?.split('@')[0] || 'unshackler').replace(/[^a-zA-Z0-9_\-+]/g, '')
      : 'guest',
    displayName: user?.displayName || user?.email?.split('@')[0] || (user ? 'Unshackler' : 'Guest'),
    email: user?.email || '',
    xp: 0,
    streak: 0,
    strikes: 'None',
    tier: 'regular',
    level: 1,
  };
  const activeStrikes = getStrikeCount(safeProfile.strikes);
  const palette = getStrikeColorPalette(activeStrikes, 'Dark', theme); // compute the styling parameters for indicator display
  const lockdown = getLockdownStatus(safeProfile);

  const handleUpdateStrikes = async (strikeCount: number) => {
    if (!onUpdateProfile) return;
    const clampedStrikes = Math.min(strikeCount, 3);
    let strikesText = "None";
    let nextStreak = safeProfile.streak;
    if (clampedStrikes > 0) {
      strikesText = `${clampedStrikes} Strike${clampedStrikes > 1 ? 's' : ''}`;
    }
    if (clampedStrikes >= 3) {
      nextStreak = 0; // reset active streak
      strikesText = `${clampedStrikes} Strikes (Streak Reset)`;
    }
    const updated = {
      ...safeProfile,
      strikes: strikesText,
      streak: nextStreak
    };
    const saved = await pywebviewBridge.saveProfile(updated);
    onUpdateProfile(saved);
  };

  // Core Sidebar menu items from Mockup 3
  const menuItems = [
    { name: "Let's Shackle", icon: Play, desc: "Focus Clock Mode" },
    { name: "Dashboard", icon: Home, desc: "Focus Command Center" },
    { name: "Shackle Leagues", icon: Trophy, desc: "Competitive Study Ranks" },
    { name: "Un-Shackled Sessions", icon: ListCollapse, desc: "Past Registry Archive" }
  ];

  // Intercept logs transmitted via the window/webview interface for our terminal output print block
  useEffect(() => {
    let unsubscribeIpcChannel: (() => void) | null = null;

    if (typeof subscribeToIpcLogs !== 'undefined') {
      // Start subscription tracking securely
      unsubscribeIpcChannel = subscribeToIpcLogs((freshLog: any) => {
        const logLine = typeof freshLog === 'string' ? freshLog : JSON.stringify(freshLog);
        
        setIpcLogs((prevHistory) => {
          // Cap array size to maximum 100 entries to prevent desktop wrapper memory exhaustion
          const truncatedHistory = prevHistory.length > 100 ? prevHistory.slice(-100) : prevHistory;
          return [...truncatedHistory, `[${new Date().toLocaleTimeString()}] ${logLine}`];
        });
      });
    }

    return () => {
      if (unsubscribeIpcChannel) {
        unsubscribeIpcChannel();
      }
    };
  }, []);

  return (
    <div className={`w-full ${isCollapsed ? 'md:w-18 px-3' : 'md:w-68 p-6'} h-full bg-slate-900 text-slate-100 sidebar-theme flex flex-col justify-between py-6 border-r border-slate-800 shrink-0 transition-all duration-300`}>
      
      {/* Upper Logo block displaying brand */}
      <div className="space-y-6">
        
        {/* Logo Brand Title with incorporated 3-bar menu trigger */}
        <div 
          className={`flex items-center cursor-pointer select-none py-3 ${isCollapsed ? 'justify-center' : 'gap-3'}`} 
          onClick={() => setIsCollapsed(!isCollapsed)}
          title={isCollapsed ? "Expand Navigation" : "Collapse Navigation"}
        >
          <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white font-bold text-lg shadow-md relative group shrink-0">
            <span>S</span>
            <div className="absolute -bottom-1 -right-1 bg-slate-950 border border-slate-800 rounded-full p-0.5 flex items-center justify-center text-slate-300">
              <Menu className="w-2.5 h-2.5" />
            </div>
          </div>
          {!isCollapsed && (
            <div className="animate-fade-in truncate">
              <h1 className="text-sm font-sans font-extrabold tracking-widest text-slate-100 uppercase leading-none">
                SHACKLE
              </h1>
              <p className="text-[8px] uppercase tracking-widest text-slate-500 font-bold mt-1">
                AI Study System
              </p>
            </div>
          )}
        </div>
 
        {/* Sidebar Nav Items */}
        {!isCollapsed && (
          <nav className="space-y-1.5 pt-2 animate-fade-in">
            {menuItems.map((item) => {
              const isActive = currentView === item.name;
              const Icon = item.icon;
              const isShackleLocked = item.name === "Let's Shackle" && lockdown.isLockedOut;
              const isDisabled = (isFocusActive && !isActive) || isShackleLocked;
              return (
                <button
                  key={item.name}
                  disabled={isDisabled}
                  onClick={() => !isDisabled && onNavigate(item.name)}
                  className={`w-full text-left p-3 rounded-lg transition-all duration-200 flex items-center gap-3.5 group border ${
                    isActive
                      ? 'bg-blue-600 border-blue-500 text-white font-semibold shadow-sm'
                      : isDisabled
                        ? 'opacity-40 cursor-not-allowed select-none text-slate-500 border-transparent bg-slate-950/20'
                        : 'text-slate-400 border-transparent hover:bg-slate-800 hover:text-slate-100 cursor-pointer'
                  }`}
                >
                  <Icon className={`w-4.5 h-4.5 ${isActive ? 'text-white' : isDisabled ? 'text-slate-600' : 'text-slate-500 group-hover:text-slate-300'}`} />
                  <div className="flex flex-col">
                    <span className="text-xs font-sans font-medium flex items-center gap-1.5">
                      {item.name}
                      {isDisabled && !isActive && (
                        <span className={`text-[8px] px-1 rounded border uppercase font-mono tracking-wider font-bold ${
                          isShackleLocked 
                            ? 'bg-red-950/50 border-red-900/60 text-red-400' 
                            : 'bg-slate-800 border-slate-700 text-slate-400'
                        }`}>
                          {isShackleLocked ? '72H LOCKOUT' : 'LOCKED'}
                        </span>
                      )}
                    </span>
                    <span className={`text-[9px] font-mono leading-none ${isActive ? 'text-blue-200/90' : isDisabled ? 'text-slate-600' : 'text-slate-500 group-hover:text-slate-400'}`}>
                      {isShackleLocked 
                        ? 'Locked: 72h Penalty' 
                        : isFocusActive && !isActive 
                          ? 'Focus Lockout Active' 
                          : item.desc}
                    </span>
                  </div>
                </button>
              );
            })}
          </nav>
        )}
 
      </div>
 
      {/* Bottom Group containing terminal details, User profile links, Settings hooks */}
      <div className="space-y-6 pt-4 border-t border-slate-800">

        {/* Dynamic Strike compliance-based Psychological Monitor */}
        {!isCollapsed && (
          <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800 space-y-2 animate-fade-in">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-mono font-bold tracking-widest text-slate-400 uppercase flex items-center gap-1.5">
                <ShieldAlert className="w-3 h-3 text-amber-500" />
                <span>STRIKES MONITOR</span>
              </span>
              <span className="text-[9px] bg-slate-800 text-slate-200 font-mono font-bold px-1.5 py-0.5 rounded">
                Active: {activeStrikes}
              </span>
            </div>

            <div className="space-y-1">
              <h4 className="text-[11px] font-bold text-slate-100 flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${activeStrikes === 0 ? 'bg-green-500' : activeStrikes === 1 ? 'bg-amber-500 font-pulse' : 'bg-red-650 font-pulse animate-pulse'}`} />
                {palette.effectTitle}
              </h4>
              <p className="text-[9px] text-slate-400 font-light leading-relaxed italic">
                "{palette.effectMessage}"
              </p>
            </div>
          </div>
        )}
        
        {/* Sub-block interactive IPC command console stream drawer removed */}
 
        {/* Bottom Panel Actions */}
        <div className={`space-y-2 w-full flex flex-col ${isCollapsed ? 'items-center' : ''}`}>
          {/* Action 1: Account Profile (Profile Icon + name / icon only) */}
          {isCollapsed ? (
            <button
              disabled={isFocusActive}
              onClick={() => !isFocusActive && onNavigate('Profile')}
              className={`w-9 h-9 rounded-xl transition-all flex items-center justify-center border overflow-hidden ${
                currentView === 'Profile' 
                  ? 'bg-blue-600 border-blue-500 text-white' 
                  : isFocusActive
                    ? 'opacity-35 cursor-not-allowed select-none bg-slate-800 border-slate-750 text-slate-500'
                    : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 cursor-pointer'
              }`}
              title={isFocusActive ? "Profile locked during study" : `Profile: ${resolveDisplayName(profile, user)}`}
            >
              {profile?.avatarUrl ? (
                <img src={profile.avatarUrl} alt="avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <User className="w-4 h-4" />
              )}
            </button>
          ) : (
            <button
              disabled={isFocusActive}
              onClick={() => !isFocusActive && onNavigate('Profile')}
              className={`w-full p-2.5 rounded-lg transition-colors border text-left flex items-center justify-between group ${
                currentView === 'Profile' 
                  ? 'bg-slate-800 border-slate-700' 
                  : isFocusActive
                    ? 'opacity-35 cursor-not-allowed select-none border-transparent'
                    : 'bg-transparent border-transparent hover:bg-slate-800 cursor-pointer'
              }`}
            >
              <div className="flex items-center gap-2.5 overflow-hidden">
                <div className="w-7 h-7 rounded-full bg-slate-800 border border-slate-700 text-slate-300 flex items-center justify-center shrink-0 overflow-hidden">
                  {profile?.avatarUrl ? (
                    <img src={profile.avatarUrl} alt="avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <User className="w-3.5 h-3.5" />
                  )}
                </div>
                <div className="flex flex-col truncate">
                  <span className="text-[9px] text-slate-500 font-bold font-mono">ACCOUNT</span>
                  <span className="text-xs font-semibold text-slate-200 font-sans truncate">{resolveDisplayName(profile, user)}</span>
                </div>
              </div>
            </button>
          )}
 
          {/* Action 2: Settings Gear */}
          {isCollapsed ? (
            <button
              disabled={isFocusActive}
              onClick={() => !isFocusActive && onNavigate('Settings')}
              className={`w-9 h-9 rounded-xl transition-all flex items-center justify-center border ${
                currentView === 'Settings' 
                  ? 'bg-blue-600 border-blue-500 text-white' 
                  : isFocusActive
                    ? 'opacity-35 cursor-not-allowed select-none text-slate-500 bg-slate-800 border-slate-750'
                    : 'text-slate-400 bg-slate-800 border-slate-700 hover:bg-slate-700 hover:text-slate-200 cursor-pointer'
              }`}
              title={isFocusActive ? "Settings locked during study" : "Settings Configuration"}
            >
              <Settings className="w-4 h-4" />
            </button>
          ) : (
            <button
              disabled={isFocusActive}
              onClick={() => !isFocusActive && onNavigate('Settings')}
              className={`w-full p-2.5 rounded-lg transition-colors text-left flex items-center gap-3.5 group border ${
                currentView === 'Settings' 
                  ? 'bg-slate-800 border-slate-700 text-white font-medium' 
                  : isFocusActive
                    ? 'opacity-35 cursor-not-allowed select-none border-transparent text-slate-500'
                    : 'text-slate-400 border-transparent hover:bg-slate-800 hover:text-slate-200 cursor-pointer'
              }`}
            >
              <Settings className={`w-4.5 h-4.5 ${currentView === 'Settings' ? 'text-blue-400' : 'text-slate-500 group-hover:text-slate-300'}`} />
              <div className="flex flex-col">
                <span className="text-xs font-semibold font-sans">Settings Configurations</span>
                <span className="text-[9px] font-mono text-slate-500 group-hover:text-slate-400 leading-none">
                  {isFocusActive ? 'Locked during Focus' : 'Setup rules & blocker dials'}
                </span>
              </div>
            </button>
          )}
 
        </div>
 
      </div>
 
    </div>
  );
}
