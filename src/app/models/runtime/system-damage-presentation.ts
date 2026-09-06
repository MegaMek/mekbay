// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../entity/base-entity';
import { systemDamageDefinitions,systemDamageReferenceValues,type SystemDamageDefinition,type SystemDamageKind } from '../rules/system-damage-rules';

const SYSTEM_LAYOUT_NAMES: Readonly<Record<SystemDamageKind, string>> = Object.freeze({
    commander: 'commander_hit', driver: 'driver_hit', pilot: 'pilot_hit', copilot: 'copilot_hit',
    engine: 'engine_hit', sensors: 'sensor_hit', avionics: 'avionics_hit', 'fire-control': 'fcs_hit',
    'combat-information': 'cic_hit', 'fuel-tank': 'fuel_tank_hit', 'docking-collar': 'docking_collar_hit',
    'kf-boom': 'kf_boom_hit', 'left-thruster': 'thruster_left_hit', 'right-thruster': 'thruster_right_hit',
    'landing-gear': 'landing_gear_hit', 'life-support': 'life_support_hit', motive: 'motive_system_hit',
    'turret-lock': 'turret_locked', stabilizer: 'stabilizer_hit', 'flight-stabilizer': 'flight_stabilizer_hit',
    rotor: 'rotor', head: 'head_hit', torso: 'torso_hit', 'left-arm': 'la_hit', 'right-arm': 'ra_hit',
    legs: 'legs_hit', 'main-gun': 'gun_hit',
});

/** Explicit bindings to existing authored layout elements; never used by game rules. */
export function systemDamagePresentation(track: SystemDamageDefinition): Readonly<{
    sheetId: string; label: string; visibleHitPips?: number;
}> {
    let suffix = track.stage === undefined ? '' : `_${track.stage}`;
    if (track.scope !== undefined) {
        const location = ({ Front: 'front', Rear: 'rear', Left: 'left', Right: 'right',
            'Front Left': 'front_left', 'Front Right': 'front_right', 'Rear Left': 'rear_left', 'Rear Right': 'rear_right',
            Turret: 'turret', 'Front Turret': 'turret_f', 'Rear Turret': 'turret_r' })[track.scope];
        suffix = track.system === 'turret-lock'
            ? track.scope === 'Front Turret' ? '_f' : track.scope === 'Rear Turret' ? '_r' : ''
            : `_${location ?? track.scope}`;
    }
    const sheetId = `${SYSTEM_LAYOUT_NAMES[track.system]}${suffix}`;
    const label = `${track.system.replaceAll('-', ' ')}${track.scope === undefined ? '' : ` (${track.scope})`}${track.stage === undefined ? '' : ` ${track.stage}`}`
        .replace(/\b\w/gu, character => character.toUpperCase());
    return Object.freeze({ sheetId, label,
        ...(track.system === 'motive' && track.maximumHits > 1 ? { visibleHitPips: 9 } : {}),
    });
}

/** The locations of scoped controls come from the rules; only their ordering and captions live here. */
export function systemDamageLocationControls(entity: BaseEntity, system: 'stabilizer' | 'turret-lock'): readonly Readonly<{
    id: string; label: string;
}>[] {
    const order = ['Front', 'Left', 'Right', 'Rear', 'Front Left', 'Front Right', 'Rear Left', 'Rear Right',
        'Turret', 'Front Turret', 'Rear Turret'];
    return systemDamageDefinitions(entity).filter(track => track.system === system && track.scope !== undefined)
        .sort((left, right) => order.indexOf(left.scope!) - order.indexOf(right.scope!))
        .map(track => ({ id: systemDamagePresentation(track).sheetId,
            label: track.scope!.replace('Front ', 'F ').replace('Rear ', 'R ') }));
}

/** Generated controls bind semantic targets while their geometry stays in the layout. */
export function systemDamageControls(entity: BaseEntity, system: SystemDamageKind, scope?: string): Readonly<{
    ids: readonly string[]; modifiers: readonly string[];
}> {
    const definitions = systemDamageDefinitions(entity).filter(track => track.system === system && track.scope === scope);
    const effects = systemDamageReferenceValues(entity, system);
    return Object.freeze({
        ids: definitions.map(track => systemDamagePresentation(track).sheetId),
        modifiers: definitions.map(track => {
            const value = effects[(track.stage ?? 1) - 1];
            return value === undefined ? '' : value === 'destroyed' ? 'D' : value === 'immobile' ? 'I'
                : value > 0 ? `+${value}` : String(value);
        }),
    });
}
