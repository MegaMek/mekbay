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

import { GameSystem } from '../models/common.model';
import { AmmoEquipment, WeaponEquipment } from '../models/equipment.model';
import type {
    RestrictionForceSnapshot,
    RestrictionListDefinition,
    RestrictionUnitSnapshot,
    RestrictionValidationResult,
    RestrictionViolation,
} from '../models/restriction-lists.model';
import type { Unit } from '../models/units.model';

function normalizeCatalogRuleValue(value: string): string {
    return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normalizeRestrictionCatalogValues(values: readonly string[] | null | undefined): string[] {
    const result: string[] = [];
    const seen = new Set<string>();

    for (const value of values ?? []) {
        const trimmed = value.trim().replace(/\s+/g, ' ');
        const normalized = normalizeCatalogRuleValue(trimmed);
        if (!normalized || seen.has(normalized)) {
            continue;
        }

        seen.add(normalized);
        result.push(trimmed);
    }

    return result;
}

function catalogRuleValuesContain(values: readonly string[] | undefined, actualValue: string | null | undefined): boolean {
    if (!values || values.length === 0) {
        return true;
    }

    const normalizedActual = normalizeCatalogRuleValue(actualValue ?? '');
    if (!normalizedActual) {
        return false;
    }

    return values.some((value) => normalizeCatalogRuleValue(value) === normalizedActual);
}

function createViolation(list: RestrictionListDefinition, message: string): RestrictionViolation {
    return {
        listSlug: list.slug,
        listName: list.name,
        severity: 'error',
        message,
    };
}

function normalizeChassisKey(chassis: string): string {
    return chassis.trim().toLowerCase();
}

function formatNames(names: readonly string[], maxNames: number = 4): string {
    if (names.length <= maxNames) {
        return names.map((name) => `"${name}"`).join(', ');
    }

    const shown = names.slice(0, maxNames).map((name) => `"${name}"`).join(', ');
    return `${shown}, and ${names.length - maxNames} more`;
}

function unitDisplayName(unit: Pick<Unit, 'chassis' | 'model'>): string {
    return `${unit.chassis} ${unit.model}`.trim();
}

function hasForbiddenAmmoType(unit: Pick<Unit, 'comp'>, ammoTypes: readonly string[]): boolean {
    return unit.comp.some((component) => {
        const equipment = component.eq;
        if (!equipment) {
            return false;
        }

        if (equipment instanceof WeaponEquipment) {
            return ammoTypes.includes(equipment.ammoType);
        }

        if (equipment instanceof AmmoEquipment) {
            return ammoTypes.includes(equipment.ammo.type);
        }

        return false;
    });
}

function hasArrowIVHoming(unit: Pick<Unit, 'comp'>): boolean {
    return unit.comp.some((component) => {
        const equipment = component.eq;
        if (!(equipment instanceof AmmoEquipment)) {
            return false;
        }

        if (equipment.ammo.type !== 'ARROW_IV') {
            return false;
        }

        const subMunition = equipment.ammo.subMunition.toLowerCase();
        const munitionTypes = equipment.ammo.munitionType.map((type) => type.toLowerCase());
        return subMunition.includes('homing') || munitionTypes.some((type) => type.includes('homing'));
    });
}

function getCatalogViolationsForUnit(unit: Pick<Unit, 'id' | 'chassis' | 'model' | 'quirks' | 'type' | 'subtype' | 'comp' | 'as'>, list: RestrictionListDefinition): RestrictionViolation[] {
    const rules = list.catalog;
    if (!rules) {
        return [];
    }

    const violations: RestrictionViolation[] = [];
    const name = unitDisplayName(unit);

    if (list.gameSystem === GameSystem.CLASSIC && !catalogRuleValuesContain(rules.allowClassicUnitTypes, unit.type)) {
        violations.push(createViolation(list, `${name} has Classic type ${unit.type}, but ${list.name} only allows types ${formatNames(normalizeRestrictionCatalogValues(rules.allowClassicUnitTypes))}.`));
    }

    if (list.gameSystem === GameSystem.CLASSIC && !catalogRuleValuesContain(rules.allowClassicUnitSubtypes, unit.subtype)) {
        violations.push(createViolation(list, `${name} has Classic subtype ${unit.subtype}, but ${list.name} only allows subtypes ${formatNames(normalizeRestrictionCatalogValues(rules.allowClassicUnitSubtypes))}.`));
    }

    if (list.gameSystem === GameSystem.ALPHA_STRIKE && !catalogRuleValuesContain(rules.allowAlphaStrikeUnitTypes, unit.as?.TP)) {
        violations.push(createViolation(list, `${name} has Alpha Strike type ${unit.as?.TP ?? 'Unknown'}, but ${list.name} only allows Alpha Strike TP values ${formatNames(normalizeRestrictionCatalogValues(rules.allowAlphaStrikeUnitTypes))}.`));
    }

    if (rules.requireCanon && unit.id <= 0) {
        violations.push(createViolation(list, `${name} is not a canon MUL unit.`));
    }

    if (rules.forbidQuirks && unit.quirks.length > 0) {
        violations.push(createViolation(list, `${name} has quirks, which are not allowed by ${list.name}.`));
    }

    if (rules.forbidAmmoTypes && hasForbiddenAmmoType(unit, rules.forbidAmmoTypes)) {
        violations.push(createViolation(list, `${name} mounts equipment using banned ammunition for ${list.name}.`));
    }

    if (rules.forbidArrowIVHoming && hasArrowIVHoming(unit)) {
        violations.push(createViolation(list, `${name} carries Arrow IV Homing ammunition, which is not allowed by ${list.name}.`));
    }

    return violations;
}

function getRosterViolations(force: RestrictionForceSnapshot, list: RestrictionListDefinition): RestrictionViolation[] {
    const rules = list.roster;
    if (!rules) {
        return [];
    }

    const violations: RestrictionViolation[] = [];
    const units = force.units;

    if (rules.minUnits !== undefined && units.length < rules.minUnits) {
        violations.push(createViolation(list, `${list.name} requires at least ${rules.minUnits} units, but this force has ${units.length}.`));
    }

    if (rules.maxUnits !== undefined && units.length > rules.maxUnits) {
        violations.push(createViolation(list, `${list.name} allows at most ${rules.maxUnits} units, but this force has ${units.length}.`));
    }

    if (rules.uniqueChassis) {
        const chassisToUnits = new Map<string, string[]>();
        for (const unit of units) {
            const key = normalizeChassisKey(unit.unit.chassis);
            const names = chassisToUnits.get(key) ?? [];
            names.push(unit.displayName);
            chassisToUnits.set(key, names);
        }

        const duplicates = [...chassisToUnits.values()].filter((names) => names.length > 1).flat();
        if (duplicates.length > 0) {
            violations.push(createViolation(list, `${list.name} allows only one unit per chassis. Duplicate chassis found: ${formatNames(duplicates)}.`));
        }
    }

    if (rules.maxUnitsWithJumpAtLeast) {
        const matchingUnits = units.filter((unit) => unit.unit.jump >= rules.maxUnitsWithJumpAtLeast!.minimumJump);
        if (matchingUnits.length > rules.maxUnitsWithJumpAtLeast.maxUnits) {
            violations.push(createViolation(
                list,
                `${list.name} allows at most ${rules.maxUnitsWithJumpAtLeast.maxUnits} units with Jump MP ${rules.maxUnitsWithJumpAtLeast.minimumJump}+; found ${matchingUnits.length}: ${formatNames(matchingUnits.map((unit) => unit.displayName))}.`,
            ));
        }
    }

    return violations;
}

function getClassicLiveViolations(force: RestrictionForceSnapshot, list: RestrictionListDefinition): RestrictionViolation[] {
    const rules = list.live?.classic;
    if (!rules || force.gameSystem !== GameSystem.CLASSIC) {
        return [];
    }

    const violations: RestrictionViolation[] = [];

    for (const unit of force.units) {
        for (const crew of unit.classicCrewSkills ?? []) {
            if (rules.crewSkillMin !== undefined && (crew.gunnery < rules.crewSkillMin || crew.piloting < rules.crewSkillMin)) {
                violations.push(createViolation(list, `${unit.displayName} has crew skills below the ${rules.crewSkillMin} minimum required by ${list.name}.`));
            }

            if (rules.crewSkillMax !== undefined && (crew.gunnery > rules.crewSkillMax || crew.piloting > rules.crewSkillMax)) {
                violations.push(createViolation(list, `${unit.displayName} has crew skills above the ${rules.crewSkillMax} maximum allowed by ${list.name}.`));
            }

            if (rules.maxGunneryPilotingDelta !== undefined && Math.abs(crew.gunnery - crew.piloting) > rules.maxGunneryPilotingDelta) {
                violations.push(createViolation(list, `${unit.displayName} has Gunnery/Piloting farther apart than ${rules.maxGunneryPilotingDelta} for ${list.name}.`));
            }
        }
    }

    return violations;
}

function getAlphaStrikeLiveViolations(force: RestrictionForceSnapshot, list: RestrictionListDefinition): RestrictionViolation[] {
    const rules = list.live?.alphaStrike;
    if (!rules || force.gameSystem !== GameSystem.ALPHA_STRIKE) {
        return [];
    }

    const violations: RestrictionViolation[] = [];

    for (const unit of force.units) {
        if (rules.allowManualPilotAbilities === false && (unit.manualAbilityCount ?? 0) > 0) {
            violations.push(createViolation(list, `${unit.displayName} has manual pilot abilities, which are not allowed by ${list.name}.`));
        }

        if (rules.allowFormationAbilities === false && (unit.formationAbilityCount ?? 0) > 0) {
            violations.push(createViolation(list, `${unit.displayName} has formation abilities, which are not allowed by ${list.name}.`));
        }
    }

    return violations;
}

export function normalizeRestrictionListSlugs(slugs: readonly string[]): string[] {
    const result: string[] = [];
    const seen = new Set<string>();

    for (const slug of slugs) {
        const normalized = slug.trim().toLowerCase();
        if (!normalized || seen.has(normalized)) {
            continue;
        }

        seen.add(normalized);
        result.push(normalized);
    }

    return result;
}

export function parseRestrictionListSlugsParam(param: string | null): string[] {
    if (!param) {
        return [];
    }

    return normalizeRestrictionListSlugs(param.split(','));
}

export function serializeRestrictionListSlugsParam(slugs: readonly string[]): string | null {
    const normalized = normalizeRestrictionListSlugs(slugs);
    return normalized.length > 0 ? normalized.join(',') : null;
}

export function filterUnitsByRestrictionLists(units: readonly Unit[], lists: readonly RestrictionListDefinition[]): Unit[] {
    if (lists.length === 0) {
        return units as Unit[];
    }

    return units.filter((unit) => {
        return lists.every((list) => getCatalogViolationsForUnit(unit, list).length === 0);
    });
}

export function validateForceAgainstRestrictionLists(
    force: RestrictionForceSnapshot,
    lists: readonly RestrictionListDefinition[],
): RestrictionValidationResult[] {
    return lists
        .filter((list) => list.gameSystem === force.gameSystem)
        .map((list) => {
            const unitViolations = force.units.flatMap((unit) => getCatalogViolationsForUnit(unit.unit, list));
            const rosterViolations = getRosterViolations(force, list);
            const classicLiveViolations = getClassicLiveViolations(force, list);
            const alphaStrikeLiveViolations = getAlphaStrikeLiveViolations(force, list);

            return {
                list,
                violations: [...unitViolations, ...rosterViolations, ...classicLiveViolations, ...alphaStrikeLiveViolations],
            };
        });
}

export function buildRestrictionWarningMessage(results: readonly RestrictionValidationResult[]): string | null {
    const messages = results.flatMap((result) => result.violations.map((violation) => violation.message));
    return messages.length > 0 ? messages.join(' ') : null;
}

export function buildRestrictionUnitSnapshot(unit: Unit, displayName?: string): RestrictionUnitSnapshot {
    return {
        displayName: displayName ?? unitDisplayName(unit),
        unit,
    };
}