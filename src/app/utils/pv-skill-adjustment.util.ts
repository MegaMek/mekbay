// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

export function adjustPointValueForSkill(basePointValue: number, skill: number): number {
    if (!Number.isInteger(basePointValue) || basePointValue < 0) {
        throw new RangeError('Base point value must be a non-negative integer.');
    }
    if (!Number.isInteger(skill) || skill < 0) {
        throw new RangeError('Alpha Strike skill must be a non-negative integer.');
    }
    // Catalog units without an Alpha Strike conversion use PV 0 at every skill.
    if (basePointValue === 0 || skill === 4) return basePointValue;
    if (skill > 4) {
        const multiplier = 1 + (basePointValue > 14 ? Math.floor((basePointValue - 5) / 10) : 0);
        return Math.max(1, basePointValue - (skill - 4) * multiplier);
    }
    const multiplier = 1 + (basePointValue > 7 ? Math.floor((basePointValue - 3) / 5) : 0);
    return Math.max(1, basePointValue + (4 - skill) * multiplier);
}
