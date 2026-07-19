import type { BaseEntity } from '../../base-entity';
import { WeaponEquipment } from '../../../equipment.model';
import type { EntityMountedEquipment } from '../../types/equipment';
import { getEquipmentEngineWeight } from '../equipment-engine-weight';
import { getFireControlWeaponCost } from '../fire-control';
import { getTargetingComputerRelevantWeight } from '../targeting-computer';
import { nextHalfTon } from './common';

const POWER_GENERATOR_BASE_COST: Readonly<Record<string, number>> = {
  STEAM: 4000,
  SOLAR: 8000,
  FISSION: 15000,
  FUSION: 10000,
  COMBUSTION_LIQUID: 5000,
  COMBUSTION_SOLID: 5000,
  FUEL_CELL: 7000,
  EXTERNAL_PCMT: 5000,
  EXTERNAL: 5000,
};

/** Resolves one mount's database-backed fixed or entity-dependent variable cost. */
export function getEquipmentCost(
  entity: BaseEntity,
  mount: EntityMountedEquipment,
): number | undefined {
  const equipment = mount.equipment;
  if (!equipment) return undefined;
  if (equipment.cost !== 'variable') {
    if (!(equipment instanceof WeaponEquipment) || !mount.armored) return equipment.cost;
    const criticalSlots = equipment.getNumCriticalSlots(entity, mount.size ?? 1);
    return criticalSlots === undefined
      ? undefined
      : equipment.cost + (150000 * criticalSlots);
  }

  const tonnage = entity.tonnage();
  let cost: number | undefined;
  if (equipment.hasFlag('F_POWER_GENERATOR')) {
    const generatorType = equipment.id.slice(0, -' PowerGenerator'.length);
    const baseCost = POWER_GENERATOR_BASE_COST[generatorType];
    cost = baseCost === undefined ? undefined : baseCost * (mount.size ?? 1);
  } else if (equipment.hasFlag('F_CARGO_LIFTER')) {
    return 250 * Math.ceil((mount.size ?? 1) * 2);
  } else if (equipment.hasFlag('F_DRONE_CARRIER_CONTROL') || equipment.hasFlag('F_MASH')) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : equipmentTonnage * 10000;
  } else if (equipment.hasFlag('F_MASC') && equipment.hasFlag('F_BA_EQUIPMENT')) {
    cost = entity.runMP() * 75000;
  } else if (equipment.hasFlag('F_FLOTATION_HULL')
    || equipment.hasFlag('F_OFF_ROAD')
    || (equipment.hasFlag('F_ENVIRONMENTAL_SEALING') && entity.entityType !== 'Mek')) {
    cost = 0;
  } else if (equipment.hasFlag('F_JET_BOOSTER') || equipment.hasFlag('S_SUPERCHARGER')) {
    cost = entity.isSupportVehicle()
      ? getEquipmentEngineWeight(entity) * 10000
      : entity.mountedEngine().rating * 10000;
  } else if (equipment.hasFlag('F_MASC') && entity.entityType === 'ProtoMek') {
    cost = Math.round(entity.mountedEngine().rating * 1000 * tonnage * 0.025);
  } else if (equipment.hasFlag('F_MASC')) {
    const mascTonnage = Math.round(tonnage / (equipment.techBase === 'Clan' ? 25 : 20));
    cost = entity.mountedEngine().rating * mascTonnage * 1000;
  } else if (equipment.hasFlag('F_TARGETING_COMPUTER')) {
    const relevantWeight = getTargetingComputerRelevantWeight(entity);
    const divider = equipment.techBase === 'IS' ? 4 : 5;
    cost = relevantWeight === undefined ? undefined : 10000 * Math.ceil(relevantWeight / divider);
  } else if (equipment.hasFlag('F_ARMORED_MOTIVE_SYSTEM')) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : equipmentTonnage * 100000;
  } else if (equipment.hasFlag('F_ENVIRONMENTAL_SEALING')) {
    cost = entity.entityType === 'Mek' ? 225 * tonnage : 0;
  } else if (equipment.hasFlag('F_LIMITED_AMPHIBIOUS') || equipment.hasFlag('F_FULLY_AMPHIBIOUS')) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : equipmentTonnage * 10000;
  } else if (equipment.hasFlag('F_DUNE_BUGGY')) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : 10 * equipmentTonnage * equipmentTonnage;
  } else if (equipment.hasFlag('F_DRONE_OPERATING_SYSTEM')) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : (equipmentTonnage * 10000) + 5000;
  } else if (equipment.hasAnyFlag(['F_HEAD_TURRET', 'F_SHOULDER_TURRET', 'F_QUAD_TURRET'])) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : equipmentTonnage * 10000;
  } else if (equipment.hasFlag('F_SPONSON_TURRET')) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : equipmentTonnage * 4000;
  } else if (equipment.hasFlag('F_PINTLE_TURRET')) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : equipmentTonnage * 1000;
  } else if (equipment.hasFlag('F_CLUB') && equipment.hasFlag('S_HATCHET')) {
    cost = Math.ceil(tonnage / 15) * 5000;
  } else if (equipment.hasFlag('F_CLUB') && equipment.hasFlag('S_SWORD')) {
    cost = nextHalfTon(tonnage / 20) * 10000;
  } else if (equipment.hasFlag('F_CLUB') && equipment.hasFlag('S_RETRACTABLE_BLADE')) {
    cost = (1 + Math.ceil(tonnage / 20)) * 10000;
  } else if (equipment.hasFlag('F_TRACKS')) {
    const multiplier = equipment.hasFlag('S_QUADVEE_WHEELS') ? 750 : 500;
    cost = Math.ceil((multiplier * entity.mountedEngine().rating * tonnage) / 75);
  } else if (equipment.hasFlag('F_TALON')) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : Math.ceil(equipmentTonnage * 300);
  } else if (equipment.hasFlag('F_SPIKES')) {
    cost = Math.ceil(tonnage * 50);
  } else if (equipment.hasFlag('F_PARTIAL_WING')) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : Math.ceil(equipmentTonnage * 50000);
  } else if (equipment.hasFlag('F_ACTUATOR_ENHANCEMENT_SYSTEM')) {
    cost = Math.ceil(tonnage * (entity.locationIsLeg(mount.location) ? 700 : 500));
  } else if (equipment.hasFlag('F_HAND_WEAPON') && equipment.hasFlag('S_CLAW')) {
    cost = Math.ceil(tonnage * 200);
  } else if (equipment.hasFlag('F_CLUB') && equipment.hasFlag('S_LANCE')) {
    cost = Math.ceil(tonnage * 150);
  } else if (equipment.hasFlag('F_MECHANICAL_JUMP_BOOSTER')) {
    if (entity.weightClass() === 'Assault') cost = 300000;
    else if (entity.weightClass() === 'Heavy') cost = 150000;
    else if (entity.weightClass() === 'Medium') cost = 75000;
    else cost = 50000;
  } else if (equipment.hasFlag('F_LADDER')) {
    cost = (mount.size ?? 1) * 5;
  } else if (equipment.hasFlag('F_COMMUNICATIONS')) {
    cost = (mount.size ?? 1) * 10000;
  } else if (equipment.hasFlag('F_BASIC_FIRE_CONTROL') || equipment.hasFlag('F_ADVANCED_FIRE_CONTROL')) {
    const weaponCost = getFireControlWeaponCost(entity);
    cost = weaponCost === undefined
      ? undefined
      : weaponCost * (equipment.hasFlag('F_BASIC_FIRE_CONTROL') ? 0.05 : 0.1);
  } else if (equipment.hasFlag('F_LIGHT_SAIL')) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : equipmentTonnage * 10000;
  } else if (equipment.hasFlag('F_NAVAL_C3')) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : equipmentTonnage * 100000;
  } else if (equipment.hasFlag('F_SRCS')) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : (equipmentTonnage * 10000) + 5000;
  } else if (equipment.hasFlag('F_SASRCS')) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : (equipmentTonnage * 12500) + 6250;
  } else if (equipment.hasFlag('F_CASPAR')) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : (equipmentTonnage * 50000) + 500000;
  } else if (equipment.hasFlag('F_CASPAR_II')) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : (equipmentTonnage * 20000) + 50000;
  } else if (equipment.hasFlag('F_ATAC')) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : equipmentTonnage * 100000;
  } else if (equipment.hasFlag('F_DTAC')) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : equipmentTonnage * 50000;
  } else if (equipment.hasFlag('F_RAM_PLATE')) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : equipmentTonnage * 10000;
  } else if (equipment.hasFlag('F_DAMAGE_INTERRUPT_CIRCUIT')) {
    cost = 150 * Math.max(1, entity.crewSlotCount());
  } else if (equipment.hasFlag('F_ANTI_MEK_GEAR')) {
    // Anti-Mek training is represented by Infantry's price multiplier;
    // the equipment marker has no independent additive cost.
    cost = 0;
  }

  if (cost === undefined || !mount.armored) return cost;
  const criticalSlots = equipment.getNumCriticalSlots(entity, mount.size ?? 1);
  return criticalSlots === undefined ? undefined : cost + (150000 * criticalSlots);
}
