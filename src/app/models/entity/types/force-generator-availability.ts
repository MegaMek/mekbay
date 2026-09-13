// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

/** Authored force-generation frequency, distinct from equipment technology availability. */
export interface ForceGeneratorAvailability {
  readonly startYear: number;
  readonly endYear: number;
  readonly availabilityCodes: string;
}

/** MegaMek ForceGeneratorAvailability uses zero for either unspecified year. */
export function parseForceGeneratorAvailability(
  lines: readonly string[],
  warn: (message: string) => void,
): ForceGeneratorAvailability[] {
  const entries: ForceGeneratorAvailability[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const range = /^(\d{3,4})?\s*-\s*(\d{3,4})?[\s:]+(.+)$/u.exec(trimmed);
    const hasRange = range && (range[1] || range[2]);
    const startYear = hasRange ? Number(range[1] ?? 0) : 0;
    const endYear = hasRange ? Number(range[2] ?? 0) : 0;
    if (startYear && endYear && endYear < startYear) {
      warn(`Availability end year ${endYear} is before start year ${startYear}`);
      continue;
    }
    entries.push({ startYear, endYear, availabilityCodes: hasRange ? range[3].trim() : trimmed });
  }
  return entries;
}

export function formatForceGeneratorAvailability(entry: ForceGeneratorAvailability): string {
  if (!entry.startYear && !entry.endYear) return entry.availabilityCodes;
  return `${entry.startYear || ''}-${entry.endYear || ''} ${entry.availabilityCodes}`;
}
