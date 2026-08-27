// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import { getMekLocationLabel, getTopologyFor, MEK_TORSO_LOCATIONS, type ArmorType } from '../models/entity/types';
import type { MekHitArc } from '../models/force-serialization';
import { fullDoubleDamagePipsRemoved, resolveMekStructureDamage } from './mek-structure-damage.util';
import {
    hitLocationCellDefinition,
    type MekHitLocationTable,
} from './record-sheet-reference-table';

export type MekFallRulesId = 'core2026' | 'tw';
export type MekFallHitArc = MekHitArc;

export interface MekFallOrientation {
    readonly roll: number;
    /** Clockwise hexside change from the facing before the fall. */
    readonly facingOffset: number;
    readonly facingInstruction: string;
    readonly hitArc: MekFallHitArc;
    readonly hitArcLabel: string;
    readonly rulesExplanation: string;
}

export interface MekFallHitLocationResult {
    readonly hitLocationRoll: number;
    readonly rawTableResult: string;
    readonly tableLabel: string;
    readonly location: string | null;
    readonly locationLabel: string | null;
    readonly rear: boolean;
    readonly critical: boolean;
    readonly tripodLegRoll?: number;
    readonly tripodLegModifier?: number;
    readonly adjustedTripodLegRoll?: number;
}

export interface ResolvedMekFallDamageGroup extends MekFallHitLocationResult {
    readonly damage: number;
    readonly location: string;
    readonly locationLabel: string;
}

export interface AppliedMekFallLocationDamage {
    readonly location: string;
    readonly rear: boolean;
    readonly armorDamage: number;
    readonly internalDamage: number;
    /** Rule-adjusted damage points consumed at this location. */
    readonly appliedDamage: number;
}

export interface AppliedMekFallDamage {
    readonly appliedDamage: number;
    readonly headHits: number;
    readonly locations: readonly AppliedMekFallLocationDamage[];
}

const TW_ORIENTATION: Readonly<Record<number, Omit<MekFallOrientation, 'roll'>>> = {
    1: {
        facingOffset: 0,
        facingInstruction: 'Keep the current facing',
        hitArc: 'front',
        hitArcLabel: 'Front',
        rulesExplanation: 'The Mek falls forward without changing facing.',
    },
    2: {
        facingOffset: 1,
        facingInstruction: 'Turn 1 hexside to the right',
        hitArc: 'right',
        hitArcLabel: 'Right side',
        rulesExplanation: 'The new facing is one hexside clockwise.',
    },
    3: {
        facingOffset: 2,
        facingInstruction: 'Turn 2 hexsides to the right',
        hitArc: 'right',
        hitArcLabel: 'Right side',
        rulesExplanation: 'The new facing is two hexsides clockwise.',
    },
    4: {
        facingOffset: 3,
        facingInstruction: 'Reverse facing',
        hitArc: 'rear',
        hitArcLabel: 'Rear',
        rulesExplanation: 'The new facing is opposite the old facing.',
    },
    5: {
        facingOffset: -2,
        facingInstruction: 'Turn 2 hexsides to the left',
        hitArc: 'left',
        hitArcLabel: 'Left side',
        rulesExplanation: 'The new facing is two hexsides counter-clockwise.',
    },
    6: {
        facingOffset: -1,
        facingInstruction: 'Turn 1 hexside to the left',
        hitArc: 'left',
        hitArcLabel: 'Left side',
        rulesExplanation: 'The new facing is one hexside counter-clockwise.',
    },
};

/** Resolves the rulebook-specific 1D6 orientation/damage-arc roll. */
export function resolveMekFallOrientation(rulesId: MekFallRulesId, roll: number): MekFallOrientation {
    assertIntegerInRange(roll, 1, 6, 'Fall orientation roll');
    if (rulesId === 'core2026') {
        const rear = roll === 1;
        return {
            roll,
            facingOffset: 0,
            facingInstruction: 'Keep the current facing',
            hitArc: rear ? 'rear' : 'front',
            hitArcLabel: rear ? 'Rear' : 'Front',
            rulesExplanation: rear
                ? 'The Mek keeps its existing facing; a roll of 1 applies all fall damage to the rear.'
                : 'The Mek keeps its existing facing; a roll of 2–6 applies all fall damage to the front.',
        };
    }
    return { roll, ...TW_ORIENTATION[roll] };
}

/** Damage before terrain or armor-specific reductions. */
export function mekFallDamage(tons: number, levelsFallen = 0): number {
    const normalizedTons = Number.isFinite(tons) ? Math.max(0, tons) : 0;
    const normalizedLevels = Number.isFinite(levelsFallen)
        ? Math.max(0, Math.trunc(levelsFallen))
        : 0;
    return Math.ceil(normalizedTons / 10) * (normalizedLevels + 1);
}

/** Splits a fall into independently located groups of at most 5 damage. */
export function mekFallDamageGroups(damage: number): readonly number[] {
    let remaining = Number.isFinite(damage) ? Math.max(0, Math.trunc(damage)) : 0;
    const groups: number[] = [];
    while (remaining > 0) {
        const group = Math.min(5, remaining);
        groups.push(group);
        remaining -= group;
    }
    return groups;
}

export function twoD6Total(dice: readonly [number, number]): number {
    return dice[0] + dice[1];
}

export function twoD6ForTotal(total: number | null): readonly [number, number] | null {
    return total !== null && Number.isInteger(total) && total >= 2 && total <= 12
        ? [Math.floor(total / 2), Math.ceil(total / 2)]
        : null;
}

/** Resolves one 2D6 hit-location roll, including the extra tripod leg roll. */
export function resolveMekFallHitLocation(
    table: MekHitLocationTable,
    arc: MekFallHitArc,
    hitLocationRoll: number,
    tripodLegRoll?: number,
): MekFallHitLocationResult {
    assertIntegerInRange(hitLocationRoll, 2, 12, 'Fall hit-location roll');
    if (tripodLegRoll !== undefined) {
        assertIntegerInRange(tripodLegRoll, 1, 6, 'Tripod leg roll');
    }

    const cell = hitLocationCellDefinition(table, hitLocationRoll, arc);
    const tripodLeg = cell.tripodLegModifier !== undefined;
    let location: string | null;
    let adjustedTripodLegRoll: number | undefined;

    if (tripodLeg) {
        if (tripodLegRoll === undefined) {
            location = null;
        } else {
            adjustedTripodLegRoll = tripodLegRoll + cell.tripodLegModifier!;
            location = adjustedTripodLegRoll <= 2 ? 'RL'
                : adjustedTripodLegRoll <= 4 ? 'CL' : 'LL';
        }
    } else {
        location = cell.location;
    }

    return {
        hitLocationRoll,
        rawTableResult: cell.tableText,
        tableLabel: cell.tableLabel,
        location,
        locationLabel: getMekLocationLabel(location ?? undefined),
        rear: arc === 'rear' && location !== null && MEK_TORSO_LOCATIONS.has(location),
        critical: cell.critical,
        ...(tripodLegRoll !== undefined && tripodLeg ? { tripodLegRoll } : {}),
        ...(cell.tripodLegModifier !== undefined ? { tripodLegModifier: cell.tripodLegModifier } : {}),
        ...(adjustedTripodLegRoll !== undefined ? { adjustedTripodLegRoll } : {}),
    };
}

export interface MekFallArmorDamageResolution {
    readonly armorDamage: number;
    readonly remainingDamage: number;
    readonly appliedDamage: number;
}

export function isResolvedMekFallHitLocation(
    result: MekFallHitLocationResult,
): result is MekFallHitLocationResult & { readonly location: string; readonly locationLabel: string } {
    return result.location !== null && result.locationLabel !== null;
}

/** Applies resolved fall groups to armor/structure and follows normal Mek damage transfer. */
export function applyMekFallDamage(
    unit: CBTForceUnit,
    groups: readonly ResolvedMekFallDamageGroup[],
    consolidateImmediately: boolean,
): AppliedMekFallDamage {
    const topology = getTopologyFor(unit.locations?.internal.keys() ?? []);
    const locations: AppliedMekFallLocationDamage[] = [];
    let appliedDamage = 0;
    let headHits = 0;

    for (const group of groups) {
        let damage = Math.max(0, Math.trunc(group.damage));
        let location: string | null = group.location;
        const originalRear = group.rear && MEK_TORSO_LOCATIONS.has(group.location);
        const originalArmor = Math.max(
            0,
            unit.getArmorPoints(group.location, originalRear)
                - unit.getArmorHits(group.location, originalRear),
        );
        const originalArmorType = unit.getArmorTypeAt(group.location);
        const visited = new Set<string>();
        let groupDamaged = false;

        while (location && damage > 0 && !visited.has(location)) {
            visited.add(location);
            const rear = group.rear && MEK_TORSO_LOCATIONS.has(location);
            const remainingArmor = Math.max(0, unit.getArmorPoints(location, rear) - unit.getArmorHits(location, rear));
            const armorType = unit.getArmorTypeAt(location);
            const armor = resolveMekFallArmorDamage(
                damage,
                remainingArmor,
                armorType,
            );
            const armorDamage = armor.armorDamage;
            if (armorDamage > 0) {
                unit.addArmorHits(
                    location,
                    armorDamage,
                    rear,
                    consolidateImmediately,
                    armor.appliedDamage,
                );
            }
            damage = armor.remainingDamage;
            appliedDamage += armor.appliedDamage;
            groupDamaged ||= armorDamage > 0;

            const remainingInternal = Math.max(
                0,
                unit.getInternalPoints(location) - unit.getInternalHits(location),
            );
            const structure = resolveMekStructureDamage(
                damage,
                remainingInternal,
                unit.getStructureKindAt(location),
            );
            const internalDamage = structure.internalDamage;
            if (internalDamage > 0) {
                unit.addInternalHits(location, internalDamage, consolidateImmediately, {
                    hardenedArmorApplies: armorType === 'HARDENED' && remainingArmor > 0,
                });
            }
            damage = structure.overflowDamage;
            appliedDamage += structure.phaseDamage;
            groupDamaged ||= internalDamage > 0;

            locations.push({
                location,
                rear,
                armorDamage,
                internalDamage,
                appliedDamage: armor.appliedDamage + structure.phaseDamage,
            });

            if (damage <= 0) break;
            location = topology[location as keyof typeof topology]?.transfersTo ?? null;
        }

        if (group.location === 'HD' && groupDamaged) headHits++;
        if (group.critical && groupDamaged
            && !(originalArmorType === 'ANTI_PENETRATIVE_ABLATION' && originalArmor > 0)) {
            unit.queueMekCriticalChance(group.location, {
                consolidateImmediately,
                hardenedArmorApplies: originalArmorType === 'HARDENED' && originalArmor > 0,
                throughArmorHitArc: throughArmorHitArc(group),
            });
        }
    }

    return { appliedDamage, headHits, locations };
}

/** Applies the armor rule for physical non-attack damage at one exact location. */
export function resolveMekFallArmorDamage(
    damage: number,
    remainingArmor: number,
    armorType: ArmorType | null,
): MekFallArmorDamageResolution {
    const incoming = normalizedInteger(damage);
    const armor = normalizedInteger(remainingArmor);
    if (incoming === 0 || armor === 0) {
        return {
            armorDamage: 0,
            remainingDamage: incoming,
            appliedDamage: 0,
        };
    }

    if (armorType === 'REFLECTIVE') {
        const modifiedDamage = incoming * 2;
        if (armor >= modifiedDamage) {
            return {
                armorDamage: modifiedDamage,
                remainingDamage: 0,
                appliedDamage: modifiedDamage,
            };
        }
        const absorbedDamage = Math.ceil(armor / 2);
        return {
            armorDamage: armor,
            remainingDamage: Math.max(0, incoming - absorbedDamage),
            appliedDamage: absorbedDamage * 2,
        };
    }

    if (armorType === 'HARDENED') {
        const absorbedDamage = Math.min(incoming, armor);
        return {
            armorDamage: absorbedDamage,
            remainingDamage: incoming - absorbedDamage,
            appliedDamage: fullDoubleDamagePipsRemoved(armor, absorbedDamage),
        };
    }

    const modifiedDamage = armorType === 'FERRO_LAMELLOR'
        ? Math.floor(incoming * 4 / 5)
        : armorType === 'IMPACT_RESISTANT'
            ? Math.max(1, Math.floor(incoming / 2))
            : incoming;
    const armorDamage = Math.min(armor, modifiedDamage);
    return {
        armorDamage,
        remainingDamage: modifiedDamage - armorDamage,
        appliedDamage: armorDamage,
    };
}

function throughArmorHitArc(group: ResolvedMekFallDamageGroup): MekFallHitArc {
    if (group.location === 'LT') return 'left';
    if (group.location === 'RT') return 'right';
    return group.rear ? 'rear' : 'front';
}

function normalizedInteger(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function assertIntegerInRange(value: number, min: number, max: number, label: string): void {
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new RangeError(`${label} must be an integer from ${min} to ${max}.`);
    }
}
