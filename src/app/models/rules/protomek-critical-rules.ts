// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ProtoMekEntity } from '../entity/entities/protomek/protomek-entity';
import { isJumpJetEquipment } from '../jump-equipment.model';
import { systemDamageDefinitions,type SystemDamageKind } from './system-damage-rules';

export interface ProtoMekCriticalReference {
    readonly system: SystemDamageKind;
    readonly location: string;
    readonly rolls: readonly number[];
    readonly effects: readonly Readonly<{ text: string; detail?: string }>[];
}

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
            { text: '-1 Jump MP*' }, { text: '1/2 Jump MP*' }, { text: 'Proto', detail: 'Destroyed' },
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

/** A torso critical allocates one die face per quad weapon, two per biped weapon. */
export function protoMekTorsoCriticalResults(entity: ProtoMekEntity): readonly Readonly<{
    firstRoll: number; lastRoll: number; weapon?: string;
}>[] {
    const weapons = entity.equipment().filter(mount => mount.getOccupiedLocations().includes('Torso')
        && mount.getAmmoShots() === undefined && !isJumpJetEquipment(mount.equipment));
    const facesPerWeapon = entity.isQuad() ? 1 : 2;
    const results: { firstRoll: number; lastRoll: number; weapon?: string }[] = [];
    let roll = 1;
    for (const weapon of weapons) {
        if (roll > 6) break;
        const end = Math.min(6, roll + facesPerWeapon - 1);
        results.push({ firstRoll: roll, lastRoll: end, weapon: weapon.displayName() });
        roll = end + 1;
    }
    if (roll <= 6) results.push({ firstRoll: roll, lastRoll: 6 });
    return results;
}
