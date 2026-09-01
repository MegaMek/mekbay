// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { CBTForceUnit, CBTMekFallDamageRoll } from '../models/cbt-force-unit.model';
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

export interface MekFallDiceOptions {
    readonly orientationRoll?: number | null;
    readonly damageRolls?: readonly CBTMekFallDamageRoll[];
    readonly random?: () => number;
}

export interface RolledMekFallDice {
    readonly orientationRoll: number;
    readonly orientation: MekFallOrientation;
    readonly damageRolls: readonly CBTMekFallDamageRoll[];
    readonly hitLocations: readonly MekFallHitLocationResult[];
}

export interface AppliedMekFallLocationDamage {
    readonly location: string;
    /** The hit came from the rear arc; only torso locations have rear armor. */
    readonly rear: boolean;
    readonly modularArmorDamage: number;
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
                ? 'The Mek keeps its existing facing; all fall damage to the rear.'
                : 'The Mek keeps its existing facing; all fall damage to the front.',
        };
    }
    return { roll, ...TW_ORIENTATION[roll] };
}

/** Damage before terrain or armor-specific reductions. */
export function mekFallDamage(tons: number, levelsFallen = 0): number {
    const weightDamage = mekFallWeightDamage(tons);
    const normalizedLevels = Number.isFinite(levelsFallen)
        ? Math.max(0, Math.trunc(levelsFallen))
        : 0;
    return weightDamage * (normalizedLevels + 1);
}

export interface MekFallDamageBreakdown {
    readonly surfaceDamage: number;
    readonly waterDamage: number;
    readonly totalDamage: number;
}

/** MegaMek-compatible surface/bottom damage for a fall into the current water depth. */
export function resolveMekFallDamage(
    rulesId: MekFallRulesId,
    tons: number,
    levelsFallen = 0,
    waterDepth = 0,
): MekFallDamageBreakdown {
    const levels = normalizedInteger(levelsFallen);
    const depth = normalizedInteger(waterDepth);
    if (depth === 0) {
        const surfaceDamage = mekFallDamage(tons, levels);
        return { surfaceDamage, waterDamage: 0, totalDamage: surfaceDamage };
    }

    const weightDamage = mekFallWeightDamage(tons);
    if (rulesId === 'core2026') {
        const waterDamage = Math.floor(weightDamage * (levels + depth + 1) / 2);
        return { surfaceDamage: 0, waterDamage, totalDamage: waterDamage };
    }

    let surfaceDamage = Math.floor(mekFallDamage(tons, levels) / 2);
    let waterDamage = Math.floor(weightDamage * (depth + 1) / 2);
    if (depth >= levels) {
        surfaceDamage = 0;
        waterDamage = Math.floor(weightDamage * (levels + 1) / 2);
    }
    return { surfaceDamage, waterDamage, totalDamage: surfaceDamage + waterDamage };
}

/** Preserves MegaMek's independent five-point clustering for surface and bottom impacts. */
export function resolvedMekFallDamageGroups(damage: MekFallDamageBreakdown): readonly number[] {
    return [
        ...mekFallDamageGroups(damage.surfaceDamage),
        ...mekFallDamageGroups(damage.waterDamage),
    ];
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

/** Rolls or restores every die needed to resolve one fall. */
export function rollMekFallDice(
    rulesId: MekFallRulesId,
    table: MekHitLocationTable,
    damageGroupCount: number,
    options: MekFallDiceOptions = {},
): RolledMekFallDice {
    const random = options.random ?? Math.random;
    const orientationRoll = options.orientationRoll ?? rollD6(random);
    const orientation = resolveMekFallOrientation(rulesId, orientationRoll);
    const rolled = Array.from({ length: damageGroupCount }, (_unused, index) => {
        const saved = options.damageRolls?.[index];
        const hitLocationDice = saved?.hitLocationDice ?? [rollD6(random), rollD6(random)] as const;
        const preliminary = resolveMekFallHitLocation(
            table,
            orientation.hitArc,
            twoD6Total(hitLocationDice),
        );
        const needsTripodLeg = preliminary.location === null
            && preliminary.tripodLegModifier !== undefined;
        const tripodLegRoll = needsTripodLeg
            ? saved?.tripodLegRoll ?? rollD6(random)
            : null;
        return {
            damageRoll: { hitLocationDice, tripodLegRoll },
            hitLocation: tripodLegRoll === null
                ? preliminary
                : resolveMekFallHitLocation(
                    table,
                    orientation.hitArc,
                    twoD6Total(hitLocationDice),
                    tripodLegRoll,
                ),
        };
    });
    return {
        orientationRoll,
        orientation,
        damageRolls: rolled.map(result => result.damageRoll),
        hitLocations: rolled.map(result => result.hitLocation),
    };
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
        // Preserve the rolled arc through transfer; only torso locations select rear armor.
        rear: arc === 'rear',
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
        let sharedCompositePip = false;

        while (location && (damage > 0 || sharedCompositePip) && !visited.has(location)) {
            visited.add(location);
            const rear = group.rear && MEK_TORSO_LOCATIONS.has(location);
            const nextLocation: string | null = topology[location as keyof typeof topology]?.transfersTo ?? null;
            let modularArmorDamage = 0;
            let armorDamage = 0;
            let internalDamage = 0;
            let locationAppliedDamage = 0;

            if (damage > 0) {
                modularArmorDamage = unit.addModularArmorHits(location, damage);
                damage -= modularArmorDamage;
                appliedDamage += modularArmorDamage;
                locationAppliedDamage += modularArmorDamage;
            }

            const remainingArmor = Math.max(0, unit.getArmorPoints(location, rear) - unit.getArmorHits(location, rear));
            const armorType = unit.getArmorTypeAt(location);
            if (damage > 0) {
                const armor = unit.applyMekFallArmorDamage(
                    location,
                    damage,
                    rear,
                    consolidateImmediately,
                );
                armorDamage = armor.armorDamage;
                damage = armor.remainingDamage;
                appliedDamage += armor.appliedDamage;
                locationAppliedDamage += armor.appliedDamage;
                groupDamaged ||= armorDamage > 0;
            }

            const remainingInternal = Math.max(
                0,
                unit.getInternalPoints(location) - unit.getInternalHits(location),
            );
            const receivedSharedCompositePip: boolean = sharedCompositePip;
            const sharedInternalDamage = receivedSharedCompositePip && remainingInternal > 0 ? 1 : 0;
            sharedCompositePip = false;
            const structureKind = unit.getStructureKindAt(location);
            const structureIncomingDamage = damage;
            const structure = resolveMekStructureDamage(
                damage,
                remainingInternal - sharedInternalDamage,
                structureKind,
            );
            internalDamage = sharedInternalDamage + structure.internalDamage;
            if (internalDamage > 0) {
                const appliedInternalDamage = unit.addInternalHits(location, internalDamage, consolidateImmediately, {
                    hardenedArmorApplies: armorType === 'HARDENED' && remainingArmor > 0,
                    ...(armorDamage > 0 ? { armorDamagedBySameHit: true } : {}),
                    ...(receivedSharedCompositePip ? { sharedCompositePip: true } : {}),
                });
                appliedDamage += appliedInternalDamage;
                locationAppliedDamage += appliedInternalDamage;
            }
            damage = structure.overflowDamage;
            groupDamaged ||= internalDamage > 0;

            sharedCompositePip = !receivedSharedCompositePip
                && structureIncomingDamage > 0
                && unit.gameRules.id === 'core2026'
                && remainingInternal % 2 === 1
                && structureKind === 'composite'
                && internalDamage === remainingInternal
                && canShareCompositePoint(unit, nextLocation, group.rear);

            locations.push({
                location,
                rear,
                modularArmorDamage,
                armorDamage,
                internalDamage,
                appliedDamage: locationAppliedDamage,
            });

            if (damage <= 0 && !sharedCompositePip) break;
            location = nextLocation;
        }

        if (group.location === 'HD' && groupDamaged) headHits++;
        if (group.critical && groupDamaged
            && !(unit.gameRules.id === 'core2026'
                && originalArmorType === 'ANTI_PENETRATIVE_ABLATION'
                && originalArmor > 0)) {
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
    rulesId: MekFallRulesId,
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
        const modifiedDamage = incoming + Math.min(incoming, Math.floor(armor / 2));
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
            ? rulesId === 'core2026'
                ? Math.max(1, Math.floor(incoming / 2))
                : Math.max(1, 2 * Math.floor(incoming / 3) + incoming % 3)
            : incoming;
    const armorDamage = Math.min(armor, modifiedDamage);
    return {
        armorDamage,
        remainingDamage: modifiedDamage - armorDamage,
        appliedDamage: armorDamage,
    };
}

function canShareCompositePoint(
    unit: CBTForceUnit,
    location: string | null,
    rearArc: boolean,
): boolean {
    if (!location || unit.getStructureKindAt(location) !== 'composite') return false;
    const rear = rearArc && MEK_TORSO_LOCATIONS.has(location);
    return unit.getModularArmorState(location).remaining === 0
        && unit.getArmorPoints(location, rear) - unit.getArmorHits(location, rear) <= 0
        && unit.getInternalPoints(location) - unit.getInternalHits(location) > 0;
}

function throughArmorHitArc(group: ResolvedMekFallDamageGroup): MekFallHitArc {
    if (group.location === 'LT') return 'left';
    if (group.location === 'RT') return 'right';
    return group.rear ? 'rear' : 'front';
}

function normalizedInteger(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function rollD6(random: () => number): number {
    return Math.floor(random() * 6) + 1;
}

function mekFallWeightDamage(tons: number): number {
    const normalizedTons = Number.isFinite(tons) ? Math.max(0, tons) : 0;
    return Math.round(normalizedTons / 10);
}

function assertIntegerInRange(value: number, min: number, max: number, label: string): void {
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new RangeError(`${label} must be an integer from ${min} to ${max}.`);
    }
}
