// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

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