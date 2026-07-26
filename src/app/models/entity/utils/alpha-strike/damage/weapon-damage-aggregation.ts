import { AmmoEquipment, WeaponEquipment } from '../../../../equipment.model';
import type { BaseEntity } from '../../../base-entity';
import { MekEntity } from '../../../entities';
import type { EntityMountedWeapon } from '../../../types';
import {
  battleForceDamageForMount,
  type AlphaStrikeRangeIndex,
} from './weapon-damage-profile';
import { alphaStrikeAmmoDamageMultiplier } from './weapon-modifiers';

/** Sums unrounded Alpha Strike weapon damage after common unit-wide modifiers. */
export function sumAlphaStrikeWeaponDamage(
  entity: BaseEntity,
  include: (mount: EntityMountedWeapon) => boolean,
): [number, number, number, number] {
  const weapons = entity.mountedWeapons();
  const ammunition = entity.equipment().filter(mount => mount.equipment instanceof AmmoEquipment);
  const targetingComputer = entity.equipment().some(mount => mount.equipment?.hasFlag('F_TARGETING_COMPUTER'));
  const total: [number, number, number, number] = [0, 0, 0, 0];

  for (const mount of weapons) {
    if (!include(mount) || isExcludedFromStandardDamage(mount.equipment)) continue;
    const modifier = weaponDamageModifier(entity, mount, weapons, ammunition, targetingComputer);
    for (let range = 0; range < 4; range++) {
      total[range] += battleForceDamageForMount(entity, mount, range as AlphaStrikeRangeIndex) * modifier;
    }
  }
  return total;
}

/** Java ASDamageConverter excludes artillery and BattleForce torpedo damage from standard damage. */
function isExcludedFromStandardDamage(weapon: WeaponEquipment): boolean {
  return weapon.damage === 'artillery' || weapon.hasFlag('F_ARTILLERY')
    || ['LRM_TORPEDO', 'SRM_TORPEDO', 'LRM_TORPEDO_COMBO'].includes(weapon.ammoType);
}

function weaponDamageModifier(
  entity: BaseEntity,
  mount: EntityMountedWeapon,
  weapons: readonly EntityMountedWeapon[],
  ammunition: readonly ReturnType<BaseEntity['equipment']>[number][],
  targetingComputer: boolean,
): number {
  const weapon = mount.equipment;
  let modifier = alphaStrikeAmmoDamageMultiplier(weapon, weapons, ammunition);
  if (weapon.oneShotCount && weapon.id !== 'CLFussilade') modifier *= 0.1;
  if (targetingComputer && weapon.hasFlag('F_DIRECT_FIRE')) modifier *= 1.1;
  if (entity instanceof MekEntity && ['LA', 'RA'].includes(mount.location)
    && entity.getEquipmentAtLocation(mount.location).some(candidate =>
      candidate.equipment?.hasFlag('F_ACTUATOR_ENHANCEMENT_SYSTEM'))) modifier *= 1.05;
  return modifier;
}
