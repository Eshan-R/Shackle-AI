"""
break_manager.py — Shackle AI
Tracks biological break durations and gates absence violations
behind a configurable grace window. Feeds into the orchestration loop.
"""
import time
import threading
from typing import Dict, Any


class BreakManager:
    def __init__(self, grace_seconds: dict = None):
        self._lock = threading.Lock()
        self.grace_seconds = grace_seconds or {
            "absent": 450,          # 7.5 minutes
            "abandoned": 450,       # 7.5 minutes
            "distracted": 90,       # 1.5 minutes
            "dark_room": 30,
            "reading_paused": 180,
            "looking_away": 60,     # 1 minute
        }
        self.absence_start     = None
        self.is_absent         = False
        self.active_violation_type = None

    def set_grace(self, violation_type: str, seconds: float):
        """Thread-safe setter for grace seconds window."""
        with self._lock:
            self.grace_seconds[violation_type] = seconds

    # ── Called by the orchestration loop each tick ──────────

    def register_presence(self):
        """User is back in frame. Fully resets the absence window."""
        self.reset()

    def register_absence(self, violation_type: str) -> Dict[str, Any]:
        """
        User has left the frame or entered a vision violation state.
        Starts the grace timer on first call or when violation type changes,
        then checks it on subsequent calls.

        Returns a status dict.
        """
        now = time.time()
        with self._lock:
            if not self.is_absent or self.active_violation_type != violation_type:
                self.is_absent     = True
                self.absence_start = now
                self.active_violation_type = violation_type

            max_seconds = self.grace_seconds.get(self.active_violation_type, 300)
            elapsed   = now - self.absence_start
            remaining = max(0.0, max_seconds - elapsed)

            if elapsed > max_seconds:
                return {
                    "violation":         True,
                    "elapsed_seconds":   int(elapsed),
                    "remaining_seconds": 0,
                    "active_violation_type": self.active_violation_type,
                    "message": (
                        f"{self.active_violation_type.replace('_', ' ').capitalize()} limit exceeded. "
                        "Strike incoming."
                    )
                }

            return {
                "violation":         False,
                "elapsed_seconds":   int(elapsed),
                "remaining_seconds": int(remaining),
                "active_violation_type": self.active_violation_type,
                "message": (
                    f"{self.active_violation_type.replace('_', ' ').capitalize()} in progress — {int(remaining)}s remaining in grace window."
                )
            }

    # ── Inspection (non-advancing) ──────────────────────────

    def get_status(self) -> Dict[str, Any]:
        """
        Snapshot of current break state without advancing the timer.
        Safe to call as many times as needed.
        """
        with self._lock:
            if not self.is_absent:
                return {"is_absent": False, "elapsed_seconds": 0, "violation": False}

            elapsed = time.time() - self.absence_start
            max_seconds = self.grace_seconds.get(self.active_violation_type, 300)
            return {
                "is_absent":       True,
                "elapsed_seconds": int(elapsed),
                "violation":       elapsed > max_seconds,
                "active_violation_type": self.active_violation_type,
                "remaining_seconds": max(0, int(max_seconds - elapsed))
            }

    def reset(self):
        """Hard reset — called when a session starts or ends, or user returns to frame."""
        with self._lock:
            self.is_absent     = False
            self.absence_start = None
            self.active_violation_type = None