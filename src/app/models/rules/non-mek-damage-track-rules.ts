// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../entity/base-entity';
import { isVehicleEntity } from '../entity/utils/entity-type-guards';
import {
    asSystemDamageTrackId,
    type SystemDamageTrackId,
} from '../entity/entity-identifiers';

/** A non-Mek record-sheet damage track; never a Mek critical slot. */
export interface NonMekDamageTrackDefinition {
    readonly id: SystemDamageTrackId;
    readonly sheetId: string;
    readonly label: string;
    readonly maximumHits: number;
    readonly visibleHitPips?: number;
    readonly motiveLevel?: number;
}

export const ENTITY_MOTIVE_HIT_PIP_COUNT = 9;
const MAX_TRACKED_REPEATABLE_MOTIVE_HITS = 256;

export const NON_MEK_DAMAGE_TRACK_SHEET_BASE_IDS = Object.freeze([
    'commander_hit',
    'driver_hit',
    'pilot_hit',
    'copilot_hit',
    'avionics_hit_',
    'fcs_hit_',
    'cic_hit_',
    'fuel_tank_hit_',
    'docking_collar_hit_',
    'kf_boom_hit_',
    'thruster_left_hit_',
    'thruster_right_hit_',
    'engine_hit_',
    'gyro_hit_',
    'sensor_hit_',
    'landing_gear_hit_',
    'life_support_hit_',
    'life_support_hit',
    'motive_system_hit_',
    'turret_locked',
    'turret_locked_f',
    'turret_locked_r',
    'stabilizer_hit_front',
    'stabilizer_hit_left',
    'stabilizer_hit_right',
    'stabilizer_hit_rear',
    'stabilizer_hit_turret',
    'stabilizer_hit_turret_f',
    'stabilizer_hit_turret_r',
    'flight_stabilizer_hit',
    'gun_hit_',
    'ra_hit_',
    'legs_hit_',
    'torso_hit_',
    'la_hit_',
    'head_hit_',
] as const);

const VEHICLE_COMMON_BASE_IDS = Object.freeze([
    'fuel_tank_hit_', 'engine_hit_', 'sensor_hit_', 'motive_system_hit_',
    'stabilizer_hit_front', 'stabilizer_hit_left', 'stabilizer_hit_right', 'stabilizer_hit_rear',
] as const);

const AEROSPACE_BASE_IDS = new Set<string>([
    'pilot_hit', 'copilot_hit', 'avionics_hit_', 'fcs_hit_', 'cic_hit_',
    'fuel_tank_hit_', 'docking_collar_hit_', 'kf_boom_hit_',
    'thruster_left_hit_', 'thruster_right_hit_', 'engine_hit_',
    'sensor_hit_', 'landing_gear_hit_', 'life_support_hit_', 'life_support_hit',
]);

const PROTOMEK_BASE_IDS = new Set<string>([
    'gun_hit_', 'ra_hit_', 'legs_hit_', 'torso_hit_', 'la_hit_', 'head_hit_',
]);

const VEHICLE_ENTITY_TYPES = new Set([
    'Tank', 'Naval', 'VTOL', 'SupportTank', 'SupportNaval', 'SupportVTOL', 'LargeSupportTank',
]);
const AEROSPACE_ENTITY_TYPES = new Set([
    'Aero', 'ConvFighter', 'FixedWingSupport', 'SmallCraft', 'DropShip',
    'JumpShip', 'WarShip', 'SpaceStation',
]);

export function nonMekDamageTrackDefinitions(entity: BaseEntity): readonly NonMekDamageTrackDefinition[] {
    const bases = entity.entityType === 'ProtoMek'
        ? PROTOMEK_BASE_IDS
        : VEHICLE_ENTITY_TYPES.has(entity.entityType)
            ? vehicleDamageTrackBases(entity)
            : AEROSPACE_ENTITY_TYPES.has(entity.entityType)
                ? AEROSPACE_BASE_IDS
                : null;
    if (!bases) return Object.freeze([]);

    const definitions = NON_MEK_DAMAGE_TRACK_SHEET_BASE_IDS
        .filter(base => bases.has(base))
        .flatMap(base => base.endsWith('_')
            ? Array.from({ length: 8 }, (_unused, index) => definition(`${base}${index + 1}`))
            : [definition(base)]);
    if (entity.entityType === 'VTOL' || entity.entityType === 'SupportVTOL') {
        definitions.push(Object.freeze({
            id: nonMekDamageTrackId('rotor'),
            sheetId: 'rotor',
            label: 'Rotor Hits',
            maximumHits: 20,
        }));
    }
    return Object.freeze(definitions);
}

function vehicleDamageTrackBases(entity: BaseEntity): ReadonlySet<string> {
    const bases = new Set<string>(VEHICLE_COMMON_BASE_IDS);
    const airborne = entity.entityType === 'VTOL' || entity.entityType === 'SupportVTOL';
    const naval = entity.entityType === 'Naval' || entity.entityType === 'SupportNaval';

    bases.add(airborne ? 'pilot_hit' : 'driver_hit');
    bases.add(airborne ? 'copilot_hit' : 'commander_hit');

    if (airborne) {
        bases.add('flight_stabilizer_hit');
    } else if (naval) {
        bases.add('turret_locked_f');
        bases.add('turret_locked_r');
        bases.add('stabilizer_hit_turret_f');
        bases.add('stabilizer_hit_turret_r');
    } else if (isVehicleEntity(entity) && (entity.hasTurret() || entity.hasDualTurret())) {
        bases.add('turret_locked');
        bases.add('stabilizer_hit_turret');
    }

    return bases;
}

export function nonMekDamageTrackId(sheetId: string): SystemDamageTrackId {
    return asSystemDamageTrackId(`damage-track:${sheetId}`);
}

function definition(sheetId: string): NonMekDamageTrackDefinition {
    const motive = /^motive_system_hit_(\d+)$/u.exec(sheetId);
    const motiveLevel = motive ? Number(motive[1]) : undefined;
    const repeatable = motiveLevel === 2 || motiveLevel === 3;
    return Object.freeze({
        id: nonMekDamageTrackId(sheetId),
        sheetId,
        label: repeatable ? `Motive Hits (${motiveLevel === 2 ? 'Medium' : 'Heavy'})` : damageTrackLabel(sheetId),
        maximumHits: repeatable ? MAX_TRACKED_REPEATABLE_MOTIVE_HITS : 1,
        ...(repeatable ? { visibleHitPips: ENTITY_MOTIVE_HIT_PIP_COUNT } : {}),
        ...(motiveLevel === undefined ? {} : { motiveLevel }),
    });
}

function damageTrackLabel(sheetId: string): string {
    return sheetId
        .replace(/_(\d+)$/u, ' $1')
        .replaceAll('_', ' ')
        .replace(/\b\w/gu, character => character.toUpperCase());
}
