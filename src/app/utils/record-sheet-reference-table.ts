// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { UnitSummary } from '../models/unit-summary.model';
import { WeaponEquipment, type Equipment } from '../models/equipment.model';
import type { EquipmentFlag } from '../models/equipment-flags.type';
import type { MekEntity } from '../models/entity/entities/mek/mek-entity';
import type { BaseEntity } from '../models/entity/base-entity';
import { TW_GAME_RULES, type PhysicalLocationRow } from '../models/rules/game-rules';
import { clusterHits } from './cluster-hit-table';
import { isHagEquipment } from '../models/hag-mode.model';
import { isApolloEquipment } from '../models/apollo-mode.model';
import { artemisReferenceNoteFromFlags } from '../models/artemis-equipment.model';

export type MekHitLocationTable = 'biped' | 'quad' | 'tripod';
export type MekHitArc = 'front' | 'rear' | 'left' | 'right';

export interface ClusterTableData {
    readonly hitLocationTable?: MekHitLocationTable;
    readonly clusterSizes: readonly number[];
    readonly equipment: readonly ReferenceTableEquipmentFlags[];
}

export interface ReferenceTableEquipmentFlags {
    readonly flags: ReadonlySet<EquipmentFlag>;
}

export interface HitLocationRow {
    readonly roll: string;
    readonly leftSide: string;
    readonly frontRear: string;
    readonly rightSide: string;
}

export interface HitLocationCellDefinition {
    readonly tableText: string;
    readonly tableLabel: string;
    readonly location: string | null;
    readonly throughArmorCritical: boolean;
    readonly tripodLegModifier?: -1 | 0 | 1;
}

interface HitLocationDefinitionRow {
    readonly roll: string;
    readonly leftSide: HitLocationCellDefinition;
    readonly frontRear: HitLocationCellDefinition;
    readonly rightSide: HitLocationCellDefinition;
}

export type PhysicalLocationColumn =
    | 'punchLeftSide'
    | 'punchFrontRear'
    | 'punchRightSide'
    | 'kickLeftSide'
    | 'kickFrontRear'
    | 'kickRightSide';

export type { PhysicalLocationRow } from '../models/rules/game-rules';

export interface ReferenceTableNote {
    readonly id: string;
    readonly text: string;
}

export type ReferenceTableNoteId = 'artemisIV' | 'artemisV' | 'artemisProto' | 'apollo' | 'hag';

const HIT_LOCATION_CELLS = {
    LA: locationCell('LA', 'LA'), RA: locationCell('RA', 'RA'),
    LL: locationCell('LL', 'LL'), RL: locationCell('RL', 'RL'),
    LT: locationCell('LT', 'LT'), CT: locationCell('CT', 'CT'),
    RT: locationCell('RT', 'RT'), HD: locationCell('HD', 'HD'),
    LEFT_TORSO_CRITICAL: locationCell('LT(C)', 'LT', 'LT', true),
    CENTER_TORSO_CRITICAL: locationCell('CT(C)', 'CT', 'CT', true),
    RIGHT_TORSO_CRITICAL: locationCell('RT(C)', 'RT', 'RT', true),
    LEFT_FRONT_LEG: locationCell('LFL', 'FLL'),
    RIGHT_FRONT_LEG: locationCell('RFL', 'FRL'),
    LEFT_REAR_LEG: locationCell('LRL', 'RLL'),
    RIGHT_REAR_LEG: locationCell('RRL', 'RRL'),
    TRIPOD_LEFT_LEG: tripodLegCell('Leg (+1)†', 'Leg (+1)', 1),
    TRIPOD_CENTER_LEG: tripodLegCell('Leg†', 'Leg', 0),
    TRIPOD_RIGHT_LEG: tripodLegCell('Leg (-1)†', 'Leg (-1)', -1),
} as const satisfies Readonly<Record<string, HitLocationCellDefinition>>;

const BIPED_DEFINITION_ROWS: readonly HitLocationDefinitionRow[] = [
    definitionRow('2*', 'LEFT_TORSO_CRITICAL', 'CENTER_TORSO_CRITICAL', 'RIGHT_TORSO_CRITICAL'),
    definitionRow('3', 'LL', 'RA', 'RL'), definitionRow('4', 'LA', 'RA', 'RA'),
    definitionRow('5', 'LA', 'RL', 'RA'), definitionRow('6', 'LL', 'RT', 'RL'),
    definitionRow('7', 'LT', 'CT', 'RT'), definitionRow('8', 'CT', 'LT', 'CT'),
    definitionRow('9', 'RT', 'LL', 'LT'), definitionRow('10', 'RA', 'LA', 'LA'),
    definitionRow('11', 'RL', 'LA', 'LL'), definitionRow('12', 'HD', 'HD', 'HD'),
];

const QUAD_DEFINITION_ROWS: readonly HitLocationDefinitionRow[] = [
    definitionRow('2*', 'LEFT_TORSO_CRITICAL', 'CENTER_TORSO_CRITICAL', 'RIGHT_TORSO_CRITICAL'),
    definitionRow('3', 'LEFT_REAR_LEG', 'RIGHT_FRONT_LEG', 'RIGHT_REAR_LEG'),
    definitionRow('4', 'LEFT_FRONT_LEG', 'RIGHT_FRONT_LEG', 'RIGHT_FRONT_LEG'),
    definitionRow('5', 'LEFT_FRONT_LEG', 'RIGHT_REAR_LEG', 'RIGHT_FRONT_LEG'),
    definitionRow('6', 'LEFT_REAR_LEG', 'RT', 'RIGHT_REAR_LEG'),
    definitionRow('7', 'LT', 'CT', 'RT'), definitionRow('8', 'CT', 'LT', 'CT'),
    definitionRow('9', 'RT', 'LEFT_REAR_LEG', 'LT'),
    definitionRow('10', 'RIGHT_FRONT_LEG', 'LEFT_FRONT_LEG', 'LEFT_FRONT_LEG'),
    definitionRow('11', 'RIGHT_REAR_LEG', 'LEFT_FRONT_LEG', 'LEFT_REAR_LEG'),
    definitionRow('12', 'HD', 'HD', 'HD'),
];

const TRIPOD_DEFINITION_ROWS: readonly HitLocationDefinitionRow[] = [
    definitionRow('2*', 'LEFT_TORSO_CRITICAL', 'CENTER_TORSO_CRITICAL', 'RIGHT_TORSO_CRITICAL'),
    definitionRow('3', 'TRIPOD_LEFT_LEG', 'RA', 'TRIPOD_RIGHT_LEG'),
    definitionRow('4', 'LA', 'RA', 'RA'), definitionRow('5', 'LA', 'TRIPOD_CENTER_LEG', 'RA'),
    definitionRow('6', 'TRIPOD_LEFT_LEG', 'RT', 'TRIPOD_RIGHT_LEG'),
    definitionRow('7', 'LT', 'CT', 'RT'), definitionRow('8', 'CT', 'LT', 'CT'),
    definitionRow('9', 'RT', 'TRIPOD_CENTER_LEG', 'LT'),
    definitionRow('10', 'RA', 'LA', 'LA'),
    definitionRow('11', 'TRIPOD_LEFT_LEG', 'LA', 'TRIPOD_RIGHT_LEG'),
    definitionRow('12', 'HD', 'HD', 'HD'),
];

const LOCATION_DEFINITION_ROWS: Readonly<Record<MekHitLocationTable, readonly HitLocationDefinitionRow[]>> = {
    biped: BIPED_DEFINITION_ROWS,
    quad: QUAD_DEFINITION_ROWS,
    tripod: TRIPOD_DEFINITION_ROWS,
};

const LOCATION_ROWS: Readonly<Record<MekHitLocationTable, readonly HitLocationRow[]>> = {
    biped: displayHitLocationRows(BIPED_DEFINITION_ROWS),
    quad: displayHitLocationRows(QUAD_DEFINITION_ROWS),
    tripod: displayHitLocationRows(TRIPOD_DEFINITION_ROWS),
};

const BIPED_RECORD_SHEET_PHYSICAL_ROWS: readonly PhysicalLocationRow[] = [
    { roll: 1, punchLeftSide: 'LT', punchFrontRear: 'LA', punchRightSide: 'RT', kickLeftSide: 'LL', kickFrontRear: 'RL', kickRightSide: 'RL' },
    { roll: 2, punchLeftSide: 'LT', punchFrontRear: 'LT', punchRightSide: 'RT', kickLeftSide: 'LL', kickFrontRear: 'RL', kickRightSide: 'RL' },
    { roll: 3, punchLeftSide: 'CT', punchFrontRear: 'CT', punchRightSide: 'CT', kickLeftSide: 'LL', kickFrontRear: 'RL', kickRightSide: 'RL' },
    { roll: 4, punchLeftSide: 'LA', punchFrontRear: 'RT', punchRightSide: 'RA', kickLeftSide: 'LL', kickFrontRear: 'LL', kickRightSide: 'RL' },
    { roll: 5, punchLeftSide: 'LA', punchFrontRear: 'RA', punchRightSide: 'RA', kickLeftSide: 'LL', kickFrontRear: 'LL', kickRightSide: 'RL' },
    { roll: 6, punchLeftSide: 'HD', punchFrontRear: 'HD', punchRightSide: 'HD', kickLeftSide: 'LL', kickFrontRear: 'LL', kickRightSide: 'RL' },
];

const QUAD_RECORD_SHEET_PHYSICAL_ROWS: readonly PhysicalLocationRow[] = [
    { roll: 1, punchLeftSide: 'LT', punchFrontRear: 'LFL/LRL', punchRightSide: 'RT', kickLeftSide: 'LFL', kickFrontRear: 'RFL/RRL', kickRightSide: 'RFL' },
    { roll: 2, punchLeftSide: 'LT', punchFrontRear: 'LT', punchRightSide: 'RT', kickLeftSide: 'LFL', kickFrontRear: 'RFL/RRL', kickRightSide: 'RFL' },
    { roll: 3, punchLeftSide: 'CT', punchFrontRear: 'CT', punchRightSide: 'CT', kickLeftSide: 'LFL', kickFrontRear: 'RFL/RRL', kickRightSide: 'RFL' },
    { roll: 4, punchLeftSide: 'LFL', punchFrontRear: 'RT', punchRightSide: 'RFL', kickLeftSide: 'LRL', kickFrontRear: 'LFL/LRL', kickRightSide: 'RRL' },
    { roll: 5, punchLeftSide: 'LRL', punchFrontRear: 'RFL/RRL', punchRightSide: 'RRL', kickLeftSide: 'LRL', kickFrontRear: 'LFL/LRL', kickRightSide: 'RRL' },
    { roll: 6, punchLeftSide: 'HD', punchFrontRear: 'HD', punchRightSide: 'HD', kickLeftSide: 'LRL', kickFrontRear: 'LFL/LRL', kickRightSide: 'RRL' },
];

const TRIPOD_RECORD_SHEET_PHYSICAL_ROWS: readonly PhysicalLocationRow[] = [
    { roll: 1, punchLeftSide: 'LT', punchFrontRear: 'LA', punchRightSide: 'RT', kickLeftSide: 'LL', kickFrontRear: 'LL', kickRightSide: 'LL' },
    { roll: 2, punchLeftSide: 'LT', punchFrontRear: 'LT', punchRightSide: 'RT', kickLeftSide: 'LL', kickFrontRear: 'LL', kickRightSide: 'CL' },
    { roll: 3, punchLeftSide: 'CT', punchFrontRear: 'CT', punchRightSide: 'CT', kickLeftSide: 'LL', kickFrontRear: 'CL', kickRightSide: 'CL' },
    { roll: 4, punchLeftSide: 'LA', punchFrontRear: 'RT', punchRightSide: 'RA', kickLeftSide: 'CL', kickFrontRear: 'CL', kickRightSide: 'RL' },
    { roll: 5, punchLeftSide: 'LA', punchFrontRear: 'RA', punchRightSide: 'RA', kickLeftSide: 'CL', kickFrontRear: 'RL', kickRightSide: 'RL' },
    { roll: 6, punchLeftSide: 'HD', punchFrontRear: 'HD', punchRightSide: 'HD', kickLeftSide: 'RL', kickFrontRear: 'RL', kickRightSide: 'RL' },
];

const RECORD_SHEET_PHYSICAL_ROWS: Readonly<Record<MekHitLocationTable, readonly PhysicalLocationRow[]>> = {
    biped: BIPED_RECORD_SHEET_PHYSICAL_ROWS,
    quad: QUAD_RECORD_SHEET_PHYSICAL_ROWS,
    tripod: TRIPOD_RECORD_SHEET_PHYSICAL_ROWS,
};

const NOTE_TEXT: Readonly<Record<string, string>> = {
    tripodLeg: '† For a tripod, apply the indicated modifier when determining the leg hit.',
    artemisIV: 'Artemis IV ammunition modifies the cluster-hit roll as described by the rules.',
    artemisV: 'Artemis V ammunition modifies the cluster-hit roll as described by the rules.',
    artemisProto: 'Prototype Artemis ammunition modifies the cluster-hit roll as described by the rules.',
    apollo: 'Apollo fire control modifies the cluster-hit roll as described by the rules.',
    hag: 'HAG cluster hits use the HAG rules.',
    atm: 'ATM cluster hits use the ATM/Artemis rules.',
};

export function hitLocationRows(table: MekHitLocationTable): readonly HitLocationRow[] {
    return LOCATION_ROWS[table];
}

/** Exact hit-location fact used by floating criticals and falling damage. */
export function hitLocationCellDefinition(
    table: MekHitLocationTable,
    roll: number,
    arc: MekHitArc,
): HitLocationCellDefinition {
    const row = LOCATION_DEFINITION_ROWS[table][roll - 2];
    if (!row) throw new RangeError('Hit-location roll must be an integer from 2 to 12.');
    if (arc === 'left') return row.leftSide;
    if (arc === 'right') return row.rightSide;
    return row.frontRear;
}

function locationCell(
    tableText: string,
    location: string,
    tableLabel = tableText,
    throughArmorCritical = false,
): HitLocationCellDefinition {
    return Object.freeze({ tableText, tableLabel, location, throughArmorCritical });
}

function tripodLegCell(
    tableText: string,
    tableLabel: string,
    tripodLegModifier: -1 | 0 | 1,
): HitLocationCellDefinition {
    return Object.freeze({ tableText, tableLabel, location: null, throughArmorCritical: false, tripodLegModifier });
}

function definitionRow(
    roll: string,
    left: keyof typeof HIT_LOCATION_CELLS,
    front: keyof typeof HIT_LOCATION_CELLS,
    right: keyof typeof HIT_LOCATION_CELLS,
): HitLocationDefinitionRow {
    return Object.freeze({
        roll,
        leftSide: HIT_LOCATION_CELLS[left],
        frontRear: HIT_LOCATION_CELLS[front],
        rightSide: HIT_LOCATION_CELLS[right],
    });
}

function displayHitLocationRows(rows: readonly HitLocationDefinitionRow[]): readonly HitLocationRow[] {
    return Object.freeze(rows.map(row => Object.freeze({
        roll: row.roll,
        leftSide: row.leftSide.tableText,
        frontRear: row.frontRear.tableText,
        rightSide: row.rightSide.tableText,
    })));
}

/** MegaMekLab-compatible punch/kick rows for the printed record sheet. */
export function recordSheetPhysicalLocationRows(
    table: MekHitLocationTable,
): readonly PhysicalLocationRow[] {
    return RECORD_SHEET_PHYSICAL_ROWS[table];
}

export function referenceTableNotes(
    table: MekHitLocationTable | undefined,
    equipment: readonly ReferenceTableEquipmentFlags[] = [],
): readonly ReferenceTableNote[] {
    const ids: string[] = [...referenceTableNoteIds(equipment)];
    if (table === 'tripod') ids.push('tripodLeg');
    return [...new Set(ids)].map(id => ({ id, text: NOTE_TEXT[id] ?? id }));
}

/**
 * Derives the reference-table data from the unit's native component records.
 */
export function clusterTableForUnit(unit: Pick<UnitSummary, 'type' | 'subtype' | 'comp'>): ClusterTableData {
    const equipment = unit.comp.flatMap(collectComponentEquipment);
    const hitLocationTable = unit.type === 'Mek'
        ? unit.subtype.startsWith('Tripod') ? 'tripod'
            : unit.subtype.startsWith('Quad') ? 'quad' : 'biped'
        : undefined;
    return clusterTableForEquipment(hitLocationTable, equipment);
}

/** Derives the printed hit-location and cluster columns directly from a live Mek. */
export function clusterTableForMekEntity(entity: MekEntity): ClusterTableData {
    return clusterTableForEquipment(
        entity.chassisConfig === 'Tripod' ? 'tripod'
            : entity.chassisConfig === 'Quad' || entity.chassisConfig === 'QuadVee' ? 'quad' : 'biped',
        entity.equipment()
            .map(mount => mount.equipment)
            .filter((equipment): equipment is Equipment => equipment !== undefined),
    );
}

/** Derives cluster columns for any live entity without family-specific projections. */
export function clusterTableForEntity(entity: BaseEntity): ClusterTableData {
    return clusterTableForEquipment(
        undefined,
        entity.equipment()
            .map(mount => mount.equipment)
            .filter((equipment): equipment is Equipment => equipment !== undefined),
    );
}

function clusterTableForEquipment(
    hitLocationTable: MekHitLocationTable | undefined,
    equipment: readonly Equipment[],
): ClusterTableData {
    const sizes = new Set<number>();

    for (const item of equipment) {
        if (!(item instanceof WeaponEquipment)) continue;
        const rapidFireCount = item.getRapidFireCount();
        if (rapidFireCount > 1) {
            for (let size = 2; size <= rapidFireCount; size++) sizes.add(size);
            continue;
        }
        switch (item.ammoType) {
            case 'AC_LBX':
            case 'EXLRM':
            case 'IATM':
            case 'LRM':
            case 'LRM_IMP':
            case 'LRM_PRIMITIVE':
            case 'LRM_TORPEDO':
            case 'LRM_STREAK':
            case 'MML':
            case 'MRM':
            case 'NLRM':
            case 'ROCKET_LAUNCHER':
            case 'SBGAUSS':
            case 'SRM':
            case 'SRM_ADVANCED':
            case 'SRM_IMP':
            case 'SRM_PRIMITIVE':
            case 'SRM_TORPEDO':
            case 'SRM_STREAK':
            case 'ATM':
            case 'HAG':
                if (item.rackSize > 0) sizes.add(item.rackSize);
                break;
            case 'MG':
            case 'MG_HEAVY':
            case 'MG_LIGHT':
                if (item.hasFlag('F_MGA')) {
                    for (let size = 2; size <= 4; size++) sizes.add(size);
                }
                break;
        }
    }

    return Object.freeze({
        ...(hitLocationTable === undefined ? {} : { hitLocationTable }),
        clusterSizes: Object.freeze([...sizes].sort((left, right) => left - right)),
        equipment,
    });
}

function collectComponentEquipment(component: UnitSummary['comp'][number]): Equipment[] {
    return [
        ...(component.eq ? [component.eq] : []),
        ...(component.bay?.flatMap(collectComponentEquipment) ?? []),
    ];
}

/** Resolves reference-table notes from the native flags on installed equipment. */
export function referenceTableNoteIds(
    equipment: readonly ReferenceTableEquipmentFlags[],
): readonly ReferenceTableNoteId[] {
    const flags = new Set<EquipmentFlag>(equipment.flatMap(item => [...item.flags]));
    const equipmentView = Object.freeze({
        hasFlag: (flag: string) => flags.has(flag as EquipmentFlag),
    });
    const noteIds: ReferenceTableNoteId[] = [];

    const artemisNote = artemisReferenceNoteFromFlags(flags);
    if (artemisNote !== null) noteIds.push(artemisNote);
    if (isApolloEquipment(equipmentView)) noteIds.push('apollo');
    if (isHagEquipment(equipmentView)) noteIds.push('hag');

    return noteIds;
}

export function clusterTableRows(clusterSizes: readonly number[]): readonly (readonly string[])[] {
    return Array.from({ length: 11 }, (_, index) => {
        const roll = index + 2;
        return [String(roll), ...clusterSizes.map(size => String(clusterHits(roll, size)))];
    });
}
