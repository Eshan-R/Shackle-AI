/**
 * =====================================================================
 * SHACKLE AI — SITE-WIDE AUTHENTICATION & THEME CONTROLLER
 * Firebase Compat SDK integration, Google Sign-in/Sign-out, and Auth Slot UI
 * =====================================================================
 */

let firebaseAuth = null;
let currentAuthUser = null;
const authStateCallbacks = [];

/**
 * Initialize Firebase authentication across any static page.
 * @param {Object} options - Callbacks { onSignIn: (user) => void, onSignOut: () => void }
 */
async function initFirebaseAuth(options = {}) {
  if (options.onSignIn) authStateCallbacks.push({ type: 'in', fn: options.onSignIn });
  if (options.onSignOut) authStateCallbacks.push({ type: 'out', fn: options.onSignOut });

  updateThemeButtonLabel();

  // If Firebase compat SDK script tags were not loaded, gracefully degrade
  if (typeof firebase === 'undefined') {
    console.warn('[ShackleAuth] Firebase compat SDK not found. Auth features unavailable.');
    renderAuthSlot(null, 'Auth offline');
    return;
  }

  try {
    if (!firebase.apps.length) {
      const cfgRes = await fetch('/v1/config/firebase');
      if (!cfgRes.ok) {
        throw new Error('HTTP ' + cfgRes.status + ' loading /v1/config/firebase');
      }
      const cfg = await cfgRes.json();
      firebase.initializeApp(cfg);
    }

    firebaseAuth = firebase.auth();

    firebaseAuth.onAuthStateChanged(async (user) => {
      currentAuthUser = user;
      renderAuthSlot(user);

      if (user) {
        for (const cb of authStateCallbacks) {
          if (cb.type === 'in') {
            try { cb.fn(user); } catch (e) { console.error('[ShackleAuth] onSignIn callback error:', e); }
          }
        }
      } else {
        for (const cb of authStateCallbacks) {
          if (cb.type === 'out') {
            try { cb.fn(); } catch (e) { console.error('[ShackleAuth] onSignOut callback error:', e); }
          }
        }
      }
    });
  } catch (err) {
    console.error('[ShackleAuth] Init failed:', err);
    renderAuthSlot(null, 'Auth unavailable');
  }
}

/**
 * Sign in using Google OAuth popup.
 */
async function signInWithGoogle() {
  if (!firebaseAuth) {
    console.warn('[ShackleAuth] Auth not initialized yet');
    return;
  }
  const provider = new firebase.auth.GoogleAuthProvider();
  try {
    await firebaseAuth.signInWithPopup(provider);
  } catch (err) {
    console.error('[ShackleAuth] Google sign-in failed:', err);
    if (err.code !== 'auth/popup-closed-by-user') {
      alert('Sign-in failed: ' + (err.message || err.code));
    }
  }
}

/**
 * Sign out current Firebase user.
 */
async function signOutUser() {
  if (!firebaseAuth) return;
  try {
    await firebaseAuth.signOut();
  } catch (err) {
    console.error('[ShackleAuth] Sign-out failed:', err);
  }
}

/**
 * Get the current user's Firebase ID token for authenticated API requests.
 */
async function getIdToken(forceRefresh = false) {
  if (!firebaseAuth || !firebaseAuth.currentUser) return null;
  try {
    return await firebaseAuth.currentUser.getIdToken(forceRefresh);
  } catch (e) {
    console.warn('[ShackleAuth] Could not get ID token:', e);
    return null;
  }
}

function getCurrentUser() {
  return currentAuthUser || (firebaseAuth ? firebaseAuth.currentUser : null);
}

function getCurrentUid() {
  const u = getCurrentUser();
  return u ? u.uid : null;
}

/**
 * Render the auth slot state inside #auth-slot
 */
function renderAuthSlot(user, errorMsg) {
  const slot = document.getElementById('auth-slot');
  if (!slot) return;

  if (errorMsg) {
    slot.innerHTML = `<div class="auth-status-msg" style="color:var(--muted);font-size:10px;letter-spacing:1px;font-family:var(--font-mono);">${errorMsg}</div>`;
    return;
  }

  if (user) {
    const displayName = user.displayName || (user.email ? user.email.split('@')[0] : 'Operative');
    const photoURL = user.photoURL;
    const initials = (displayName.replace(/[^a-zA-Z0-9]/g, '') || 'OP').slice(0, 2).toUpperCase();

    slot.innerHTML = `
      <div class="auth-user-card">
        <div class="auth-user-meta">
          ${photoURL ? `<img class="auth-avatar" src="${photoURL}" alt="" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';" />` : ''}
          <div class="auth-avatar-fallback" style="${photoURL ? 'display:none;' : 'display:flex;'}">${initials}</div>
          <div class="auth-text-meta">
            <span class="auth-display-name" title="${displayName}">${displayName}</span>
            <span class="auth-sub-badge">AUTHENTICATED</span>
          </div>
        </div>
        <button type="button" class="auth-action-btn auth-signout-btn" onclick="signOutUser()">SIGN OUT</button>
      </div>
    `;
  } else {
    slot.innerHTML = `
      <div class="auth-signin-box">
        <button type="button" class="auth-action-btn auth-signin-btn" onclick="signInWithGoogle()">
          <svg class="auth-g-icon" viewBox="0 0 24 24" width="13" height="13">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
          </svg>
          <span>SIGN IN</span>
        </button>
      </div>
    `;
  }
}

/**
 * Site-wide Theme Toggle Handler
 */
function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme') || 'light';
  const next = current === 'light' ? 'dark' : 'light';
  html.setAttribute('data-theme', next);
  try {
    localStorage.setItem('shackle-theme', next);
  } catch (e) {}
  updateThemeButtonLabel();
}

function updateThemeButtonLabel() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme') || 'light';
  const btn = document.getElementById('theme-btn');
  if (btn) {
    btn.textContent = current === 'light' ? 'Theme: Light' : 'Theme: Dark';
  }
}

// Ensure theme toggle label is synchronized on document ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', updateThemeButtonLabel);
} else {
  updateThemeButtonLabel();
}
