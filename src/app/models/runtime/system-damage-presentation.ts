// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../entity/base-entity';
import { systemDamageDefinitions,systemDamageReferenceValues,type SystemDamageDefinition,type SystemDamageKind,type SystemDamageReferenceValue } from '../rules/system-damage-rules';

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
    const label = `${systemDamageSystemLabel(track.system)}${track.scope === undefined ? '' : ` (${track.scope})`}${track.stage === undefined ? '' : ` ${track.stage}`}`;
    return Object.freeze({ sheetId, label,
        ...(track.system === 'motive' && track.maximumHits > 1 ? { visibleHitPips: 9 } : {}),
    });
}

/** Display name of a damaged system, without its stage or location. */
export function systemDamageSystemLabel(system: SystemDamageKind): string {
    return system.replaceAll('-', ' ').replace(/\b\w/gu, character => character.toUpperCase());
}

/** Short caption printed on one stage control: its reference effect, its location, or its stage number. */
export function systemDamageStageCaption(
    entity: BaseEntity,
    track: Pick<SystemDamageDefinition, 'system' | 'stage' | 'scope'>,
): string {
    if (track.scope !== undefined) return systemDamageScopeCaption(track.scope);
    const value = systemDamageReferenceValues(entity, track.system)[(track.stage ?? 1) - 1];
    if (value !== undefined) return systemDamageReferenceCaption(value);
    return track.stage === undefined ? '' : String(track.stage);
}

const SYSTEM_DAMAGE_SCOPE_ORDER = ['Front', 'Left', 'Right', 'Rear', 'Front Left', 'Front Right', 'Rear Left', 'Rear Right',
    'Turret', 'Front Turret', 'Rear Turret'];

/** Printed order of location-scoped controls (front, sides, rear, turrets). */
export function compareSystemDamageScopes(left: string | undefined, right: string | undefined): number {
    return SYSTEM_DAMAGE_SCOPE_ORDER.indexOf(left ?? '') - SYSTEM_DAMAGE_SCOPE_ORDER.indexOf(right ?? '');
}

/** The locations of scoped controls come from the rules; only their ordering and captions live here. */
export function systemDamageLocationControls(entity: BaseEntity, system: 'stabilizer' | 'turret-lock'): readonly Readonly<{
    id: string; label: string;
}>[] {
    return systemDamageDefinitions(entity).filter(track => track.system === system && track.scope !== undefined)
        .sort((left, right) => compareSystemDamageScopes(left.scope, right.scope))
        .map(track => ({ id: systemDamagePresentation(track).sheetId, label: systemDamageScopeCaption(track.scope!) }));
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
            return value === undefined ? '' : systemDamageReferenceCaption(value);
        }),
    });
}

function systemDamageReferenceCaption(value: SystemDamageReferenceValue): string {
    return value === 'destroyed' ? 'D' : value === 'immobile' ? 'I' : value > 0 ? `+${value}` : String(value);
}

function systemDamageScopeCaption(scope: string): string {
    return scope.replace('Front ', 'F ').replace('Rear ', 'R ');
}
