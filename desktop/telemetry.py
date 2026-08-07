import time
import threading
from collections import deque
from pynput import keyboard, mouse
from typing import Dict, Any

class TelemetryEngine:
    def __init__(self):
        """
        Initializes the privacy-first input tracking engine.
        We use rolling deques to keep track of event timestamps
        over the last 60 seconds.
        ABSOLUTELY NO KEY CHARACTERS ARE STORED.
        """
        self.keystroke_timestamps = deque(maxlen=1000)
        self.mouse_timestamps = deque(maxlen=1000)

        self.last_key_time = time.time()
        self.last_snapshot_time = time.time()
        self.rapid_fire_count = 0.0
        self.is_running = True

        self.lock = threading.Lock()

        # Background decay thread for continuous linear spoof-counter decay
        self._decay_thread = threading.Thread(target=self._decay_loop, daemon=True)
        self._decay_thread.start()

        try:
            self.keyboard_listener = keyboard.Listener(on_press=self._on_key_press)
            self.mouse_listener = mouse.Listener(on_click=self._on_mouse_click, on_scroll=self._on_mouse_scroll)
            self.keyboard_listener.start()
            self.mouse_listener.start()
            print("[SYSTEM] Telemetry low-level OS hooks bound successfully.")
        except Exception as e:
            print(f"[SYSTEM WARNING] Input telemetry hooks failed to bind: {e}")
            print("Ensure your operating system has granted input monitoring accessibility options.")

    def _decay_loop(self):
        """Smoothly decays the rapid fire count every 1 second independently of snapshot calls."""
        while self.is_running:
            time.sleep(1.0)
            with self.lock:
                self.rapid_fire_count = max(0.0, self.rapid_fire_count - 15.0)

    def _on_key_press(self, key):
        """Fires whenever a key is pressed. Extremely lightweight to prevent OS queue lag."""
        current_time = time.time()
        with self.lock:
            time_delta = current_time - self.last_key_time
            if time_delta < 0.05:
                self.rapid_fire_count += 1.0
            
            self.keystroke_timestamps.append(current_time)
            self.last_key_time = current_time

    def _on_mouse_click(self, x, y, button, pressed):
        """Logs mouse clicks safely to factor into Actions Per Minute (APM)."""
        if pressed:
            current_time = time.time()
            with self.lock:
                self.mouse_timestamps.append(current_time)

    def _on_mouse_scroll(self, x, y, dx, dy):
        """Logs scrolling behavior as active engagement."""
        current_time = time.time()
        with self.lock:
            self.mouse_timestamps.append(current_time)

    def _clean_old_events(self, current_time: float):
        """Removes timestamps older than 60 seconds. Called out-of-band from callbacks."""
        cutoff_time = current_time - 60.0

        # Clean keystrokes
        while self.keystroke_timestamps and self.keystroke_timestamps[0] < cutoff_time:
            self.keystroke_timestamps.popleft()

        # Clean mouse events
        while self.mouse_timestamps and self.mouse_timestamps[0] < cutoff_time:
            self.mouse_timestamps.popleft()

    def get_telemetry_snapshot(self) -> Dict[str, Any]:
        """
        Compiles current input dynamics to determine if the user is actively working,
        abandoning their desk, or trying to spoof the system.
        """
        current_time = time.time()

        with self.lock:
            # Clean old events inside lock block wrapper
            self._clean_old_events(current_time)

            kpm = len(self.keystroke_timestamps)
            cpm = len(self.mouse_timestamps)
            total_apm = kpm + cpm
            spoof_risk = self.rapid_fire_count

        # 1. Input Spoofing Detection Matrix
        if spoof_risk > 50:
            return {
                "status": "spoofing_detected",
                "kpm": kpm,
                "apm": total_apm,
                "message": "Unnatural input rhythm detected. Stop holding down a single key."
            }
        
        # 2. Genuine Deep Work State
        if total_apm > 15:
            return {
                "status": "active",
                "kpm": kpm,
                "apm": total_apm,
                "message": "Optimal input velocity. Deep work verified."
            }
        
        # 3. Micro-Pause / Reading Context
        if 0 < total_apm <= 15:
            return {
                "status": "reading",
                "kpm": kpm,
                "apm": total_apm,
                "message": "Low input rate. Verifying presence via vision engine or active window."
            }
        
        # 4. Absolute zero idle context
        return {
            "status": "idle",
            "kpm": kpm,
            "apm": total_apm,
            "message": "Zero keyboard or mouse input detected in the last 60 seconds."
        }
    
    def shutdown(self):
        """Safely terminates the background listening threads without hanging."""
        self.is_running = False
        try:
            if hasattr(self, 'keyboard_listener') and self.keyboard_listener.running:
                self.keyboard_listener.stop()
            if hasattr(self, 'mouse_listener') and self.mouse_listener.running:
                self.mouse_listener.stop()
            print("[SYSTEM] Telemetry engine loops unhooked cleanly.")
        except Exception as e:
            print(f"[WARNING] Error during telemetry shutdown: {e}")


if __name__ == "__main__":
    print("Starting Shackle AI Telemetry Tracker (Privacy-Safe Mode)...")
    telemetry = TelemetryEngine()

    try:
        while True:
            time.sleep(5)
            snapshot = telemetry.get_telemetry_snapshot()
            print(
                f"[{time.strftime('%H:%M:%S')}] State: {snapshot['status'].upper()} | "
                f"KPM: {snapshot.get('kpm', 0)} | APM: {snapshot.get('apm', 0)} | "
                f"Spoof Counter: {telemetry.rapid_fire_count:.1f} | "
                f"Msg: {snapshot['message']}"
            )

    except KeyboardInterrupt:
        telemetry.shutdown()
        print("\nTelemetry engine safely shut down.")