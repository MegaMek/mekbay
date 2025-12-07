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
import { GameSystem } from '../models/common.model';

async function loadXlsx() {
    const { utils, writeFile } = await import('xlsx');
    return { utils, writeFile };
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
function unitsToCBTRows(units: Unit[]): Record<string, unknown>[] {
    return units.map(unit => ({
        chassis: unit.chassis,
        model: unit.model,
        mul_id: unit.id === -1 ? '' : unit.id,
        year: unit.year,
        BV: unit.bv,
        cost: unit.cost,
        level: unit.level,
        techBase: unit.techBase,
        techRating: unit.techRating,
        type: unit.type,
        subtype: unit.subtype,
        omni: unit.omni,
        engine: unit.engine,
        engineRating: unit.engineRating,
        source: unit.source,
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
    }));
}

/**
 * Converts units to AS (Alpha Strike) export format.
 */
function unitsToASRows(units: Unit[]): Record<string, unknown>[] {
    return units.map(unit => {
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
            source: unit.source,
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
    });
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

    const rows = gameSystem === GameSystem.AS
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
    const sheetName = gameSystem === GameSystem.AS ? 'Alpha Strike Units' : 'BattleTech Units';
    utils.book_append_sheet(workbook, worksheet, sheetName);

    const defaultFilename = gameSystem === GameSystem.AS
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

    const rows = gameSystem === GameSystem.AS
        ? unitsToASRows(units)
        : unitsToCBTRows(units);

    const worksheet = utils.json_to_sheet(rows);
    const workbook = utils.book_new();
    const sheetName = gameSystem === GameSystem.AS ? 'Alpha Strike Units' : 'BattleTech Units';
    utils.book_append_sheet(workbook, worksheet, sheetName);

    const defaultFilename = gameSystem === GameSystem.AS
        ? 'mekbay-alpha-strike-units'
        : 'mekbay-battletech-units';
    const exportFilename = `${filename || defaultFilename}.csv`;

    writeFile(workbook, exportFilename, { bookType: 'csv' });
}
