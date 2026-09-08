// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../models/entity/base-entity';
import type { EquipmentRegistry } from '../../models/equipment-lookup';
import { MiscEquipment } from '../../models/equipment.model';
import { MountedEngine, MountedStructure, getStructureByName } from '../../models/entity/components';
import type { EntityType } from '../../models/entity/types';
import { BipedMekEntity } from '../../models/entity/entities/mek/biped-mek-entity';
import { QuadMekEntity } from '../../models/entity/entities/mek/quad-mek-entity';
import { TripodMekEntity } from '../../models/entity/entities/mek/tripod-mek-entity';
import { AeroSpaceFighterEntity } from '../../models/entity/entities/aero/aero-space-fighter-entity';
import { HandheldWeaponEntity } from '../../models/entity/entities/misc/handheld-weapon-entity';
import {
  AeroEntity, BattleArmorEntity, ConvFighterEntity, DropShipEntity,
  FixedWingSupportEntity, InfantryEntity, JumpShipEntity, LamEntity,
  LargeSupportTankEntity, MekEntity, NavalEntity, ProtoMekEntity,
  QuadVeeEntity, SmallCraftEntity, SpaceStationEntity, StaticEmplacementEntity,
  SupportNavalEntity, SupportTankEntity, SupportVtolEntity, TankEntity,
  VehicleEntity, VtolEntity, WarShipEntity,
} from '../../models/entity/entities';

export type ConstructionUnitKind = EntityType | 'Biped' | 'Quad' | 'Tripod' | 'LAM' | 'QuadVee';

export const CONSTRUCTION_UNIT_TYPES: readonly { id: ConstructionUnitKind; label: string }[] = [
  { id: 'Biped', label: 'BattleMek / IndustrialMek' },
  { id: 'Quad', label: 'Quad Mek' }, { id: 'Tripod', label: 'Tripod Mek' },
  { id: 'LAM', label: 'Land-Air Mek' }, { id: 'QuadVee', label: 'QuadVee' },
  { id: 'ProtoMek', label: 'ProtoMek' }, { id: 'Tank', label: 'Combat Vehicle' },
  { id: 'Naval', label: 'Naval Vehicle' }, { id: 'VTOL', label: 'VTOL' },
  { id: 'SupportTank', label: 'Support Vehicle' },
  { id: 'SupportNaval', label: 'Support Naval Vehicle' },
  { id: 'SupportVTOL', label: 'Support VTOL' },
  { id: 'LargeSupportTank', label: 'Large Support Vehicle' },
  { id: 'Infantry', label: 'Conventional Infantry' },
  { id: 'BattleArmor', label: 'Battle Armor' },
  { id: 'Aero', label: 'Aerospace Fighter' },
  { id: 'ConvFighter', label: 'Conventional Fighter' },
  { id: 'FixedWingSupport', label: 'Fixed-Wing Support' },
  { id: 'SmallCraft', label: 'Small Craft' }, { id: 'DropShip', label: 'DropShip' },
  { id: 'JumpShip', label: 'JumpShip' }, { id: 'WarShip', label: 'WarShip' },
  { id: 'SpaceStation', label: 'Space Station' },
  { id: 'HandheldWeapon', label: 'Handheld Weapon' },
  { id: 'GunEmplacement', label: 'Gun Emplacement' },
  { id: 'BuildingEntity', label: 'Building' },
];

/** Creates a new design, using the same family classes as native source loading. */
export function createConstructionEntity(kind: ConstructionUnitKind, registry: EquipmentRegistry): BaseEntity {
  let entity: BaseEntity;
  switch (kind) {
    case 'Mek': case 'Biped': entity = new BipedMekEntity(registry); break;
    case 'Quad': entity = new QuadMekEntity(registry); break;
    case 'Tripod': entity = new TripodMekEntity(registry); break;
    case 'LAM': entity = new LamEntity(registry); break;
    case 'QuadVee': entity = new QuadVeeEntity(registry); break;
    case 'ProtoMek': entity = new ProtoMekEntity(registry); break;
    case 'Tank': entity = new TankEntity(registry); break;
    case 'Naval': entity = new NavalEntity(registry); break;
    case 'VTOL': entity = new VtolEntity(registry); break;
    case 'SupportTank': entity = new SupportTankEntity(registry); break;
    case 'SupportNaval': entity = new SupportNavalEntity(registry); break;
    case 'SupportVTOL': entity = new SupportVtolEntity(registry); break;
    case 'LargeSupportTank': entity = new LargeSupportTankEntity(registry); break;
    case 'Infantry': entity = new InfantryEntity(registry); break;
    case 'BattleArmor': entity = new BattleArmorEntity(registry); break;
    case 'Aero': entity = new AeroSpaceFighterEntity(registry); break;
    case 'ConvFighter': entity = new ConvFighterEntity(registry); break;
    case 'FixedWingSupport': entity = new FixedWingSupportEntity(registry); break;
    case 'SmallCraft': entity = new SmallCraftEntity(registry); break;
    case 'DropShip': entity = new DropShipEntity(registry); break;
    case 'JumpShip': entity = new JumpShipEntity(registry); break;
    case 'WarShip': entity = new WarShipEntity(registry); break;
    case 'SpaceStation': entity = new SpaceStationEntity(registry); break;
    case 'HandheldWeapon': entity = new HandheldWeaponEntity(registry); break;
    case 'GunEmplacement': case 'BuildingEntity': entity = new StaticEmplacementEntity(kind, registry); break;
  }
  entity.chassis.set('New Design');
  entity.model.set('Custom');
  entity.year.set(3151);
  entity.setTonnage(entity instanceof JumpShipEntity ? 100000
    : entity instanceof DropShipEntity ? 2000
    : entity instanceof SmallCraftEntity ? 100
    : entity instanceof ProtoMekEntity ? 5
    : entity instanceof HandheldWeaponEntity ? 1 : 50);

  if (entity instanceof MekEntity || entity instanceof VehicleEntity || entity instanceof AeroEntity) {
    entity.originalWalkMP.set(4);
    const rating = entity instanceof MekEntity ? 200
      : entity.entityType === 'Aero' ? 100 : 200;
    entity.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating, techBase: 'IS' }));
  }
  if (entity instanceof MekEntity) {
    const structure = getStructureByName('Standard', entity.techBase(), registry);
    if (structure) entity.setUniformStructure(new MountedStructure({ structure, tonnage: entity.tonnage(), techBase: entity.techBase() }));
    const sink = registry.findForTechBase('Heat Sink', 'IS');
    if (sink instanceof MiscEquipment) {
      entity.configureHeatSinks(sink, 10);
      for (const mount of entity.equipment().filter(mount => mount.allocation.kind === 'unallocated')) {
        for (const location of [...entity.locationOrder].sort((a, b) => Number(entity.locationIsLeg(b)) - Number(entity.locationIsLeg(a)))) {
          const slots = entity.criticalSlotGrid().get(location) ?? [];
          const maxSlots = location === 'HD' || entity.locationIsLeg(location) ? 6 : 12;
          const index = slots.slice(0, maxSlots).findIndex(slot => slot.type === 'empty');
          if (index < 0) continue;
          entity.moveEquipment(mount, location, [{ location, slotIndex: index }]);
          break;
        }
      }
    }
  }
  if (entity instanceof AeroEntity) {
    entity.heatSinkCount.set(10);
    entity.structuralIntegrity.set(entity instanceof JumpShipEntity ? 1 : 4);
    entity.fuel.set(400);
  }
  if (entity instanceof SmallCraftEntity || entity instanceof JumpShipEntity) entity.crew.set(5);
  if (entity instanceof SpaceStationEntity) {
    entity.motiveType.set('Station Keeping');
    entity.originalWalkMP.set(0);
  }
  if (entity instanceof NavalEntity || entity instanceof SupportNavalEntity) entity.motiveType.set('Naval');
  if (entity instanceof VtolEntity || entity instanceof SupportVtolEntity) entity.motiveType.set('VTOL');
  if (entity instanceof ProtoMekEntity) {
    entity.techBase.set('Clan');
    entity.originalWalkMP.set(4);
    entity.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 30, techBase: 'Clan' }));
  }
  if (entity instanceof InfantryEntity) { entity.squadSize.set(7); entity.squadCount.set(4); }
  if (entity instanceof BattleArmorEntity) { entity.squadSize.set(4); entity.originalWalkMP.set(1); }
  if (entity instanceof StaticEmplacementEntity) {
    entity.equipmentLocations.set(['Guns']);
    entity.constructionFactor.set(20);
    entity.height.set(1);
  }
  entity.armorValues.set(new Map((entity instanceof BattleArmorEntity ? ['Squad'] : entity.armorLocations).map(location => [location, { front: 0, rear: 0 }])));
  return entity;
}

/** Static emplacement construction has no canonical mass calculation. */
export function getConstructionMass(entity: BaseEntity): number | null {
  if (entity instanceof StaticEmplacementEntity) return null;
  // Unresolved variable-size equipment is a normal intermediate design state.
  try {
    const mass = entity.loadoutTonnage();
    return Number.isFinite(mass) ? mass : null;
  } catch { return null; }
}

export function getConstructionMassCapacity(entity: BaseEntity): number {
  if (entity instanceof BattleArmorEntity) {
    const limit: Record<string, number> = { 'Ultra Light': 0.4, Light: 0.75, Medium: 1, Heavy: 1.5, Assault: 2 };
    return (limit[entity.weightClass()] ?? 1) * entity.trooperCount();
  }
  return entity.tonnage();
}
