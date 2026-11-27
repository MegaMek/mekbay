// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from './entity/base-entity';
import type { EntityMountedEquipment } from './entity/types/equipment';
import { isJumpShipEntity } from './entity/utils/entity-type-guards';
import type { Equipment } from './equipment.model';
import { hasEquipmentVariant } from './equipment-variant.model';
import { isNavalC3Equipment } from './c3-network.model';

export type LargeCraftEquipmentKind =
  | 'naval-tug-adaptor'
  | 'light-sail'
  | 'lithium-fusion-storage-battery'
  | 'naval-c3'
  | 'srcs'
  | 'sasrcs'
  | 'caspar'
  | 'caspar-ii'
  | 'atac'
  | 'dtac'
  | 'sds-destruct';

export function largeCraftEquipmentKind(
  equipment: Equipment | null | undefined,
): LargeCraftEquipmentKind | null {
  if (equipment?.hasFlag('F_NAVAL_TUG_ADAPTOR') === true) return 'naval-tug-adaptor';
  if (equipment?.hasFlag('F_LIGHT_SAIL') === true) return 'light-sail';
  if (equipment?.hasFlag('F_LF_STORAGE_BATTERY') === true) return 'lithium-fusion-storage-battery';
  if (isNavalC3Equipment(equipment)) return 'naval-c3';
  if (equipment?.hasFlag('F_SRCS') === true) return 'srcs';
  if (equipment?.hasFlag('F_SASRCS') === true) return 'sasrcs';
  if (equipment?.hasFlag('F_CASPAR') === true) return 'caspar';
  if (equipment?.hasFlag('F_CASPAR_II') === true) return 'caspar-ii';
  if (equipment?.hasFlag('F_ATAC') === true) return 'atac';
  if (equipment?.hasFlag('F_DTAC') === true) return 'dtac';
  if (equipment?.hasFlag('F_SDS_DESTRUCT') === true) return 'sds-destruct';
  return null;
}

export function isAtacEquipment(equipment: Equipment | null | undefined): boolean {
  return largeCraftEquipmentKind(equipment) === 'atac';
}

export function isAtacOrDtacEquipment(equipment: Equipment | null | undefined): boolean {
  const kind = largeCraftEquipmentKind(equipment);
  return kind === 'atac' || kind === 'dtac';
}

export function largeCraftEquipmentVariableTonnage(
  entity: BaseEntity,
  mount: EntityMountedEquipment,
): number | null {
  const equipment = mount.equipment;
  const kind = largeCraftEquipmentKind(equipment);
  const tonnage = entity.tonnage();
  if (kind === 'naval-tug-adaptor') return 100 + tonnage * 0.1;
  if (kind === 'light-sail') return tonnage / 10;
  if (kind === 'lithium-fusion-storage-battery') return tonnage / 100;
  if (kind === 'naval-c3') return tonnage * 0.01;
  if (kind === 'srcs' || kind === 'sasrcs') return srcsTonnage(entity, mount, kind);
  if (kind === 'caspar') return casparTonnage(entity, hasEquipmentVariant(equipment, 'improved'));
  if (kind === 'caspar-ii') return casparIITonnage(entity, hasEquipmentVariant(equipment, 'improved'));
  if (kind === 'atac') return Math.min(largeCraftStandardRound(tonnage * 0.02), 50000) + ((mount.size ?? 1) * 150);
  if (kind === 'dtac') return largeCraftStandardRound(tonnage * 0.03) + ((mount.size ?? 1) * 150);
  if (kind === 'sds-destruct') return Math.min(Math.ceil(tonnage * 0.1), 10000);
  return null;
}

export function largeCraftEquipmentVariableCost(
  entity: BaseEntity,
  mount: EntityMountedEquipment,
): number | null | undefined {
  const kind = largeCraftEquipmentKind(mount.equipment);
  if (kind === null) return null;
  const tonnage = mount.getTonnage(entity);
  if (kind === 'light-sail') return tonnage === undefined ? undefined : tonnage * 10000;
  if (kind === 'naval-c3') return tonnage === undefined ? undefined : tonnage * 100000;
  if (kind === 'srcs') return tonnage === undefined ? undefined : tonnage * 10000 + 5000;
  if (kind === 'sasrcs') return tonnage === undefined ? undefined : tonnage * 12500 + 6250;
  if (kind === 'caspar') return tonnage === undefined ? undefined : tonnage * 50000 + 500000;
  if (kind === 'caspar-ii') return tonnage === undefined ? undefined : tonnage * 20000 + 50000;
  if (kind === 'atac') return tonnage === undefined ? undefined : tonnage * 100000;
  if (kind === 'dtac') return tonnage === undefined ? undefined : tonnage * 50000;
  return null;
}

export function largeCraftAlphaStrikeAbilities(
  equipment: Equipment | null | undefined,
): readonly ('RBT' | 'SDCS' | 'ECM' | 'NC3')[] {
  const kind = largeCraftEquipmentKind(equipment);
  const abilities: ('RBT' | 'SDCS' | 'ECM' | 'NC3')[] = [];
  if (kind === 'srcs' || kind === 'sasrcs' || kind === 'caspar' || kind === 'caspar-ii') {
    abilities.push('RBT');
  }
  if (kind === 'caspar') abilities.push('SDCS');
  if (kind === 'sasrcs') abilities.push('ECM');
  if (kind === 'naval-c3') abilities.push('NC3');
  return abilities;
}

function srcsTonnage(
  entity: BaseEntity,
  mount: EntityMountedEquipment,
  kind: 'srcs' | 'sasrcs',
): number {
  const improved = hasEquipmentVariant(mount.equipment, 'improved');
  if (entity.tonnage() < 10) return improved ? 1 : 0;
  let percent = entity.entityType === 'DropShip' || entity.entityType === 'SpaceStation' ? 0.07
    : entity.entityType === 'JumpShip' || entity.entityType === 'WarShip' ? 0.1 : 0.05;
  if (improved) percent += kind === 'sasrcs' ? 0.01 : 0.02;
  else if (mount.equipment?.hasFlag('S_ELITE')) percent += 0.03;
  return isJumpShipEntity(entity)
    ? Math.ceil((entity.tonnage() - entity.jumpDriveWeight()) * percent)
    : largeCraftStandardRound(entity.tonnage() * percent);
}

function casparTonnage(entity: BaseEntity, improved: boolean): number {
  let percent = entity.entityType === 'DropShip' ? 0.04
    : entity.entityType === 'SpaceStation' ? 0.08
      : entity.entityType === 'WarShip' ? 0.06 : 0.05;
  if (improved) percent = percent === 0.05 ? 0.07 : percent + 0.04;
  return largeCraftRound(entity, entity.tonnage() * percent);
}

function casparIITonnage(entity: BaseEntity, improved: boolean): number {
  let percent = entity.entityType === 'DropShip' ? 0.08
    : entity.entityType === 'SpaceStation' ? 0.1
      : entity.entityType === 'WarShip' ? 0.12 : 0.06;
  if (improved) percent = percent === 0.06 ? 0.08 : percent + 0.04;
  return largeCraftRound(entity, entity.tonnage() * percent);
}

function largeCraftRound(entity: BaseEntity, weight: number): number {
  return entity.entityType === 'JumpShip' || entity.entityType === 'SpaceStation'
    ? Math.ceil(weight)
    : largeCraftStandardRound(weight);
}

export function largeCraftStandardRound(tonnage: number): number {
  const kilogramRounded = Math.round(tonnage * 1000) / 1000;
  return Math.ceil(kilogramRounded * 2) / 2;
}
