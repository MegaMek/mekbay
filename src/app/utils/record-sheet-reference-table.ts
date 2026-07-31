/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 */

import type { Unit } from '../models/units.model';
import { WeaponEquipment, type Equipment } from '../models/equipment.model';
import type { EquipmentFlag } from '../models/equipment-flags.type';
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
export function clusterTableForUnit(unit: Pick<Unit, 'type' | 'subtype' | 'comp'>): ClusterTableData {
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

function collectComponentEquipment(component: Unit['comp'][number]): Equipment[] {
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
