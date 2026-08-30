// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ComponentId } from './entity/entity-identifiers';

const PROTOTYPE_LASER_MAX_EXTRA_HEAT = Object.freeze(new Map<string, 3 | 6>([
    ['ISSmallPulseLaserPrototype', 3],
    ['ISMediumPulseLaserPrototype', 6],
    ['ISLargePulseLaserPrototype', 6],
    ['ISERLargeLaserPrototype', 6],
    ['ISMediumPulseLaserRecovered', 6],
]));

export interface PrototypeLaserHeatRoll {
    readonly weaponId: ComponentId;
    readonly roll: number;
}

export interface PrototypeLaserHeatResult extends PrototypeLaserHeatRoll {
    readonly additionalHeat: number;
    readonly detail: string;
}

export type PrototypeLaserHeatRollMapResult =
    | Readonly<{ readonly accepted: true; readonly rolls: ReadonlyMap<ComponentId, number> }>
    | Readonly<{ readonly accepted: false }>;

export function prototypeLaserMaximumExtraHeat(internalName: string): 0 | 3 | 6 {
    return PROTOTYPE_LASER_MAX_EXTRA_HEAT.get(internalName) ?? 0;
}

export function prototypeLaserHeatForRoll(
    internalName: string,
    weaponId: ComponentId,
    roll: number,
): PrototypeLaserHeatResult | null {
    const maximum = prototypeLaserMaximumExtraHeat(internalName);
    if (maximum === 0 || !Number.isInteger(roll) || roll < 1 || roll > 6) return null;
    return Object.freeze({
        weaponId,
        roll,
        additionalHeat: maximum === 3 ? Math.ceil(roll / 2) : roll,
        detail: maximum === 3
            ? `1D3 (1D6 roll: ${roll})`
            : `1D6 roll: ${roll}`,
    });
}

/** Canonical validation shared by Mek and non-Mek deterministic fire reducers. */
export function prototypeLaserHeatRollMap(
    evidence: readonly PrototypeLaserHeatRoll[] | undefined,
): PrototypeLaserHeatRollMapResult {
    if (evidence === undefined) {
        return Object.freeze({ accepted: true, rolls: new Map<ComponentId, number>() });
    }
    if (!Array.isArray(evidence) || evidence.length > 256) return Object.freeze({ accepted: false });
    const rolls = new Map<ComponentId, number>();
    for (const row of evidence) {
        if (!row || typeof row !== 'object'
            || typeof row.weaponId !== 'string'
            || !Number.isInteger(row.roll)
            || row.roll < 1
            || row.roll > 6
            || rolls.has(row.weaponId)) {
            return Object.freeze({ accepted: false });
        }
        rolls.set(row.weaponId, row.roll);
    }
    return Object.freeze({ accepted: true, rolls });
}

