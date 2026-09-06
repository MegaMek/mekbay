// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../entity/base-entity';
import { asSystemDamageTrackId,type SystemDamageTrackId } from '../entity/entity-identifiers';
import { isAeroEntity,isProtoMekEntity,isVehicleEntity } from '../entity/utils/entity-type-guards';

export type SystemDamageKind =
    | 'commander' | 'driver' | 'pilot' | 'copilot' | 'engine' | 'sensors'
    | 'avionics' | 'fire-control' | 'combat-information' | 'fuel-tank'
    | 'docking-collar' | 'kf-boom' | 'left-thruster' | 'right-thruster'
    | 'landing-gear' | 'life-support' | 'motive' | 'turret-lock' | 'stabilizer'
    | 'flight-stabilizer' | 'rotor' | 'head' | 'torso' | 'left-arm' | 'right-arm'
    | 'legs' | 'main-gun';

/** Independently authored system damage; Mek system damage remains slot-backed. */
export interface SystemDamageDefinition {
    readonly id: SystemDamageTrackId;
    readonly system: SystemDamageKind;
    /** A selected damage stage, not an index into a rendered pip array. */
    readonly stage?: number;
    /** Canonical construction location, where the system is location-scoped. */
    readonly scope?: string;
    readonly maximumHits: number;
    readonly motiveLevel?: number;
}

export function systemDamageId(system: SystemDamageKind, stage?: number, scope?: string): SystemDamageTrackId {
    return asSystemDamageTrackId(`system-damage:${system}${scope === undefined ? '' : `:${scope}`}${stage === undefined ? '' : `:${stage}`}`);
}

function definition(system: SystemDamageKind, stage?: number, scope?: string): SystemDamageDefinition {
    const repeatable = system === 'motive' && (stage === 2 || stage === 3);
    return Object.freeze({
        id: systemDamageId(system, stage, scope), system,
        ...(stage === undefined ? {} : { stage }),
        ...(scope === undefined ? {} : { scope }),
        maximumHits: repeatable ? 256 : system === 'rotor' ? 20 : 1,
        ...(system === 'motive' ? { motiveLevel: stage } : {}),
    });
}

function stages(system: SystemDamageKind, count: number): readonly SystemDamageDefinition[] {
    return Array.from({ length: count }, (_, index) => definition(system, index + 1));
}

/** Legal damage targets are derived without consulting a record sheet. */
export function systemDamageDefinitions(entity: BaseEntity): readonly SystemDamageDefinition[] {
    if (isVehicleEntity(entity)) {
        const airborne = entity.unitType() === 'VTOL';
        const result = [
            definition(airborne ? 'pilot' : 'driver'),
            definition(airborne ? 'copilot' : 'commander'),
            definition('fuel-tank', 1), definition('engine', 1),
            ...stages('sensors', 4), ...stages('motive', 4),
        ];
        for (const scope of entity.locationOrder.filter(location => location !== 'Rotor')) {
            result.push(definition('stabilizer', undefined, scope));
            if (scope.includes('Turret')) result.push(definition('turret-lock', undefined, scope));
        }
        if (airborne) result.push(definition('flight-stabilizer'), definition('rotor'));
        return Object.freeze(result);
    }
    if (isProtoMekEntity(entity)) {
        return Object.freeze([
            ...stages('head', 2),
            ...(!entity.isQuad() ? [...stages('left-arm', 2), ...stages('right-arm', 2)] : []),
            ...stages('torso', 3), ...stages('legs', 3),
            ...(entity.locationOrder.includes('Main Gun') ? stages('main-gun', 1) : []),
        ]);
    }
    if (isAeroEntity(entity)) {
        const capital = ['JumpShip', 'WarShip', 'SpaceStation'].includes(entity.entityType);
        const large = capital || ['SmallCraft', 'DropShip'].includes(entity.entityType);
        return Object.freeze([
            ...stages('avionics', 3), ...stages(capital ? 'combat-information' : 'fire-control', 3),
            ...stages('sensors', 3), ...stages('engine', large ? 6 : 3),
            definition('life-support', 1), definition('fuel-tank', 1),
            ...(entity.entityType === 'DropShip' ? [definition('docking-collar', 1), definition('kf-boom', 1)] : []),
            ...(!capital ? [definition('landing-gear', 1)] : []),
            ...(large ? [...stages('left-thruster', 4), ...stages('right-thruster', 4)] : []),
        ]);
    }
    return Object.freeze([]);
}

export type SystemDamageReferenceValue = number | 'destroyed' | 'immobile';

/** Rule-owned consequences printed alongside system stages on record sheets. */
export function systemDamageReferenceValues(entity: BaseEntity, system: SystemDamageKind): readonly SystemDamageReferenceValue[] {
    if (isVehicleEntity(entity)) {
        if (system === 'sensors') return [1, 2, 3, 'destroyed'];
        if (system === 'motive') return [1, 2, 3, 'immobile'];
        if (system === 'flight-stabilizer') return [3];
        return [];
    }
    switch (system) {
        case 'avionics': case 'sensors': return [1, 2, 5];
        case 'fire-control': case 'combat-information': return [2, 4, 'destroyed'];
        case 'engine': return ['SmallCraft', 'DropShip', 'JumpShip', 'WarShip', 'SpaceStation'].includes(entity.entityType)
            ? [-1, -2, -3, -4, -5, 'destroyed'] : [-2, -4, 'destroyed'];
        case 'landing-gear': return [5];
        case 'life-support': return [2];
        case 'left-thruster': case 'right-thruster': return [1, 2, 3, 'destroyed'];
        case 'docking-collar': case 'kf-boom': return ['destroyed'];
        default: return [];
    }
}
