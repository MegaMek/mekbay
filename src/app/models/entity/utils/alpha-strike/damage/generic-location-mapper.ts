import type { BaseEntity } from '../../../base-entity';
import { AeroEntity } from '../../../entities/aero/aero-entity';
import { MekEntity } from '../../../entities/mek/mek-entity';
import { QuadVeeEntity } from '../../../entities/mek/quad-vee-entity';
import { TripodMekEntity } from '../../../entities/mek/tripod-mek-entity';
import { VehicleEntity } from '../../../entities/vehicle/vehicle-entity';
import type { EntityMountedWeapon } from '../../../types';

/** Alpha Strike conversion scopes for non-arced unit weapon damage and abilities. */
export type AlphaStrikeDamageLocation = 'standard' | 'rear' | 'turret';

/**
 * Returns Java ASLocationMapper's multiplier for the common non-arced conversion scopes.
 *
 * Turret weapons intentionally belong to both standard and turret scopes. Physical vehicle
 * rear locations take precedence over the mount's rear-facing flag.
 */
export function alphaStrikeDamageLocationMultiplier(
  entity: BaseEntity,
  target: AlphaStrikeDamageLocation,
  mount: EntityMountedWeapon,
): number {
  if (entity instanceof VehicleEntity) return vehicleLocationMultiplier(target, mount.location);
  if (entity instanceof AeroEntity) return aeroLocationMultiplier(target, mount);
  if (entity instanceof TripodMekEntity) return tripodLocationMultiplier(target, mount);
  if (entity instanceof QuadVeeEntity) return quadVeeLocationMultiplier(target, mount);
  if (entity instanceof MekEntity) return mekLocationMultiplier(target, mount);
  return target === 'standard' ? 1 : 0;
}

/**
 * Returns Java ASLocationMapper's scope for discrete weapon abilities.
 *
 * Rear-mounted Mek and fighter equipment still grants discrete abilities to the
 * unit's primary special collection, unlike its damage-bearing abilities.
 */
export function alphaStrikeSpecialLocationMultiplier(
  entity: BaseEntity,
  target: 'standard' | 'turret',
  mount: EntityMountedWeapon,
): number {
  if (target === 'standard'
    && (entity instanceof MekEntity && mount.rearMounted
      || entity instanceof AeroEntity && (mount.rearMounted || mount.location === 'Aft'))) return 1;
  return alphaStrikeDamageLocationMultiplier(entity, target, mount);
}

/** Whether the unit has a Java ASLocationMapper turret conversion location. */
export function hasAlphaStrikeTurretLocation(entity: BaseEntity): boolean {
  return entity instanceof TripodMekEntity
    || entity instanceof QuadVeeEntity
    || entity instanceof VehicleEntity && entity.rangedWeapons().some(mount => isVehicleTurret(mount.location))
    || entity instanceof MekEntity && entity.rangedWeapons().some(mount => mount.turretMounted);
}

function vehicleLocationMultiplier(target: AlphaStrikeDamageLocation, location: string): number {
  if (target === 'standard') return location === 'Rear' ? 0 : 1;
  if (target === 'rear') return location === 'Rear' ? 1 : 0;
  return isVehicleTurret(location) ? 1 : 0;
}

function aeroLocationMultiplier(target: AlphaStrikeDamageLocation, mount: EntityMountedWeapon): number {
  if (target === 'standard') return mount.location !== 'Aft' && !mount.rearMounted ? 1 : 0;
  return target === 'rear' && (mount.location === 'Aft' || mount.rearMounted) ? 1 : 0;
}

function mekLocationMultiplier(target: AlphaStrikeDamageLocation, mount: EntityMountedWeapon): number {
  if (target === 'standard') return mount.rearMounted ? 0 : 1;
  if (target === 'rear') return mount.rearMounted ? 1 : 0;
  return mount.turretMounted ? 1 : 0;
}

function tripodLocationMultiplier(target: AlphaStrikeDamageLocation, mount: EntityMountedWeapon): number {
  if (target === 'turret') return isTripodTurretEligible(mount.location) ? 1 : 0;
  return mekLocationMultiplier(target, mount);
}

function quadVeeLocationMultiplier(target: AlphaStrikeDamageLocation, mount: EntityMountedWeapon): number {
  if (target === 'turret') return 1;
  return mekLocationMultiplier(target, mount);
}

function isVehicleTurret(location: string): boolean {
  return location === 'Turret' || location === 'Front Turret' || location === 'Rear Turret';
}

function isTripodTurretEligible(location: string): boolean {
  return location !== 'CL' && location !== 'LL' && location !== 'RL';
}
