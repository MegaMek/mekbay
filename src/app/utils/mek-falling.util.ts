// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import { getMekLocationLabel, getTopologyFor, MEK_TORSO_LOCATIONS } from '../models/entity/types';
import type { MekHitArc } from '../models/force-serialization';
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
    const compositeMultiplier = unit.getUnit().structureType?.trim().toLowerCase() === 'composite' ? 2 : 1;
    const armorType = unit.getUnit().armorType;
    const impactResistant = isImpactResistantArmor(armorType);
    const antiPenetrativeAblation = isAntiPenetrativeAblationArmor(armorType);
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
        let impactReductionApplied = false;
        const visited = new Set<string>();
        let groupAppliedDamage = 0;

        while (location && damage > 0 && !visited.has(location)) {
            visited.add(location);
            const rear = group.rear && MEK_TORSO_LOCATIONS.has(location);
            const remainingArmor = Math.max(0, unit.getArmorPoints(location, rear) - unit.getArmorHits(location, rear));
            if (impactResistant && remainingArmor > 0 && !impactReductionApplied) {
                damage = Math.max(1, Math.floor(damage / 2));
                impactReductionApplied = true;
            }

            const armorDamage = Math.min(damage, remainingArmor);
            if (armorDamage > 0) {
                unit.addArmorHits(location, armorDamage, rear, consolidateImmediately);
                damage -= armorDamage;
                appliedDamage += armorDamage;
                groupAppliedDamage += armorDamage;
            }

            const remainingInternal = Math.max(
                0,
                unit.getInternalPoints(location) - unit.getInternalHits(location),
            );
            const internalDamage = Math.min(remainingInternal, damage * compositeMultiplier);
            if (internalDamage > 0) {
                unit.addInternalHits(location, internalDamage, consolidateImmediately, {
                    hardenedArmorApplies: remainingArmor > 0,
                });
                const damagePoints = internalDamage / compositeMultiplier;
                damage = Math.max(0, damage - damagePoints);
                appliedDamage += damagePoints;
                groupAppliedDamage += damagePoints;
            }

            locations.push({
                location,
                rear,
                armorDamage,
                internalDamage,
            });

            if (damage <= 0) break;
            location = topology[location as keyof typeof topology]?.transfersTo ?? null;
        }

        if (group.location === 'HD' && groupAppliedDamage > 0) headHits++;
        if (group.critical && groupAppliedDamage > 0
            && !(antiPenetrativeAblation && originalArmor > 0)) {
            unit.queueMekCriticalChance(group.location, {
                consolidateImmediately,
                hardenedArmorApplies: originalArmor > 0,
                throughArmorHitArc: throughArmorHitArc(group),
            });
        }
    }

    return { appliedDamage, headHits, locations };
}

function throughArmorHitArc(group: ResolvedMekFallDamageGroup): MekFallHitArc {
    if (group.location === 'LT') return 'left';
    if (group.location === 'RT') return 'right';
    return group.rear ? 'rear' : 'front';
}

const IMPACT_RESISTANT_ARMOR_NAMES = new Set([
    'impact-resistant',
    'impact resistant',
    'impact_resistant',
]);

const ANTI_PENETRATIVE_ABLATION_ARMOR_NAMES = new Set([
    'anti-penetrative-ablation',
    'anti penetrative ablation',
    'anti_penetrative_ablation',
    'anti-penetrative-ablative',
    'anti penetrative ablative',
    'anti_penetrative_ablative',
]);

export function isImpactResistantArmor(armorType: string): boolean {
    return IMPACT_RESISTANT_ARMOR_NAMES.has(armorType.trim().toLowerCase());
}

function isAntiPenetrativeAblationArmor(armorType: string): boolean {
    return ANTI_PENETRATIVE_ABLATION_ARMOR_NAMES.has(armorType.trim().toLowerCase());
}

function assertIntegerInRange(value: number, min: number, max: number, label: string): void {
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new RangeError(`${label} must be an integer from ${min} to ${max}.`);
    }
}
