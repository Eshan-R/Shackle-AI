from dotenv import load_dotenv
load_dotenv()  # MUST be first — main.py reads GOOGLE_CLIENT_ID etc. at import time

import sys
import os
import threading
import time
import json
import webbrowser
import requests
from pathlib import Path
import webview
from daemon import ShackleDaemon

def save_profile_backup(profile_data: dict):
    try:
        docs = Path.home() / "Documents" / "ShackleAI"
        docs.mkdir(parents=True, exist_ok=True)
        with open(docs / "profile_backup.json", "w") as f:
            json.dump(profile_data, f, indent=2)
        print(f"[SYSTEM] Profile backup successfully saved to {docs / 'profile_backup.json'}")
    except Exception as e:
        print(f"[ERROR] Failed saving profile backup: {e}")

def load_profile_backup():
    try:
        path = Path.home() / "Documents" / "ShackleAI" / "profile_backup.json"
        if path.exists():
            with open(path) as f:
                data = json.load(f)
                print(f"[SYSTEM] Profile backup successfully restored from {path}")
                return data
    except Exception as e:
        print(f"[ERROR] Failed loading profile backup: {e}")
    return None

class ExternalLinkHandler:
    def open_external_link(self, url: str) -> None:
        """Open the supplied URL in the user's default external browser."""
        webbrowser.open(url)

# ----------------------------------------------------------------------
# Existing globals & helper functions
# ----------------------------------------------------------------------
daemon_instance = None
backend_thread = None
shutdown_event = threading.Event()
backend_ready = threading.Event()

def start_backend_server():
    """Start the FastAPI backend server using uvicorn in a thread."""
    try:
        # ── Path resolution ──────────────────────────────────────────────
        # In a PyInstaller bundle, all bundled files land in sys._MEIPASS.
        # The spec copies the backend/ tree as 'backend', so it ends up at
        #   _MEIPASS/backend/
        # We must add _MEIPASS (the *parent* of backend/) to sys.path so
        # that `from backend.main import ...` resolves correctly.
        #
        # In dev mode, app.py sits at  <root>/desktop/app.py  and
        # backend/ sits at  <root>/backend/  — so we walk up to find it.

        if hasattr(sys, '_MEIPASS'):
            # PyInstaller bundle: backend is right inside _MEIPASS
            desktop_path = os.path.join(sys._MEIPASS, 'desktop')
            if desktop_path not in sys.path:
                sys.path.insert(0, desktop_path)
            backend_parent = sys._MEIPASS
            backend_dir = os.path.join(sys._MEIPASS, 'backend')
        else:
            # Dev mode: walk up from app.py's directory to find backend/
            app_dir = os.path.dirname(os.path.abspath(__file__))
            # Try sibling of app.py first (e.g. desktop/backend/ — shouldn't exist but safe)
            candidate = os.path.join(app_dir, 'backend')
            if not os.path.isdir(candidate):
                # Try one level up (project root/backend/)
                candidate = os.path.join(app_dir, '..', 'backend')
            backend_dir = os.path.normpath(candidate)
            backend_parent = os.path.dirname(backend_dir)

        if not os.path.isdir(backend_dir):
            print(f"[WARNING] Backend directory not found at {backend_dir}")
            return

        # Add backend_parent for `from backend.main import ...`
        if backend_parent not in sys.path:
            sys.path.insert(0, backend_parent)

        # Add backend_dir directly for internal imports like `import firebase_config`
        if backend_dir not in sys.path:
            sys.path.insert(0, backend_dir)

        print(f"[SYSTEM] Starting backend server from {backend_dir}")

        import uvicorn
        from backend.main import app

        config = uvicorn.Config(
            app,
            host="0.0.0.0",
            port=8080,
            log_level="warning",
            access_log=False
        )
        server = uvicorn.Server(config)

        def run_server():
            try:
                server.run()
            except Exception as e:
                print(f"[ERROR] Backend server error: {e}")
            finally:
                backend_ready.clear()

        global backend_thread
        backend_thread = threading.Thread(target=run_server, daemon=True)
        backend_thread.start()

        print("[SYSTEM] Backend server thread initialized on http://127.0.0.1:8080")
    except Exception as e:
        print(f"[ERROR] Failed to start backend server: {e}")



def get_resource_path(relative_path: str) -> str:
    """Get absolute path to resource, works for local dev and inside PyInstaller."""
    if hasattr(sys, '_MEIPASS'):
        return os.path.join(sys._MEIPASS, relative_path)
    return os.path.join(os.path.abspath("."), relative_path)


def cleanup():
    """Cleanup function to be called on exit."""
    print("\n[SYSTEM] Cleaning up resources...")
    if daemon_instance:
        daemon_instance.shutdown()


def wait_for_backend(url: str = "http://127.0.0.1:8080/api/status", retries: int = 40, delay: float = 0.1):
    """Polls backend health check endpoint until ready or timeout."""
    for i in range(retries):
        try:
            r = requests.get(url, timeout=0.5)
            if r.status_code == 200:
                print(f"[SYSTEM] Backend ready after {i * delay:.2f}s")
                return
        except Exception:
            pass
        time.sleep(delay)
    print("[WARNING] Backend health check timed out — continuing anyway.")

def main():
    global daemon_instance
    startup_start_time = time.time()
    import atexit
    atexit.register(cleanup)

    # 1. Start backend server
    start_backend_server()
    wait_for_backend()

    # 2. Import and Instantiate the OAuth Handshake Bridge from main.py
    # (Must happen after start_backend_server to ensure sys.path resolution is set)
    from backend.main import DesktopBridgeAPI
    oauth_bridge = DesktopBridgeAPI()

    # 3. Instantiate Daemon synchronously on Main Thread (Fixes the Race Condition)
    user_id = "local_developer"
    # session_id is intentionally left empty — it will only be set by the backend
    # /v1/session/start after the user authenticates via Firebase.
    backend_api = "http://127.0.0.1:8080"

    print("[SYSTEM] Pre-booting biometric and system processing engines...")
    shutdown_event.clear()
    daemon_instance = ShackleDaemon(
        session_id="",       # Empty: no local fallback IDs
        user_id=user_id,
        api_url=backend_api,
        stop_event=shutdown_event
    )

    # 4. Offload the blocking loop to your background thread execution space
    daemon_thread = threading.Thread(
        target=daemon_instance.run,
        daemon=True
    )
    daemon_thread.start()

    # 5. Spin up the window framework layers
    ui_url = "http://127.0.0.1:8080"
    print(f"[SYSTEM] Initializing edge desktop window wrapper layers (elapsed: {time.time() - startup_start_time:.2f}s)...")
    window = webview.create_window(
        title='Shackle AI',
        url=ui_url,
        width=1280,
        height=800,
        resizable=True,
        background_color='#0B0B0C'
    )

    # Inject the window reference into the daemon module so stream_audio_discipline
    # can call evaluate_js to trigger the roast audio overlay in the React frontend.
    import daemon as daemon_module
    daemon_module._webview_window = window

    # 6. Safely expose methods down to the React frontend execution window context
    window.expose(daemon_instance.set_session_active)
    window.expose(daemon_instance.get_daemon_status)
    window.expose(daemon_instance.set_book_mode)

    # OS-level app locking/unlocking (core shackle mechanic)
    window.expose(daemon_instance.lock_apps)
    window.expose(daemon_instance.unlock_apps)
    window.expose(daemon_instance.get_available_apps)
    window.expose(daemon_instance.get_active_session_id)

    # Blacklist management (add/remove from live OSLocker kill list)
    window.expose(daemon_instance.add_to_blacklist)
    window.expose(daemon_instance.remove_from_blacklist)

    # CRITICAL: Exposes window.pywebview.api.start_google_oauth() matching firebase.ts expectations
    window.expose(oauth_bridge.start_google_oauth)

    # Filesystem backup bridge methods
    window.expose(save_profile_backup)
    window.expose(load_profile_backup)

    # 7. Pass the explicit handler method rather than the class object instance
    external_link_handler = ExternalLinkHandler()
    window.expose(external_link_handler.open_external_link)

    # Configure persistent WebView2 user data folder so Firebase Auth (IndexedDB/localStorage)
    # and session credentials persist across app restarts instead of running in a temporary incognito profile.
    storage_dir = os.path.join(
        os.environ.get('APPDATA', os.path.expanduser('~')),
        'ShackleAI',
        'webview_data'
    )
    os.makedirs(storage_dir, exist_ok=True)

    # Disable background timer throttling for background telemetry and timer loops
    existing_args = os.environ.get('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS', '')
    throttle_flags = '--disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding'
    if throttle_flags not in existing_args:
        os.environ['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'] = f"{existing_args} {throttle_flags}".strip()

    webview.start(debug=False, private_mode=False, storage_path=storage_dir)

    print("\n[SYSTEM] Desktop window close intercepted. Initiating safe teardown...")
    shutdown_event.set()
    daemon_thread.join(timeout=8.0)
    if daemon_thread.is_alive():
        print("[WARNING] Daemon thread did not exit within 8.0s timeout — resources may not be fully released.")
    print("[SYSTEM] Core processes successfully unlinked. Process exiting.")


if __name__ == '__main__':
    import multiprocessing
    multiprocessing.freeze_support()
    main()