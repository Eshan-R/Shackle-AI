/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { pywebviewBridge, isDesktopApp } from '../utils/pywebviewBridge';
import { TimerConfigurations, DisplaySettings, BlacklistItem, UserProfile } from '../types';
import { getLockdownStatus } from '../utils/lockdownService';
import { ArrowLeft, ChevronDown, ChevronUp, Check, Settings, Monitor, Shield, Sparkles, Terminal, Copy, Plus, Trash2, HelpCircle, Lock } from 'lucide-react';

interface SettingsViewProps {
  timerConfigs: TimerConfigurations;
  displaySettings: DisplaySettings;
  onUpdateTimerConfigs: (c: TimerConfigurations) => void;
  onUpdateDisplaySettings: (s: DisplaySettings) => void;
  onNavigate: (view: string) => void;
  profile?: UserProfile;
}

export default function SettingsView({
  timerConfigs,
  displaySettings,
  onUpdateTimerConfigs,
  onUpdateDisplaySettings,
  onNavigate,
  profile,
}: SettingsViewProps) {
  const isPremiumLocked = profile ? getLockdownStatus(profile).isPremiumLocked : false;
  const [aiReportEnabled, setAiReportEnabled] = useState(true);
  const isGlass = displaySettings.glassmorphism;

  const totalXp = profile?.xp || 0;
  const getLevel = (xp: number) => {
    const thresholds = [0, 100, 200, 400, 700, 1200, 2000];
    for (let i = 0; i < thresholds.length - 1; i++) {
      if (xp >= thresholds[i] && xp < thresholds[i + 1]) {
        return i + 1;
      }
    }
    return 6;
  };
  const currentLevel = getLevel(totalXp);
  const isAiReportLocked = currentLevel < 3;
  
  // Collapse toggles mapping
  const [collapsedGroup, setCollapsedGroup] = useState<Record<string, boolean>>({
    timer: false,
    display: false,
    blacklists: false,
    advanced: false,
    desktop: true, // starts closed
  });

  const toggleCollapse = (group: string) => {
    setCollapsedGroup(prev => ({ ...prev, [group]: !prev[group] }));
  };

  // Blacklisting management state
  const [activeBlacklist, setActiveBlacklist] = useState<string[]>([]);
  const [availableApps, setAvailableApps] = useState<BlacklistItem[]>([]);
  const [showAppSelectorModal, setShowAppSelectorModal] = useState(false);
  
  // Adding custom executable app name
  const [customAppName, setCustomAppName] = useState("");
  const [customAppProcess, setCustomAppProcess] = useState("");

  // Copying helper
  const [copiedScriptText, setCopiedScriptText] = useState(false);

  useEffect(() => {
    // Hardened defensive hooks for staging inside local web browser environments
    if (typeof pywebviewBridge !== 'undefined') {
      if (pywebviewBridge.getBlacklistedApps) {
        pywebviewBridge.getBlacklistedApps().then(apps => setActiveBlacklist(apps || []));
      }
      if (pywebviewBridge.getAvailableApps) {
        pywebviewBridge.getAvailableApps().then(list => setAvailableApps(list || []));
      }
    } else {
      // Mocked fallbacks for browser sandboxing
      setAvailableApps([
        { id: 'discord', name: 'Discord', processName: 'Discord.exe', enabled: true },
        { id: 'steam', name: 'Steam', processName: 'steam.exe', enabled: true },
        { id: 'riot', name: 'Riot Client', processName: 'RiotClientServices.exe', enabled: true }
      ]);
    }
  }, []);

  const handleUpdateTimerField = async <K extends keyof TimerConfigurations>(key: K, value: TimerConfigurations[K]) => {
    const updated = { ...timerConfigs, [key]: value };
    if (typeof pywebviewBridge !== 'undefined' && pywebviewBridge.saveTimerConfigs) {
      const saved = await pywebviewBridge.saveTimerConfigs(updated);
      onUpdateTimerConfigs(saved);
    } else {
      onUpdateTimerConfigs(updated);
    }
  };

  const handleUpdateDisplayField = async <K extends keyof DisplaySettings>(key: K, value: DisplaySettings[K]) => {
    const updated = { ...displaySettings, [key]: value };
    if (typeof pywebviewBridge !== 'undefined' && pywebviewBridge.saveDisplaySettings) {
      const saved = await pywebviewBridge.saveDisplaySettings(updated);
      onUpdateDisplaySettings(saved);
    } else {
      onUpdateDisplaySettings(updated);
    }
  };

  const toggleBlacklistAppName = async (processName: string) => {
    let list = [...activeBlacklist];
    const isAdding = !list.includes(processName);
    if (isAdding) {
      list.push(processName);
      if (typeof pywebviewBridge !== 'undefined' && pywebviewBridge.add_to_blacklist) {
        await pywebviewBridge.add_to_blacklist(processName);
      }
    } else {
      list = list.filter(item => item !== processName);
      if (typeof pywebviewBridge !== 'undefined' && pywebviewBridge.remove_from_blacklist) {
        await pywebviewBridge.remove_from_blacklist(processName);
      }
    }

    if (typeof pywebviewBridge !== 'undefined' && pywebviewBridge.saveBlacklistedApps) {
      const saved = await pywebviewBridge.saveBlacklistedApps(list);
      setActiveBlacklist(saved || list);
    } else {
      setActiveBlacklist(list);
    }
  };

  const addCustomBlacklistApp = async () => {
    const processClean = customAppProcess.trim();
    const nameClean = customAppName.trim();
    if (!nameClean || !processClean) return;

    try {
      // 1. Commit safely to background execution daemon
      if (typeof pywebviewBridge !== 'undefined' && pywebviewBridge.add_to_blacklist) {
        await pywebviewBridge.add_to_blacklist(processClean);
      }

      // 2. Drive live UI sync by adding directly to active and preset tracking states
      if (!activeBlacklist.includes(processClean)) {
        const updatedList = [...activeBlacklist, processClean];
        setActiveBlacklist(updatedList);
        
        if (typeof pywebviewBridge !== 'undefined' && pywebviewBridge.saveBlacklistedApps) {
          await pywebviewBridge.saveBlacklistedApps(updatedList);
        }
      }

      if (!availableApps.some(app => app.processName === processClean)) {
        setAvailableApps(prev => [...prev, {
          id: processClean,
          name: nameClean,
          processName: processClean,
          enabled: true,
          isCustom: true
        }]);
      }

      // 3. Keep main local configuration schema up to date
      const newAppItem = {
        id: processClean,
        name: nameClean,
        process: processClean,
        enabled: true,
        isCustom: true
      };

      const updatedBlacklist = [...(timerConfigs.blacklistItems || []), newAppItem];
      onUpdateTimerConfigs({
        ...timerConfigs,
        blacklistItems: updatedBlacklist
      });

      // 4. Clear form states
      setCustomAppName("");
      setCustomAppProcess("");
    } catch (err) {
      console.error("Failed to commit custom app state to locker backend:", err);
    }
  };

  const removeBlacklistApp = async (processName: string) => {
    const list = activeBlacklist.filter(item => item !== processName);
    
    if (typeof pywebviewBridge !== 'undefined' && pywebviewBridge.remove_from_blacklist) {
      await pywebviewBridge.remove_from_blacklist(processName);
    }

    if (typeof pywebviewBridge !== 'undefined' && pywebviewBridge.saveBlacklistedApps) {
      const saved = await pywebviewBridge.saveBlacklistedApps(list);
      setActiveBlacklist(saved || list);
    } else {
      setActiveBlacklist(list);
    }
  };

  const handleCopyBashScript = () => {
    const text = `python shackle_desktop.py ${window.location.origin}`;
    navigator.clipboard.writeText(text);
    setCopiedScriptText(true);
    setTimeout(() => setCopiedScriptText(false), 3000);
  };

  return (
    <div className="space-y-6 animate-fade-in w-full max-w-3xl mx-auto py-4">
      
      {/* Title block with back arrow */}
      <div className="flex items-center gap-3 text-slate-800 dark:text-slate-200">
        <button
          onClick={() => onNavigate('Dashboard')}
          className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-805 rounded-lg transition-colors cursor-pointer"
          title="Back to Dashboard"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-sans font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wide">Settings Panel</h1>
      </div>

      {/* Accordion groups container column */}
      <div className="space-y-4">
        
        {/* Accordion 1: Focus Timer Configurations */}
        <div className={`${isGlass ? 'glass-panel' : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-805'} rounded-xl overflow-hidden shadow-sm transition-all`}>
          <button
            onClick={() => toggleCollapse('timer')}
            className="w-full px-4 py-3.5 text-left flex justify-between items-center bg-slate-50/50 dark:bg-slate-950/20 border-b border-slate-100 dark:border-slate-805 hover:bg-slate-50 dark:hover:bg-slate-950/40 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <Settings className="w-4.5 h-4.5 text-blue-600 dark:text-blue-400" />
              <h2 className="text-sm font-sans font-bold text-slate-800 dark:text-slate-200">
                Focus Timer Configurations
              </h2>
            </div>
            {collapsedGroup.timer ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronUp className="w-4 h-4 text-blue-600 dark:text-blue-400" />}
          </button>

          {!collapsedGroup.timer && (
            <div className="p-4 space-y-4 font-sans">
              
              {/* Row 1: Focus Periods */}
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2">
                <div>
                  <h4 className="font-bold text-slate-800 dark:text-slate-200 text-xs">Focus Periods</h4>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">Length of productive study blocks</p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={timerConfigs.focusPeriods}
                    onChange={(e) => handleUpdateTimerField('focusPeriods', e.target.value as any)}
                    className="text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 px-3.5 py-1.5 rounded-lg text-slate-705 dark:text-slate-300 font-semibold cursor-pointer outline-none focus:border-blue-500"
                  >
                    <option value="Automatic">Automatic (25m)</option>
                    <option value="25 minutes">25 minutes</option>
                    <option value="50 minutes">50 minutes</option>
                    <option value="Custom">Custom</option>
                  </select>

                  {timerConfigs.focusPeriods === 'Custom' && (
                    <input
                      type="number"
                      min="1"
                      max="180"
                      value={timerConfigs.focusPeriodsCustom || 25}
                      onChange={(e) => handleUpdateTimerField('focusPeriodsCustom', Math.max(1, parseInt(e.target.value, 10) || 25))}
                      className="w-16 px-2 py-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-805 rounded-lg text-xs font-mono font-bold text-center text-slate-700 dark:text-slate-300 outline-none"
                    />
                  )}
                </div>
              </div>

              {/* Row 2: Break Periods */}
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-805">
                <div>
                  <h4 className="font-bold text-slate-800 dark:text-slate-200 text-xs">Break Periods</h4>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">Length of relaxation intervals</p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={timerConfigs.breakPeriods}
                    onChange={(e) => handleUpdateTimerField('breakPeriods', e.target.value as any)}
                    className="text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 px-3.5 py-1.5 rounded-lg text-slate-705 dark:text-slate-300 font-semibold cursor-pointer outline-none focus:border-blue-500"
                  >
                    <option value="Automatic">Automatic (5m)</option>
                    <option value="5 minutes">5 minutes</option>
                    <option value="10 minutes">10 minutes</option>
                    <option value="Custom">Custom</option>
                  </select>

                  {timerConfigs.breakPeriods === 'Custom' && (
                    <input
                      type="number"
                      min="1"
                      max="60"
                      value={timerConfigs.breakPeriodsCustom || 5}
                      onChange={(e) => handleUpdateTimerField('breakPeriodsCustom', Math.max(1, parseInt(e.target.value, 10) || 5))}
                      className="w-16 px-2 py-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-805 rounded-lg text-xs font-mono font-bold text-center text-slate-700 dark:text-slate-300 outline-none"
                    />
                  )}
                </div>
              </div>

              {/* Extras: Auto Start Break */}
              <div className="flex justify-between items-center pt-2 border-t border-slate-100 dark:border-slate-805 font-sans">
                <div>
                  <h4 className="font-bold text-slate-800 dark:text-slate-200 text-xs">Auto-Start Intervals</h4>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">Switch automatically to break when timer finishes</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={timerConfigs.autoStartBreak}
                    onChange={(e) => handleUpdateTimerField('autoStartBreak', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 dark:bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600 toggle-switch-large"></div>
                </label>
              </div>

              {/* Extras: Sound Effects */}
              <div className="flex justify-between items-center pt-2 border-t border-slate-100 dark:border-slate-805 font-sans">
                <div>
                  <h4 className="font-bold text-slate-800 dark:text-slate-200 text-xs">Interval Audio Alerts</h4>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">Play completion tone on clock exhaust</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={timerConfigs.soundOnEnd}
                    onChange={(e) => handleUpdateTimerField('soundOnEnd', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 dark:bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600 toggle-switch-large"></div>
                </label>
              </div>

            </div>
          )}
        </div>

        {/* Accordion 2: Display Configurations */}
        <div className={`${isGlass ? 'glass-panel' : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-805'} rounded-xl overflow-hidden shadow-sm transition-all`}>
          <button
            onClick={() => toggleCollapse('display')}
            className="w-full px-4 py-3.5 text-left flex justify-between items-center bg-slate-50/50 dark:bg-slate-950/20 border-b border-slate-100 dark:border-slate-805 hover:bg-slate-50 dark:hover:bg-slate-950/40 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <Monitor className="w-4.5 h-4.5 text-blue-600 dark:text-blue-400" />
              <h2 className="text-sm font-sans font-bold text-slate-800 dark:text-slate-200">
                Display Styling Configurations
              </h2>
            </div>
            {collapsedGroup.display ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronUp className="w-4 h-4 text-blue-600 dark:text-blue-400" />}
          </button>

          {!collapsedGroup.display && (
            <div className="p-4 space-y-4 font-sans">
              
              {/* Countdown design selection */}
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2">
                <div>
                  <h4 className="font-bold text-slate-800 dark:text-slate-200 text-xs">Countdown Design</h4>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">The visual rendering style of your focus timer</p>
                </div>
                <select
                  value={displaySettings.countdownDesign}
                  onChange={(e) => handleUpdateDisplayField('countdownDesign', e.target.value as any)}
                  className="text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-805 px-3.5 py-1.5 rounded-lg text-slate-705 dark:text-slate-300 font-semibold cursor-pointer outline-none focus:border-blue-500"
                >
                  <option value="Split Flip Clock">Split Flip Clock</option>
                  <option value="Radial">Radial Progress Ring</option>
                  <option value="Minimal">Minimal Digital Text</option>
                </select>
              </div>

              {/* Rendering Mode */}
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-805">
                <div>
                  <h4 className="font-bold text-slate-800 dark:text-slate-200 text-xs">Operation Mode</h4>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 font-light">Adjust canvas rendering bounds</p>
                </div>
                <select
                  value={displaySettings.mode}
                  onChange={(e) => handleUpdateDisplayField('mode', e.target.value as any)}
                  className="text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-805 px-3.5 py-1.5 rounded-lg text-slate-705 dark:text-slate-300 font-semibold cursor-pointer outline-none focus:border-blue-500"
                >
                  <option value="Light">Light Mode</option>
                  <option value="Dark">Dark Mode</option>
                  <option value="Auto">Auto Synced</option>
                </select>
              </div>

              {/* Accent Color Preset Theme */}
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-805">
                <div>
                  <div className="flex items-center gap-1.5">
                    <h4 className="font-bold text-slate-800 dark:text-slate-200 text-xs">Workspace Color Theme</h4>
                    {isPremiumLocked && (
                      <span className="text-[8px] bg-red-500/10 text-red-500 px-1.5 py-0.5 rounded flex items-center gap-1 font-mono font-bold border border-red-500/20">
                        <Lock className="w-2.5 h-2.5" /> LOCKED
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 font-light">
                    {isPremiumLocked ? 'Premium locked during Strike 3 Penalty' : 'Primary visual pairing selection'}
                  </p>
                </div>
                <select
                  disabled={isPremiumLocked}
                  value={isPremiumLocked ? 'Granite Beige' : displaySettings.theme}
                  onChange={(e) => handleUpdateDisplayField('theme', e.target.value as any)}
                  className={`text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-805 px-3.5 py-1.5 rounded-lg font-semibold outline-none focus:border-blue-500 ${isPremiumLocked ? 'opacity-50 cursor-not-allowed text-slate-400' : 'text-slate-705 dark:text-slate-300 cursor-pointer'}`}
                >
                  <option value="Granite Beige">Granite Beige (Warm Neutral)</option>
                  <option value="Midnight Slate">Midnight Slate (Futuristic Blue)</option>
                  <option value="Deep Plum">Deep Plum (Cozy Violet)</option>
                </select>
              </div>

              {/* Glassmorphism blur switch */}
              <div className="flex justify-between items-center pt-2 border-t border-slate-100 dark:border-slate-805">
                <div>
                  <h4 className="font-bold text-slate-800 dark:text-slate-200 text-xs">Glassmorphism effects</h4>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 font-light">Toggle frosted glass blurred elements</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={displaySettings.glassmorphism}
                    onChange={(e) => handleUpdateDisplayField('glassmorphism', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 dark:bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600 toggle-switch-large"></div>
                </label>
              </div>

            </div>
          )}
        </div>

        {/* Accordion 3: App Blacklisting */}
        <div className={`${isGlass ? 'glass-panel' : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-805'} rounded-xl overflow-hidden shadow-sm transition-all`}>
          <button
            onClick={() => toggleCollapse('blacklists')}
            className="w-full px-4 py-3.5 text-left flex justify-between items-center bg-slate-50/50 dark:bg-slate-950/20 border-b border-slate-100 dark:border-slate-805 hover:bg-slate-50 dark:hover:bg-slate-950/40 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <Shield className="w-4.5 h-4.5 text-blue-600 dark:text-blue-400" />
              <h2 className="text-sm font-sans font-bold text-slate-800 dark:text-slate-200">
                Blacklists
              </h2>
            </div>
            {collapsedGroup.blacklists ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronUp className="w-4 h-4 text-blue-600 dark:text-blue-400" />}
          </button>

          {!collapsedGroup.blacklists && (
            <div className="p-4 space-y-4">
              
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                <div>
                  <h4 className="font-bold text-slate-800 dark:text-slate-200 text-xs">Shielded Distractions Blocklist</h4>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">Apps scheduled for auto-termination when Focus timer spins</p>
                </div>
                
                <button
                  onClick={() => setShowAppSelectorModal(true)}
                  className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 border border-blue-500/20 text-white rounded-lg text-xs font-semibold cursor-pointer transition-colors shadow-sm"
                >
                  Choose app to blacklist
                </button>
              </div>

              {activeBlacklist.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {activeBlacklist.map((process) => {
                    const presetApp = availableApps.find(v => v.processName === process);
                    const displayName = presetApp ? presetApp.name : process.replace('.exe', '');
                    return (
                      <div key={process} className="bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 p-2.5 rounded-lg flex items-center justify-between font-sans">
                        <div className="flex items-center gap-2.5">
                          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                          <div>
                            <p className="text-xs font-semibold text-slate-805 dark:text-slate-250">{displayName}</p>
                            <p className="text-[10px] text-slate-400 font-mono">{process}</p>
                          </div>
                        </div>
                        <button
                          onClick={() => removeBlacklistApp(process)}
                          className="p-1 hover:bg-red-50 dark:hover:bg-red-950/20 text-slate-450 hover:text-red-500 rounded cursor-pointer transition-all"
                          title="Release process from block rules"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-slate-450 dark:text-slate-500 font-light italic text-center py-4 bg-slate-50 dark:bg-slate-950/50 rounded-lg">
                  No applications are currently blacklisted. Distractions are wide open!
                </p>
              )}

            </div>
          )}
        </div>

        {/* Accordion 4: Advanced Setting */}
        <div className={`${isGlass ? 'glass-panel' : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-805'} rounded-xl overflow-hidden shadow-sm transition-all`}>
          <button
            onClick={() => toggleCollapse('advanced')}
            className="w-full px-4 py-3.5 text-left flex justify-between items-center bg-slate-50/50 dark:bg-slate-950/20 border-b border-slate-100 dark:border-slate-805 hover:bg-slate-50 dark:hover:bg-slate-950/40 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <Sparkles className="w-4.5 h-4.5 text-blue-600 dark:text-blue-400" />
              <h2 className="text-sm font-sans font-bold text-slate-800 dark:text-slate-200">
                Advanced Setting
              </h2>
            </div>
            {collapsedGroup.advanced ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronUp className="w-4 h-4 text-blue-600 dark:text-blue-400" />}
          </button>

          {!collapsedGroup.advanced && (
            <div className="p-4 relative">
              
              <div className={`flex items-center justify-between transition-all duration-300 ${isAiReportLocked ? 'opacity-40 select-none pointer-events-none filter blur-[1px]' : ''}`}>
                <div className="max-w-[80%] flex flex-col">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h4 className="font-bold text-slate-800 dark:text-slate-200 text-xs">Generate an AI Report after every focus session (Premium)</h4>
                    {isPremiumLocked && (
                      <span className="text-[8px] bg-red-500/10 text-red-500 px-1.5 py-0.5 rounded flex items-center gap-1 font-mono font-bold border border-red-500/20">
                        <Lock className="w-2.5 h-2.5" /> LOCKED
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 dark:text-slate-505 mt-0.5 leading-relaxed font-sans">
                    {isPremiumLocked 
                      ? 'This feature is currently locked. Complete your 1-week challenge and maintain your streak to restore premium features.' 
                      : 'Enable the server-side Gemini 3.5 Assistant to automatically bundle study metrics, background app attempts, and compile tailored cognitive psychology focus coaching summaries after each logged period.'}
                  </p>
                </div>

                <label className={`relative inline-flex items-center font-sans ${isPremiumLocked || isAiReportLocked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    disabled={isPremiumLocked || isAiReportLocked}
                    checked={isPremiumLocked ? false : aiReportEnabled}
                    onChange={(e) => !isPremiumLocked && setAiReportEnabled(e.target.checked)}
                  />
                  <div className="w-11 h-6 bg-slate-200 dark:bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600 toggle-switch-large"></div>
                </label>
              </div>

              {/* Gated lock overlay */}
              {isAiReportLocked && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-4 bg-slate-50/10 dark:bg-slate-900/10 rounded-xl backdrop-grayscale-25">
                  <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 shadow-xl rounded-xl p-4 max-w-xs space-y-1.5">
                    <div className="w-8 h-8 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto shadow-2xs">
                      <Lock className="w-4 h-4" />
                    </div>
                    <h5 className="text-xs font-bold text-slate-900 dark:text-slate-100">AI Analytics Gated</h5>
                    <p className="text-[10px] text-slate-450 dark:text-slate-500 leading-normal font-sans">
                      Complete focus blocks to acquire **{200 - totalXp} more XP** and breach **Level 3** to unlock advanced session cognitive reports.
                    </p>
                  </div>
                </div>
              )}

            </div>
          )}
        </div>

        {/* Accordion 5: Desktop App Wrapper Guide */}
        {!isDesktopApp() && (
          <div className={`${isGlass ? 'glass-panel' : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-805'} rounded-xl overflow-hidden shadow-sm transition-all`}>
            <button
              onClick={() => toggleCollapse('desktop')}
              className="w-full px-4 py-3.5 text-left flex justify-between items-center bg-slate-50/50 dark:bg-slate-950/20 border-b border-slate-100 dark:border-slate-805 hover:bg-slate-50 dark:hover:bg-slate-950/40 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2.5">
                <Terminal className="w-4.5 h-4.5 text-blue-600 dark:text-blue-400" />
                <h2 className="text-sm font-sans font-bold text-slate-800 dark:text-slate-205">
                  Desktop App Client Integration
                </h2>
              </div>
              {collapsedGroup.desktop ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronUp className="w-4 h-4 text-blue-600 dark:text-blue-400" />}
            </button>

            {!collapsedGroup.desktop && (
              <div className="p-4 space-y-3 font-sans max-w-full">
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed font-sans">
                  Shackle AI's unique superpower is its ability to seamlessly block distracting applications directly from your native computer using a lightweight <code>pywebview</code> wrapper and native python background threads.
                </p>

                <div className="space-y-2 bg-slate-900 dark:bg-slate-950 text-slate-200 p-4 rounded-lg font-mono text-xs overflow-x-auto w-full relative">
                  <button
                    onClick={handleCopyBashScript}
                    className="absolute right-3.5 top-3 p-1.5 bg-slate-800 hover:bg-slate-705 rounded text-slate-300 transition-colors"
                    title="Copy desktop launcher command line"
                  >
                    {copiedScriptText ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <span className="text-slate-550 text-[10px]"># Start Python pywebview desktop bridge pointing to this cloud address URL:</span>
                  <p className="text-yellow-400 mt-1 select-all break-all">
                    python shackle_desktop.py {window.location.origin}
                  </p>
                </div>

                <div className="space-y-1.5 border-t border-slate-100 dark:border-slate-800 pt-3">
                  <h4 className="text-xs font-bold text-slate-800 dark:text-slate-205 flex items-center gap-1.5">
                    <HelpCircle className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                    <span>Setup Walkthrough for Local Computer</span>
                  </h4>
                  <ol className="list-decimal list-inside text-[11px] text-slate-500 dark:text-slate-400 space-y-1.5 pl-1 leading-normal font-sans">
                    <li>Download and install Python on your machine (e.g., Python 3.9+).</li>
                    <li>In your command line / shell terminal, install the required active libraries: <br /><code className="bg-slate-100 dark:bg-slate-950 text-blue-600 dark:text-blue-400 border border-slate-200 dark:border-slate-800 px-1.5 py-0.5 rounded text-[10px] font-mono select-all">pip install pywebview psutil</code></li>
                    <li>Copy the customized Python script file <code>shackle_desktop.py</code> from the app root directory to your computer.</li>
                    <li>Run the copied Python script in your command line terminal. It will immediately map and link native process kills to your study sprints!</li>
                  </ol>
                </div>
              </div>
            )}
          </div>
        )}

      </div>

      {/* Main blacklisting app multi-selection popup selector modal */}
      {showAppSelectorModal && (
        <div className="fixed inset-0 bg-slate-950/45 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 max-w-sm w-full shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4 text-left">
            
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5 text-slate-800 dark:text-slate-200">
              <h3 className="text-sm font-bold font-sans">Choose App Blacklist Targets</h3>
              <button
                onClick={() => setShowAppSelectorModal(false)}
                className="text-blue-600 dark:text-blue-400 hover:underline text-xs font-bold cursor-pointer"
              >
                Done
              </button>
            </div>

            <p className="text-[11px] text-slate-500 dark:text-slate-450 leading-normal font-sans">
              Select common gaming or chat applications running. Selected processes will auto-kill when Focus mode starts:
            </p>

            {/* Presets Grid */}
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {availableApps.map((app) => {
                const isActive = activeBlacklist.includes(app.processName);
                return (
                  <button
                    key={app.processName}
                    onClick={() => toggleBlacklistAppName(app.processName)}
                    className={`w-full p-2.5 rounded-lg border text-left flex items-center justify-between transition-all font-sans cursor-pointer ${
                      isActive 
                        ? 'border-red-200 bg-red-50/10' 
                        : 'border-slate-100 dark:border-slate-800 hover:border-slate-200 dark:hover:border-slate-700 bg-slate-50/20 dark:bg-slate-950/20'
                    }`}
                  >
                    <div>
                      <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">{app.name}</h4>
                      <p className="text-[10px] font-mono text-slate-400 mt-0.5">{app.processName}</p>
                    </div>
                    {isActive ? (
                      <span className="text-[9px] text-red-700 dark:text-red-400 bg-red-100/40 dark:bg-red-950/40 px-2 py-0.5 font-bold rounded">Active Block</span>
                    ) : (
                      <span className="text-[9px] text-slate-400 border border-slate-200 dark:border-slate-800 px-2 py-0.5 rounded">Unblocked</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Custom Input */}
            <div className="border-t border-slate-100 dark:border-slate-800 pt-3 space-y-2 font-sans">
              <h4 className="text-xs font-bold text-slate-705 dark:text-slate-305">Add Custom Process Blocker</h4>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Application Name"
                  value={customAppName}
                  onChange={(e) => setCustomAppName(e.target.value)}
                  className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-xs outline-none text-slate-800 dark:text-slate-200 focus:border-blue-500"
                />
                <input
                  type="text"
                  placeholder="e.g. steam.exe"
                  value={customAppProcess}
                  onChange={(e) => setCustomAppProcess(e.target.value)}
                  className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-xs outline-none text-slate-800 dark:text-slate-200 focus:border-blue-500"
                />
              </div>
              <button
                onClick={addCustomBlacklistApp}
                className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold uppercase tracking-wide transition-all flex items-center justify-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Append to List</span>
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}