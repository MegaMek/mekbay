import { AmmoEquipment, MiscEquipment, WeaponEquipment } from '../../../equipment.model';
import type { HandheldWeaponEntity } from '../../entities/misc/handheld-weapon-entity';
import { calculateHeatNeutralRequirement } from '../cost/common';
import { ceilToHalfTon } from './weight-rounding';

export interface HandheldWeaponWeightBreakdown {
  readonly heatSinks: number;
  readonly miscellaneous: number;
  readonly weapons: number;
  readonly ammo: number;
  readonly exact: number;
  readonly rounded: number;
}

export function calculateHandheldWeaponEffectiveTonnage(entity: HandheldWeaponEntity): number {
  return calculateHandheldWeaponWeightBreakdown(entity).rounded;
}

export function calculateHandheldWeaponWeightBreakdown(entity: HandheldWeaponEntity): HandheldWeaponWeightBreakdown {
  const heatSinks = calculateHeatNeutralRequirement(entity);
  let miscellaneous = 0;
  let weapons = 0;
  let ammo = 0;
  for (const mount of entity.equipment()) {
    const equipment = mount.equipment;
    if (!equipment) throw new Error(`Unresolved equipment ${mount.equipmentId} on ${entity.displayName()}`);
    const tonnage = mount.getTonnage(entity);
    if (tonnage === undefined) throw new Error(`Unable to calculate tonnage for ${mount.equipmentId} on ${entity.displayName()}`);
    if (equipment instanceof AmmoEquipment) ammo += tonnage;
    else if (equipment instanceof WeaponEquipment) weapons += tonnage;
    else if (equipment instanceof MiscEquipment) miscellaneous += tonnage;
  }
  const exact = heatSinks + miscellaneous + weapons + ammo;
  return { heatSinks, miscellaneous, weapons, ammo, exact, rounded: ceilToHalfTon(exact) };
}
