// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { UnitSummary } from '../models/unit-summary.model';
import { WeaponEquipment, type Equipment } from '../models/equipment.model';
import type { EquipmentFlag } from '../models/equipment-flags.type';
import type { MekHitArc } from '../models/force-serialization';
import { CORE_2026_GAME_RULES, TW_GAME_RULES, type PhysicalLocationRow } from '../models/rules/game-rules';
import { clusterHits } from './cluster-hit-table';

export type MekHitLocationTable = 'biped' | 'quad' | 'tripod';

export interface ClusterTableData {
    readonly hitLocationTable?: MekHitLocationTable;
    readonly clusterSizes: readonly number[];
    readonly equipment: readonly Pick<Equipment, 'flags'>[];
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
    readonly critical: boolean;
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

/** Native equipment-flag associations for reference-table notes. */
export const REFERENCE_TABLE_NOTE_FLAGS: Readonly<Record<ReferenceTableNoteId, readonly EquipmentFlag[]>> = {
    artemisIV: ['F_ARTEMIS', 'F_ATM'],
    artemisV: ['F_ARTEMIS_V'],
    artemisProto: ['F_ARTEMIS_PROTO'],
    apollo: ['F_APOLLO'],
    hag: ['F_HAG'],
};

const HIT_LOCATION_CELLS = {
    LA: locationCell('LA', 'LA'),
    RA: locationCell('RA', 'RA'),
    LL: locationCell('LL', 'LL'),
    RL: locationCell('RL', 'RL'),
    LT: locationCell('LT', 'LT'),
    CT: locationCell('CT', 'CT'),
    RT: locationCell('RT', 'RT'),
    HD: locationCell('HD', 'HD'),
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
    { roll: '2*', leftSide: HIT_LOCATION_CELLS.LEFT_TORSO_CRITICAL, frontRear: HIT_LOCATION_CELLS.CENTER_TORSO_CRITICAL, rightSide: HIT_LOCATION_CELLS.RIGHT_TORSO_CRITICAL },
    { roll: '3', leftSide: HIT_LOCATION_CELLS.LL, frontRear: HIT_LOCATION_CELLS.RA, rightSide: HIT_LOCATION_CELLS.RL },
    { roll: '4', leftSide: HIT_LOCATION_CELLS.LA, frontRear: HIT_LOCATION_CELLS.RA, rightSide: HIT_LOCATION_CELLS.RA },
    { roll: '5', leftSide: HIT_LOCATION_CELLS.LA, frontRear: HIT_LOCATION_CELLS.RL, rightSide: HIT_LOCATION_CELLS.RA },
    { roll: '6', leftSide: HIT_LOCATION_CELLS.LL, frontRear: HIT_LOCATION_CELLS.RT, rightSide: HIT_LOCATION_CELLS.RL },
    { roll: '7', leftSide: HIT_LOCATION_CELLS.LT, frontRear: HIT_LOCATION_CELLS.CT, rightSide: HIT_LOCATION_CELLS.RT },
    { roll: '8', leftSide: HIT_LOCATION_CELLS.CT, frontRear: HIT_LOCATION_CELLS.LT, rightSide: HIT_LOCATION_CELLS.CT },
    { roll: '9', leftSide: HIT_LOCATION_CELLS.RT, frontRear: HIT_LOCATION_CELLS.LL, rightSide: HIT_LOCATION_CELLS.LT },
    { roll: '10', leftSide: HIT_LOCATION_CELLS.RA, frontRear: HIT_LOCATION_CELLS.LA, rightSide: HIT_LOCATION_CELLS.LA },
    { roll: '11', leftSide: HIT_LOCATION_CELLS.RL, frontRear: HIT_LOCATION_CELLS.LA, rightSide: HIT_LOCATION_CELLS.LL },
    { roll: '12', leftSide: HIT_LOCATION_CELLS.HD, frontRear: HIT_LOCATION_CELLS.HD, rightSide: HIT_LOCATION_CELLS.HD },
];

const QUAD_DEFINITION_ROWS: readonly HitLocationDefinitionRow[] = [
    { roll: '2*', leftSide: HIT_LOCATION_CELLS.LEFT_TORSO_CRITICAL, frontRear: HIT_LOCATION_CELLS.CENTER_TORSO_CRITICAL, rightSide: HIT_LOCATION_CELLS.RIGHT_TORSO_CRITICAL },
    { roll: '3', leftSide: HIT_LOCATION_CELLS.LEFT_REAR_LEG, frontRear: HIT_LOCATION_CELLS.RIGHT_FRONT_LEG, rightSide: HIT_LOCATION_CELLS.RIGHT_REAR_LEG },
    { roll: '4', leftSide: HIT_LOCATION_CELLS.LEFT_FRONT_LEG, frontRear: HIT_LOCATION_CELLS.RIGHT_FRONT_LEG, rightSide: HIT_LOCATION_CELLS.RIGHT_FRONT_LEG },
    { roll: '5', leftSide: HIT_LOCATION_CELLS.LEFT_FRONT_LEG, frontRear: HIT_LOCATION_CELLS.RIGHT_REAR_LEG, rightSide: HIT_LOCATION_CELLS.RIGHT_FRONT_LEG },
    { roll: '6', leftSide: HIT_LOCATION_CELLS.LEFT_REAR_LEG, frontRear: HIT_LOCATION_CELLS.RT, rightSide: HIT_LOCATION_CELLS.RIGHT_REAR_LEG },
    { roll: '7', leftSide: HIT_LOCATION_CELLS.LT, frontRear: HIT_LOCATION_CELLS.CT, rightSide: HIT_LOCATION_CELLS.RT },
    { roll: '8', leftSide: HIT_LOCATION_CELLS.CT, frontRear: HIT_LOCATION_CELLS.LT, rightSide: HIT_LOCATION_CELLS.CT },
    { roll: '9', leftSide: HIT_LOCATION_CELLS.RT, frontRear: HIT_LOCATION_CELLS.LEFT_REAR_LEG, rightSide: HIT_LOCATION_CELLS.LT },
    { roll: '10', leftSide: HIT_LOCATION_CELLS.RIGHT_FRONT_LEG, frontRear: HIT_LOCATION_CELLS.LEFT_FRONT_LEG, rightSide: HIT_LOCATION_CELLS.LEFT_FRONT_LEG },
    { roll: '11', leftSide: HIT_LOCATION_CELLS.RIGHT_REAR_LEG, frontRear: HIT_LOCATION_CELLS.LEFT_FRONT_LEG, rightSide: HIT_LOCATION_CELLS.LEFT_REAR_LEG },
    { roll: '12', leftSide: HIT_LOCATION_CELLS.HD, frontRear: HIT_LOCATION_CELLS.HD, rightSide: HIT_LOCATION_CELLS.HD },
];

const TRIPOD_DEFINITION_ROWS: readonly HitLocationDefinitionRow[] = [
    { roll: '2*', leftSide: HIT_LOCATION_CELLS.LEFT_TORSO_CRITICAL, frontRear: HIT_LOCATION_CELLS.CENTER_TORSO_CRITICAL, rightSide: HIT_LOCATION_CELLS.RIGHT_TORSO_CRITICAL },
    { roll: '3', leftSide: HIT_LOCATION_CELLS.TRIPOD_LEFT_LEG, frontRear: HIT_LOCATION_CELLS.RA, rightSide: HIT_LOCATION_CELLS.TRIPOD_RIGHT_LEG },
    { roll: '4', leftSide: HIT_LOCATION_CELLS.LA, frontRear: HIT_LOCATION_CELLS.RA, rightSide: HIT_LOCATION_CELLS.RA },
    { roll: '5', leftSide: HIT_LOCATION_CELLS.LA, frontRear: HIT_LOCATION_CELLS.TRIPOD_CENTER_LEG, rightSide: HIT_LOCATION_CELLS.RA },
    { roll: '6', leftSide: HIT_LOCATION_CELLS.TRIPOD_LEFT_LEG, frontRear: HIT_LOCATION_CELLS.RT, rightSide: HIT_LOCATION_CELLS.TRIPOD_RIGHT_LEG },
    { roll: '7', leftSide: HIT_LOCATION_CELLS.LT, frontRear: HIT_LOCATION_CELLS.CT, rightSide: HIT_LOCATION_CELLS.RT },
    { roll: '8', leftSide: HIT_LOCATION_CELLS.CT, frontRear: HIT_LOCATION_CELLS.LT, rightSide: HIT_LOCATION_CELLS.CT },
    { roll: '9', leftSide: HIT_LOCATION_CELLS.RT, frontRear: HIT_LOCATION_CELLS.TRIPOD_CENTER_LEG, rightSide: HIT_LOCATION_CELLS.LT },
    { roll: '10', leftSide: HIT_LOCATION_CELLS.RA, frontRear: HIT_LOCATION_CELLS.LA, rightSide: HIT_LOCATION_CELLS.LA },
    { roll: '11', leftSide: HIT_LOCATION_CELLS.TRIPOD_LEFT_LEG, frontRear: HIT_LOCATION_CELLS.LA, rightSide: HIT_LOCATION_CELLS.TRIPOD_RIGHT_LEG },
    { roll: '12', leftSide: HIT_LOCATION_CELLS.HD, frontRear: HIT_LOCATION_CELLS.HD, rightSide: HIT_LOCATION_CELLS.HD },
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

export const PHYSICAL_LOCATION_ROWS: readonly PhysicalLocationRow[] = CORE_2026_GAME_RULES.physicalLocationRows;

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

/** Resolves the exact table text and its rule metadata without parsing display strings. */
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
    critical = false,
): HitLocationCellDefinition {
    return { tableText, tableLabel, location, critical };
}

function tripodLegCell(
    tableText: string,
    tableLabel: string,
    tripodLegModifier: -1 | 0 | 1,
): HitLocationCellDefinition {
    return { tableText, tableLabel, location: null, critical: false, tripodLegModifier };
}

function displayHitLocationRows(rows: readonly HitLocationDefinitionRow[]): readonly HitLocationRow[] {
    return rows.map(row => ({
        roll: row.roll,
        leftSide: row.leftSide.tableText,
        frontRear: row.frontRear.tableText,
        rightSide: row.rightSide.tableText,
    }));
}

export function referenceTableNotes(
    table: MekHitLocationTable | undefined,
    equipment: readonly Pick<Equipment, 'flags'>[] = [],
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
    const sizes = new Set<number>();

    for (const item of equipment) {
        if (!(item instanceof WeaponEquipment)) continue;

        if (item.getWeaponTypes().includes('R')) {
            for (let size = 2; size <= item.getRapidFireCount(); size++) sizes.add(size);
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

    const hitLocationTable = unit.type === 'Mek'
        ? unit.subtype.startsWith('Tripod') ? 'tripod'
            : unit.subtype.startsWith('Quad') ? 'quad' : 'biped'
        : undefined;

    return {
        hitLocationTable,
        clusterSizes: [...sizes].sort((left, right) => left - right),
        equipment,
    };
}

function collectComponentEquipment(component: UnitSummary['comp'][number]): Equipment[] {
    return [
        ...(component.eq ? [component.eq] : []),
        ...(component.bay?.flatMap(collectComponentEquipment) ?? []),
    ];
}

/** Resolves reference-table notes from the native flags on installed equipment. */
export function referenceTableNoteIds(
    equipment: readonly Pick<Equipment, 'flags'>[],
): readonly ReferenceTableNoteId[] {
    const flags = new Set<EquipmentFlag>(equipment.flatMap(item => [...item.flags]));
    const noteIds: ReferenceTableNoteId[] = [];

    if (REFERENCE_TABLE_NOTE_FLAGS.artemisIV.some(flag => flags.has(flag))) {
        noteIds.push('artemisIV');
    } else if (REFERENCE_TABLE_NOTE_FLAGS.artemisV.some(flag => flags.has(flag))) {
        noteIds.push('artemisV');
    } else if (REFERENCE_TABLE_NOTE_FLAGS.artemisProto.some(flag => flags.has(flag))) {
        noteIds.push('artemisProto');
    }
    for (const noteId of ['apollo', 'hag'] as const) {
        if (REFERENCE_TABLE_NOTE_FLAGS[noteId].some(flag => flags.has(flag))) noteIds.push(noteId);
    }

    return noteIds;
}

export function clusterTableRows(clusterSizes: readonly number[]): readonly (readonly string[])[] {
    return Array.from({ length: 11 }, (_, index) => {
        const roll = index + 2;
        return [String(roll), ...clusterSizes.map(size => String(clusterHits(roll, size)))];
    });
}
