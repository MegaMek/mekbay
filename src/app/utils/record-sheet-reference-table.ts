// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { UnitSummary } from '../models/unit-summary.model';
import { WeaponEquipment, type Equipment } from '../models/equipment.model';
import type { EquipmentFlag } from '../models/equipment-flags.type';
import type { MekEntity } from '../models/entity/entities/mek/mek-entity';
import type { BaseEntity } from '../models/entity/base-entity';
import type { MekRecordSheetSnapshot } from '../models/runtime/mek-record-sheet';
import { CORE_2026_GAME_RULES, TW_GAME_RULES, type PhysicalLocationRow } from '../models/rules/game-rules';
import { clusterHits } from './cluster-hit-table';
import { isHagEquipment } from '../models/hag-mode.model';
import { isApolloEquipment } from '../models/apollo-mode.model';
import { artemisReferenceNoteFromFlags } from '../models/artemis-equipment.model';

export type MekHitLocationTable = 'biped' | 'quad' | 'tripod';

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

const BIPED_ROWS: readonly HitLocationRow[] = [
    { roll: '2*', leftSide: 'LT(C)', frontRear: 'CT(C)', rightSide: 'RT(C)' },
    { roll: '3', leftSide: 'LL', frontRear: 'RA', rightSide: 'RL' },
    { roll: '4', leftSide: 'LA', frontRear: 'RA', rightSide: 'RA' },
    { roll: '5', leftSide: 'LA', frontRear: 'RL', rightSide: 'RA' },
    { roll: '6', leftSide: 'LL', frontRear: 'RT', rightSide: 'RL' },
    { roll: '7', leftSide: 'LT', frontRear: 'CT', rightSide: 'RT' },
    { roll: '8', leftSide: 'CT', frontRear: 'LT', rightSide: 'CT' },
    { roll: '9', leftSide: 'RT', frontRear: 'LL', rightSide: 'LT' },
    { roll: '10', leftSide: 'RA', frontRear: 'LA', rightSide: 'LA' },
    { roll: '11', leftSide: 'RL', frontRear: 'LA', rightSide: 'LL' },
    { roll: '12', leftSide: 'HD', frontRear: 'HD', rightSide: 'HD' },
];

const QUAD_ROWS: readonly HitLocationRow[] = [
    { roll: '2*', leftSide: 'LT(C)', frontRear: 'CT(C)', rightSide: 'RT(C)' },
    { roll: '3', leftSide: 'LRL', frontRear: 'RFL', rightSide: 'RRL' },
    { roll: '4', leftSide: 'LFL', frontRear: 'RFL', rightSide: 'RFL' },
    { roll: '5', leftSide: 'LFL', frontRear: 'RRL', rightSide: 'RFL' },
    { roll: '6', leftSide: 'LRL', frontRear: 'RT', rightSide: 'RRL' },
    { roll: '7', leftSide: 'LT', frontRear: 'CT', rightSide: 'RT' },
    { roll: '8', leftSide: 'CT', frontRear: 'LT', rightSide: 'CT' },
    { roll: '9', leftSide: 'RT', frontRear: 'LRL', rightSide: 'LT' },
    { roll: '10', leftSide: 'RFL', frontRear: 'LFL', rightSide: 'LFL' },
    { roll: '11', leftSide: 'RRL', frontRear: 'LFL', rightSide: 'LRL' },
    { roll: '12', leftSide: 'HD', frontRear: 'HD', rightSide: 'HD' },
];

const TRIPOD_ROWS: readonly HitLocationRow[] = [
    { roll: '2*', leftSide: 'LT(C)', frontRear: 'CT(C)', rightSide: 'RT(C)' },
    { roll: '3', leftSide: 'Leg (+1)†', frontRear: 'RA', rightSide: 'Leg (-1)†' },
    { roll: '4', leftSide: 'LA', frontRear: 'RA', rightSide: 'RA' },
    { roll: '5', leftSide: 'LA', frontRear: 'Leg†', rightSide: 'RA' },
    { roll: '6', leftSide: 'Leg (+1)†', frontRear: 'RT', rightSide: 'Leg (-1)†' },
    { roll: '7', leftSide: 'LT', frontRear: 'CT', rightSide: 'RT' },
    { roll: '8', leftSide: 'CT', frontRear: 'LT', rightSide: 'CT' },
    { roll: '9', leftSide: 'RT', frontRear: 'Leg†', rightSide: 'LT' },
    { roll: '10', leftSide: 'RA', frontRear: 'LA', rightSide: 'LA' },
    { roll: '11', leftSide: 'Leg (+1)†', frontRear: 'LA', rightSide: 'Leg (-1)†' },
    { roll: '12', leftSide: 'HD', frontRear: 'HD', rightSide: 'HD' },
];

const LOCATION_ROWS: Readonly<Record<MekHitLocationTable, readonly HitLocationRow[]>> = {
    biped: BIPED_ROWS,
    quad: QUAD_ROWS,
    tripod: TRIPOD_ROWS,
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

/** Derives reference-table facts from the detached record-sheet projection. */
export function clusterTableForMekRecordSheet(
    snapshot: MekRecordSheetSnapshot,
): ClusterTableData {
    return clusterTableForEquipment(
        snapshot.identity.form === 'tripod' ? 'tripod'
            : snapshot.identity.form === 'quad' || snapshot.identity.form === 'quadvee' ? 'quad' : 'biped',
        snapshot.equipment
            .map(component => component.equipment)
            .filter((equipment): equipment is Equipment => equipment !== undefined),
    );
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
                if (item.hasWeaponTrait('machine-gun-array')) {
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
