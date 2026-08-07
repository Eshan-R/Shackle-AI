/**
 * Utility functions for Exponential Level XP scaling.
 * Formula: XP Required to reach target level N = 60 * N^1.5
 */

export function getXpForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.floor(60 * Math.pow(level, 1.5));
}

export function getLevelFromXp(xp: number): {
  level: number;
  currentLevelXp: number;
  nextLevelRequirement: number;
  percent: number;
} {
  let level = 1;
  while (true) {
    const required = 60 * Math.pow(level + 1, 1.5);
    if (xp < required) break;
    level++;
  }
  const prevLevelXp = level === 1 ? 0 : 60 * Math.pow(level, 1.5);
  const nextLevelTotalXp = 60 * Math.pow(level + 1, 1.5);

  const currentLevelXp = xp - prevLevelXp;
  const nextLevelRequirement = nextLevelTotalXp - prevLevelXp;
  const percent = Math.min(Math.max((currentLevelXp / nextLevelRequirement) * 100, 0), 100);

  return {
    level,
    currentLevelXp,
    nextLevelRequirement,
    percent
  };
}
