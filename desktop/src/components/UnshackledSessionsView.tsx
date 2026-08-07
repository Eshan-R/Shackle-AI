/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { pywebviewBridge } from '../utils/pywebviewBridge';
import { ShackleSession } from '../types';
import { Table, Shield, Calendar, Clock, Download, CheckCircle, XCircle, Search, Trash2 } from 'lucide-react';

interface UnshackledSessionsViewProps {
  onClearAll: () => void;
  sessionsUpdatedCounter: number;
}

export default function UnshackledSessionsView({ onClearAll, sessionsUpdatedCounter }: UnshackledSessionsViewProps) {
  const [sessions, setSessions] = useState<ShackleSession[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTypeFilter, setSelectedTypeFilter] = useState("all");

  useEffect(() => {
    if (typeof pywebviewBridge !== 'undefined' && pywebviewBridge.getSessions) {
      pywebviewBridge.getSessions()
        .then(list => {
          if (list) setSessions(list);
        })
        .catch(err => {
          console.error("Failed to load session history from core engine:", err);
        });
    }
  }, [sessionsUpdatedCounter]);

  // Handle data export securely to CSV format
  const exportToCsv = () => {
    if (sessions.length === 0) return;
    const headers = ["ID", "Start Time", "Duration (mins)", "Type", "XP Earned", "Strikes", "Status", "Blocked Processes"];
    
    try {
      const rows = sessions.map(s => {
        const safeApps = s.blacklistedAppsPrevented || [];
        const validDate = s.startTime ? new Date(s.startTime) : null;
        const dateStr = validDate && !isNaN(validDate.getTime()) ? validDate.toLocaleString() : 'Unknown Time';
        
        return [
          s.id || '',
          dateStr,
          s.duration || 0,
          s.type || 'focus',
          s.xpEarned || 0,
          s.strikes !== undefined ? s.strikes : '—',
          s.completed ? "Completed" : "Interrupted",
          // Double-quote the field contents to stop semicolon splits parsing as separate columns
          `"${safeApps.join('; ')}"`
        ];
      });

      const csvContent = [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
      
      // Native desktop disk channel route check
      if (typeof pywebviewBridge !== 'undefined' && (pywebviewBridge as any).saveExportedFile) {
        (pywebviewBridge as any).saveExportedFile(csvContent, "focus_history.csv");
      } else {
        // Fallback sandboxed browser download engine
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `shackle_history_${Date.now()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (error) {
      console.error("CSV synthesis halted unexpectedly:", error);
    }
  };

  const handleClearSessions = async () => {
    if (confirm("Are you sure you want to completely wipe all focus logs from memory? This cannot be undone.")) {
      if (typeof pywebviewBridge !== 'undefined' && pywebviewBridge.clearSessions) {
        try {
          await pywebviewBridge.clearSessions();
          setSessions([]);
          onClearAll(); // Synchronize profile metrics downstream
        } catch (err) {
          console.error("Core clearing routine rejected execution:", err);
        }
      } else {
        // No pywebview bridge available (e.g. running in a plain browser during
        // development) — just clear local component state. No fake sessions are
        // ever generated here; an empty array is the correct "clean" result.
        setSessions([]);
        onClearAll();
      }
    }
  };

  // Filter list securely without throwing on empty structural models
  const filteredSessions = sessions.filter(session => {
    const validDate = session.startTime ? new Date(session.startTime) : null;
    const timeStr = validDate && !isNaN(validDate.getTime()) ? validDate.toLocaleString().toLowerCase() : '';
    const safeApps = session.blacklistedAppsPrevented || [];
    const typeStr = (session.type || '').toLowerCase();
    
    const matchesSearch = safeApps.some(app => app.toLowerCase().includes(searchTerm.toLowerCase()))
      || timeStr.includes(searchTerm.toLowerCase())
      || typeStr.includes(searchTerm.toLowerCase());
    
    if (selectedTypeFilter === 'all') return matchesSearch;
    return matchesSearch && session.type === selectedTypeFilter;
  });

  // Safe dashboard metric summaries calculation routines
  const totalFocusMins = sessions
    .filter(s => s.type === 'focus' && s.completed)
    .reduce((acc, curr) => acc + (curr.duration || 0), 0);
    
  const totalSprints = sessions.filter(s => s.type === 'focus').length;
  
  const totalBlockedInterceptions = sessions.reduce((acc, curr) => {
    const count = Array.isArray(curr.blacklistedAppsPrevented) ? curr.blacklistedAppsPrevented.length : 0;
    return acc + count;
  }, 0);

  return (
    <div className="space-y-6 animate-fade-in w-full max-w-5xl mx-auto py-4">
      
      {/* Title block */}
      <div className="text-center space-y-1">
        <h1 className="text-3xl font-sans uppercase tracking-widest font-bold text-slate-900 dark:text-slate-100">
          UN-SHACKLED SESSIONS
        </h1>
        <p className="text-xs text-slate-400 dark:text-slate-500 font-medium font-sans">
          Detailed archive tracking study discipline, background interceptions, and collected EXP.
        </p>
      </div>

      {/* Summary Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-xl flex items-center gap-3">
          <div className="p-2.5 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-lg">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase tracking-wider font-bold">Focus Injected</p>
            <p className="text-lg font-bold text-slate-900 dark:text-slate-100">{totalFocusMins} Mins</p>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-xl flex items-center gap-3">
          <div className="p-2.5 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-lg">
            <Table className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase tracking-wider font-bold">Total Sprints</p>
            <p className="text-lg font-bold text-slate-900 dark:text-slate-100">{totalSprints} Sessions</p>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-xl flex items-center gap-3">
          <div className="p-2.5 bg-red-50 dark:bg-red-950/30 text-red-650 dark:text-red-400 rounded-lg">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase tracking-wider font-bold">Distraction Blocks</p>
            <p className="text-lg font-bold text-slate-900 dark:text-slate-100">{totalBlockedInterceptions} Intercepts</p>
          </div>
        </div>
      </div>

      {/* Control bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 rounded-xl flex flex-col md:flex-row justify-between items-center gap-3">
        
        {/* Search */}
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400 dark:text-slate-500" />
          <input
            type="text"
            placeholder="Search dates, blocked apps..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-xs text-slate-700 dark:text-slate-350 outline-none focus:border-blue-500 dark:focus:border-blue-500 transition-colors placeholder:text-slate-400"
          />
        </div>

        {/* Filter and Exports */}
        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto justify-end">
          
          <select
            value={selectedTypeFilter}
            onChange={(e) => setSelectedTypeFilter(e.target.value)}
            className="text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-1.5 text-slate-650 dark:text-slate-350 font-semibold cursor-pointer outline-none"
          >
            <option value="all">All Intervals</option>
            <option value="focus">Focus Sprints</option>
            <option value="break">Break Intervals</option>
          </select>

          {sessions.length > 0 && (
            <>
              <button
                onClick={exportToCsv}
                className="text-xs bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-705 rounded-lg px-3 py-1.5 text-slate-700 dark:text-slate-300 font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export CSV</span>
              </button>

              <button
                onClick={handleClearSessions}
                className="text-xs bg-red-50 hover:bg-red-105 text-red-600 dark:bg-red-950/10 dark:text-red-400 dark:hover:bg-red-955/20 border border-red-200 dark:border-red-900/30 rounded-lg px-3 py-1.5 font-bold transition-colors flex items-center gap-1.5 cursor-pointer"
                title="Wipe focus registry logs"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Wipe Logs</span>
              </button>
            </>
          )}

        </div>

      </div>

      {/* Main Table Layout */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto w-full">
          <table className="w-full min-w-[700px] text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-450 font-mono text-[10px] uppercase tracking-wider font-bold">
                <th className="py-3 px-5 font-bold">Date &amp; Time</th>
                <th className="py-3 px-5 font-bold">Type</th>
                <th className="py-3 px-5 font-bold">Duration</th>
                <th className="py-3 px-5 font-bold">Rewards Earned</th>
                <th className="py-3 px-5 font-bold">Strikes</th>
                <th className="py-3 px-5 font-bold">Shield Compliance</th>
                <th className="py-3 px-5 text-right font-bold">Sprint Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredSessions.length > 0 ? (
                filteredSessions.map((session) => {
                  const safeApps = session.blacklistedAppsPrevented || [];
                  const validDate = session.startTime ? new Date(session.startTime) : null;
                  const displayDate = validDate && !isNaN(validDate.getTime()) ? validDate.toLocaleString() : 'Unknown Time';

                  return (
                    <tr key={session.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-805/30 transition-colors text-slate-700 dark:text-slate-300">
                      {/* Column 1: Time */}
                      <td className="py-3.5 px-5 font-semibold text-xs text-slate-800 dark:text-slate-200 flex items-center gap-2">
                        <Calendar className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                        <span>{displayDate}</span>
                      </td>

                      {/* Column 2: Type */}
                      <td className="py-3.5 px-5">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-sans font-bold uppercase ${
                          session.type === 'focus' ? 'bg-blue-50/50 text-blue-800 border-blue-100/40 dark:bg-blue-950/20 dark:text-blue-450 dark:border-blue-900/30' : 'bg-emerald-50 text-emerald-800 border border-emerald-150/40 dark:bg-emerald-950/20 dark:text-emerald-450 dark:border-emerald-900/30'
                        }`}>
                          {session.type || 'focus'}
                        </span>
                      </td>

                      {/* Column 3: Duration */}
                      <td className="py-3.5 px-5 font-mono text-xs font-semibold">
                        {session.duration || 0} mins
                      </td>

                      {/* Column 4: XP */}
                      <td className="py-3.5 px-5 font-mono text-xs font-bold text-blue-600 dark:text-blue-450">
                        +{session.xpEarned || 0} XP
                      </td>

                      {/* Column 5: Strikes */}
                      <td className="py-3.5 px-5 font-mono text-xs font-semibold text-slate-700 dark:text-slate-300">
                        {session.strikes !== undefined ? `${session.strikes}/3` : '—'}
                      </td>

                      {/* Column 5: Compliance */}
                      <td className="py-3.5 px-5 font-sans">
                        {safeApps.length > 0 ? (
                          <div className="flex flex-col gap-1 max-w-xs sm:max-w-sm md:max-w-md">
                            <span className="text-[10px] bg-red-50 dark:bg-red-950/30 text-red-650 dark:text-red-400 px-2 py-0.5 rounded font-bold w-fit">
                              Block triggered x{safeApps.length}
                            </span>
                            <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 break-words line-clamp-2" title={safeApps.join(', ')}>
                              Blocked: {safeApps.join(', ')}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400 dark:text-slate-500 font-light italic">
                            Perfect (no distractions)
                      </span>
                        )}
                      </td>

                      {/* Column 6: Status */}
                      <td className="py-3.5 px-5 text-right">
                        {session.completed ? (
                          <span className="inline-flex items-center gap-1.5 text-[10px] text-emerald-600 dark:text-emerald-400 font-bold bg-emerald-50 dark:bg-emerald-950/25 border border-emerald-100 dark:border-emerald-900/30 px-2.5 py-0.5 rounded-full uppercase">
                            <CheckCircle className="w-3 h-3" />
                            <span>Fully Done</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-[10px] text-amber-600 dark:text-amber-400 font-bold bg-amber-50 dark:bg-amber-950/25 border border-amber-100 dark:border-amber-900/30 px-2.5 py-0.5 rounded-full uppercase">
                            <XCircle className="w-3 h-3" />
                            <span>Interrupted</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} className="text-center py-12">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                        <Clock className="w-8 h-8 text-slate-400" />
                      </div>
                      <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                        No focus sessions recorded yet
                      </p>
                      <p className="text-xs text-slate-400 dark:text-slate-500">
                        Start your first Shackle session to track your progress
                      </p>
                      <button
                        onClick={() => window.dispatchEvent(new CustomEvent('navigate', { detail: "Let's Shackle" }))}
                        className="mt-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold uppercase rounded-lg transition-colors cursor-pointer"
                      >
                        Begin Your First Session
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}