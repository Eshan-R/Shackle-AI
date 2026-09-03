/**
 * trialUtils.ts
 * Pure reconciliation logic for trial days and daily streak gaps.
 * Called once after profile load — before the profile is rendered anywhere.
 */

import { UserProfile, BillingLifecycle } from '../types';

const TRIAL_LENGTH_DAYS = 7;

/**
 * Returns a YYYY-MM-DD string in LOCAL time using the 'en-CA' locale,
 * which matches the convention used when writing `last_session_date` in addSession.
 * Do NOT use toISOString() here — that returns UTC and silently shifts the date
 * near midnight for non-UTC users, breaking the gap calculation.
 */
export function getTodayDateString(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA'); // 'en-CA' locale always yields YYYY-MM-DD
}

/**
 * Parse a YYYY-MM-DD string to a pure calendar day count via Date.UTC.
 * Using UTC avoids DST arithmetic since both sides are constructed the same way.
 */
function dateStringToDayCount(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 86400000;
}

/**
 * Returns the calendar-day gap between two YYYY-MM-DD strings.
 * A positive result means `dateA` is after `dateB`.
 */
function daysBetween(dateA: string, dateB: string): number {
  return dateStringToDayCount(dateA) - dateStringToDayCount(dateB);
}

export interface ReconciliationResult {
  billing_lifecycle: BillingLifecycle | undefined;
  streak: number;
  changed: boolean;
}

/**
 * Reconcile trial days and streak gap for a profile.
 *
 * @param profile - The current user profile
 * @param nowMs   - Current time in epoch ms (pass Date.now())
 * @returns An object with possibly-updated billing_lifecycle, streak, and a
 *          `changed` flag indicating whether anything was mutated.
 */
export function reconcileProfile(
  profile: UserProfile,
  nowMs: number
): ReconciliationResult {
  let changed = false;
  const nowDate = new Date(nowMs);
  const todayDateString = getTodayDateString(nowDate);

  // ── 1. Trial day reconciliation ────────────────────────────────────────────
  let billing_lifecycle = profile.billing_lifecycle
    ? { ...profile.billing_lifecycle }
    : undefined;

  if (billing_lifecycle && billing_lifecycle.status_code !== 'PREMIUM_ACTIVE') {
    const createdAt = profile.createdAt;

    if (!createdAt) {
      // No anchor available — cannot compute trial; leave as-is.
      console.warn('[trialUtils] Cannot reconcile trial: profile.createdAt is missing.');
    } else if (nowMs < createdAt) {
      // Clock skew: system clock is behind the profile creation timestamp.
      // Do NOT expire or change anything — a negative elapsed value would produce garbage.
      console.warn('[trialUtils] Clock skew detected: now < createdAt. Skipping trial reconciliation.');
    } else {
      // Creation day counts as day 0: a brand-new user created right now has
      // elapsed=0 and sees "7 days remaining" for the entire first calendar day.
      // On day 7 (elapsed >= 7), the trial expires.
      const elapsedMs = nowMs - createdAt;
      const elapsedDays = Math.floor(elapsedMs / 86400000);

      if (elapsedDays >= TRIAL_LENGTH_DAYS) {
        // Trial has expired
        if (
          billing_lifecycle.status_code !== 'TRIAL_EXPIRED' ||
          billing_lifecycle.access_granted !== false ||
          billing_lifecycle.days_remaining_in_trial !== 0
        ) {
          billing_lifecycle = {
            access_granted: false,
            status_code: 'TRIAL_EXPIRED',
            days_remaining_in_trial: 0,
          };
          changed = true;
          console.log(`[trialUtils] Trial expired (elapsed ${elapsedDays}d >= ${TRIAL_LENGTH_DAYS}d).`);
        }
      } else {
        // Trial is still active
        const daysRemaining = Math.max(0, TRIAL_LENGTH_DAYS - elapsedDays);
        if (
          billing_lifecycle.status_code !== 'TRIAL_ACTIVE' ||
          billing_lifecycle.access_granted !== true ||
          billing_lifecycle.days_remaining_in_trial !== daysRemaining
        ) {
          billing_lifecycle = {
            access_granted: true,
            status_code: 'TRIAL_ACTIVE',
            days_remaining_in_trial: daysRemaining,
          };
          changed = true;
          console.log(`[trialUtils] Trial active: ${daysRemaining} days remaining (elapsed ${elapsedDays}d).`);
        }
      }
    }
  }

  // ── 2. Streak gap reconciliation ───────────────────────────────────────────
  let streak = profile.streak ?? 0;
  const lastSessionDate = profile.last_session_date;

  if (!lastSessionDate) {
    // New user or already at 0, no previous session to diff against — no-op.
  } else {
    let gap: number;
    try {
      gap = daysBetween(todayDateString, lastSessionDate);
    } catch (e) {
      console.warn('[trialUtils] Failed to parse last_session_date for streak gap calc:', lastSessionDate, e);
      gap = 0; // treat as same-day on parse failure — safe default
    }

    if (gap < 0) {
      // Clock skew: today appears to be *before* the last session date. No-op.
      console.warn(`[trialUtils] Clock skew: today (${todayDateString}) < last_session_date (${lastSessionDate}). Skipping streak gap check.`);
    } else if (gap === 0) {
      // Same day — existing dedup behavior, do nothing.
    } else if (gap === 1) {
      // Yesterday — streak is intact, no reset needed.
    } else {
      // gap >= 2: at least one full calendar day was skipped entirely.
      // "Missed a day" is exactly gap >= 2, not gap > 1 in fractional hours.
      // The Rest Protocol (rest_day_active) is designed to freeze the streak
      // through a gap — if it was active, skip the reset.
      const restDayActive = profile.gamification?.rest_day_active ?? false;
      if (restDayActive) {
        console.log(`[trialUtils] Streak gap of ${gap}d detected but Rest Protocol is active — streak preserved.`);
      } else {
        if (streak !== 0) {
          streak = 0;
          changed = true;
          console.log(`[trialUtils] Streak reset: ${gap} calendar days since last session (${lastSessionDate} → ${todayDateString}).`);
        }
      }
    }
  }

  return { billing_lifecycle, streak, changed };
}
