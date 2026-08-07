"""
os_locker.py — Shackle AI
Provides two-stage OS-level enforcement:
  1. scan_for_violations() — non-destructive detection (called every tick)
  2. execute_purge()       — process kill (called only on Strike 2+)
"""
import psutil
import logging
from typing import List, Dict, Any

logger = logging.getLogger(__name__)


class OSLocker:
    def __init__(self, custom_blacklist: List[str] = None):
        # chrome.exe intentionally excluded from the default list —
        # killing it nukes all open tabs. Add manually if you're sure.
        self.blacklist: List[str] = custom_blacklist or [
            "Discord.exe",
            "Spotify.exe",
            "EpicGamesLauncher.exe",
            "steam.exe",
            "Netflix.exe",
            "TikTok.exe",
        ]

    def _blacklist_lower_set(self) -> set:
        """Returns a lowercase set of current blacklist entries for case-insensitive lookup."""
        return {b.lower() for b in self.blacklist}

    # ── Stage 1: Non-destructive scan ──────────────────────

    def scan_for_violations(self) -> List[str]:
        """
        Scans running processes and returns a deduplicated list of
        any blacklisted executable names that are currently active.
        Does NOT kill anything — safe to call every few seconds.
        """
        blacklist_lower = self._blacklist_lower_set()
        running_violations: List[str] = []
        try:
            for proc in psutil.process_iter(["name"]):
                name = proc.info.get("name", "")
                if name.lower() in blacklist_lower:
                    running_violations.append(name)
        except Exception:
            pass
        return list(set(running_violations))

    def is_running(self, process_name: str) -> bool:
        """Quick check for a single process name."""
        target = process_name.lower()
        try:
            for proc in psutil.process_iter(["name"]):
                if (proc.info.get("name") or "").lower() == target:
                    return True
        except Exception:
            pass
        return False

    # ── Stage 2: Strike 2+ termination ─────────────────────

    def execute_purge(self) -> Dict[str, Any]:
        """
        Hunts down and terminates all blacklisted processes.
        Should only be called on Strike 2 or higher.
        Returns a report dict for logging.
        """
        logger.info("💀 INITIATING OS-LEVEL PROCESS PURGE")
        blacklist_lower = self._blacklist_lower_set()
        terminated: List[str] = []
        access_denied: List[str] = []

        for proc in psutil.process_iter(["pid", "name"]):
            try:
                name = proc.info.get("name", "")
                if name.lower() in blacklist_lower:
                    proc.kill()
                    terminated.append(name)
                    logger.info(f"Terminated: {name} (PID {proc.info['pid']})")
            except psutil.AccessDenied:
                access_denied.append(name)
                logger.warning(
                    f"Access denied for {name}. "
                    "Run Shackle AI as Administrator to enforce this process."
                )
            except (psutil.NoSuchProcess, psutil.ZombieProcess):
                pass  # Already gone — no action needed

        report = {
            "terminated":    terminated,
            "access_denied": access_denied,
            "total_killed":  len(terminated)
        }
        logger.info(f"Purge complete. Killed: {len(terminated)} | Denied: {len(access_denied)}")
        return report

    # ── Blacklist management ────────────────────────────────

    def add_to_blacklist(self, process_name: str):
        """Adds a process name to the kill list at runtime."""
        if process_name not in self.blacklist:
            self.blacklist.append(process_name)
            logger.info(f"Added to blacklist: {process_name}")
            print(f"[OSLocker CURRENT BLACKLIST]: {self.blacklist}")

    def remove_from_blacklist(self, process_name: str):
        """Removes a process name from the kill list at runtime."""
        if process_name in self.blacklist:
            self.blacklist.remove(process_name)
            logger.info(f"Removed from blacklist: {process_name}")
            print(f"[OSLocker CURRENT BLACKLIST]: {self.blacklist}")