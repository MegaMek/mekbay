// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { Unit } from '../models/units.model';
import type { PhysicalLocationRow } from '../models/rules/game-rules';
import { clusterHits } from './cluster-hit-table';
import { hitLocationRows, type MekHitLocationTable, type ReferenceTableNote } from './record-sheet-reference-table';

export type ReferenceTableGroupId = 'cluster' | 'mek' | 'vehicle' | 'infantry';

export type ReferenceTableOptionId =
    | 'cluster-full'
    | 'mek-biped'
    | 'mek-tripod'
    | 'mek-quad'
    | 'vehicle-ground'
    | 'vehicle-ground-superheavy'
    | 'vehicle-vtol'
    | 'infantry-battle-armor'
    | 'infantry-conventional';

export interface ReferenceTableOptionDefinition {
    readonly id: ReferenceTableOptionId;
    readonly label: string;
}

export interface ReferenceTableGroupDefinition {
    readonly id: ReferenceTableGroupId;
    readonly label: string;
    readonly options: readonly ReferenceTableOptionDefinition[];
}

export interface ReferenceTableDice {
    readonly count: 1 | 2;
    readonly sides: 6;
}

export interface ReferenceTableRollSource {
    readonly tableKey: string;
    readonly tableLabel: string;
}

export interface ReferenceTableColumn {
    readonly key: string;
    readonly label: string;
    readonly rollable?: boolean;
    readonly rollSource?: ReferenceTableRollSource;
}

export interface ReferenceTableHeaderGroup {
    readonly label: string;
    readonly span: number;
}

export interface ReferenceTableCell {
    readonly value: string;
    readonly rowSpan?: number;
    /** The value resolves rolls covered by a preceding rowspan, but is not rendered again. */
    readonly continuation?: boolean;
}

export type ReferenceTableCellValue = string | ReferenceTableCell;

export interface ReferenceTableRollRange {
    readonly label: string;
    readonly min: number;
    readonly max: number;
}

export interface ReferenceTableRow {
    readonly key: string;
    readonly roll?: ReferenceTableRollRange;
    readonly cells: Readonly<Record<string, ReferenceTableCellValue>>;
}

export interface ReferenceTableDefinition {
    readonly key: string;
    readonly title: string;
    readonly shortTitle?: string;
    readonly layout?: 'compact';
    readonly dice?: ReferenceTableDice;
    readonly rollLabel?: string;
    readonly columns: readonly ReferenceTableColumn[];
    readonly headerGroups?: readonly ReferenceTableHeaderGroup[];
    readonly rows: readonly ReferenceTableRow[];
    readonly notes?: readonly string[];
}

export interface ReferenceTableViewDefinition {
    readonly tables: readonly ReferenceTableDefinition[];
    readonly combinedTable?: ReferenceTableDefinition;
    readonly combinedSourceKeys?: readonly [string, string];
}

export interface ReferenceTableBuildContext {
    readonly physicalRows: readonly PhysicalLocationRow[];
    readonly clusterSizes: readonly number[];
    readonly clusterNotes: readonly ReferenceTableNote[];
}

export interface ResolvedReferenceTableRoll {
    readonly roll: number;
    readonly rowKey: string;
    readonly rowLabel: string;
    readonly value: string;
    readonly source: ReferenceTableRollSource;
}

export const FULL_CLUSTER_SIZES: readonly number[] = [
    2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 30, 40,
];

export const REFERENCE_TABLE_GROUPS: readonly ReferenceTableGroupDefinition[] = [
    {
        id: 'cluster',
        label: 'Cluster',
        options: [{ id: 'cluster-full', label: 'Full Table' }],
    },
    {
        id: 'mek',
        label: 'Mek',
        options: [
            { id: 'mek-biped', label: 'Biped' },
            { id: 'mek-tripod', label: 'Tripod' },
            { id: 'mek-quad', label: 'Quad' },
        ],
    },
    {
        id: 'vehicle',
        label: 'Vehicle',
        options: [
            { id: 'vehicle-ground', label: 'Ground' },
            { id: 'vehicle-ground-superheavy', label: 'Superheavy' },
            { id: 'vehicle-vtol', label: 'VTOL' },
        ],
    },
    {
        id: 'infantry',
        label: 'Infantry',
        options: [
            { id: 'infantry-battle-armor', label: 'Battle Armor' },
            { id: 'infantry-conventional', label: 'Conventional' },
        ],
    },
];

const D6: ReferenceTableDice = { count: 1, sides: 6 };
const TWO_D6: ReferenceTableDice = { count: 2, sides: 6 };

const GROUND_HIT_LOCATION_ROWS = [
    ['2*', 'Front (critical)', 'Rear (critical)', 'Side (critical)', 2, 2],
    ['3', 'Front†', 'Rear†', 'Side†', 3, 3],
    ['4', 'Front†', 'Rear†', 'Side†', 4, 4],
    ['5', 'Right Side†', 'Left Side†', 'Front†', 5, 5],
    ['6', 'Front', 'Rear', 'Side', 6, 6],
    ['7', 'Front', 'Rear', 'Side', 7, 7],
    ['8', 'Front', 'Rear', 'Side (critical)*', 8, 8],
    ['9', 'Left Side†', 'Right Side†', 'Rear†', 9, 9],
    ['10', 'Turret', 'Turret', 'Turret', 10, 10],
    ['11', 'Turret', 'Turret', 'Turret', 11, 11],
    ['12*', 'Turret (critical)', 'Turret (critical)', 'Turret (critical)', 12, 12],
] as const;

const SUPERHEAVY_HIT_LOCATION_ROWS = [
    ['2*', 'Front (critical)', 'Rear (critical)', 'Side (critical)', 'Side (critical)', 2, 2],
    ['3', 'Right Side†', 'Left Side†', 'Front†', 'Rear†', 3, 3],
    ['4', 'Front†', 'Rear†', 'Side†', 'Side†', 4, 4],
    ['5', 'Front†', 'Rear†', 'Side', 'Side', 5, 5],
    ['6', 'Front', 'Rear', 'Side', 'Side', 6, 6],
    ['7', 'Front', 'Rear', 'Side', 'Side', 7, 7],
    ['8', 'Front', 'Rear', 'Side (critical)*', 'Side (critical)*', 8, 8],
    ['9', 'Front†', 'Rear†', 'Side†', 'Side†', 9, 9],
    ['10', 'Turret', 'Turret', 'Turret', 'Turret', 10, 10],
    ['11', 'Turret', 'Turret', 'Turret', 'Turret', 11, 11],
    ['12*', 'Turret (critical)', 'Turret (critical)', 'Turret (critical)', 'Turret (critical)', 12, 12],
] as const;

const VTOL_HIT_LOCATION_ROWS = [
    ['2*', 'Front (critical)', 'Rear (critical)', 'Side (critical)', 2, 2],
    ['3', 'Rotors†', 'Rotors†', 'Rotors†', 3, 3],
    ['4', 'Turret‡', 'Turret‡', 'Turret‡', 4, 4],
    ['5', 'Right Side', 'Left Side', 'Front', 5, 5],
    ['6', 'Front', 'Rear', 'Side', 6, 6],
    ['7', 'Front', 'Rear', 'Side', 7, 7],
    ['8', 'Front', 'Rear', 'Side (critical)*', 8, 8],
    ['9', 'Left Side', 'Right Side', 'Rear', 9, 9],
    ['10', 'Rotors†', 'Rotors†', 'Rotors†', 10, 10],
    ['11', 'Rotors†', 'Rotors†', 'Rotors†', 11, 11],
    ['12*', 'Rotors (critical)†', 'Rotors (critical)†', 'Rotors (critical)†', 12, 12],
] as const;

const GROUND_CRITICAL_ROWS = [
    ['2–5', 'No Critical Hit', 'No Critical Hit', 'No Critical Hit', 'No Critical Hit', 2, 5],
    ['6', 'Driver Hit', 'Cargo/Infantry Hit', 'Weapon Malfunction', 'Stabilizer', 6, 6],
    ['7', 'Weapon Malfunction', 'Weapon Malfunction', 'Cargo/Infantry Hit', 'Turret Jam', 7, 7],
    ['8', 'Stabilizer', 'Crew Stunned', 'Stabilizer', 'Weapon Malfunction', 8, 8],
    ['9', 'Sensors', 'Stabilizer', 'Weapon Destroyed', 'Turret Locks', 9, 9],
    ['10', 'Commander Hit', 'Weapon Destroyed', 'Engine Hit', 'Weapon Destroyed', 10, 10],
    ['11', 'Weapon Destroyed', 'Engine Hit', 'Ammunition**', 'Ammunition**', 11, 11],
    ['12', 'Crew Killed', 'Fuel Tank*', 'Fuel Tank*', 'Turret Blown Off', 12, 12],
] as const;

const VTOL_CRITICAL_ROWS = [
    ['2–5', 'No Critical Hit', 'No Critical Hit', 'No Critical Hit', 'No Critical Hit', 'No Critical Hit', 2, 5],
    ['6', 'Co-Pilot Hit', 'Weapon Malfunction', 'Cargo/Infantry Hit', 'Rotor Damage', 'Stabilizer', 6, 6],
    ['7', 'Weapon Malfunction', 'Cargo/Infantry Hit', 'Weapon Malfunction', 'Rotor Damage', 'Turret Jam', 7, 7],
    ['8', 'Stabilizer', 'Stabilizer', 'Stabilizer', 'Rotor Damage', 'Weapon Malfunction', 8, 8],
    ['9', 'Sensors', 'Weapon Destroyed', 'Weapon Destroyed', 'Flight Stabilizer Hit', 'Turret Locks', 9, 9],
    ['10', 'Pilot Hit', 'Engine Hit', 'Sensors', 'Flight Stabilizer Hit', 'Weapon Destroyed', 10, 10],
    ['11', 'Weapon Destroyed', 'Ammunition**', 'Engine Hit', 'Rotors Destroyed', 'Ammunition**', 11, 11],
    ['12', 'Crew Killed', 'Fuel Tank*', 'Fuel Tank*', 'Rotors Destroyed', 'Turret Blown Off', 12, 12],
] as const;

const MOTIVE_DAMAGE_ROWS = [
    ['2–5', 'No effect', 2, 5],
    ['6–7', 'Minor damage; +1 modifier to all Driving Skill Rolls', 6, 7],
    ['8–9', 'Moderate damage; −1 Cruising MP, +2 modifier to all Driving Skill Rolls', 8, 9],
    ['10–11', 'Heavy damage; halve Cruising MP (round up), +3 modifier to all Driving Skill Rolls', 10, 11],
    ['12+', 'Major damage; no movement for the rest of the game. Vehicle is immobile.', 12, Number.POSITIVE_INFINITY],
] as const;

const SWARM_LOCATION_ROWS = [
    ['2', 'Head', 'Head'],
    ['3', 'Rear Center Torso', 'Front Right Torso'],
    ['4', 'Rear Right Torso', 'Rear Center Torso'],
    ['5', 'Front Right Torso', 'Rear Right Torso'],
    ['6', 'Right Arm', 'Front Right Torso'],
    ['7', 'Front Center Torso', 'Front Center Torso'],
    ['8', 'Left Arm', 'Front Left Torso'],
    ['9', 'Front Left Torso', 'Rear Left Torso'],
    ['10', 'Rear Left Torso', 'Rear Center Torso'],
    ['11', 'Rear Center Torso', 'Front Left Torso'],
    ['12', 'Head', 'Head'],
] as const;

const CONVENTIONAL_BURST_FIRE_ROWS = [
    ['AP Gauss Rifle', '2D6'],
    ['Light Machine Gun', '1D6'],
    ['Machine Gun', '2D6'],
    ['Heavy Machine Gun', '3D6'],
    ['Small/Micro Pulse Laser', '2D6'],
    ['Flamer', '4D6'],
] as const;

const BATTLE_ARMOR_BURST_FIRE_ROWS = [
    ['Light Machine Gun', '1D6/2 (round up)'],
    ['Machine Gun', '1D6'],
    ['Heavy Machine Gun', '2D6'],
    ['Flamer', '3D6'],
    ['Light Recoilless Rifle', '1D6'],
    ['Medium Recoilless Rifle', '2D6'],
    ['Heavy Recoilless Rifle', '2D6'],
    ['Light Mortar', '1D6'],
    ['Heavy Mortar', '1D6'],
    ['Automatic Grenade Launcher', '1D6/2 (round up)'],
    ['Heavy Grenade Launcher', '1D6'],
] as const;

const NON_INFANTRY_DAMAGE_ROWS = [
    ['Direct Fire (Energy or Ballistic)', 'Damage Value / 10'],
    ['Cluster (Ballistic)', 'Damage Value / 10 + 1'],
    ['Pulse**', 'Damage Value / 10 + 2'],
    ['Cluster (Missile)', 'Damage Value / 5'],
    ['Area Effect (AE)', 'Damage Value / 5'],
    ['Burst-Fire', 'See Burst-Fire Weapons Table'],
    ['Heat Effect Weapons', 'See Heat-Effect Weapons‡'],
] as const;

export function referenceTableGroup(groupId: ReferenceTableGroupId): ReferenceTableGroupDefinition {
    const group = REFERENCE_TABLE_GROUPS.find(candidate => candidate.id === groupId);
    if (!group) throw new RangeError(`Unknown reference table group: ${groupId}`);
    return group;
}

export function referenceTableOption(optionId: ReferenceTableOptionId): ReferenceTableOptionDefinition {
    for (const group of REFERENCE_TABLE_GROUPS) {
        const option = group.options.find(candidate => candidate.id === optionId);
        if (option) return option;
    }
    throw new RangeError(`Unknown reference table option: ${optionId}`);
}

export function referenceTableGroupForOption(optionId: ReferenceTableOptionId): ReferenceTableGroupDefinition {
    const group = REFERENCE_TABLE_GROUPS.find(candidate => candidate.options.some(option => option.id === optionId));
    if (!group) throw new RangeError(`Unknown reference table option: ${optionId}`);
    return group;
}

export function defaultReferenceTableOption(
    unit: Pick<Unit, 'type' | 'subtype'> & Partial<Pick<Unit, 'tons' | 'weightClass'>>,
): ReferenceTableOptionId {
    if (unit.type === 'Mek') {
        if (unit.subtype.startsWith('Tripod')) return 'mek-tripod';
        if (unit.subtype.startsWith('Quad')) return 'mek-quad';
        return 'mek-biped';
    }
    if (unit.type === 'VTOL') return 'vehicle-vtol';
    if (unit.type === 'Tank' || unit.type === 'Naval') {
        const isLargeSupport = unit.weightClass === 'Large Support Vehicle';
        const isSuperheavy = unit.weightClass === 'Colossal/Super-Heavy' || (unit.tons ?? 0) > 100;
        return isLargeSupport || isSuperheavy ? 'vehicle-ground-superheavy' : 'vehicle-ground';
    }
    if (unit.type === 'Infantry') {
        return unit.subtype === 'Battle Armor' ? 'infantry-battle-armor' : 'infantry-conventional';
    }
    return 'cluster-full';
}

export function hasUnitDefaultReferenceTables(unit: Pick<Unit, 'type'>): boolean {
    return unit.type === 'Mek'
        || unit.type === 'Tank'
        || unit.type === 'Naval'
        || unit.type === 'VTOL'
        || unit.type === 'Infantry';
}

export function buildReferenceTableView(
    optionId: ReferenceTableOptionId,
    context: ReferenceTableBuildContext,
): ReferenceTableViewDefinition {
    if (optionId === 'cluster-full') {
        return { tables: [createClusterTable(FULL_CLUSTER_SIZES, context.clusterNotes, 'cluster-full')] };
    }

    if (optionId.startsWith('mek-')) {
        const locationType = optionId.slice('mek-'.length) as MekHitLocationTable;
        const locationTable = createMekLocationTable(locationType);
        const physicalTable = createPhysicalLocationTable(context.physicalRows);
        return withUnitClusterTable([locationTable, physicalTable], locationTable, context);
    }

    if (optionId === 'vehicle-ground') {
        const locationTable = createGroundLocationTable();
        return withUnitClusterTable([
            locationTable,
            createMotiveDamageTable(),
            createMotiveModifierTable(),
            createGroundCriticalTable('GROUND COMBAT VEHICLE CRITICAL HITS TABLE', 'Ground Crit'),
        ], locationTable, context);
    }

    if (optionId === 'vehicle-ground-superheavy') {
        const locationTable = createSuperheavyLocationTable();
        return withUnitClusterTable([
            locationTable,
            createMotiveDamageTable(),
            createMotiveModifierTable(),
            createGroundCriticalTable('LARGE/SUPERHEAVY GROUND VEHICLE CRITICAL HITS TABLE', 'Superheavy Crit'),
        ], locationTable, context);
    }

    if (optionId === 'vehicle-vtol') {
        const locationTable = createVtolLocationTable();
        return withUnitClusterTable([
            locationTable,
            createVtolCriticalTable(),
        ], locationTable, context);
    }

    if (optionId === 'infantry-battle-armor') {
        return { tables: createBattleArmorTables() };
    }

    return { tables: createConventionalInfantryTables() };
}

export function resolveReferenceTableRoll(
    table: ReferenceTableDefinition,
    columnKey: string,
    roll: number,
): ResolvedReferenceTableRoll | null {
    if (!Number.isInteger(roll) || !table.dice) return null;
    const column = table.columns.find(candidate => candidate.key === columnKey);
    if (!column?.rollable) return null;
    const row = table.rows.find(candidate => candidate.roll
        && roll >= candidate.roll.min
        && roll <= candidate.roll.max);
    if (!row?.roll) return null;
    const cell = row.cells[columnKey];
    if (cell === undefined) return null;
    return {
        roll,
        rowKey: row.key,
        rowLabel: row.roll.label,
        value: referenceTableCellText(cell),
        source: referenceTableRollSource(table, column),
    };
}

export function referenceTableRollSource(
    table: ReferenceTableDefinition,
    column: ReferenceTableColumn,
): ReferenceTableRollSource {
    return column.rollSource ?? {
        tableKey: table.key,
        tableLabel: table.shortTitle ?? table.title,
    };
}

export function referenceTableCellText(cell: ReferenceTableCellValue): string {
    return typeof cell === 'string' ? cell : cell.value;
}

export function referenceTableCellRowSpan(cell: ReferenceTableCellValue): number | null {
    return typeof cell === 'string' ? null : cell.rowSpan ?? null;
}

export function isReferenceTableCellContinuation(cell: ReferenceTableCellValue): boolean {
    return typeof cell !== 'string' && cell.continuation === true;
}

function withUnitClusterTable(
    tables: readonly ReferenceTableDefinition[],
    locationTable: ReferenceTableDefinition,
    context: ReferenceTableBuildContext,
): ReferenceTableViewDefinition {
    if (context.clusterSizes.length === 0) return { tables };
    const clusterTable = createClusterTable(context.clusterSizes, context.clusterNotes);
    const locationIndex = tables.findIndex(table => table.key === locationTable.key);
    const tableList = [...tables];
    tableList.splice(locationIndex + 1, 0, clusterTable);
    return {
        tables: tableList,
        combinedTable: combineRollTables(locationTable, clusterTable),
        combinedSourceKeys: [locationTable.key, clusterTable.key],
    };
}

function createMekLocationTable(locationType: MekHitLocationTable): ReferenceTableDefinition {
    const labels: Readonly<Record<MekHitLocationTable, string>> = {
        biped: 'BIPED MEK HIT LOCATIONS',
        tripod: 'TRIPOD MEK HIT LOCATIONS',
        quad: 'QUAD MEK HIT LOCATIONS',
    };
    const shortLabels: Readonly<Record<MekHitLocationTable, string>> = {
        biped: 'Biped',
        tripod: 'Tripod',
        quad: 'Quad',
    };
    const columns: readonly ReferenceTableColumn[] = [
        { key: 'leftSide', label: 'LS', rollable: true },
        { key: 'frontRear', label: 'F/R', rollable: true },
        { key: 'rightSide', label: 'RS', rollable: true },
    ];
    const rows = hitLocationRows(locationType).map((source, index): ReferenceTableRow => ({
        key: `roll-${index + 2}`,
        roll: { label: source.roll, min: index + 2, max: index + 2 },
        cells: {
            leftSide: source.leftSide,
            frontRear: source.frontRear,
            rightSide: source.rightSide,
        },
    }));
    const notes = [
        '* A result of 2 may inflict a critical hit.',
        ...(locationType === 'tripod'
            ? ['† For a tripod, apply the indicated modifier when determining the leg hit.']
            : []),
    ];
    return {
        key: `mek-${locationType}-locations`,
        title: labels[locationType],
        shortTitle: shortLabels[locationType],
        dice: TWO_D6,
        rollLabel: '2d6 roll',
        columns,
        rows,
        notes,
    };
}

function createPhysicalLocationTable(rows: readonly PhysicalLocationRow[]): ReferenceTableDefinition {
    const columns: readonly ReferenceTableColumn[] = [
        { key: 'punchLeftSide', label: 'LS', rollable: true },
        { key: 'punchFrontRear', label: 'F/R', rollable: true },
        { key: 'punchRightSide', label: 'RS', rollable: true },
        { key: 'kickLeftSide', label: 'LS', rollable: true },
        { key: 'kickFrontRear', label: 'F/R', rollable: true },
        { key: 'kickRightSide', label: 'RS', rollable: true },
    ];
    return {
        key: 'mek-physical-locations',
        title: 'PUNCH & KICK LOCATION TABLE',
        shortTitle: 'Punch/Kick',
        dice: D6,
        rollLabel: '1d6 roll',
        columns,
        headerGroups: [
            { label: 'PUNCH', span: 3 },
            { label: 'KICK', span: 3 },
        ],
        rows: rows.map((source, index): ReferenceTableRow => ({
            key: `roll-${source.roll}`,
            roll: { label: String(source.roll), min: source.roll, max: source.roll },
            cells: {
                punchLeftSide: source.punchLeftSide,
                punchFrontRear: source.punchFrontRear,
                punchRightSide: source.punchRightSide,
                kickLeftSide: kickCell(source.kickLeftSide, index),
                kickFrontRear: kickCell(source.kickFrontRear, index),
                kickRightSide: kickCell(source.kickRightSide, index),
            },
        })),
    };
}

function kickCell(value: string, rowIndex: number): ReferenceTableCell {
    return rowIndex % 3 === 0
        ? { value, rowSpan: 3 }
        : { value, continuation: true };
}

function createClusterTable(
    sizes: readonly number[],
    notes: readonly ReferenceTableNote[],
    key = 'cluster-unit',
): ReferenceTableDefinition {
    const uniqueSizes = [...new Set(sizes)].sort((left, right) => left - right);
    const columns = uniqueSizes.map((size): ReferenceTableColumn => ({
        key: `rack-${size}`,
        label: String(size),
        rollable: true,
    }));
    return {
        key,
        title: 'CLUSTER TABLE',
        shortTitle: 'Cluster',
        dice: TWO_D6,
        rollLabel: '2d6 roll',
        columns,
        rows: Array.from({ length: 11 }, (_, index): ReferenceTableRow => {
            const roll = index + 2;
            return {
                key: `roll-${roll}`,
                roll: { label: String(roll), min: roll, max: roll },
                cells: Object.fromEntries(uniqueSizes.map(size => [`rack-${size}`, String(clusterHits(roll, size))])),
            };
        }),
        notes: notes.map(note => note.text),
    };
}

function combineRollTables(
    left: ReferenceTableDefinition,
    right: ReferenceTableDefinition,
): ReferenceTableDefinition {
    const rightRows = new Map(right.rows.map(row => [row.key, row]));
    return {
        key: `${left.key}+${right.key}`,
        title: `${left.title} & ${right.title}`,
        shortTitle: `${left.shortTitle ?? left.title} + ${right.shortTitle ?? right.title}`,
        dice: left.dice,
        rollLabel: left.rollLabel,
        columns: [left, right].flatMap(sourceTable => sourceTable.columns.map(column => ({
            ...column,
            rollSource: referenceTableRollSource(sourceTable, column),
        }))),
        rows: left.rows.map(row => ({
            ...row,
            cells: { ...row.cells, ...rightRows.get(row.key)?.cells },
        })),
        notes: [...(left.notes ?? []), ...(right.notes ?? [])],
    };
}

function createGroundLocationTable(): ReferenceTableDefinition {
    return rollTableFromRows(
        'vehicle-ground-locations',
        'GROUND COMBAT VEHICLE HIT LOCATION TABLE',
        ['front', 'rear', 'side'],
        ['FRONT', 'REAR', 'SIDE'],
        GROUND_HIT_LOCATION_ROWS,
        [
            '* A result of 2 or 12 (or an 8 from the side) may inflict a critical hit.',
            '† Also roll once on the Motive System Damage Table.',
            'A side result hits the side facing the attack; turret results hit that facing when no turret is present.',
        ],
        'Ground',
    );
}

function createSuperheavyLocationTable(): ReferenceTableDefinition {
    return rollTableFromRows(
        'vehicle-superheavy-locations',
        'LARGE/SUPERHEAVY GROUND VEHICLE HIT LOCATION TABLE',
        ['front', 'rear', 'frontSide', 'rearSide'],
        ['FRONT', 'REAR', 'FRONT SIDE§', 'REAR SIDE§'],
        SUPERHEAVY_HIT_LOCATION_ROWS,
        [
            '* A result of 2 or 12 (or an 8 from either side) may inflict a critical hit.',
            '† Also roll once on the Motive System Damage Table.',
            '§ For a Front Right Attack Direction, results 4–9 marked “Side” in the Front Side column resolve to the Front Right Side location. For a Rear Right Attack Direction, those results in the Rear Side column resolve to the Rear Right Side location.',
        ],
        'Superheavy',
    );
}

function createVtolLocationTable(): ReferenceTableDefinition {
    return rollTableFromRows(
        'vehicle-vtol-locations',
        'VTOL COMBAT VEHICLE HIT LOCATION TABLE',
        ['front', 'rear', 'side'],
        ['FRONT', 'REAR', 'SIDE'],
        VTOL_HIT_LOCATION_ROWS,
        [
            '* A result of 2 or 12 (or an 8 from the side) may inflict a critical hit.',
            '† Rotor hits use the VTOL rotor damage rules.',
            '‡ If the VTOL has no turret, a turret strike hits the rotors.',
        ],
        'VTOL',
    );
}

function createGroundCriticalTable(title: string, shortTitle: string): ReferenceTableDefinition {
    return rollTableFromRows(
        'vehicle-ground-critical',
        title,
        ['front', 'side', 'rear', 'turret'],
        ['FRONT', 'SIDE', 'REAR', 'TURRET'],
        GROUND_CRITICAL_ROWS,
        [
            '* Fuel Tank applies to ICE- or Fuel Cell-powered vehicles; Fusion- or Fission-powered vehicles treat it as Engine Hit.',
            '** If the vehicle carries no ammunition, treat this result as Weapon Destroyed.',
            'Stabilizers do not exist in locations without weapons. Ignore such a result and apply the next critical down that table column.',
        ],
        shortTitle,
    );
}

function createVtolCriticalTable(): ReferenceTableDefinition {
    return rollTableFromRows(
        'vehicle-vtol-critical',
        'VTOL COMBAT VEHICLE CRITICAL HITS TABLE',
        ['front', 'side', 'rear', 'rotors', 'turret'],
        ['FRONT', 'SIDE', 'REAR', 'ROTORS', 'TURRET'],
        VTOL_CRITICAL_ROWS,
        [
            '* Fuel Tank applies to ICE-powered VTOLs; fusion-powered VTOLs treat it as Engine Hit.',
            '** If the VTOL carries no ammunition, treat this result as Weapon Destroyed.',
        ],
        'VTOL Crit',
    );
}

function createMotiveDamageTable(): ReferenceTableDefinition {
    return rollTableFromRows(
        'vehicle-motive-damage',
        'MOTIVE SYSTEM DAMAGE TABLE',
        ['effect'],
        ['EFFECT'],
        MOTIVE_DAMAGE_ROWS,
        ['Motive damage and Driving Skill Roll penalties are cumulative, but each individual modifier applies only once.'],
        'Motive',
    );
}

function createMotiveModifierTable(): ReferenceTableDefinition {
    return infoTable(
        'vehicle-motive-modifiers',
        'MOTIVE SYSTEM DAMAGE MODIFIERS',
        [
            { key: 'category', label: 'CATEGORY' },
            { key: 'source', label: 'SOURCE' },
            { key: 'modifier', label: 'MODIFIER' },
        ],
        [
            ['Attack direction', 'Hit from rear', '+1'],
            ['Attack direction', 'Hit from the sides', '+2'],
            ['Vehicle type', 'Tracked, Naval', '+0'],
            ['Vehicle type', 'Wheeled', '+2'],
            ['Vehicle type', 'Hovercraft, Hydrofoil', '+3'],
            ['Vehicle type', 'WiGE', '+4'],
        ],
    );
}

function createBattleArmorTables(): readonly ReferenceTableDefinition[] {
    return [
        compactTable(infoTable(
            'battle-armor-leg-attacks',
            'LEG ATTACKS TABLE',
            [
                { key: 'active', label: 'BATTLE ARMOR TROOPERS ACTIVE' },
                { key: 'modifier', label: 'BASE TO-HIT MODIFIER' },
            ],
            [['4–6', '0'], ['3', '+2'], ['2', '+5'], ['1', '+7']],
        )),
        compactTable(infoTable(
            'battle-armor-swarm-attacks',
            'SWARM ATTACKS TABLE',
            [
                { key: 'active', label: 'BATTLE ARMOR TROOPERS ACTIVE' },
                { key: 'modifier', label: 'BASE TO-HIT MODIFIER' },
            ],
            [['4–6', '+2'], ['1–3', '+5']],
        )),
        createSwarmModifierTable(),
        compactTable(infoTable(
            'battle-armor-swarm-equipment',
            'SWARM ATTACK EQUIPMENT MODIFIERS',
            [{ key: 'equipment', label: 'BATTLE ARMOR EQUIPMENT' }, { key: 'modifier', label: 'MODIFIER' }],
            [['Claws with magnets', '−1']],
        )),
        compactTable(infoTable(
            'battle-armor-swarm-situations',
            'SWARM ATTACK SITUATION MODIFIERS',
            [{ key: 'situation', label: 'SITUATION' }, { key: 'modifier', label: 'MODIFIER' }],
            [["'Mech prone", '−2'], ["'Mech or vehicle immobile", '−4'], ['Vehicle', '−2']],
            ['* Modifiers are cumulative.'],
        )),
        createSwarmLocationTable(),
        compactTable(infoTable(
            'battle-armor-transport-positions',
            'TRANSPORT POSITIONS TABLE',
            [
                { key: 'trooper', label: 'TROOPER NUMBER' },
                { key: 'mek', label: "'MECH LOCATION" },
                { key: 'vehicle', label: 'VEHICLE LOCATION' },
            ],
            [
                ['1', 'Right Torso', 'Right Side'],
                ['2', 'Left Torso', 'Right Side'],
                ['3', 'Right Torso (rear)', 'Left Side'],
                ['4', 'Left Torso (rear)', 'Left Side'],
                ['5', 'Center Torso (rear)', 'Rear'],
                ['6', 'Center Torso', 'Rear'],
            ],
        )),
        compactTable(infoTable(
            'battle-armor-large-support-positions',
            'LARGE SUPPORT VEHICLE TRANSPORT POSITIONS',
            [
                { key: 'trooper', label: 'TROOPER NUMBER' },
                { key: 'location', label: 'LARGE SUPPORT VEHICLE LOCATION*' },
            ],
            [
                ['1', 'Right Side (Unit 1/Unit 2)'],
                ['2', 'Right Side (Unit 1/Unit 2)'],
                ['3', 'Left Side (Unit 1/Unit 2)'],
                ['4', 'Left Side (Unit 1/Unit 2)'],
                ['5', 'Rear (Unit 1/Unit 2)'],
                ['6', 'Rear (Unit 1/Unit 2)'],
            ],
            ['* Unit 1 and Unit 2 represent two battle armor units.'],
        )),
    ];
}

function createSwarmModifierTable(): ReferenceTableDefinition {
    const values = [
        ['6', '+0', '+0', '+0', '+0', '+1', '+2'],
        ['5', '+0', '+0', '+0', '+1', '+2', '+3'],
        ['4', '+0', '+0', '+1', '+2', '+3', '+4'],
        ['3', '+0', '+1', '+2', '+3', '+4', '+5'],
        ['2', '+1', '+2', '+3', '+4', '+5', '+6'],
        ['1', '+2', '+3', '+4', '+5', '+6', '+7'],
    ];
    return {
        ...infoTable(
            'battle-armor-swarm-modifiers',
            'SWARM ATTACK MODIFIERS TABLE',
            [
                { key: 'attacking', label: 'ACTIVE' },
                ...Array.from({ length: 6 }, (_, index): ReferenceTableColumn => ({
                    key: `friendly-${index + 1}`,
                    label: String(index + 1),
                })),
            ],
            values,
        ),
        headerGroups: [
            { label: 'ATTACKING BA', span: 1 },
            { label: 'FRIENDLY', span: 6 },
        ],
    };
}

function createSwarmLocationTable(): ReferenceTableDefinition {
    return rollTableFromRows(
        'battle-armor-swarm-locations',
        'SWARM ATTACKS HIT LOCATION TABLE',
        ['bipedTripod', 'quad'],
        ['BIPEDAL/TRIPOD', 'QUAD'],
        SWARM_LOCATION_ROWS.map((row, index) => [row[0], row[1], row[2], index + 2, index + 2] as const),
        [],
        'BA Swarm',
    );
}

function createConventionalInfantryTables(): readonly ReferenceTableDefinition[] {
    return [
        compactTable(infoTable(
            'conventional-burst-fire-vehicles',
            "BURST-FIRE DAMAGE\n'MECHS, PROTOMECHS & VEHICLES",
            [{ key: 'weapon', label: 'WEAPON' }, { key: 'damage', label: 'DAMAGE VS. CONVENTIONAL INFANTRY' }],
            CONVENTIONAL_BURST_FIRE_ROWS,
        )),
        compactTable(infoTable(
            'conventional-burst-fire-ba',
            'BURST-FIRE DAMAGE\nBATTLE ARMOR',
            [{ key: 'weapon', label: 'WEAPON' }, { key: 'damage', label: 'DAMAGE VS. CONVENTIONAL INFANTRY' }],
            BATTLE_ARMOR_BURST_FIRE_ROWS,
        )),
        infoTable(
            'conventional-non-infantry-weapons',
            'NON-INFANTRY WEAPON AGAINST INFANTRY',
            [{ key: 'weapon', label: 'WEAPON TYPE*' }, { key: 'troopers', label: 'CONVENTIONAL TROOPERS HIT†' }],
            NON_INFANTRY_DAMAGE_ROWS,
            [
                '** Except Small and Micro Pulse Lasers, which are treated as Burst-Fire weapons.',
                '† This is the number of troopers hit and eliminated; double it against mechanized infantry and round up.',
                '‡ Use the specific conventional-infantry damage listed for the Heat-Effect weapon.',
            ],
        ),
    ];
}

function compactTable(table: ReferenceTableDefinition): ReferenceTableDefinition {
    return { ...table, layout: 'compact' };
}

function rollTableFromRows(
    key: string,
    title: string,
    columnKeys: readonly string[],
    columnLabels: readonly string[],
    rows: readonly (readonly (string | number)[])[],
    notes: readonly string[] = [],
    shortTitle?: string,
): ReferenceTableDefinition {
    const columns = columnKeys.map((columnKey, index): ReferenceTableColumn => ({
        key: columnKey,
        label: columnLabels[index] ?? columnKey,
        rollable: true,
    }));
    return {
        key,
        title,
        shortTitle: shortTitle ?? title,
        dice: TWO_D6,
        rollLabel: '2d6 roll',
        columns,
        rows: rows.map((source, rowIndex): ReferenceTableRow => {
            const min = Number(source[source.length - 2]);
            const max = Number(source[source.length - 1]);
            return {
                key: `roll-${min}`,
                roll: { label: String(source[0]), min, max },
                cells: Object.fromEntries(columnKeys.map((columnKey, columnIndex) => [
                    columnKey,
                    String(source[columnIndex + 1]),
                ])),
            };
        }),
        notes,
    };
}

function infoTable(
    key: string,
    title: string,
    columns: readonly ReferenceTableColumn[],
    rows: readonly (readonly string[])[],
    notes: readonly string[] = [],
): ReferenceTableDefinition {
    return {
        key,
        title,
        columns,
        rows: rows.map((source, rowIndex): ReferenceTableRow => ({
            key: `row-${rowIndex}`,
            cells: Object.fromEntries(columns.map((column, columnIndex) => [
                column.key,
                source[columnIndex] ?? '',
            ])),
        })),
        notes,
    };
}
