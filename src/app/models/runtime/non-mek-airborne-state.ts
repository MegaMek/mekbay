// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../entity/base-entity';

export type NonMekAirGroundCapability = 'only-airborne' | 'switchable' | 'only-grounded';

/** Satellites are Fixed-Wing Support Vehicles with station-keeping motive systems. */
export function isSatelliteEntity(entity: BaseEntity): boolean {
    return entity.entityType === 'FixedWingSupport'
        && entity.motiveType() === 'Station Keeping';
}

/** Space-only craft have no grounded movement state to select or display. */
export function isOnlyAirborne(entity: BaseEntity): boolean {
    return entity.entityType === 'JumpShip'
        || entity.entityType === 'WarShip'
        || entity.entityType === 'SpaceStation'
        || isSatelliteEntity(entity);
}

/** One canonical classification for storage, controls, movement, and presentation. */
export function nonMekAirGroundCapability(entity: BaseEntity): NonMekAirGroundCapability {
    if (isOnlyAirborne(entity)) return 'only-airborne';
    const switchable = entity.entityType === 'Aero'
        || entity.entityType === 'ConvFighter'
        || entity.entityType === 'FixedWingSupport'
        || entity.entityType === 'SmallCraft'
        || entity.entityType === 'DropShip'
        || entity.unitType() === 'VTOL'
        || entity.motiveType() === 'VTOL'
        || entity.motiveType() === 'WiGE';
    return switchable ? 'switchable' : 'only-grounded';
}

/** Whether grounded versus airborne is a meaningful per-turn user choice. */
export function canSwitchNonMekAirGroundState(entity: BaseEntity): boolean {
    return nonMekAirGroundCapability(entity) === 'switchable';
}

/** Removes impossible legacy states while retaining an unset switchable state. */
export function canonicalNonMekAirborneState(
    entity: BaseEntity,
    airborne: boolean | null,
): boolean | null {
    switch (nonMekAirGroundCapability(entity)) {
        case 'only-airborne': return true;
        case 'only-grounded': return null;
        case 'switchable': return airborne;
    }
}

/** Display state exists only when grounded versus airborne is a real choice. */
export function projectedNonMekAirGroundCondition(
    entity: BaseEntity,
    airborne: boolean | null,
): 'airborne' | 'grounded' | null {
    if (!canSwitchNonMekAirGroundState(entity)) return null;
    if (airborne === true) return 'airborne';
    if (airborne === false) return 'grounded';
    return null;
}
