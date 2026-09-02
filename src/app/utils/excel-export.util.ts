// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake



import type { UnitSummary, AlphaStrikeArcStats } from '../models/unit-summary.model';
import type { ForceUnit } from '../models/force-unit.model';
import type { ASForceUnit } from '../models/as-force-unit.model';
import type { Force } from '../models/force.model';
import type { CBTForce } from '../models/cbt-force.model';
import {
    isCBTForceMember,
    isCBTMekForceMember,
    type CBTForceMember,
    type ForceMember,
} from '../models/force-member.model';
import { GameSystem } from '../models/common.model';
import { DEFAULT_GUNNERY_SKILL, DEFAULT_PILOTING_SKILL } from '../models/crew-member.model';
import { hasNonMekRuntime } from '../models/cbt-unit-snapshot';
import type { BaseEntity } from '../models/entity/base-entity';

async function loadXlsx() {
    const { utils, writeFile } = await import('xlsx');
    return { utils, writeFile };
}

/**
 * Sanitizes a string for use in filenames by removing/replacing invalid characters.
 */
function sanitizeFilename(name: string): string {
    return name
        .replace(/[<>:"/\\|?*']/g, '') // Remove invalid file characters
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
    .replace(/^'+|'+$/g, '')        // Excel sheet names cannot start or end with apostrophes
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

function getMergedUnitTags(unit: UnitSummary): string {
    const merged = new Map<string, { label: string; quantity: number }>();

    const mergeTag = (tag: string, quantity: number) => {
        const key = tag.toLowerCase();
        const existing = merged.get(key);
        if (!existing) {
            merged.set(key, { label: tag, quantity });
            return;
        }

        if (quantity > existing.quantity) {
            existing.quantity = quantity;
        }
    };

    for (const entry of unit._chassisTags ?? []) {
        mergeTag(entry.tag, entry.quantity);
    }
    for (const entry of unit._nameTags ?? []) {
        mergeTag(entry.tag, entry.quantity);
    }

    return Array.from(merged.values())
        .map(entry => entry.quantity > 1 ? `${entry.label} (${entry.quantity})` : entry.label)
        .join(', ');
}

/**
 * Converts units to CBT (Classic BattleTech) export format.
 */
function unitToCBTRow(unit: UnitSummary): Record<string, unknown> {
    return {
        chassis: unit.chassis,
        model: unit.model,
        mul_id: unit.id <= 0 ? '' : unit.id,
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
        publishedRS: unit.published?.join(', ') ?? '',
        tags: getMergedUnitTags(unit),
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
        kfIntegrity: unit.capital?.kfIntegrity ?? '',
    };
}

function unitsToCBTRows(units: UnitSummary[]): Record<string, unknown>[] {
    return units.map(unitToCBTRow);
}

/** Loaded CBT export facts come only from the admitted Entity. */
function entityToCBTRow(unit: BaseEntity): Record<string, unknown> {
    const engine = unit.mountedEngine();
    const rangedWeapons = unit.rangedWeapons();
    const firepower = rangedWeapons.reduce((total, mount) =>
        total + unit.resolveMountedWeaponDamage(mount).maximum, 0);
    const maxRange = rangedWeapons.reduce((maximum, mount) =>
        Math.max(maximum, ...mount.equipment.ranges), 0);
    return {
        chassis: unit.fullChassis(),
        model: unit.model(),
        mul_id: unit.mulId() <= 0 ? '' : unit.mulId(),
        year: unit.year(),
        BV: unit.battleValue(),
        cost: unit.cost(),
        tonnage: unit.tonnage(),
        weightClass: unit.weightClass(),
        level: unit.staticTechLevel(),
        techBase: unit.techBase(),
        techRating: unit.techRating(),
        type: unit.unitType(),
        subtype: unit.unitSubtype(),
        omni: unit.omni(),
        engine: engine.type,
        engineRating: engine.rating,
        source: unit.source().map(source => source.abbrev).join(', '),
        publishedRS: unit.published().map(source => source.abbrev).join(', '),
        tags: '',
        role: unit.role(),
        armorType: unit.hasPatchworkArmor()
            ? 'Patchwork'
            : unit.uniformArmor()?.armor.name ?? '',
        structureType: unit.uniformStructureMaterial()?.structure.name ?? '',
        armor: unit.totalArmorPoints(),
        armorPer: unit.maximumArmorPoints() > 0
            ? unit.totalArmorPoints() / unit.maximumArmorPoints()
            : 0,
        structure: unit.totalInternalPoints(),
        heat: unit.heatGeneration(),
        dissipation: unit.heatDissipation(),
        dissipationEfficiency: unit.heatGeneration() > 0
            ? unit.heatDissipation() / unit.heatGeneration()
            : '',
        moveType: unit.motiveType(),
        walk: unit.walkMP(),
        maxWalk: unit.maxWalkMP(),
        jump: unit.jumpMP(),
        umu: unit.umuMP(),
        c3: unit.c3System(),
        dpt: firepower,
        firepower,
        'firepower (no oneshots)': firepower,
        maxRange,
        components: unit.equipment()
            .map(mount => `${mount.displayName()}:${mount.location}`)
            .join(', '),
        quirks: unit.quirks()
            .map(({ quirk, value }) => value ? `${quirk.name}=${value}` : quirk.name)
            .join(', '),
        cargo: unit.transporters()
            .map(transporter => {
                const capacity = transporter.kind === 'bay'
                    ? transporter.capacity
                    : transporter.kind === 'troop-space'
                        ? transporter.totalSpace
                        : transporter.kind === 'battle-armor-handles'
                            ? transporter.troopers
                            : 1;
                return `${transporter.kind}(${capacity})`;
            })
            .join(', '),
        dropshipCapacity: unit.dockingCollarCount(),
        escapePods: '',
        lifeBoats: '',
        gravDecks: '',
        sailIntegrity: '',
        kfIntegrity: '',
    };
}

/**
 * Converts units to AS (Alpha Strike) export format.
 */
function unitToASRow(unit: UnitSummary): Record<string, unknown> {
    const as = unit.as;
    return {
        chassis: unit.chassis,
        model: unit.model,
        mul_id: unit.id <= 0 ? '' : unit.id,
        year: unit.year,
        PV: as?.PV ?? '',
        cost: unit.cost,
        level: unit.level,
        techBase: unit.techBase,
        techRating: unit.techRating,
        source: unit.source?.join(', ') ?? '',
        publishedRS: unit.published?.join(', ') ?? '',
        tags: getMergedUnitTags(unit),
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
        specials: as?.specials?.join(', ') ?? '',
        usesArcs: as?.usesArcs ?? '',
        // Front Arc columns
        'frontArc STD': formatArcDamage(as?.frontArc, 'STD'),
        'frontArc CAP': formatArcDamage(as?.frontArc, 'CAP'),
        'frontArc MSL': formatArcDamage(as?.frontArc, 'MSL'),
        'frontArc SCAP': formatArcDamage(as?.frontArc, 'SCAP'),
        'frontArc specials': as?.frontArc?.specials.join(', ') ?? '',
        // Rear Arc columns
        'rearArc STD': formatArcDamage(as?.rearArc, 'STD'),
        'rearArc CAP': formatArcDamage(as?.rearArc, 'CAP'),
        'rearArc MSL': formatArcDamage(as?.rearArc, 'MSL'),
        'rearArc SCAP': formatArcDamage(as?.rearArc, 'SCAP'),
        'rearArc specials': as?.rearArc?.specials.join(', ') ?? '',
        // Left Arc columns
        'leftArc STD': formatArcDamage(as?.leftArc, 'STD'),
        'leftArc CAP': formatArcDamage(as?.leftArc, 'CAP'),
        'leftArc MSL': formatArcDamage(as?.leftArc, 'MSL'),
        'leftArc SCAP': formatArcDamage(as?.leftArc, 'SCAP'),
        'leftArc specials': as?.leftArc?.specials.join(', ') ?? '',
        // Right Arc columns
        'rightArc STD': formatArcDamage(as?.rightArc, 'STD'),
        'rightArc CAP': formatArcDamage(as?.rightArc, 'CAP'),
        'rightArc MSL': formatArcDamage(as?.rightArc, 'MSL'),
        'rightArc SCAP': formatArcDamage(as?.rightArc, 'SCAP'),
        'rightArc specials': as?.rightArc?.specials.join(', ') ?? ''
    };
}

function unitsToASRows(units: UnitSummary[]): Record<string, unknown>[] {
    return units.map(unitToASRow);
}

/**
 * Converts one canonical CBT member to an export row from Entity + runtime.
 */
function forceMemberToCBTRow(member: CBTForceMember, groupName: string): Record<string, unknown> {
    const unit = member.entity;
    const baseRow = entityToCBTRow(unit);
    const { chassis, model, ...rest } = baseRow;
    if (!isCBTMekForceMember(member)) {
        const snapshot = member.force.getUnitSnapshot(member.id);
        if (!snapshot || !hasNonMekRuntime(snapshot)) {
            throw new Error(`CBT unit ${member.id} is no longer admitted`);
        }
        const crew = member.force.getUnitCrewAssignment(member.id)?.positions[0];
        const crewState = crew ? snapshot.state.crew.get(crew.positionId) : undefined;
        const pristineBv = member.pristineBattleValue() ?? unit.battleValue();
        const currentBv = member.adjustedBattleValue() ?? pristineBv;
        return {
            group: groupName,
            chassis,
            model,
            pilot: crew?.name ?? '',
            gunnery: crew?.gunnery ?? DEFAULT_GUNNERY_SKILL,
            piloting: crew?.piloting ?? DEFAULT_PILOTING_SKILL,
            wounds: crewState?.wounds ?? 0,
            BV: pristineBv !== currentBv ? `${currentBv} (${pristineBv})` : currentBv,
            totalBV: currentBv,
            armorDamage: [...snapshot.state.locations.values()].reduce((total, location) => total
                + location.armorDamage.reduce((sum, face) => sum + face.damage, 0), 0),
            internalDamage: [...snapshot.state.locations.values()].reduce((total, location) =>
                total + location.internalDamage, 0),
            destroyed: snapshot.query.destroyed(),
            ...rest,
        };
    }

    const snapshot = member.force.getMekRecordSheetSnapshot(member.id);
    if (!snapshot) throw new Error(`CBT Mek ${member.id} is no longer admitted`);
    const pilot = snapshot.crew.find(position => position.occurrence === 0) ?? snapshot.crew[0];
    const totalArmorDamage = snapshot.locations.reduce((total, location) => total
        + location.armor.reduce((faceTotal, face) => faceTotal
            + Math.max(0, face.maximum - face.committedRemaining), 0), 0);
    const totalInternalDamage = snapshot.locations.reduce((total, location) => total
        + Math.max(0, location.maximumInternal - location.committedRemainingInternal), 0);
    const pristineBv = snapshot.battleValue.pristine ?? unit.battleValue();
    const currentBv = snapshot.battleValue.current ?? pristineBv;
    return {
        group: groupName,
        chassis,
        model,
        pilot: pilot?.name ?? '',
        gunnery: pilot?.gunnery ?? DEFAULT_GUNNERY_SKILL,
        piloting: pilot?.piloting ?? DEFAULT_PILOTING_SKILL,
        wounds: pilot?.state.wounds ?? 0,
        BV: pristineBv !== currentBv ? `${currentBv} (${pristineBv})` : currentBv,
        totalBV: snapshot.battleValue.adjusted ?? currentBv,
        armorDamage: totalArmorDamage,
        internalDamage: totalInternalDamage,
        destroyed: snapshot.destroyed,
        ...rest
    };
}

/**
 * Converts an AS ForceUnit to export row with additional state fields.
 */
function forceUnitToASRow(forceUnit: ForceUnit, groupName: string): Record<string, unknown> {
    const unit = forceUnit.getSummary();
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
function forceMembersToRows(force: Force, members: readonly ForceMember[]): Record<string, unknown>[] {
    if (force.gameSystem === GameSystem.AS) {
        return members.map(member => {
            if (isCBTForceMember(member)) throw new Error('A CBT runtime cannot be exported as Alpha Strike');
            const group = member.getGroup();
            let groupName = group?.groupDisplayName() ?? '';
            if (group?.activeFormation()) groupName += ` - ${group.formationDisplayName()}`;
            if (group?.activeFormation() && !group.hasValidFormation()) groupName += ' (Invalid Formation)';
            return forceUnitToASRow(member, groupName);
        });
    }

    const cbtForce = force as CBTForce;
    const roster = cbtForce.queryCanonicalRoster();
    if (roster.kind !== 'available') throw new Error(roster.message);
    const groupNames = new Map(roster.snapshot.groups.map(group => [
        group.groupId,
        group.name?.trim() || group.groupId,
    ] as const));
    return members.map(member => {
        if (!isCBTForceMember(member)) throw new Error('CBT force export requires canonical members');
        return forceMemberToCBTRow(member, groupNames.get(member.rosterGroupId) ?? member.rosterGroupId);
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
    units: UnitSummary[],
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
    units: UnitSummary[],
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
    members: readonly ForceMember[],
    filename?: string
): Promise<void> {
    if (members.length === 0) {
        throw new Error('No units to export');
    }

    const { utils, writeFile } = await loadXlsx();
    const gameSystem = force.gameSystem;
    const rows = forceMembersToRows(force, members);

    const worksheet = createWorksheetWithAutoWidth(rows, utils);
    const workbook = utils.book_new();
    const sheetName = sanitizeSheetName(force.displayName() || 'Force');
    utils.book_append_sheet(workbook, worksheet, sheetName);

    const timestamp = new Date().toISOString().slice(0, 10);
    const systemLabel = gameSystem === GameSystem.AS ? 'as' : 'cbt';
    const forceName = sanitizeFilename(force.displayName()) || 'force';
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
    members: readonly ForceMember[],
    filename?: string
): Promise<void> {
    if (members.length === 0) {
        throw new Error('No units to export');
    }

    const { utils, writeFile } = await loadXlsx();
    const gameSystem = force.gameSystem;
    const rows = forceMembersToRows(force, members);

    const worksheet = utils.json_to_sheet(rows);
    const workbook = utils.book_new();
    const sheetName = sanitizeSheetName(force.displayName() || 'Force');
    utils.book_append_sheet(workbook, worksheet, sheetName);

    const timestamp = new Date().toISOString().slice(0, 10);
    const systemLabel = gameSystem === GameSystem.AS ? 'as' : 'cbt';
    const forceName = sanitizeFilename(force.displayName()) || 'force';
    const defaultFilename = `mekbay-${systemLabel}-${forceName}-${timestamp}`;
    const exportFilename = `${filename || defaultFilename}.csv`;

    writeFile(workbook, exportFilename, { bookType: 'csv' });
}
