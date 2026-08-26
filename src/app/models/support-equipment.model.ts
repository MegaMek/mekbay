// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from './entity/base-entity';
import type { EntityMountedEquipment } from './entity/types/equipment';
import { isAeroEntity } from './entity/utils/entity-type-guards';
import type { Equipment } from './equipment.model';

const POWER_GENERATOR_BASE_COST: Readonly<Record<string, number>> = Object.freeze({
  STEAM: 4000,
  SOLAR: 8000,
  FISSION: 15000,
  FUSION: 10000,
  COMBUSTION_LIQUID: 5000,
  COMBUSTION_SOLID: 5000,
  FUEL_CELL: 7000,
  EXTERNAL_PCMT: 5000,
  EXTERNAL: 5000,
});

export type SupportEquipmentKind =
  | 'cargo'
  | 'liquid-cargo'
  | 'communications'
  | 'command-console'
  | 'ladder'
  | 'cargo-lifter'
  | 'battle-armor-mission-equipment'
  | 'dumper'
  | 'power-generator'
  | 'drone-carrier-control'
  | 'remote-drone-command-console'
  | 'mash'
  | 'fuel'
  | 'mobile-field-base'
  | 'field-kitchen';

export function supportEquipmentKind(
  equipment: Equipment | null | undefined,
): SupportEquipmentKind | null {
  if (equipment?.hasFlag('F_CARGO') === true) return 'cargo';
  if (equipment?.hasFlag('F_LIQUID_CARGO') === true) return 'liquid-cargo';
  if (equipment?.hasFlag('F_COMMUNICATIONS') === true) return 'communications';
  if (equipment?.hasFlag('F_COMMAND_CONSOLE') === true) return 'command-console';
  if (equipment?.hasFlag('F_LADDER') === true) return 'ladder';
  if (equipment?.hasFlag('F_CARGO_LIFTER') === true) return 'cargo-lifter';
  if (equipment?.hasFlag('F_BA_MISSION_EQUIPMENT') === true) return 'battle-armor-mission-equipment';
  if (equipment?.hasFlag('F_DUMPER') === true) return 'dumper';
  if (equipment?.hasFlag('F_POWER_GENERATOR') === true) return 'power-generator';
  if (equipment?.hasFlag('F_DRONE_CARRIER_CONTROL') === true) return 'drone-carrier-control';
  if (equipment?.hasFlag('F_REMOTE_DRONE_COMMAND_CONSOLE') === true) return 'remote-drone-command-console';
  if (equipment?.hasFlag('F_MASH') === true) return 'mash';
  if (equipment?.hasFlag('F_FUEL') === true) return 'fuel';
  if (equipment?.hasFlag('F_MOBILE_FIELD_BASE') === true) return 'mobile-field-base';
  if (equipment?.hasFlag('F_FIELD_KITCHEN') === true) return 'field-kitchen';
  return null;
}

export function isCargoEquipment(equipment: Equipment | null | undefined): boolean {
  const kind = supportEquipmentKind(equipment);
  return kind === 'cargo' || kind === 'liquid-cargo';
}

export function isStandardCargoEquipment(equipment: Equipment | null | undefined): boolean {
  return supportEquipmentKind(equipment) === 'cargo';
}

export function isFuelEquipment(equipment: Equipment | null | undefined): boolean {
  return supportEquipmentKind(equipment) === 'fuel';
}

export function supportEquipmentVariableTonnage(
  entity: BaseEntity,
  mount: EntityMountedEquipment,
  standardRound: (value: number) => number,
): number | null {
  const kind = supportEquipmentKind(mount.equipment);
  const size = mount.size ?? 1;
  if (kind === 'fuel') {
    const tankEngine = entity.entityType === 'Tank'
      || entity.entityType === 'Naval'
      || entity.entityType === 'VTOL';
    return standardRound(entity.mountedEngine().getWeight({ tank: tankEngine }) * 0.1);
  }
  if (kind === 'drone-carrier-control') return 2 + size * 0.5;
  if (kind === 'mash') return 2.5 + size;
  if (kind === 'cargo' || kind === 'liquid-cargo' || kind === 'communications') {
    return standardRound(size);
  }
  if (kind === 'ladder') return nearestKg(size / 200);
  if (kind === 'cargo-lifter') return 0.03 * Math.ceil(size * 2);
  if (kind === 'battle-armor-mission-equipment') return nearestKg(size / 1000);
  if (kind === 'dumper') return standardRound(dumperCapacity(entity, mount) * 0.05);
  if (kind === 'power-generator') return 1;
  return null;
}

export function supportEquipmentVariableCost(
  entity: BaseEntity,
  mount: EntityMountedEquipment,
): number | null | undefined {
  const equipment = mount.equipment;
  const kind = supportEquipmentKind(equipment);
  const size = mount.size ?? 1;
  if (kind === 'power-generator') {
    const generatorType = equipment!.id.slice(0, -' PowerGenerator'.length);
    const baseCost = POWER_GENERATOR_BASE_COST[generatorType];
    return baseCost === undefined ? undefined : baseCost * size;
  }
  if (kind === 'cargo-lifter') return 250 * Math.ceil(size * 2);
  if (kind === 'drone-carrier-control' || kind === 'mash') {
    const tonnage = mount.getTonnage(entity);
    return tonnage === undefined ? undefined : tonnage * 10000;
  }
  if (kind === 'ladder') return size * 5;
  if (kind === 'communications') return size * 10000;
  return null;
}

export function supportEquipmentCriticalSlots(
  entity: BaseEntity,
  equipment: Equipment | null | undefined,
  size: number,
): number | null {
  const kind = supportEquipmentKind(equipment);
  if (kind === 'fuel') {
    if (!entity.mountedEngine().installed) return 0;
    const tankEngine = entity.entityType === 'Tank'
      || entity.entityType === 'Naval'
      || entity.entityType === 'VTOL';
    return Math.ceil(roundStandard(
      entity.mountedEngine().getWeight({ tank: tankEngine }) * 0.1,
      entity,
    ));
  }
  if (kind === 'cargo') return isAeroEntity(entity) ? 0 : Math.ceil(size);
  if (kind === 'liquid-cargo' || kind === 'communications') return Math.ceil(size);
  return null;
}

export function supportEquipmentCrewContribution(
  entity: BaseEntity,
  mount: EntityMountedEquipment,
): number {
  const kind = supportEquipmentKind(mount.equipment);
  if (kind === 'mobile-field-base') return 5;
  if (kind === 'mash') return 5 * Math.trunc(mount.size ?? 1);
  if (kind === 'field-kitchen') return 3;
  if (kind === 'communications') return Math.trunc(mount.getTonnage(entity) ?? 0);
  return 0;
}

export function supportEquipmentNeedsCrew(equipment: Equipment | null | undefined): boolean {
  const kind = supportEquipmentKind(equipment);
  return kind === 'communications' || kind === 'mash'
    || kind === 'mobile-field-base' || kind === 'field-kitchen';
}

export interface SupportEquipmentAlphaStrikeFacts {
  readonly droneControl?: number;
  readonly mash?: number;
  readonly mobileHeadquarters?: number;
  readonly reconnaissance: boolean;
  readonly abilities: readonly 'MFB'[];
}

export function supportEquipmentAlphaStrikeFacts(
  entity: BaseEntity,
  mount: EntityMountedEquipment,
): SupportEquipmentAlphaStrikeFacts {
  const kind = supportEquipmentKind(mount.equipment);
  const tonnage = kind === 'communications' ? mount.getTonnage(entity) : undefined;
  const mobileHeadquarters = kind === 'command-console' ? 1
    : tonnage === undefined ? undefined : Math.trunc(tonnage);
  return Object.freeze({
    ...(kind === 'drone-carrier-control'
      ? { droneControl: Math.trunc(mount.size ?? 1) }
      : kind === 'remote-drone-command-console' ? { droneControl: 1 } : {}),
    ...(kind === 'mash' ? { mash: Math.trunc(mount.size ?? 1) } : {}),
    ...(mobileHeadquarters === undefined ? {} : { mobileHeadquarters }),
    reconnaissance: tonnage !== undefined && tonnage >= entity.tonnage() / 20,
    abilities: Object.freeze(kind === 'mobile-field-base' ? ['MFB' as const] : []),
  });
}

export function supportVariableSizeLabel(
  equipment: Equipment | null | undefined,
  size: number,
): string | null {
  const kind = supportEquipmentKind(equipment);
  const name = equipment?.shortName ?? '';
  if (kind === 'drone-carrier-control') {
    return `${name} (${Math.trunc(size)} ${size > 1 ? 'drones' : 'drone'})`;
  }
  if (kind === 'mash') return `${name} (${Math.trunc(size)} ${size > 1 ? 'theaters' : 'theater'})`;
  if (kind === 'ladder') return `${name} (${Math.trunc(size)} m)`;
  if (kind === 'battle-armor-mission-equipment') return `${name} (${Math.trunc(size)} kg)`;
  return null;
}

export function supportEquipmentExplosionDamage(
  equipment: Equipment | null | undefined,
): number | null {
  return isFuelEquipment(equipment) ? 20 : null;
}

function dumperCapacity(entity: BaseEntity, mount: EntityMountedEquipment): number {
  const linkedCargo = entity.getLinkedMount(mount);
  if (isCargoEquipment(linkedCargo?.equipment)) return linkedCargo?.size ?? 1;
  return entity.equipment().reduce((total, candidate) => (
    candidate.location === mount.location && isCargoEquipment(candidate.equipment)
      ? total + (candidate.size ?? 1)
      : total
  ), 0);
}

function nearestKg(tonnage: number): number {
  return Math.round(tonnage * 1000) / 1000;
}

function roundStandard(tonnage: number, entity: BaseEntity): number {
  const kilograms = entity.entityType === 'ProtoMek'
    || entity.entityType === 'BattleArmor'
    || (entity.isSupportVehicle() && entity.weightClass() === 'Small Support');
  return kilograms
    ? Math.ceil(tonnage * 1000) / 1000
    : Math.ceil(tonnage * 2) / 2;
}
