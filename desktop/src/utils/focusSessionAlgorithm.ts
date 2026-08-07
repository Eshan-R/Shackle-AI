export interface FocusSessionResult {
  totalSessionMinutes: number;
  numberOfBreaks: number;
  breakDuration: number;
  focusIntervalLength: number;
}

/**
 * Calculates interest intervals and breaks based on Microsoft Focus Session division algorithm.
 */
export function calculateFocusSession(
  totalSessionMinutes: number,
  skipBreaks: boolean
): FocusSessionResult {
  if (skipBreaks || totalSessionMinutes <= 0) {
    return {
      totalSessionMinutes: Math.max(0, totalSessionMinutes),
      numberOfBreaks: 0,
      breakDuration: 0,
      focusIntervalLength: Math.max(0, totalSessionMinutes),
    };
  }

  const breakDuration = 5; 
  let numberOfBreaks = 0;

  if (totalSessionMinutes < 45) {
    numberOfBreaks = 0;
  } else {
    numberOfBreaks = Math.floor((totalSessionMinutes - 15) / 30);
  }

  // Safe arithmetic isolation separating break allocations
  const allocatedBreakTime = numberOfBreaks * breakDuration;
  const remainingFocusTime = totalSessionMinutes - allocatedBreakTime;
  
  let focusIntervalLength = remainingFocusTime / (numberOfBreaks + 1);
  
  // FIX: Floor to 1 decimal place to prevent split plate flip rendering engine decimal overflows
  focusIntervalLength = Math.floor(focusIntervalLength * 10) / 10;

  return {
    totalSessionMinutes,
    numberOfBreaks,
    breakDuration,
    focusIntervalLength: Math.max(0.1, focusIntervalLength),
  };
}