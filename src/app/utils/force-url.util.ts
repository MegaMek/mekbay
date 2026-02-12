/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
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

import { Unit } from '../models/units.model';
import { Force, UnitGroup } from '../models/force.model';
import { ForceUnit } from '../models/force-unit.model';
import { ASForceUnit } from '../models/as-force-unit.model';
import { CBTForceUnit } from '../models/cbt-force-unit.model';
import { DEFAULT_GUNNERY_SKILL, DEFAULT_PILOTING_SKILL } from '../models/crew-member.model';
import { GameSystem } from '../models/common.model';
import { ForceSlot } from '../models/force-slot.model';

/**
 * Minimal logger interface for URL parsing warnings.
 */
export interface UrlParseLogger {
    warn(message: string): void;
}

/**
 * Parameters derived from a Force (or set of forces) for URL serialization.
 * For multi-force support, `instance` may contain comma-separated IDs.
 */
export interface ForceQueryParams {
    gs: GameSystem | null;
    units: string | null;
    name: string | null;
    instance: string | null;
}

/**
 * Builds URL query parameters from a Force's current state.
 */
export function buildForceQueryParams(force: Force | null): ForceQueryParams {
    if (!force) {
        return { gs: null, units: null, name: null, instance: null };
    }
    const instanceId = force.instanceId();
    const groups = force.groups() || [];
    const units = force.units() || [];
    let forceName: string | undefined = force.name;
    if (units.length === 0) {
        forceName = undefined;
    }
    const groupParams = generateGroupUrlParams(groups);
    return {
        gs: force.gameSystem,
        units: groupParams.length > 0 ? groupParams.join('|') : null,
        name: forceName || null,
        instance: instanceId || null
    };
}

/**
 * Builds URL query parameters representing ALL loaded forces.
 *
 * - Saved forces (with instanceId) are combined into a comma-separated `instance` param.
 *   Enemy forces are prefixed with `enemy:` (friendly is the default, no prefix).
 *   Example: `instance=UUID1,enemy:UUID2,UUID3`
 * - At most one unsaved force (without instanceId) is serialized via `gs`, `units`, `name`.
 *   Unsaved forces are always friendly (our own force).
 */
export function buildMultiForceQueryParams(slots: ForceSlot[]): ForceQueryParams {
    if (slots.length === 0) {
        return { gs: null, units: null, name: null, instance: null };
    }

    // Collect instance IDs from saved forces, with alignment prefix
    const instanceEntries: string[] = [];
    let unsavedForce: Force | null = null;

    for (const slot of slots) {
        const id = slot.force.instanceId();
        if (id) {
            instanceEntries.push(slot.alignment === 'enemy' ? `enemy:${id}` : id);
        } else if (!unsavedForce) {
            // Only the first unsaved force is serialized (constraint: max one unsaved)
            unsavedForce = slot.force;
        }
    }

    // Build unsaved force params (gs/units/name)
    let gs: GameSystem | null = null;
    let units: string | null = null;
    let name: string | null = null;

    if (unsavedForce) {
        gs = unsavedForce.gameSystem;
        const groups = unsavedForce.groups() || [];
        const groupParams = generateGroupUrlParams(groups);
        units = groupParams.length > 0 ? groupParams.join('|') : null;
        const forceName = unsavedForce.units().length > 0 ? unsavedForce.name : undefined;
        name = forceName || null;
    }

    return {
        gs,
        units,
        name,
        instance: instanceEntries.length > 0 ? instanceEntries.join(',') : null
    };
}

/**
 * Generates URL parameters for all groups in a force.
 * Format: groupName~unit1,unit2|groupName2~unit3,unit4
 */
export function generateGroupUrlParams(groups: UnitGroup[]): string[] {
    return groups.filter(g => g.units().length > 0).map(group => {
        const unitParams = generateUnitUrlParams(group.units());
        let groupName = group.name();
        if (groupName) {
            return `${groupName}~${unitParams.join(',')}`;
        } else {
            return unitParams.join(','); // No group name, just return unit;
        }
    });
}

/**
 * Generates URL parameters for units within a group.
 *
 * Format for CBT: unitName:gunnery:piloting (skills omitted if all defaults)
 * Format for AS:  unitName:skill (skill omitted if default 4)
 */
export function generateUnitUrlParams(units: ForceUnit[]): string[] {
    return units.map(fu => {
        const unit = fu.getUnit();
        let unitParam = unit.name;

        // Handle Alpha Strike units (single pilot skill)
        if (fu instanceof ASForceUnit) {
            const skill = fu.pilotSkill();
            // Only include skill if not default (4)
            if (skill !== DEFAULT_GUNNERY_SKILL) {
                unitParam += `:${skill}`;
            }
            return unitParam;
        }

        // Handle CBT units (crew members with gunnery/piloting)
        if (fu instanceof CBTForceUnit) {
            const crewMembers = fu.getCrewMembers();
            if (crewMembers.length > 0) {
                // Check if any crew member has non-default skills
                const hasNonDefaultSkills = crewMembers.some(crew =>
                    crew.getSkill('gunnery') !== DEFAULT_GUNNERY_SKILL ||
                    crew.getSkill('piloting') !== DEFAULT_PILOTING_SKILL
                );

                if (hasNonDefaultSkills) {
                    const crewSkills: string[] = [];
                    for (const crew of crewMembers) {
                        const gunnery = crew.getSkill('gunnery');
                        const piloting = crew.getSkill('piloting');
                        crewSkills.push(`${gunnery}`, `${piloting}`);
                    }
                    if (crewSkills.length > 0) {
                        unitParam += ':' + crewSkills.join(':');
                    }
                }
            }
        }

        return unitParam;
    });
}

/**
 * Parses units from a URL parameter string, creating groups and adding units
 * to the provided force.
 *
 * Supports two formats:
 * - New format: `groupName~unit1,unit2|groupName2~unit3,unit4`
 * - Legacy format: `unit1,unit2,unit3`
 *
 * **Note:** This function _mutates_ the provided force by calling
 * `force.addGroup()` and `force.addUnit()`.
 */
export function parseForceFromUrl(
    force: Force,
    unitsParam: string,
    allUnits: Unit[],
    logger?: UrlParseLogger
): ForceUnit[] {
    const unitMap = new Map(allUnits.map(u => [u.name, u]));
    const allForceUnits: ForceUnit[] = [];

    // Check if it's the new group format (contains '|' or '~')
    const hasGroups = unitsParam.includes('|') || unitsParam.includes('~');

    if (hasGroups) {
        // New format with groups
        const groupParams = unitsParam.split('|');
        for (const groupParam of groupParams) {
            if (!groupParam.trim()) continue;

            let groupName: string | null = null;
            let unitsStr: string;

            // Check if group has a name (format: groupName~units)
            if (groupParam.includes('~')) {
                const [namePart, unitsPart] = groupParam.split('~', 2);
                groupName = namePart;
                unitsStr = unitsPart || '';
            } else {
                unitsStr = groupParam;
            }

            // Create or get group
            const group = force.addGroup();
            if (groupName) {
                group.name.set(groupName);
            }

            // Parse units for this group
            const groupUnits = parseUnitUrlParams(force, unitsStr, unitMap, group, logger);
            allForceUnits.push(...groupUnits);
        }
    } else {
        // Legacy format without groups — all units in default group
        const groupUnits = parseUnitUrlParams(force, unitsParam, unitMap, undefined, logger);
        allForceUnits.push(...groupUnits);
    }

    return allForceUnits;
}

/**
 * Parses individual unit parameters from a comma-separated string
 * and adds them to the force.
 *
 * Format for CBT: `unitName[:gunnery:piloting]` (skills optional, defaults to 4/5)
 * Format for AS:  `unitName[:skill]` (skill optional, defaults to 4)
 *
 * **Note:** This function _mutates_ the force by calling `force.addUnit()`
 * and modifying group membership / crew skills.
 */
export function parseUnitUrlParams(
    force: Force,
    unitsStr: string,
    unitMap: Map<string, Unit>,
    group?: UnitGroup,
    logger?: UrlParseLogger
): ForceUnit[] {
    if (!unitsStr.trim()) return [];

    const unitParams = unitsStr.split(',');
    const forceUnits: ForceUnit[] = [];

    for (const unitParam of unitParams) {
        if (!unitParam.trim()) continue;

        const parts = unitParam.split(':');
        const unitName = parts[0];
        const unit = unitMap.get(unitName);

        if (!unit) {
            logger?.warn(`Unit "${unitName}" not found in data`);
            continue;
        }

        const forceUnit = force.addUnit(unit);

        // Move unit to the specified group if provided
        if (group) {
            // Remove from default group and add to specified group
            const defaultGroup = force.groups().find(g => g.units().some(u => u.id === forceUnit.id));
            if (defaultGroup && defaultGroup.id !== group.id) {
                defaultGroup.units.set(defaultGroup.units().filter(u => u.id !== forceUnit.id));
                group.units.set([...group.units(), forceUnit]);
            }
        }

        // Parse skills if present
        if (parts.length > 1) {
            forceUnit.disabledSaving = true;

            // Handle Alpha Strike units
            if (forceUnit instanceof ASForceUnit) {
                const skill = parseInt(parts[1]);
                if (!isNaN(skill)) {
                    forceUnit.setPilotSkill(skill);
                }
            }
            // Handle CBT units (crew members with gunnery/piloting)
            else if (forceUnit instanceof CBTForceUnit) {
                const crewSkills = parts.slice(1);
                const crewMembers = forceUnit.getCrewMembers();

                // Process crew skills in pairs (gunnery, piloting)
                for (let i = 0; i < crewSkills.length && i < crewMembers.length * 2; i += 2) {
                    const crewIndex = Math.floor(i / 2);
                    const gunnery = parseInt(crewSkills[i]);
                    const piloting = parseInt(crewSkills[i + 1]);

                    if (!isNaN(gunnery) && !isNaN(piloting) && crewMembers[crewIndex]) {
                        crewMembers[crewIndex].setSkill('gunnery', gunnery);
                        crewMembers[crewIndex].setSkill('piloting', piloting);
                    }
                }
            }

            forceUnit.disabledSaving = false;
        }

        forceUnits.push(forceUnit);
    }

    return forceUnits;
}
