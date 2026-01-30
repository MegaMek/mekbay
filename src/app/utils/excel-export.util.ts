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

/*
 * Author: Drake
 */

import type { Unit, AlphaStrikeArcStats } from '../models/units.model';
import type { ForceUnit } from '../models/force-unit.model';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import type { ASForceUnit } from '../models/as-force-unit.model';
import type { Force, UnitGroup } from '../models/force.model';
import { GameSystem } from '../models/common.model';
import { DEFAULT_GUNNERY_SKILL, DEFAULT_PILOTING_SKILL } from '../models/crew-member.model';

async function loadXlsx() {
    const { utils, writeFile } = await import('xlsx');
    return { utils, writeFile };
}

/**
 * Sanitizes a string for use in filenames by removing/replacing invalid characters.
 */
function sanitizeFilename(name: string): string {
    return name
        .replace(/[<>:"/\\|?*]/g, '') // Remove invalid file characters
        .replace(/\s+/g, '-')          // Replace spaces with dashes
        .replace(/-+/g, '-')           // Collapse multiple dashes
        .replace(/^-|-$/g, '')         // Remove leading/trailing dashes
        .slice(0, 50);                 // Limit length
}

/**
 * Sanitizes a string for use as an Excel sheet name.
 * Invalid characters: \ / ? * [ ] :
 * Max length: 31 characters
 */
function sanitizeSheetName(name: string): string {
    return name
        .replace(/[\\/?*[\]:]/g, '') // Remove invalid sheet name characters
        .slice(0, 31) || 'Force';     // Limit length, fallback if empty
}

/**
 * Formats arc stats for Alpha Strike export.
 */
function formatArcDamage(arc: AlphaStrikeArcStats | undefined, type: 'STD' | 'CAP' | 'MSL' | 'SCAP'): string {
    if (!arc || !arc[type]) return '';
    const dmg = arc[type];
    return `${dmg.dmgS}/${dmg.dmgM}/${dmg.dmgL}/${dmg.dmgE}`;
}

/**
 * Converts units to CBT (Classic BattleTech) export format.
 */
function unitToCBTRow(unit: Unit): Record<string, unknown> {
    return {
        chassis: unit.chassis,
        model: unit.model,
        mul_id: unit.id === -1 ? '' : unit.id,
        year: unit.year,
        BV: unit.bv,
        cost: unit.cost,
        tonnage: unit.tons,
        weightClass: unit.weightClass,
        level: unit.level,
        techBase: unit.techBase,
        techRating: unit.techRating,
        type: unit.type,
        subtype: unit.subtype,
        omni: unit.omni,
        engine: unit.engine,
        engineRating: unit.engineRating,
        source: unit.source?.join(', ') ?? '',
        role: unit.role,
        armorType: unit.armorType,
        structureType: unit.structureType,
        armor: unit.armor,
        armorPer: unit.armorPer,
        structure: unit.internal,
        heat: unit.heat,
        dissipation: unit.dissipation,
        dissipationEfficiency: unit._dissipationEfficiency,
        moveType: unit.moveType,
        walk: unit.walk,
        maxWalk: unit.walk2,
        jump: unit.jump,
        maxJump: unit.jump2,
        umu: unit.umu,
        c3: unit.c3,
        dpt: unit.dpt,
        firepower: unit._mdSumNoPhysical,
        'firepower (no oneshots)': unit._mdSumNoPhysicalNoOneshots,
        maxRange: unit._maxRange,
        components: unit.comp?.map(c => `${c.q}x${c.n}:${c.l}`).join(', ') ?? '',
        quirks: unit.quirks?.join(', ') ?? '',
        cargo: unit.cargo?.map(c => `${c.type}(${c.capacity})(${c.doors})`).join(', ') ?? '',
        dropshipCapacity: unit.capital?.dropshipCapacity ?? '',
        escapePods: unit.capital?.escapePods ?? '',
        lifeBoats: unit.capital?.lifeBoats ?? '',
        gravDecks: unit.capital?.gravDecks?.join(', ') ?? '',
        sailIntegrity: unit.capital?.sailIntegrity ?? '',
        kfIntegrity: unit.capital?.kfIntegrity ?? ''
    };
}

function unitsToCBTRows(units: Unit[]): Record<string, unknown>[] {
    return units.map(unitToCBTRow);
}

/**
 * Converts units to AS (Alpha Strike) export format.
 */
function unitToASRow(unit: Unit): Record<string, unknown> {
    const as = unit.as;
    return {
        chassis: unit.chassis,
        model: unit.model,
        mul_id: unit.id === -1 ? '' : unit.id,
        year: unit.year,
        PV: as?.PV ?? '',
        cost: unit.cost,
        level: unit.level,
        techBase: unit.techBase,
        techRating: unit.techRating,
        source: unit.source?.join(', ') ?? '',
        role: unit.role,
        SZ: as?.SZ ?? '',
        usesOV: as?.usesOV ?? '',
        OV: as?.OV ?? '',
        MV: as?.MV ?? '',
        TMM: as?.TMM ?? '',
        usesTh: as?.usesTh ?? '',
        Th: as?.usesTh ? (as?.Th ?? '') : '',
        Str: as?.Str ?? '',
        TP: as?.TP ?? '',
        Arm: as?.Arm ?? '',
        usesE: as?.usesE ?? '',
        dmgS: as?.dmg?.dmgS ?? '',
        dmgM: as?.dmg?.dmgM ?? '',
        dmgL: as?.dmg?.dmgL ?? '',
        dmgE: as?.dmg?.dmgE ?? '',
        usesArcs: as?.usesArcs ?? '',
        // Front Arc columns
        'frontArc STD': formatArcDamage(as?.frontArc, 'STD'),
        'frontArc CAP': formatArcDamage(as?.frontArc, 'CAP'),
        'frontArc MSL': formatArcDamage(as?.frontArc, 'MSL'),
        'frontArc SCAP': formatArcDamage(as?.frontArc, 'SCAP'),
        'frontArc specials': as?.frontArc?.specials ?? '',
        // Rear Arc columns
        'rearArc STD': formatArcDamage(as?.rearArc, 'STD'),
        'rearArc CAP': formatArcDamage(as?.rearArc, 'CAP'),
        'rearArc MSL': formatArcDamage(as?.rearArc, 'MSL'),
        'rearArc SCAP': formatArcDamage(as?.rearArc, 'SCAP'),
        'rearArc specials': as?.rearArc?.specials ?? '',
        // Left Arc columns
        'leftArc STD': formatArcDamage(as?.leftArc, 'STD'),
        'leftArc CAP': formatArcDamage(as?.leftArc, 'CAP'),
        'leftArc MSL': formatArcDamage(as?.leftArc, 'MSL'),
        'leftArc SCAP': formatArcDamage(as?.leftArc, 'SCAP'),
        'leftArc specials': as?.leftArc?.specials ?? '',
        // Right Arc columns
        'rightArc STD': formatArcDamage(as?.rightArc, 'STD'),
        'rightArc CAP': formatArcDamage(as?.rightArc, 'CAP'),
        'rightArc MSL': formatArcDamage(as?.rightArc, 'MSL'),
        'rightArc SCAP': formatArcDamage(as?.rightArc, 'SCAP'),
        'rightArc specials': as?.rightArc?.specials ?? ''
    };
}

function unitsToASRows(units: Unit[]): Record<string, unknown>[] {
    return units.map(unitToASRow);
}

/**
 * Converts a CBT ForceUnit to export row with additional state fields.
 */
function forceUnitToCBTRow(forceUnit: ForceUnit, groupName: string): Record<string, unknown> {
    const unit = forceUnit.getUnit();
    const baseRow = unitToCBTRow(unit);
    const cbtUnit = forceUnit as CBTForceUnit;
    const crew = cbtUnit.getCrewMembers();
    const pilot = crew.length > 0 ? crew[0] : null;
    
    // Sum armor damage across all locations
    const locations = cbtUnit.getLocations();
    let totalArmorDamage = 0;
    let totalInternalDamage = 0;
    for (const locData of Object.values(locations)) {
        totalArmorDamage += locData.armor ?? 0;
        totalInternalDamage += locData.internal ?? 0;
    }
    
    // Insert force-specific fields
    const { chassis, model, ...rest } = baseRow;
    return {
        group: groupName,
        chassis,
        model,
        pilot: pilot?.getName() ?? '',
        gunnery: pilot?.getSkill('gunnery') ?? DEFAULT_GUNNERY_SKILL,
        piloting: pilot?.getSkill('piloting') ?? DEFAULT_PILOTING_SKILL,
        wounds: pilot?.getHits() ?? 0,
        adjustedBV: cbtUnit.baseBvPilotAdjusted(),
        C3Tax: cbtUnit.c3Tax(),
        totalBV: cbtUnit.getBv(),
        armorDamage: totalArmorDamage,
        internalDamage: totalInternalDamage,
        destroyed: forceUnit.destroyed,
        ...rest
    };
}

/**
 * Converts an AS ForceUnit to export row with additional state fields.
 */
function forceUnitToASRow(forceUnit: ForceUnit, groupName: string): Record<string, unknown> {
    const unit = forceUnit.getUnit();
    const baseRow = unitToASRow(unit);
    const asUnit = forceUnit as ASForceUnit;
    const state = asUnit.getState();
    
    // Insert force-specific fields
    const { chassis, model, ...rest } = baseRow;
    return {
        group: groupName,
        chassis,
        model,
        pilot: asUnit.alias() ?? '',
        skill: asUnit.pilotSkill(),
        adjustedPV: asUnit.adjustedPv(),
        armorDamage: state.armor(),
        structureDamage: state.internal(),
        destroyed: forceUnit.destroyed,
        ...rest
    };
}

/**
 * Converts force groups to rows.
 */
function forceGroupsToRows(
    groups: UnitGroup[],
    gameSystem: GameSystem
): Record<string, unknown>[] {
    const rowConverter = gameSystem === GameSystem.ALPHA_STRIKE ? forceUnitToASRow : forceUnitToCBTRow;
    return groups.flatMap(group =>
        group.units().map(unit => rowConverter(unit, group.name()))
    );
}

/**
 * Exports units to an Excel file based on the specified game system.
 * 
 * @param units - Array of units to export
 * @param gameSystem - The game system (CBT or AS) determining the export format
 * @param filename - Optional custom filename (without extension)
 */
export async function exportUnitsToExcel(
    units: Unit[],
    gameSystem: GameSystem,
    filename?: string
): Promise<void> {
    if (!units || units.length === 0) {
        throw new Error('No units to export');
    }

    const { utils, writeFile } = await loadXlsx();

    const rows = gameSystem === GameSystem.ALPHA_STRIKE
        ? unitsToASRows(units)
        : unitsToCBTRows(units);

    const worksheet = utils.json_to_sheet(rows);
    
    // Auto-width columns to fit content
    if (rows.length > 0) {
        const keys = Object.keys(rows[0]);
        worksheet['!cols'] = keys.map(key => {
            // Calculate max width: header length vs max content length
            const maxContentLength = rows.reduce((max, row) => {
                const val = row[key];
                const len = val == null ? 0 : String(val).length;
                return Math.max(max, len);
            }, key.length);
            return { wch: Math.min(maxContentLength + 2, 60) }; // Cap at 60 chars
        });
    }

    const workbook = utils.book_new();
    const sheetName = gameSystem === GameSystem.ALPHA_STRIKE ? 'Alpha Strike Units' : 'BattleTech Units';
    utils.book_append_sheet(workbook, worksheet, sheetName);

    const defaultFilename = gameSystem === GameSystem.ALPHA_STRIKE
        ? 'mekbay-alpha-strike-units'
        : 'mekbay-battletech-units';
    const exportFilename = `${filename || defaultFilename}.xlsx`;

    writeFile(workbook, exportFilename);
}

/**
 * Exports units to a CSV file based on the specified game system.
 * 
 * @param units - Array of units to export
 * @param gameSystem - The game system (CBT or AS) determining the export format
 * @param filename - Optional custom filename (without extension)
 */
export async function exportUnitsToCSV(
    units: Unit[],
    gameSystem: GameSystem,
    filename?: string
): Promise<void> {
    if (!units || units.length === 0) {
        throw new Error('No units to export');
    }

    const { utils, writeFile } = await loadXlsx();

    const rows = gameSystem === GameSystem.ALPHA_STRIKE
        ? unitsToASRows(units)
        : unitsToCBTRows(units);

    const worksheet = utils.json_to_sheet(rows);
    const workbook = utils.book_new();
    const sheetName = gameSystem === GameSystem.ALPHA_STRIKE ? 'Alpha Strike Units' : 'BattleTech Units';
    utils.book_append_sheet(workbook, worksheet, sheetName);

    const defaultFilename = gameSystem === GameSystem.ALPHA_STRIKE
        ? 'mekbay-alpha-strike-units'
        : 'mekbay-battletech-units';
    const exportFilename = `${filename || defaultFilename}.csv`;

    writeFile(workbook, exportFilename, { bookType: 'csv' });
}

/**
 * Creates a worksheet with auto-width columns.
 */
function createWorksheetWithAutoWidth(
    rows: Record<string, unknown>[],
    utils: { json_to_sheet: (data: unknown[]) => Record<string, unknown> }
): Record<string, unknown> {
    const worksheet = utils.json_to_sheet(rows);
    
    if (rows.length > 0) {
        const keys = Object.keys(rows[0]);
        (worksheet as Record<string, unknown>)['!cols'] = keys.map(key => {
            const maxContentLength = rows.reduce((max, row) => {
                const val = row[key];
                const len = val == null ? 0 : String(val).length;
                return Math.max(max, len);
            }, key.length);
            return { wch: Math.min(maxContentLength + 2, 60) };
        });
    }
    
    return worksheet;
}

/**
 * Exports a force to an Excel file with force-specific state data.
 * Groups are included as a column if there are multiple groups.
 * 
 * @param force - The Force to export
 * @param filename - Optional custom filename (without extension). If not provided, uses force name.
 */
export async function exportForceToExcel(
    force: Force,
    filename?: string
): Promise<void> {
    const groups = force.groups();
    const totalUnits = groups.reduce((sum, g) => sum + g.units().length, 0);
    if (totalUnits === 0) {
        throw new Error('No units to export');
    }

    const { utils, writeFile } = await loadXlsx();
    const gameSystem = force.gameSystem;
    const rows = forceGroupsToRows(groups, gameSystem);

    const worksheet = createWorksheetWithAutoWidth(rows, utils);
    const workbook = utils.book_new();
    const sheetName = sanitizeSheetName(force.name || 'Force');
    utils.book_append_sheet(workbook, worksheet, sheetName);

    const timestamp = new Date().toISOString().slice(0, 10);
    const systemLabel = gameSystem === GameSystem.ALPHA_STRIKE ? 'as' : 'cbt';
    const forceName = sanitizeFilename(force.name) || 'force';
    const defaultFilename = `mekbay-${systemLabel}-${forceName}-${timestamp}`;
    const exportFilename = `${filename || defaultFilename}.xlsx`;

    writeFile(workbook, exportFilename);
}

/**
 * Exports a force to a CSV file with force-specific state data.
 * Groups are included as a column if there are multiple groups.
 * 
 * @param force - The Force to export
 * @param filename - Optional custom filename (without extension). If not provided, uses force name.
 */
export async function exportForceToCSV(
    force: Force,
    filename?: string
): Promise<void> {
    const groups = force.groups();
    const totalUnits = groups.reduce((sum, g) => sum + g.units().length, 0);
    if (totalUnits === 0) {
        throw new Error('No units to export');
    }

    const { utils, writeFile } = await loadXlsx();
    const gameSystem = force.gameSystem;
    const rows = forceGroupsToRows(groups, gameSystem);

    const worksheet = utils.json_to_sheet(rows);
    const workbook = utils.book_new();
    const sheetName = sanitizeSheetName(force.name || 'Force');
    utils.book_append_sheet(workbook, worksheet, sheetName);

    const timestamp = new Date().toISOString().slice(0, 10);
    const systemLabel = gameSystem === GameSystem.ALPHA_STRIKE ? 'as' : 'cbt';
    const forceName = sanitizeFilename(force.name) || 'force';
    const defaultFilename = `mekbay-${systemLabel}-${forceName}-${timestamp}`;
    const exportFilename = `${filename || defaultFilename}.csv`;

    writeFile(workbook, exportFilename, { bookType: 'csv' });
}
