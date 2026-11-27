// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from './entity/base-entity';
import type { EntityMountedEquipment } from './entity/types/equipment';
import { isVehicleEntity } from './entity/utils/entity-type-guards';
import { MiscEquipment, type Equipment } from './equipment.model';

export type TurretEquipmentKind = 'head' | 'shoulder' | 'quad' | 'sponson' | 'pintle';

export function turretEquipmentKind(
  equipment: Equipment | null | undefined,
): TurretEquipmentKind | null {
  if (equipment?.hasFlag('F_HEAD_TURRET') === true) return 'head';
  if (equipment?.hasFlag('F_SHOULDER_TURRET') === true) return 'shoulder';
  if (equipment?.hasFlag('F_QUAD_TURRET') === true) return 'quad';
  if (equipment?.hasFlag('F_SPONSON_TURRET') === true) return 'sponson';
  if (equipment?.hasFlag('F_PINTLE_TURRET') === true) return 'pintle';
  return null;
}

export function isSponsonTurretEquipment(equipment: Equipment | null | undefined): boolean {
  return turretEquipmentKind(equipment) === 'sponson';
}

export function turretEquipmentVariableTonnage(
  entity: BaseEntity,
  mount: EntityMountedEquipment,
  round: (tonnage: number) => number,
): number | null | undefined {
  const kind = turretEquipmentKind(mount.equipment);
  if (kind === null) return null;
  if (kind === 'head' || kind === 'shoulder' || kind === 'quad') {
    const location = kind === 'head' ? 'HD' : mount.location;
    const equipmentWeight = sumEquipmentTonnage(
      entity,
      candidate => candidate.location === location && candidate.turretMounted,
    );
    return equipmentWeight === undefined ? undefined : round(equipmentWeight / 10);
  }

  const turretCount = entity.equipment().filter(
    candidate => turretEquipmentKind(candidate.equipment) === kind,
  ).length;
  if (turretCount === 0) return undefined;
  const baseChassisWeight = isVehicleEntity(entity)
    ? entity.baseChassisSponsonPintleWeight()
    : -1;
  if (kind === 'sponson') {
    if (entity.omni() && baseChassisWeight >= 0) return baseChassisWeight / turretCount;
    const equipmentWeight = sumEquipmentTonnage(
      entity,
      candidate => candidate.turretType === 'sponson',
    );
    return equipmentWeight === undefined ? undefined : round(equipmentWeight / 10) / turretCount;
  }
  if (baseChassisWeight >= 0) return baseChassisWeight / turretCount;
  const weaponWeight = sumEquipmentTonnage(
    entity,
    candidate => candidate.equipment?.type === 'weapon'
      && candidate.location === mount.location
      && candidate.turretType === 'pintle',
  );
  return weaponWeight === undefined ? undefined : round(weaponWeight / 20);
}

export function turretEquipmentVariableCost(
  entity: BaseEntity,
  mount: EntityMountedEquipment,
): number | null | undefined {
  const kind = turretEquipmentKind(mount.equipment);
  if (kind === null) return null;
  const tonnage = mount.getTonnage(entity);
  if (tonnage === undefined) return undefined;
  if (kind === 'sponson') return tonnage * 4000;
  if (kind === 'pintle') return tonnage * 1000;
  return tonnage * 10000;
}

function sumEquipmentTonnage(
  entity: BaseEntity,
  predicate: (mount: EntityMountedEquipment) => boolean,
): number | undefined {
  let tonnage = 0;
  for (const mount of entity.equipment()) {
    const equipment = mount.equipment;
    if (!equipment || !predicate(mount)) continue;
    if (equipment.type === 'ammo' || equipment.type === 'armor') continue;
    if (equipment instanceof MiscEquipment && equipment.isHeatSink) continue;
    const mountTonnage = mount.getTonnage(entity);
    if (mountTonnage === undefined) return undefined;
    tonnage += mountTonnage;
  }
  return tonnage;
}
