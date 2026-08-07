/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { UserProfile } from '../types';

export interface StrikePalette {
  isDark: boolean;
  bgHex: string;
  cardBgHex: string;
  borderHex: string;
  textHex: string;
  textMutedHex: string;
  accentHex: string;         // e.g. #FFFFFF, #D97706, #DC2626
  accentTextHex: string;     // Color for text written ON top of accent background (usually light or dark)
  accentHoverBgHex: string;
  effectMessage: string;
  effectTitle: string;
}

/**
 * Parses the numeric strike count from the userProfile.strikes string
 */
export function getStrikeCount(strikesStr: string): number {
  if (!strikesStr || typeof strikesStr !== 'string' || strikesStr.toLowerCase() === 'none') {
    return 0;
  }
  
  // Safe extraction matching individual distinct token structures explicitly
  const match = strikesStr.match(/\d+/);
  if (match) {
    const computedCount = parseInt(match[0], 10);
    return isNaN(computedCount) ? 0 : Math.min(computedCount, 3); // Clamped tightly to system rules ceiling
  }
  return 0;
}

/**
 * Resolves the color palette based on strike count, active mode setting, and selected theme
 */
export function getStrikeColorPalette(
  strikeCount: number,
  mode: 'Light' | 'Dark' | 'Auto',
  theme: string = 'Granite Beige'
): StrikePalette {
  // If strikeCount >= 2, we force dark theme over the entire app
  const isForcedDark = strikeCount >= 2;
  const isDark = isForcedDark || mode === 'Dark';

  if (!isDark) {
    // Light Mode styling
    if (strikeCount === 0) {
      if (theme === 'Midnight Slate') {
        return {
          isDark: false,
          bgHex: "#F0F4F8",         // cool frosty slate wash
          cardBgHex: "#FFFFFF",
          borderHex: "#D1DBE5",     // slate border border lines
          textHex: "#0F172A",       // slate-900 primary labels
          textMutedHex: "#475569",  // slate-600 helper messages
          accentHex: "#2563EB",     // Vivid Blue
          accentTextHex: "#FFFFFF",
          accentHoverBgHex: "#1D4ED8",
          effectTitle: "Optimal Compliance",
          effectMessage: "Absolute silence. Zero visual noise. Pure, cold focus.",
        };
      } else if (theme === 'Deep Plum') {
        return {
          isDark: false,
          bgHex: "#FAF5FF",         // very soft cozy lilac/plum light wash
          cardBgHex: "#FFFFFF",
          borderHex: "#E9D5FF",     // purple-200 border
          textHex: "#3B0764",       // deep violet text
          textMutedHex: "#701A75",  // plum description
          accentHex: "#7C3AED",     // deep purple/violet
          accentTextHex: "#FFFFFF",
          accentHoverBgHex: "#6D28D9",
          effectTitle: "Optimal Compliance",
          effectMessage: "Absolute silence. Zero visual noise. Pure, cold focus.",
        };
      } else {
        // Granite Beige theme (default)
        return {
          isDark: false,
          bgHex: "#F4F1EA",         // warm sandstone light wash
          cardBgHex: "#FFFFFF",
          borderHex: "#E2DED5",     // warm sand accent border
          textHex: "#1C1B19",       // dark warm charcoal
          textMutedHex: "#7A756B",  // sandstone text helper
          accentHex: "#70624E",     // bronze/wood granite accent
          accentTextHex: "#FFFFFF",
          accentHoverBgHex: "#5B4F3F",
          effectTitle: "Optimal Compliance",
          effectMessage: "Absolute silence. Zero visual noise. Pure, cold focus.",
        };
      }
    } else {
      // Strike 1 (Warning) Light mode
      return {
        isDark: false,
        bgHex: "#FDF8EB",         // Warm Sand Amber Light wash
        cardBgHex: "#FFFFFF",
        borderHex: "#FCD34D",     // amber border accent
        textHex: "#78350F",       // amber-900 text
        textMutedHex: "#B45309",   // amber-700 description
        accentHex: "#D97706",     // Warning Orange
        accentTextHex: "#FFFFFF",
        accentHoverBgHex: "#B45309",
        effectTitle: "Anomaly Warning",
        effectMessage: "Adrenaline spike. The system is watching. A border has been crossed.",
      };
    }
  } else {
    // Dark Mode / Forced Dark styling
    if (strikeCount === 0) {
      if (theme === 'Midnight Slate') {
        return {
          isDark: true,
          bgHex: "#0B0F19",         // midnight deep indigo/slate shadow
          cardBgHex: "#121B2D",     // midnight card background
          borderHex: "#1E293B",     // slate-800
          textHex: "#ECEFF4",       // cool ice blue white
          textMutedHex: "#94A3B8",  // cool gray helper
          accentHex: "#3B82F6",     // Electric Blue
          accentTextHex: "#FFFFFF",
          accentHoverBgHex: "#2563EB",
          effectTitle: "Optimal Compliance",
          effectMessage: "Absolute silence. Zero visual noise. Pure, cold focus.",
        };
      } else if (theme === 'Deep Plum') {
        return {
          isDark: true,
          bgHex: "#120914",         // almost black amethyst twilight shadow
          cardBgHex: "#1F1024",     // rich cozy plum block card
          borderHex: "#3B1B48",     // purple-900/80
          textHex: "#F3E8FF",       // dreamy orchid white
          textMutedHex: "#C084FC",  // light amethyst violet
          accentHex: "#A855F7",     // Neon Violet
          accentTextHex: "#FFFFFF",
          accentHoverBgHex: "#8B5CF6",
          effectTitle: "Optimal Compliance",
          effectMessage: "Absolute silence. Zero visual noise. Pure, cold focus.",
        };
      } else {
        // Granite Beige
        return {
          isDark: true,
          bgHex: "#1B1A18",         // Obsidian void with dry warm sandstone undertone
          cardBgHex: "#252320",     // deep warm slate charcoal card
          borderHex: "#3B3833",     // sandstone dark boundary
          textHex: "#F5F2EB",       // off-white cream
          textMutedHex: "#A39E93",  // warm neutral muted text
          accentHex: "#D1C5B4",     // beige gold accent highlight
          accentTextHex: "#1B1A18", // dark text on gold highlight
          accentHoverBgHex: "#B3A591",
          effectTitle: "Optimal Compliance",
          effectMessage: "Absolute silence. Zero visual noise. Pure, cold focus.",
        };
      }
    } else if (strikeCount === 1) {
      return {
        isDark: true,
        bgHex: "#1C1306",         // Deep Amber Wash
        cardBgHex: "#2C1E0A",     // warm amber card
        borderHex: "#4E3512",
        textHex: "#FEF3C7",       // soft amber yellow
        textMutedHex: "#F59E0B",   // warning amber
        accentHex: "#D97706",     // Warning Orange
        accentTextHex: "#FFFFFF",
        accentHoverBgHex: "#B45309",
        effectTitle: "Anomaly Warning",
        effectMessage: "Adrenaline spike. The system is watching. A border has been crossed.",
      };
    } else if (strikeCount === 2) {
      return {
        isDark: true,
        bgHex: "#1C0606",         // Blood Wine Wash
        cardBgHex: "#2C0B0B",     // crimson card
        borderHex: "#4C1010",
        textHex: "#FECACA",       // red-100
        textMutedHex: "#F87171",   // red-400 helper
        accentHex: "#DC2626",     // Crimson Alert
        accentTextHex: "#FFFFFF",
        accentHoverBgHex: "#B91C1C",
        effectTitle: "Critical Alert",
        effectMessage: "Pure urgency. One misstep away from full OS lock and execution termination.",
      };
    } else {
      // Strike 3 or higher: Transition back toward Obsidian Void as the count continues to tick up
      let currentBg = "#1C0606";
      let cardBg = "#2C0B0B";
      let borderBg = "#4C1010";
      
      if (strikeCount === 3) {
        currentBg = "#140909";
        cardBg = "#1F0F0F";
        borderBg = "#3D1515";
      } else {
        currentBg = "#0B0B0C";  // Obsidian Void
        cardBg = "#161618";
        borderBg = "#2C2C30";
      }

      return {
        isDark: true,
        bgHex: currentBg,         // slowly transition to Obsidian Void
        cardBgHex: cardBg,
        borderHex: borderBg,
        textHex: "#FFD2D2",       // warning text color
        textMutedHex: "#EF4444",
        accentHex: "#DC2626",     // Crimson Alert
        accentTextHex: "#FFFFFF",
        accentHoverBgHex: "#B91C1C",
        effectTitle: "System Shackle Lockdown",
        effectMessage: `Strike count: ${strikeCount}. Total containment active. System locked.`,
      };
    }
  }
}
