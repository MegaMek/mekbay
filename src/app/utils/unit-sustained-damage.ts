// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AmmoEquipment, WeaponEquipment } from '../models/equipment.model';
import type { BaseEntity } from '../models/entity/base-entity';
import { AeroEntity } from '../models/entity/entities/aero/aero-entity';
import { BattleArmorEntity } from '../models/entity/entities/infantry/battle-armor-entity';
import { InfantryEntity } from '../models/entity/entities/infantry/infantry-entity';
import type { EntityMountedWeapon } from '../models/entity/types';
import type { UnitComponent } from '../models/unit-summary.model';
import {
  calculateSustainedDamageFromFacts,
  expectedClusterHits,
  maximumGroundSustainedWeaponDamage,
  sustainedDamageAmmoKey,
} from './unit-sustained-damage-kernel';

/** Port of SVGMassPrinter's ten-turn sustained DPT summary calculation. */
export function calculateUnitSustainedDamage(
  entity: BaseEntity,
  components: readonly UnitComponent[],
): number {
  if (entity instanceof InfantryEntity && !(entity instanceof BattleArmorEntity)) {
    return calculateConventionalInfantryDamage(components);
  }

  const weapons = entity.rangedWeapons();
  const fireFraction = calculateFireFraction(entity, weapons);
  const availableShots = new Map<string, number>();
  const ammoDamagePerShot = new Map<string, number>();
  for (const mount of entity.equipment()) {
    const ammo = mount.equipment;
    if (!(ammo instanceof AmmoEquipment)) continue;
    const key = sustainedDamageAmmoKey(ammo.ammoType, ammo.rackSize);
    availableShots.set(key, (availableShots.get(key) ?? 0) + (mount.getAmmoShots() ?? 0));
    ammoDamagePerShot.set(key, Math.max(
      ammoDamagePerShot.get(key) ?? Number.NEGATIVE_INFINITY,
      ammo.damagePerShot,
    ));
  }
  const facts = weapons.map(mount => {
    const weapon = mount.equipment;
    const rapidFire = weapon.getRapidFireCount();
    const damage = rapidFire > 0 && typeof weapon.damage === 'number'
      ? weapon.damage
      : maximumWeaponDamage(entity, weapon, ammoDamagePerShot);
    const battleArmorSquadMount = entity instanceof BattleArmorEntity
      && mount.location === 'Squad' && !mount.isSSWM;
    return {
      damage,
      ammoType: weapon.ammoType,
      rackSize: weapon.rackSize,
      rapidFireCount: rapidFire,
      oneShotCount: weapon.oneShotCount ?? 0,
      clusterDamage: weapon.weapon.damage === 'cluster',
      ...(battleArmorSquadMount ? {
        ammoDemandMultiplier: entity.squadSize(),
        damageMultiplier: expectedClusterHits(entity.squadSize()),
      } : {}),
    } as const;
  });
  return calculateSustainedDamageFromFacts({ fireFraction, weapons: facts, availableShots });
}

/** Exact SVGMassPrinter.getMaxDamage projection over the exported equipment data. */
function maximumWeaponDamage(
  entity: BaseEntity,
  weapon: WeaponEquipment,
  ammoDamagePerShot: ReadonlyMap<string, number>,
): number {
  // DPT follows WeaponType.getDamage(), not the display-oriented domain
  // getter (which intentionally hides AMS/NARC damage from inventory rows).
  const damage = weapon.weapon.damage;
  if (damage === '') return 0;

  if (entity instanceof AeroEntity) {
    const maximumIndex = RANGE_INDEX[weapon.maxRangeBracket];
    return Math.max(0, ...weapon.weapon.av.slice(0, maximumIndex + 1).map(Math.round));
  }
  if (weapon.isInfantryWeapon()) return weapon.infantry.damage;
  return maximumGroundSustainedWeaponDamage({
    id: weapon.id,
    damage,
    rackSize: weapon.rackSize,
    ammoType: weapon.ammoType,
    flags: weapon.flags,
    ammoDamagePerShot: ammoDamagePerShot.get(sustainedDamageAmmoKey(
      weapon.ammoType,
      weapon.rackSize,
    )),
  });
}

const RANGE_INDEX = {
  short: 0,
  medium: 1,
  long: 2,
  extreme: 3,
} as const;

function calculateConventionalInfantryDamage(components: readonly UnitComponent[]): number {
  let troopDamage = 0;
  let fieldDamage = 0;
  for (const component of flattenComponents(components)) {
    if (!component.md) continue;
    const damage = Number(component.md);
    if (!Number.isFinite(damage)) continue;
    if (component.l === 'Troop') troopDamage += damage * component.q;
    else fieldDamage += damage * component.q;
  }
  return Math.round(Math.max(troopDamage, fieldDamage));
}

function calculateFireFraction(entity: BaseEntity, weapons: readonly EntityMountedWeapon[]): number {
  const dissipation = entity.heatDissipation();
  if (dissipation < 0) return 1;
  const weaponHeat = weapons.reduce((sum, mount) => sum + mount.equipment.heat, 0);
  const totalHeat = Math.max(weaponHeat, entity.heatGeneration());
  return totalHeat > dissipation && totalHeat > 0 ? dissipation / totalHeat : 1;
}

function* flattenComponents(components: readonly UnitComponent[]): Generator<UnitComponent> {
  for (const component of components) {
    yield component;
    if (component.bay) yield* flattenComponents(component.bay);
  }
}
