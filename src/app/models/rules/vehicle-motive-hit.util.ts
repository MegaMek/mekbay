/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import type { CriticalSlot } from '../force-serialization';

export interface MotiveHitTimestamp {
    level: number;
    timestamp: number;
}

export const REPEATABLE_MOTIVE_HIT_LEVELS = new Set([2, 3]);
export const MOTIVE_HIT_PIP_COUNT = 9;

export function critId(crit: Pick<CriticalSlot, 'id' | 'name'>): string {
    return crit.id || crit.name || '';
}

export function motiveHitLevelFromId(id: string): number | null {
    const match = id.match(/^motive_system_hit_(\d+)$/);
    return match ? parseInt(match[1], 10) : null;
}

export function isRepeatableMotiveHitId(id: string): boolean {
    const level = motiveHitLevelFromId(id);
    return level !== null && REPEATABLE_MOTIVE_HIT_LEVELS.has(level);
}

export function normalizedCriticalHitTimestamps(crit: CriticalSlot): number[] {
    const count = Math.max(0, crit.hits ?? 0);
    const timestamps = normalizeTimestampArray(crit.hitTimestamps);
    if (count === 0) {
        if (timestamps.length > 0) return timestamps;
        return crit.destroyed ? [crit.destroyed] : [];
    }

    if (timestamps.length >= count) return timestamps.slice(0, count);

    const fallbackStart = timestamps[timestamps.length - 1] ?? crit.destroyed ?? 0;
    const missing = Array.from({ length: count - timestamps.length }, (_value, index) => fallbackStart + index + 1);
    return [...timestamps, ...missing];
}

export function pendingCriticalHitTimestamps(crit: CriticalSlot): number[] {
    return normalizeTimestampArray(crit.pendingHitTimestamps);
}

export function committedCriticalHitCount(crit: CriticalSlot): number {
    return normalizedCriticalHitTimestamps(crit).length;
}

export function timestampedMotiveHits(crits: readonly CriticalSlot[]): MotiveHitTimestamp[] {
    return crits
        .flatMap(crit => {
            const level = motiveHitLevelFromId(critId(crit));
            if (level === null) return [];
            if (REPEATABLE_MOTIVE_HIT_LEVELS.has(level)) {
                return normalizedCriticalHitTimestamps(crit).map(timestamp => ({ level, timestamp }));
            }
            return crit.destroyed ? [{ level, timestamp: crit.destroyed }] : [];
        })
        .sort((a, b) => a.timestamp - b.timestamp);
}

function normalizeTimestampArray(value: readonly number[] | undefined): number[] {
    return (value ?? [])
        .filter(timestamp => Number.isFinite(timestamp))
        .sort((a, b) => a - b);
}