import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Mail,
  Lock,
  User,
  Sparkles,
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  Cpu,
  Check,
  UserCheck,
} from "lucide-react";
import {
  logInWithEmail,
  registerWithEmail,
  signInWithGoogle,
  signInWithGoogleDesktop,
  saveUserProfile,
  fetchUserProfile,
  db,
} from "../utils/firebase";
import { doc, getDoc, writeBatch } from "firebase/firestore";
import { UserProfile } from "../types";

interface AuthViewProps {
  theme: "Granite Beige" | "Midnight Slate" | "Deep Plum";
  mode: "Light" | "Dark";
  onAuthSuccess: (uid: string, profile: UserProfile) => void;
  onContinueGuest: () => void;
}

export default function AuthView({
  theme,
  mode,
  onAuthSuccess,
  onContinueGuest,
}: AuthViewProps) {
  const [isLogin, setIsLogin] = useState<boolean>(true);
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [displayName, setDisplayName] = useState<string>("");
  const [username, setUsername] = useState<string>("");

  const [setupUser, setSetupUser] = useState<{
    uid: string;
    email: string;
  } | null>(null);

  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const isDark = mode === "Dark";



  // Aesthetic adjustments based on current theme and dark status
  const getThemeStyles = () => {
    if (isDark) {
      if (theme === "Midnight Slate") {
        return {
          bg: "bg-slate-950",
          cardBg: "bg-slate-900/80 border-slate-800",
          accentColor: "indigo-500",
          accentText: "text-indigo-400",
          buttonBg: "bg-indigo-600 hover:bg-indigo-500",
          inputBg:
            "bg-slate-950/60 border-slate-800 focus:border-indigo-500/80",
          glow: "bg-blue-500/10",
        };
      } else if (theme === "Deep Plum") {
        return {
          bg: "bg-slate-950",
          cardBg: "bg-[#18111e]/80 border-purple-900/30",
          accentColor: "purple-500",
          accentText: "text-purple-400",
          buttonBg: "bg-purple-600 hover:bg-purple-500",
          inputBg:
            "bg-purple-950/20 border-purple-900/30 focus:border-purple-500/80",
          glow: "bg-purple-500/10",
        };
      } else {
        // Granite Beige
        return {
          bg: "bg-[#141210]",
          cardBg: "bg-[#1f1d1b]/80 border-[#322f2b]/60",
          accentColor: "amber-500",
          accentText: "text-[#d1c5b4]",
          buttonBg: "bg-[#d1c5b4] hover:bg-[#e4dbce] !text-[#1c1b19]",
          inputBg: "bg-[#171513]/80 border-[#322f2b] focus:border-[#d1c5b4]/80",
          glow: "bg-amber-500/5",
        };
      }
    } else {
      // Light mode equivalent
      if (theme === "Midnight Slate") {
        return {
          bg: "bg-slate-50",
          cardBg: "bg-white border-slate-200/80 shadow-xl",
          accentColor: "blue-600",
          accentText: "text-blue-600",
          buttonBg: "bg-blue-600 hover:bg-blue-500 !",
          inputBg: "bg-slate-50 border-slate-200 focus:border-blue-500",
          glow: "bg-blue-500/5",
        };
      } else if (theme === "Deep Plum") {
        return {
          bg: "bg-purple-50/25",
          cardBg: "bg-white border-purple-100 shadow-xl",
          accentColor: "purple-600",
          accentText: "text-purple-600",
          buttonBg: "bg-purple-600 hover:bg-purple-500 !",
          inputBg: "bg-purple-50/30 border-purple-100 focus:border-purple-500",
          glow: "bg-purple-500/5",
        };
      } else {
        // Granite Beige
        return {
          bg: "bg-[#faf9f6]",
          cardBg: "bg-[#fcfbf9]/95 border-[#ebdcd0]/70 shadow-xl",
          accentColor: "[#70624e]",
          accentText: "text-[#70624e]",
          buttonBg: "bg-[#70624e] hover:bg-[#857560]",
          inputBg: "bg-white/60 border-slate-200 focus:border-[#70624e]",
          glow: "bg-amber-100/30",
        };
      }
    }
  };

  const styles = getThemeStyles();

  // Unified response generation and signup structure
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    if (!email || !password) {
      setError("Please fill in all email and password fields.");
      setIsLoading(false);
      return;
    }

    try {
      if (isLogin) {
        // Perform standard login using email/password
        const credentials = await logInWithEmail(email, password);
        const user = credentials.user;
        const dbProfile = await fetchUserProfile(user.uid);
        if (dbProfile) {
          onAuthSuccess(user.uid, dbProfile);
        } else {
          // Inherit from local profile to prevent overwriting existing progress
          let localXp = 0;
          let localStreak = 0;
          let localLevel = 1;
          let localLeague = "Bronze";

          const cachedRaw =
            localStorage.getItem("shackle_profile") ||
            localStorage.getItem("shackle_guest_profile");
          if (cachedRaw) {
            try {
              const cachedProfile = JSON.parse(cachedRaw);
              localXp = cachedProfile.xp || 0;
              localStreak = cachedProfile.streak || 0;
              localLevel = cachedProfile.level || 1;
              localLeague = cachedProfile.league || "Bronze";
            } catch (e) {}
          }

          const profile: UserProfile = {
            displayName:
              user.displayName || user.email?.split("@")[0] || "Unshackler",
            username: `@${(user.email?.split("@")[0] || "unshackled").replace(/[^a-zA-Z0-9_\-+]/g, "")}`,
            email: user.email || email,
            xp: localXp,
            streak: localStreak,
            strikes: "None",
            tier: "regular",
            level: localLevel,
            league: localLeague as any,
            billing_lifecycle: {
              access_granted: true,
              status_code: "TRIAL_ACTIVE",
              days_remaining_in_trial: 7,
            },
            gamification: {
              rest_permits: 2,
              rest_day_active: false,
              last_permit_reset: new Date().toISOString(),
            },
            last_session_date: null,
            last_league_update: Date.now(),
          };
          onAuthSuccess(user.uid, profile);
        }
      } else {
        // Register standard new credentials (no usernames collected here, we transit to setup step)
        const credentials = await registerWithEmail(email, password);
        const user = credentials.user;

        // Formulate automatic beautiful prepopulated defaults
        const emailPrefix = user.email
          ? user.email.split("@")[0]
          : "unshackler";
        const formattedDisp = emailPrefix
          .split(/[._\-+]+/)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ");
        const cleanBase = emailPrefix.toLowerCase().replace(/[^a-z0-9]/g, "");
        const randomSuffix = Math.floor(1000 + Math.random() * 9000);

        setDisplayName(formattedDisp || "Unshackler Partner");
        setUsername(`${cleanBase || "user"}_${randomSuffix}`);
        setSetupUser({ uid: user.uid, email: user.email || email });
      }
    } catch (err: any) {
      console.error(err);
      let readableMsg = err.message;
      if (
        err.code === "auth/invalid-credential" ||
        err.code === "auth/wrong-password"
      ) {
        readableMsg = "Incorrect email address or security credentials.";
      } else if (err.code === "auth/email-already-in-use") {
        readableMsg =
          "This email is already associated with an existing account.";
      } else if (err.code === "auth/weak-password") {
        readableMsg =
          "Password strength is too weak. Must be at least 6 characters.";
      } else if (err.code === "auth/invalid-email") {
        readableMsg = "Format of email address is structured incorrectly.";
      }
      setError(readableMsg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFinalizeProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!setupUser) return;
    setError(null);
    setIsLoading(true);

    if (!displayName || !username) {
      setError("Please input a display name and select a username.");
      setIsLoading(false);
      return;
    }

    try {
      const formattedUsername = username.startsWith("@")
        ? username
        : `@${username}`;
      const normalizedUsername = formattedUsername
        .toLowerCase()
        .replace(/^@/, "");

      const usernameRef = doc(db, "usernames", normalizedUsername);
      const usernameSnap = await getDoc(usernameRef);
      if (usernameSnap.exists()) {
        throw new Error(
          "This username is already taken. Please choose another username.",
        );
      }

      // Inherit from local profile to prevent overwriting existing progress
      let localXp = 0;
      let localStreak = 0;
      let localLevel = 1;
      let localLeague = "Bronze";

      const cachedRaw =
        localStorage.getItem("shackle_profile") ||
        localStorage.getItem("shackle_guest_profile");
      if (cachedRaw) {
        try {
          const cachedProfile = JSON.parse(cachedRaw);
          localXp = cachedProfile.xp || 0;
          localStreak = cachedProfile.streak || 0;
          localLevel = cachedProfile.level || 1;
          localLeague = cachedProfile.league || "Bronze";
        } catch (e) {}
      }

      const finalProfile: UserProfile = {
        displayName,
        username: formattedUsername,
        email: setupUser.email,
        xp: localXp,
        streak: localStreak,
        strikes: "None",
        tier: "regular",
        level: localLevel,
        league: localLeague as any,
        billing_lifecycle: {
          access_granted: true,
          status_code: "TRIAL_ACTIVE",
          days_remaining_in_trial: 7,
        },
        gamification: {
          rest_permits: 2,
          rest_day_active: false,
          last_permit_reset: new Date().toISOString(),
        },
        last_session_date: null,
        last_league_update: Date.now(),
      };

      const batch = writeBatch(db);
      const userRef = doc(db, "users", setupUser.uid);
      batch.set(userRef, finalProfile, { merge: true });
      batch.set(usernameRef, { uid: setupUser.uid });
      await batch.commit();

      onAuthSuccess(setupUser.uid, finalProfile);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to finalize profile. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // Google OAuth flow handler optimized for pywebview container execution
  const handleGoogleAuth = async () => {
    setError(null);
    setIsLoading(true);

    // 1. Safety Check: If we aren't in pywebview, fall back to standard web popup
    if (!window.pywebview || !window.pywebview.api) {
      try {
        console.log(
          "[FRONTEND] Desktop bridge unavailable. Attempting standard web popup flow...",
        );
        const credentials = await signInWithGoogle();
        const user = credentials.user;
        await processUserProfile(user);
      } catch (err: any) {
        console.error(err);
        setError("Failed to authenticate with Google via browser popup.");
        setIsLoading(false);
      }
      return;
    }

    // 2. Native Desktop Route
    try {
      console.log("[FRONTEND] Spawning secure desktop loopback listener...");
      const authData = await window.pywebview.api.start_google_oauth();

      if (!authData || !authData.idToken) {
        setError("Authentication was aborted or authorization timed out.");
        setIsLoading(false);
        return;
      }

      console.log(
        "[FRONTEND] Loopback raw token acquired. Exchanging with Firebase client...",
      );
      const credentials = await signInWithGoogleDesktop(
        authData.idToken,
        authData.accessToken,
      );
      await processUserProfile(credentials.user);
    } catch (err: any) {
      console.error("[FRONTEND] Desktop OAuth Handshake Exception:", err);
      setError("Failed to execute native Google Sign-In loopback.");
    } finally {
      setIsLoading(false);
    }
  };

  // Helper inside AuthView to handle existing or new user onboarding profile data layout
  const processUserProfile = async (user: any) => {
    const dbProfile = await fetchUserProfile(user.uid);
    if (dbProfile) {
      onAuthSuccess(user.uid, dbProfile);
    } else {
      const baseDispName =
        user.displayName || user.email?.split("@")[0] || "Unshackler";
      const cleanBase = baseDispName.toLowerCase().replace(/[^a-z0-9]/g, "");

      let generatedUsername = `@${cleanBase || "user"}_${Math.floor(1000 + Math.random() * 9000)}`;
      let attempts = 0;
      try {
        while (attempts < 10) {
          const normalized = generatedUsername.toLowerCase().replace(/^@/, "");
          const usernameRef = doc(db, "usernames", normalized);
          const usernameSnap = await getDoc(usernameRef);
          if (!usernameSnap.exists()) {
            break;
          }
          const newSuffix = Math.floor(1000 + Math.random() * 9000);
          generatedUsername = `@${cleanBase || "user"}_${newSuffix}`;
          attempts++;
        }
      } catch (e) {
        console.error("Google auth username uniqueness check failed:", e);
      }

      // Inherit from local profile to prevent overwriting existing progress
      let localXp = 0;
      let localStreak = 0;
      let localLevel = 1;
      let localLeague = "Bronze";

      const cachedRaw =
        localStorage.getItem("shackle_profile") ||
        localStorage.getItem("shackle_guest_profile");
      if (cachedRaw) {
        try {
          const cachedProfile = JSON.parse(cachedRaw);
          localXp = cachedProfile.xp || 0;
          localStreak = cachedProfile.streak || 0;
          localLevel = cachedProfile.level || 1;
          localLeague = cachedProfile.league || "Bronze";
        } catch (e) {}
      }

      const initialProfile: UserProfile = {
        displayName: baseDispName,
        username: generatedUsername,
        email: user.email || "",
        xp: localXp,
        streak: localStreak,
        strikes: "None",
        tier: "regular",
        level: localLevel,
        league: localLeague as any,
        billing_lifecycle: {
          access_granted: true,
          status_code: "TRIAL_ACTIVE",
          days_remaining_in_trial: 7,
        },
        gamification: {
          rest_permits: 2,
          rest_day_active: false,
          last_permit_reset: new Date().toISOString(),
        },
        last_session_date: null,
        last_league_update: Date.now(),
        sessions: [],
      };

      try {
        const batch = writeBatch(db);
        const userRef = doc(db, "users", user.uid);
        const normalizedUsername = initialProfile.username
          .toLowerCase()
          .replace(/^@/, "");
        const usernameRef = doc(db, "usernames", normalizedUsername);

        batch.set(userRef, initialProfile, { merge: true });
        batch.set(usernameRef, { uid: user.uid });
        await batch.commit();
      } catch (err) {
        console.error(
          "Failed to commit Google auth profile batch to Firestore:",
          err,
        );
      }

      onAuthSuccess(user.uid, initialProfile);
    }
  };

  return (
    <div
      className={`min-h-[90vh] flex flex-col justify-center items-center px-4 py-12 transition-colors duration-500 overflow-hidden relative`}
    >
      {/* Absolute background accent spheres for premium look */}
      <div
        className={`absolute top-1/4 left-1/4 w-80 h-80 rounded-full blur-[110px] pointer-events-none opacity-40 transition-colors duration-500 ${styles.glow}`}
      />
      <div
        className={`absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full blur-[110px] pointer-events-none opacity-40 transition-colors duration-500 ${styles.glow}`}
      />

      {setupUser ? (
        /* Setup Step 2 Profile Personalization form */
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="w-full max-w-md relative z-10"
        >
          {/* Shackle AI Branding Header for step 2 */}
          <div className="flex flex-col items-center mb-8 text-center select-none">
            <div
              className={`p-3 rounded-2xl bg-indigo-500/10 border ${isDark ? "border-indigo-500/25" : "border-blue-500/25"} mb-3`}
            >
              <UserCheck
                className={`w-8 h-8 ${isDark ? "text-indigo-400" : "text-blue-600"} animate-pulse`}
              />
            </div>
            <h1 className="text-3xl font-sans tracking-tight font-black uppercase text-slate-900 dark:text-slate-100 flex items-center gap-1.5 justify-center">
              PERSONALIZE <span className={styles.accentText}>PROFILE</span>
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mt-1.5 leading-relaxed">
              Complete your profile setup. Set how you want your display name
              and username to appear publicly.
            </p>
          </div>

          <div
            className={`p-8 rounded-2xl border backdrop-blur-md transition-all duration-300 ${styles.cardBg}`}
          >
            <form onSubmit={handleFinalizeProfile} className="space-y-4">
              <div>
                <label className="block text-[10px] uppercase tracking-wider font-mono text-slate-400 dark:text-slate-500 mb-1.5">
                  Your Display Name
                </label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  <input
                    type="text"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Eshan"
                    className={`w-full text-xs p-3 pl-10 rounded-xl outline-none border transition-all text-slate-900 dark:text-slate-100 ${styles.inputBg}`}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider font-mono text-slate-400 dark:text-slate-500 mb-1.5">
                  Unique Username
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-mono text-slate-400 font-bold">
                    @
                  </span>
                  <input
                    type="text"
                    required
                    value={username.replace("@", "")}
                    onChange={(e) =>
                      setUsername(
                        `@${e.target.value.toLowerCase().replace(/\s+/g, "")}`,
                      )
                    }
                    placeholder="eshan_rk"
                    className={`w-full text-xs p-3 pl-8 rounded-xl outline-none border transition-all text-slate-900 dark:text-slate-100 ${styles.inputBg}`}
                  />
                </div>
              </div>

              {/* Error Banner */}
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 flex items-start gap-2.5"
                >
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <p className="text-[11px] leading-snug">{error}</p>
                </motion.div>
              )}

              {/* Submit Finalize Profile */}
              <button
                type="submit"
                disabled={isLoading}
                className={`w-full py-3.5 rounded-xl font-sans font-extrabold text-xs tracking-wider uppercase flex items-center justify-center gap-2 shadow-lg hover:shadow-xl active:scale-[0.98] transition-all text-white pointer-events-auto cursor-pointer ${styles.buttonBg}`}
              >
                {isLoading ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <span>FINALIZE PROFILE</span>
                    <Check className="w-4 h-4 text-inherit" />
                  </>
                )}
              </button>
            </form>
          </div>
        </motion.div>
      ) : (
        /* Standard Auth Screen Step 1 */
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="w-full max-w-md relative z-10"
        >
          {/* Shackle AI Branding Logo Header */}
          <div className="flex flex-col items-center mb-8 text-center select-none">
            <div
              className={`p-3 rounded-2xl bg-indigo-500/10 border ${isDark ? "border-indigo-500/25" : "border-blue-500/25"} mb-3`}
            >
              <Cpu
                className={`w-8 h-8 ${isDark ? "text-indigo-400" : "text-blue-600"} animate-pulse`}
              />
            </div>
            <h1 className="text-3xl font-sans tracking-tight font-black uppercase text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              SHACKLE <span className={styles.accentText}>AI</span>
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mt-1.5">
              Lock down distractive applications, cultivate high-performing
              habits, and earn premium league positions.
            </p>
          </div>

          {/* Central Auth Container Card */}
          <div
            className={`p-8 rounded-2xl border backdrop-blur-md transition-all duration-300 ${styles.cardBg}`}
          >
            {/* Top segment: Login / Register tabs */}
            <div className="flex bg-slate-100 dark:bg-slate-950/60 p-1 rounded-xl mb-6 border border-slate-200/40 dark:border-slate-800/40">
              <button
                onClick={() => {
                  setIsLogin(true);
                  setError(null);
                }}
                className={`flex-1 py-2 text-xs font-sans font-bold rounded-lg transition-all ${
                  isLogin
                    ? isDark
                      ? "bg-slate-800 text-white shadow-sm"
                      : "bg-white text-slate-900 shadow-sm"
                    : "text-slate-400 hover:text-slate-500"
                }`}
              >
                Log In
              </button>
              <button
                onClick={() => {
                  setIsLogin(false);
                  setError(null);
                }}
                className={`flex-1 py-2 text-xs font-sans font-bold rounded-lg transition-all ${
                  !isLogin
                    ? isDark
                      ? "bg-slate-800 text-white shadow-sm"
                      : "bg-white text-slate-900 shadow-sm"
                    : "text-slate-400 hover:text-slate-500"
                }`}
              >
                Create Account
              </button>
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={isLogin ? "login" : "register"}
                initial={{ opacity: 0, x: isLogin ? -15 : 15 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: isLogin ? 15 : -15 }}
                transition={{ duration: 0.25 }}
              >
                {/* Social authentication triggers */}
                <div className="mb-5">
                  {/* Google Sign-in - Adjusted to full-width */}
                  <button
                    type="button"
                    onClick={handleGoogleAuth}
                    disabled={isLoading}
                    className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors text-xs font-sans font-semibold text-slate-700 dark:text-slate-300 pointer-events-auto cursor-pointer"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24">
                      <path
                        fill="#4285F4"
                        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v3.92h6.61a5.66 5.66 0 0 1-2.45 3.71v3.08h3.95c2.31-2.13 3.63-5.26 3.63-8.64Z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.95-3.08c-1.1.74-2.5 1.18-3.98 1.18-3.06 0-5.64-2.07-6.57-4.86H1.43v3.18A12 12 0 0 0 12 24Z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.43 14.33a7.18 7.18 0 0 1 0-4.56V6.59H1.43a12 12 0 0 0 0 10.92l4-3.18Z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.43-3.43A11.93 11.93 0 0 0 12 0 12 12 0 0 0 1.43 6.59l4 3.18c.93-2.79 3.51-4.86 6.57-4.86Z"
                      />
                    </svg>
                    <span>Continue with Google</span>
                  </button>
                </div>

                {/* Decorative divider bar */}
                <div className="flex items-center justify-center gap-3 mb-6 select-none">
                  <div className="h-[1px] flex-1 bg-slate-200 dark:bg-slate-800/80" />
                  <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">
                    Or credential login
                  </span>
                  <div className="h-[1px] flex-1 bg-slate-200 dark:bg-slate-800/80" />
                </div>

                {/* Form Input elements */}
                <form onSubmit={handleAuth} className="space-y-4">
                  {/* Email Address */}
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider font-mono text-slate-400 dark:text-slate-500 mb-1.5">
                      Email Address
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value.trim())}
                        placeholder="you@domain.com"
                        className={`w-full text-xs p-3 pl-10 rounded-xl outline-none border transition-all text-slate-900 dark:text-slate-100 ${styles.inputBg}`}
                      />
                    </div>
                  </div>

                  {/* Secure Password */}
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider font-mono text-slate-400 dark:text-slate-500 mb-1.5">
                      Security Password
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                      <input
                        type={showPassword ? "text" : "password"}
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className={`w-full text-xs p-3 pl-10 pr-10 rounded-xl outline-none border transition-all text-slate-900 dark:text-slate-100 ${styles.inputBg}`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-500 pointer-events-auto cursor-pointer"
                      >
                        {showPassword ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Error Banner */}
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -5 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 flex items-start gap-2.5"
                    >
                      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                      <p className="text-[11px] leading-snug">{error}</p>
                    </motion.div>
                  )}

                  {/* Submission Action */}
                  <button
                    type="submit"
                    disabled={isLoading}
                    className={`w-full py-3.5 rounded-xl font-sans font-extrabold text-xs tracking-wider uppercase flex items-center justify-center gap-2 shadow-lg hover:shadow-xl active:scale-[0.98] transition-all text-white pointer-events-auto cursor-pointer ${styles.buttonBg}`}
                  >
                    {isLoading ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>
                        <span>
                          {isLogin ? "AUTHENTICATE NOW" : "CREATE ACCOUNT"}
                        </span>
                        <ArrowRight className="w-4 h-4 text-inherit" />
                      </>
                    )}
                  </button>
                </form>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Offline / Guest Mode Fallback Trigger */}
          <div className="mt-6 text-center select-none">
            <button
              onClick={onContinueGuest}
              className="text-xs font-mono font-bold text-slate-500 hover:text-slate-600 dark:text-slate-400 dark:hover:text-[#d1c5b4] transition-colors inline-flex items-center gap-1 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Continue Offline in Guest Mode
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
