import os
import json
import time
import threading
import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud.firestore_v1.base_query import FieldFilter
from typing import Dict, List, Optional
from dotenv import load_dotenv
load_dotenv()  # Safety net: ensures .env is loaded if this module is ever run standalone

class ShackleDatabaseManager:
    def __init__(self):
        self.db = None
        self.fallback_mode = False
        self._session_lock = threading.Lock()
        
        # Local cache memory to guarantee zero-downtime execution during offline development
        self._local_users: Dict[str, dict] = {
            "local_developer": {
                "tier": "premium", 
                "voice_id": None, 
                "streak": 0,
                "penalty_phase": 0,          
                "penalty_expires_at": 0.0,   
                "probation_strikes": 0
            }
        }
        self._local_sessions: Dict[str, dict] = {}
        self._local_frauds: List[dict] = []

        self._initialize_firebase()

    def _initialize_firebase(self):
        """Looks for explicit credentials path or raw environment string to boot Google Cloud Client."""
        # Resolve relative to this file's directory so the path is correct regardless
        # of where Python is invoked from (project root, _MEIPASS bundle, etc.)
        _this_dir = os.path.dirname(os.path.abspath(__file__))
        cred_path = os.path.join(_this_dir, "config", "firebase-service-account.json")
        raw_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT_RAW")

        try:
            if not firebase_admin._apps:
                if os.path.exists(cred_path):
                    cred = credentials.Certificate(cred_path)
                    firebase_admin.initialize_app(cred)
                    print("[DATABASE] Firebase Core connected via local service account key file.")
                elif raw_json:
                    cred_dict = json.loads(raw_json)
                    cred = credentials.Certificate(cred_dict)
                    firebase_admin.initialize_app(cred)
                    print("[DATABASE] Firebase Core successfully instantiated from runtime environment string.")
                else:
                    self.fallback_mode = True
                    print("[WARNING] No Firebase credentials located. Operating in transient Local Cache Mode.")
                    return
            else:
                firebase_admin.get_app()
                print("[DATABASE] Firebase Core retrieved existing default app instance.")

            self.db = firestore.client()
        except Exception as e:
            self.fallback_mode = True
            print(f"[ERROR] Connection gateway rejected credentials: {e}. Defaulting to Local Cache.")

    # =====================================================================
    # 👤 USER PROFILE LIFECYCLE MANAGEMENT
    # =====================================================================
    def _check_trial_expiry(self, profile: dict) -> bool:
        if not isinstance(profile, dict):
            return False

        billing = profile.get("billing_lifecycle")
        if not isinstance(billing, dict):
            return False

        if billing.get("status_code") != "TRIAL_ACTIVE":
            return False

        created_at = profile.get("createdAt")
        if created_at is None:
            profile["createdAt"] = time.time()
            return True

        now = time.time()
        try:
            created_at_sec = float(created_at) / 1000.0 if float(created_at) > 1e11 else float(created_at)
        except (ValueError, TypeError):
            profile["createdAt"] = now
            return True

        elapsed_seconds = max(0.0, now - created_at_sec)
        elapsed_days = elapsed_seconds / 86400.0

        if elapsed_days >= 7.0:
            profile["billing_lifecycle"] = {
                "access_granted": False,
                "status_code": "TRIAL_EXPIRED",
                "days_remaining_in_trial": 0
            }
            return True
        else:
            remaining_days = max(0, int(7.0 - elapsed_days))
            billing["days_remaining_in_trial"] = remaining_days
            profile["billing_lifecycle"] = billing
            return True

    def get_user(self, user_id: str) -> Optional[dict]:
        if self.fallback_mode:
            profile = self._local_users.get(user_id)
        else:
            try:
                doc_ref = self.db.collection("users").document(user_id).get()
                profile = doc_ref.to_dict() if doc_ref.exists else None
            except Exception as e:
                print(f"[DB_ERR] Failed reading user map @{user_id}: {e}")
                profile = self._local_users.get(user_id)

        if profile and self._check_trial_expiry(profile):
            self.set_user(user_id, profile)

        return profile

    def set_user(self, user_id: str, profile_data: dict) -> bool:
        if self.fallback_mode:
            self._local_users[user_id] = profile_data
            return True
        
        try:
            self.db.collection("users").document(user_id).set(profile_data, merge=True)
            return True
        except Exception as e:
            print(f"[DB_ERR] Failed updating structural map for @{user_id}: {e}")
            self._local_users[user_id] = profile_data
            return False

    # =====================================================================
    # ⚡ ACTIVE FOCUS SESSION LOGIC
    # =====================================================================
    def set_session(self, user_id: str, session_id: str, session_data: dict) -> bool:
        if self.fallback_mode:
            self._local_sessions[session_id] = session_data
            return True
        try:
            doc_ref = self.db.collection("users").document(user_id).collection("sessions").document(session_id)
            doc_ref.set(session_data, merge=True)
            return True
        except Exception as e:
            print(f"[DB_ERR] Active telemetry trace upload failed for vector {session_id}: {e}")
            self._local_sessions[session_id] = session_data
            return False

    def get_session(self, user_id: str, session_id: str) -> Optional[dict]:
        if self.fallback_mode:
            return self._local_sessions.get(session_id)
        try:
            doc_ref = self.db.collection("users").document(user_id).collection("sessions").document(session_id).get()
            return doc_ref.to_dict() if doc_ref.exists else None
        except Exception as e:
            print(f"[DB_ERR] Session fetch dropped for tracking vector {session_id}: {e}")
            return self._local_sessions.get(session_id)

    def try_claim_session_completion(self, user_id: str, session_id: str) -> bool:
        """
        Atomically checks and marks a session as completed to guarantee idempotency.
        Returns True if this caller successfully claimed the completion, or False if
        already marked completed by a concurrent or previous request.
        """
        if self.fallback_mode or self.db is None:
            with self._session_lock:
                sess = self._local_sessions.get(session_id)
                if sess and sess.get("status") == "completed":
                    return False
                if not sess:
                    self._local_sessions[session_id] = {"status": "completed"}
                else:
                    sess["status"] = "completed"
                return True

        try:
            doc_ref = self.db.collection("users").document(user_id).collection("sessions").document(session_id)
            transaction = self.db.transaction()

            @firestore.transactional
            def _claim_tx(tx):
                snapshot = doc_ref.get(transaction=tx)
                if snapshot.exists:
                    data = snapshot.to_dict() or {}
                    if data.get("status") == "completed":
                        return False
                    tx.update(doc_ref, {"status": "completed"})
                    return True
                else:
                    tx.set(doc_ref, {"status": "completed"}, merge=True)
                    return True

            claimed = _claim_tx(transaction)
            if claimed and session_id in self._local_sessions:
                self._local_sessions[session_id]["status"] = "completed"
            return claimed
        except Exception as e:
            print(f"[DB_ERR] Transactional claim failed for vector {session_id}: {e}")
            with self._session_lock:
                sess = self._local_sessions.get(session_id)
                if sess and sess.get("status") == "completed":
                    return False
                if not sess:
                    self._local_sessions[session_id] = {"status": "completed"}
                else:
                    sess["status"] = "completed"
                return True

    # =====================================================================
    # 🚨 GLOBAL "HALL OF FRAUDS" & REAL-TIME LEAGUE SYSTEM
    # =====================================================================
    def log_infraction_event(self, fraud_record: dict) -> bool:
        if self.fallback_mode:
            self._local_frauds.append(fraud_record)
            return True
        
        try:
            self.db.collection("global_shame").add(fraud_record)
            return True
        except Exception as e:
            print(f"[DB_ERR] Appending shard element to global shame array dropped: {e}")
            self._local_frauds.append(fraud_record)
            return False

    def get_all_frauds(self) -> List[dict]:
        if self.fallback_mode:
            return self._local_frauds
        
        try:
            docs = self.db.collection("global_shame").order_by("timestamp", direction=firestore.Query.DESCENDING).limit(50).stream()
            return [doc.to_dict() for doc in docs]
        except Exception as e:
            print(f"[DB_ERR] Extraction query on global_shame collection aborted: {e}")
            return self._local_frauds

    def _parse_strikes(self, strikes_val) -> int:
        if not strikes_val or str(strikes_val).lower() == "none":
            return 0
        import re
        match = re.search(r'(\d+)', str(strikes_val))
        return int(match.group(1)) if match else 0

    def get_league_leaderboard(self, league_tier: str = "Bronze") -> List[dict]:
            """
            Fetches enriched standings for a specific Duolingo-style tier (e.g., Bronze, Gold, Obsidian).
            Returns profile pictures, display names, usernames, XP, streaks, and active strikes.
            """
            if self.fallback_mode:
                # Filter mock local users by tier if specified, or return sorted list
                standings = []
                for username, data in self._local_users.items():
                    standings.append({
                        "username": username,
                        "display_name": data.get("display_name", username.replace("_", " ").title()),
                        "avatar_url": data.get("avatar_url", ""),
                        "xp": data.get("xp", 1000),
                        "streak": data.get("streak", 0),
                        "strikes": self._parse_strikes(data.get("strikes", "None")),
                        "league": data.get("league", "Bronze")
                    })
                # Sort descending by XP (Duolingo style rankings are based on weekly XP accumulation)
                return sorted(standings, key=lambda x: x.get("xp", 0), reverse=True)
            
            try:
                # Queries users belonging to the specific competitive tier
                query = self.db.collection("users").where(
                    filter=FieldFilter("league", "==", league_tier)
                ).order_by("xp", direction=firestore.Query.DESCENDING).limit(100)
                
                standings = []
                for doc in query.stream():
                    data = doc.to_dict()
                    standings.append({
                        "username": doc.id,
                        "display_name": data.get("display_name", doc.id),
                        "avatar_url": data.get("avatar_url", ""),
                        "xp": data.get("xp", 0),
                        "streak": data.get("streak", 0),
                        "strikes": self._parse_strikes(data.get("strikes", "None")),
                    })
                return standings
            except Exception as e:
                print(f"[DB_ERR] Failed to pull enriched league leaderboard for tier {league_tier}: {e}")
                return []

ShackleDB = ShackleDatabaseManager()