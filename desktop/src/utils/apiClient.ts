/**
 * apiClient.ts
 *
 * Configured Axios instance for all ShackleAI backend API calls.
 *
 * URL resolution strategy (in priority order):
 *   1. VITE_BACKEND_API_URL env var   — explicit override (staging, custom domain)
 *   2. import.meta.env.DEV == true    — local dev server at http://127.0.0.1:8080
 *   3. Production without explicit var — empty string, relies on Vercel proxy rewrites
 *
 * Auth strategy:
 *   - Request interceptor first tries Firebase Auth currentUser.getIdToken() (fresh JWT).
 *   - Falls back to `localStorage.getItem('shackle_token')` for desktop/pywebview builds
 *     where Firebase Auth may not be available in the main webview context.
 *   - If neither is present, the request is sent unauthenticated (public endpoints).
 */

import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { getAuth } from 'firebase/auth';

// ---------------------------------------------------------------------------
// 1. Base URL helper
// ---------------------------------------------------------------------------

/**
 * Resolves the backend base URL based on the current environment.
 *
 * @returns Base URL string (no trailing slash).
 */
export function getBaseUrl(): string {
  // Explicit override wins in every environment
  const explicitUrl = import.meta.env.VITE_BACKEND_API_URL as string | undefined;
  if (explicitUrl) {
    return explicitUrl.replace(/\/$/, ''); // strip trailing slash
  }

  // Local dev — FastAPI runs on 8080 by default
  if (import.meta.env.DEV) {
    return 'http://127.0.0.1:8080';
  }

  // Production without an explicit URL → empty string so Vercel rewrites
  // (configured in vercel.json) transparently proxy /api/* calls.
  return '';
}

// ---------------------------------------------------------------------------
// 2. Axios instance
// ---------------------------------------------------------------------------

const apiClient: AxiosInstance = axios.create({
  baseURL: getBaseUrl(),
  timeout: 30_000, // 30s — enough for Gemini/ElevenLabs calls
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

// ---------------------------------------------------------------------------
// 3. Request interceptor — attach Bearer token
// ---------------------------------------------------------------------------

apiClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig): Promise<InternalAxiosRequestConfig> => {
    let token: string | null = null;

    // Primary: Firebase Auth fresh ID token (works in browser & Vercel)
    try {
      const currentUser = getAuth().currentUser;
      if (currentUser) {
        // forceRefresh=false — uses cached token unless within 5 min of expiry
        token = await currentUser.getIdToken(false);
      }
    } catch {
      // Firebase Auth not initialised yet or user is signed out — fall through
    }

    // Fallback: localStorage token set by desktop/pywebview bridge on sign-in
    if (!token) {
      token = localStorage.getItem('shackle_token');
    }

    if (token) {
      config.headers.set('Authorization', `Bearer ${token}`);
    }

    return config;
  },
  (error) => Promise.reject(error),
);

// ---------------------------------------------------------------------------
// 4. Response interceptor — optional global error normalisation
// ---------------------------------------------------------------------------

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // Surface the backend detail message when available
    const detail =
      error?.response?.data?.detail ??
      error?.response?.data?.message ??
      error?.message ??
      'Unknown error';

    console.error(
      `[apiClient] ${error?.config?.method?.toUpperCase() ?? 'HTTP'} ` +
        `${error?.config?.url ?? '?'} → ${error?.response?.status ?? 'network error'}: ${detail}`,
    );

    return Promise.reject(error);
  },
);

// ---------------------------------------------------------------------------
// 5. Exports
// ---------------------------------------------------------------------------

export default apiClient;
export { apiClient };
