# Shackle AI

**An uncompromising, AI-enforced focus and productivity system.**

Shackle AI is a desktop focus-enforcement app that combines webcam-based attention tracking, input telemetry, OS-level app locking, and an LLM-powered "disciplinary" persona to keep users on task — with gamified streaks, leagues, and premium voice-cloned roasts for repeat offenders.

---

## How it works

1. **You start a focus session** from the desktop app (React/TypeScript UI running in a pywebview shell).
2. **`daemon.py`** runs a background enforcement loop that polls three signal sources every few seconds:
   - **`vision.py`** — MediaPipe-based webcam tracking (face presence, gaze direction, head pose, phone-near-face detection, giggle/laughter detection) via a threaded camera capture pipeline.
   - **`telemetry.py`** — privacy-safe keyboard/mouse activity tracking (timestamps only, no keystrokes logged) to compute actions-per-minute and detect input spoofing.
   - **`utils/os_locker.py`** — scans and, on repeated violations, kills blacklisted processes (Discord, Steam, Netflix, TikTok, etc.).
3. Violations are graded through **`utils/break_manager.py`**, which enforces per-violation-type grace windows (absence, distraction, dark room, looking away) before escalating to a strike.
4. Strikes are reported to the **FastAPI backend** (`backend/main.py`), which tracks per-user strike counts, penalty phases (lockdown → probation → freedom), streaks, and XP, and can generate a sarcastic AI "roast" via Gemini + ElevenLabs/gTTS voice synthesis.
5. Progress, leagues, and profiles sync through **Firebase/Firestore** (`backend/firebase_config.py`, `desktop/src/utils/firebase.ts`), with Razorpay handling premium subscription billing.

---

## Project structure

```
.
├── desktop/                      # Electron/pywebview desktop client
│   ├── app.py                    # pywebview bootstrap + JS↔Python bridge, OAuth loopback
│   ├── daemon.py                 # Core enforcement loop: strikes, cooldowns, audio playback
│   ├── telemetry.py              # Keyboard/mouse activity engine (privacy-safe)
│   ├── vision.py                 # MediaPipe webcam tracking engine
│   ├── utils/
│   │   ├── break_manager.py      # Grace-period / violation-escalation logic
│   │   └── os_locker.py          # Blacklisted-process scan + purge
│   └── src/                      # React + TypeScript frontend (Vite)
│       ├── App.tsx
│       ├── components/           # AuthView, DashboardView, LetsShackleView, Navigation,
│       │                         # ProfileView, SettingsView, ShackleLeaguesView,
│       │                         # UnshackledSessionsView
│       ├── utils/                # firebase.ts, focusSessionAlgorithm.ts, levelUtils.ts,
│       │                         # lockdownService.ts, profileHelpers.ts,
│       │                         # pywebviewBridge.ts, strikeHelpers.ts
│       ├── index.css
│       ├── main.tsx
│       └── types.ts
│
└── backend/                      # FastAPI cloud/local API server
    ├── main.py                   # REST API: sessions, strikes, billing, roasts, auth
    ├── firebase_config.py        # Firestore data access layer (ShackleDB)
    ├── services/
    │   ├── gemini_agent.py       # Gemini-powered roast/report/audit generation
    │   └── calendar_mesh.py      # Calendar integration service
    └── static/                   # Public pages: checkout, dashboard, downloads,
                                   # hall_of_frauds, privacy-policy, refund-policy,
                                   # roadmap, terms
```

---

## Core features

- **Webcam attention tracking** — face/pose presence, gaze-away detection, head yaw/pitch thresholds, phone-in-hand/near-face detection, giggle detection, and a distinct low-threshold "Book Mode" for reading sessions.
- **Input telemetry** — APM-based activity classification (active / reading / idle / spoofing-detected) without ever storing keystroke content.
- **OS-level enforcement** — non-destructive scanning every tick, with process termination gated behind Strike 2+.
- **Strike & penalty system** — 3-strike sessions escalate into a Phase 1 lockdown (72h) → Phase 2 probation (7 days, stricter streak requirements) → restored freedom.
- **Gamification** — XP, levels, daily streaks, Bronze/Silver/Gold leagues, and a public "Hall of Frauds" shame wall.
- **AI-generated discipline** — Gemini-authored roasts delivered via ElevenLabs voice cloning (premium tier) or gTTS fallback, with prompt-injection sanitization on all user-supplied text.
- **Billing** — Razorpay checkout with multi-currency support and signature-verified webhooks for premium upgrades.

---

## Getting started

### Prerequisites
- Python 3.10+
- Node.js 18+
- A webcam-capable machine (Windows recommended — `os_locker.py` and app-locking targets `.exe` process names)

### Backend setup
```bash
cd backend
pip install -r requirements.txt   # fastapi, uvicorn, firebase-admin, gtts, elevenlabs, razorpay, httpx, python-dotenv, pydantic
uvicorn main:app --reload --port 8080
```

### Desktop app setup
```bash
cd desktop
npm install
npm run dev      # frontend dev server
python app.py    # pywebview shell + daemon
```

### Environment variables (`.env` at project root)
| Variable | Purpose |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth desktop loopback flow |
| `LOOPBACK_REDIRECT_URI` | OAuth callback URI (defaults to `http://0.0.0.0:8080/v1/auth/callback`) |
| `ELEVENLABS_API_KEY` | Premium voice-cloned roast synthesis |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Billing/checkout |
| `RAZORPAY_WEBHOOK_SECRET` | Verifies incoming Razorpay webhook signatures |
| `FIREBASE_SERVICE_ACCOUNT_RAW` | Inline Firebase service-account JSON (alternative to `backend/config/firebase-service-account.json`) |

---

## Known issues / hardening backlog

These surfaced during a code review pass and are worth addressing before a public production deploy:

- **No server-side identity verification.** Every `backend/main.py` endpoint trusts a client-supplied `user_id` string with no Firebase ID-token check, despite `FirebaseTokenPayload` and `firebase_auth` being imported. This allows any caller to act on behalf of any `user_id` — including triggering strikes/lockdowns against other users and calling `/v1/billing/simulate-success` to grant free premium access. **Highest priority fix.**
- **`is_far_user` in `vision.py`** is computed in a code branch that can never coexist with where it's written into the result dict, so it's always `False` downstream.
- **Violation-dedup cooldown in `daemon.py`** compares full message strings that embed a live elapsed-seconds counter, so the intended 5s dedup window rarely actually matches.
- **CORS is wide open** (`allow_origins=["*"]` with `allow_credentials=True`) on the FastAPI app.
- Minor temporal-smoothing off-by-one bugs in `vision.py`'s rolling detection windows right after mode switches.
- `productive_apps` list in `daemon.py` is defined but never wired into the violation-duration logic.
- `_audio_playback_lock` in `daemon.py` is declared but never acquired.

---

## Tech stack

**Frontend:** React, TypeScript, Vite, Firebase SDK
**Desktop shell:** pywebview
**Backend:** FastAPI, Firebase Admin SDK / Firestore, Razorpay SDK
**Vision:** MediaPipe, OpenCV
**AI:** Google Gemini (roast/report generation), ElevenLabs (voice cloning), gTTS (fallback TTS)
**Process control:** psutil, pynput
