// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../entity/base-entity';
import type { MotiveType } from '../entity/types/motive';
import { isAeroEntity, isInfantryEntity } from '../entity/utils/entity-type-guards';

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

/** The motive type a unit moves by: a beast-mounted platoon moves as its creature does (TO:AUE p. 107). */
export function nonMekMotiveType(entity: BaseEntity): MotiveType {
    return (isInfantryEntity(entity) ? entity.mount()?.movementMode : undefined) ?? entity.motiveType();
}

/** One canonical classification for storage, controls, movement, and presentation. */
export function nonMekAirGroundCapability(entity: BaseEntity): NonMekAirGroundCapability {
    if (isOnlyAirborne(entity)) return 'only-airborne';
    const motive = nonMekMotiveType(entity);
    const switchable = entity.entityType === 'Aero'
        || entity.entityType === 'ConvFighter'
        || entity.entityType === 'FixedWingSupport'
        || entity.entityType === 'SmallCraft'
        || entity.entityType === 'DropShip'
        || entity.unitType() === 'VTOL'
        || motive === 'VTOL'
        || motive === 'WiGE';
    return switchable ? 'switchable' : 'only-grounded';
}

/**
 * Whether the unit flies at an Elevation over the ground map: VTOLs, WiGEs, VTOL infantry and battle armor, gliders
 * (TW p. 55). Aerospace units fly at Altitude, which their velocity record keeps turn by turn.
 */
export function nonMekFliesAtElevation(entity: BaseEntity): boolean {
    return nonMekAirGroundCapability(entity) === 'switchable' && !isAeroEntity(entity);
}

/** TW p. 111: an aerospace unit needs a successful TAG hit unless it is a grounded spheroid DropShip. */
export function canSpotWithoutTag(entity: BaseEntity, airborne: boolean | null): boolean {
    return !isAeroEntity(entity)
        || (entity.entityType === 'DropShip' && entity.motiveType() === 'Spheroid' && airborne === false);
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
