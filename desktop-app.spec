# -*- mode: python ; coding: utf-8 -*-
# CRITICAL FIX: Import collect_submodules / collect_all to bundle lazy imports
from PyInstaller.utils.hooks import collect_data_files, collect_submodules, collect_all
import sys
import os

block_cipher = None

# ------------------------------------------------------------------
# 1. Collect all dynamic submodules for large frameworks
# ------------------------------------------------------------------
mediapipe_data = collect_data_files('mediapipe')
mediapipe_submodules = collect_submodules('mediapipe')

fastapi_submodules   = collect_submodules('fastapi')
starlette_submodules = collect_submodules('starlette')
uvicorn_submodules   = collect_submodules('uvicorn')
anyio_submodules     = collect_submodules('anyio')

firebase_admin_submodules = collect_submodules('firebase_admin')
firebase_admin_data       = collect_data_files('firebase_admin')

google_cloud_firestore_submodules = collect_submodules('google.cloud.firestore_v1')
google_auth_submodules            = collect_submodules('google.auth')
google_api_core_submodules        = collect_submodules('google.api_core')

# google.genai uses namespace packaging – collect all
genai_datas, genai_binaries, genai_hiddenimports = collect_all('google.genai')

dotenv_submodules = collect_submodules('dotenv')

razorpay_datas, razorpay_binaries, razorpay_hiddenimports = collect_all('razorpay')

matplotlib_data = collect_data_files('matplotlib')
matplotlib_submodules = collect_submodules('matplotlib')

# ------------------------------------------------------------------
# 2. Build Analysis object
# ------------------------------------------------------------------
a = Analysis(
    ['desktop/app.py'],                # Entry point
    pathex=['.', 'desktop'],           # Root and desktop paths for imports during build
    binaries=[] + genai_binaries + razorpay_binaries,
    datas=[
        ('desktop/dist', 'dist'),          # React frontend build
        ('desktop/assets', 'assets'),      # MediaPipe .task files
        ('backend', 'backend'),            # Backend FastAPI package
        ('.env', '.'),                     # Environment variables
        ('logo.ico', '.'),                 # App Icon
    ] + mediapipe_data + firebase_admin_data + genai_datas + razorpay_datas + matplotlib_data,
    hiddenimports=[
        # ---------- Desktop modules (flat files inside desktop/) ----------
        'vision',
        'telemetry',
        'daemon',
        'utils.os_locker',
        'utils.break_manager',

        # ---------- Backend package ----------
        'backend',
        'backend.main',
        'backend.firebase_config',
        'firebase_config',
        'backend.services',
        'backend.services.gemini_agent',
        'backend.services.calendar_mesh',

        # ---------- Third‑party dependencies ----------
        'pynput',
        'pynput.keyboard',
        'pynput.mouse',
        'pynput._util',
        'pygetwindow',
        'cv2',
        'mediapipe',
        'mediapipe.tasks.python',
        'mediapipe.tasks.python.vision',
        'gtts',
        'firebase_admin',
        'firebase_admin.credentials',
        'firebase_admin.firestore',
        'firebase_admin.auth',
        'psutil',
        'httpx',
        'httpx._transports.default',
        'httpcore',
        'h11',
        'razorpay',
        'elevenlabs',
        'elevenlabs.client',
        'pydantic',
        'pydantic.networks',
        'pydantic.v1',
        'google.genai',
        'google.genai.types',
        'google.genai.client',
        'dotenv',
        'google.cloud.firestore',
        'google.cloud.firestore_v1',
        'tkinter',          # Used for light bomb
        '_tkinter',         # Underlying Tcl/Tk DLL – must be present
        'matplotlib',
        'matplotlib.pyplot',
        'matplotlib.backends',
        'matplotlib.backends.backend_agg',
    ] + mediapipe_submodules
      + fastapi_submodules
      + starlette_submodules
      + uvicorn_submodules
      + anyio_submodules
      + firebase_admin_submodules
      + google_cloud_firestore_submodules
      + google_auth_submodules
      + google_api_core_submodules
      + genai_hiddenimports
      + dotenv_submodules
      + razorpay_hiddenimports
      + matplotlib_submodules,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['jax', 'jaxlib', 'torch', 'scipy', 'IPython', 'notebook'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='ShackleAI',
    debug=False,
    icon='logo.ico',
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    uac_admin=True,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='ShackleAI',
)