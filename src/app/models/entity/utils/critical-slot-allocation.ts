// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

/** First contiguous run that fits, or individual slots for spreadable equipment. */
export function firstCriticalSlots(free: readonly number[], count: number, spreadable = false): number[] {
  if (count === 0) return [];
  if (spreadable) return free.slice(0, count);
  for (let start = 0; start <= free.length - count; start++) {
    if (free[start + count - 1] === free[start] + count - 1) return free.slice(start, start + count);
  }
  return [];
}
