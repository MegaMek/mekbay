// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EntityMountedEquipment } from '../entity/types/equipment';
import type { ProtoMekEntity } from '../entity/entities/protomek/protomek-entity';
import { isJumpJetEquipment } from '../jump-equipment.model';
import { systemDamageDefinitions,type SystemDamageKind } from './system-damage-rules';

export interface ProtoMekCriticalReference {
    readonly system: SystemDamageKind;
    readonly location: string;
    readonly rolls: readonly number[];
    readonly effects: readonly Readonly<{ text: string; detail?: string }>[];
}

export const PROTOMEK_GLIDER_WING_CRITICAL_REFERENCE = Object.freeze({
    rolls: Object.freeze([3, 11]),
    location: 'Wings',
    effect: '-1 Cruise MP (Each Hit)',
});

/** Hit locations and system consequences, independent of record-sheet geometry. */
export function protoMekCriticalReferences(entity: ProtoMekEntity): readonly ProtoMekCriticalReference[] {
    const supported = new Set(systemDamageDefinitions(entity).map(track => track.system));
    const rows: readonly ProtoMekCriticalReference[] = [
        { system: 'main-gun', location: 'Main Gun', rolls: [2], effects: [{ text: 'Main Gun Destroyed' }] },
        { system: 'right-arm', location: 'Right Arm', rolls: [4], effects: [
            { text: '+1 to Hit' }, { text: 'Right Arm Destroyed' },
        ] },
        { system: 'legs', location: 'Legs', rolls: entity.isQuad() ? [4, 5, 9, 10] : [5, 9], effects: [
            { text: '-1 Walk MP' }, { text: '1/2 Walk MP' }, { text: 'No Move' },
        ] },
        { system: 'torso', location: 'Torso', rolls: [6, 7, 8], effects: [
            { text: entity.isGlider() ? '-1 Cruise MP' : '-1 Jump MP*' },
            { text: entity.isGlider() ? '1/2 Cruise MP' : '1/2 Jump MP*' },
            { text: 'Proto', detail: 'Destroyed' },
        ] },
        { system: 'left-arm', location: 'Left Arm', rolls: [10], effects: [
            { text: '+1 to Hit' }, { text: 'Left Arm Destroyed' },
        ] },
        { system: 'head', location: 'Head', rolls: [12], effects: [
            { text: '+1 to Hit' }, { text: '+2 to Hit', detail: 'No Long Range Shots' },
        ] },
    ];
    return rows.filter(row => row.system === 'main-gun' || supported.has(row.system))
        .map(row => supported.has(row.system) ? row : { ...row, effects: [] });
}

/** Filled critical boxes that wound the pilot, one hit each; the record sheet shades them (TW p.185; MegaMek). */
const SHADED_CRITICAL_BOXES: Partial<Record<SystemDamageKind, readonly number[]>> = {
    head: [2], 'left-arm': [2], 'right-arm': [2], torso: [1, 2, 3], legs: [3],
};

/** Pilot hits from filling a location's critical boxes after `filled` up to `to`. */
export function protoMekCriticalPilotHits(system: SystemDamageKind, filled: number, to: number): number {
    return (SHADED_CRITICAL_BOXES[system] ?? []).filter(box => box > filled && box <= to).length;
}

/**
 * A torso critical allocates one die face per quad weapon, two per biped weapon. The first and second
 * torso criticals each roll once; a face with no weapon has no effect (TW p.186).
 */
export function protoMekTorsoCriticalResults(entity: ProtoMekEntity): readonly Readonly<{
    firstRoll: number; lastRoll: number; weapon?: string; mount?: EntityMountedEquipment;
}>[] {
    const weapons = entity.equipment().filter(mount => mount.getOccupiedLocations().includes('Torso')
        && mount.getAmmoShots() === undefined && !isJumpJetEquipment(mount.equipment));
    const facesPerWeapon = entity.isQuad() ? 1 : 2;
    const results: { firstRoll: number; lastRoll: number; weapon?: string; mount?: EntityMountedEquipment }[] = [];
    let roll = 1;
    for (const weapon of weapons) {
        if (roll > 6) break;
        const end = Math.min(6, roll + facesPerWeapon - 1);
        results.push({ firstRoll: roll, lastRoll: end, weapon: weapon.displayName(), mount: weapon });
        roll = end + 1;
    }
    if (roll <= 6) results.push({ firstRoll: roll, lastRoll: 6 });
    return results;
}
