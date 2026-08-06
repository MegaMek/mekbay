// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

/**
 * System Components barrel export.
 *
 * System components are the fundamental structural elements of every entity
 * (Gyro, Cockpit, Engine, Structure). Armor and structure definitions are
 * resolved from the equipment database.
 */

export {
  type GyroType,
  type GyroTypeDescriptor,
  type GyroComponent,
  GYRO_DATA,
  getGyro,
  getAllGyroTypes,
  getGyroTechAdvancement,
} from './gyro';

export {
  getAllCockpitTypes,
  buildHeadSystemLayout,
} from './cockpit';

export {
  AERO_COCKPIT_TECH,
  COCKPIT_DATA,
  type CockpitCrewType,
  type CockpitHeadLayout,
  type CockpitTypeDescriptor,
  getCockpitTechAdvancement,
  getIndustrialAdvancedFireControlTech,
  getAeroCockpitTechAdvancement,
} from '../components/cockpit-data';

export {
  getFullHeadEjectionTech,
  getRiscHeatSinkOverrideKitTech,
} from './mek-system-tech-data';

export {
  getAerospaceFighterConstructionTech,
  getBattleArmorConstructionTech,
  getCombatVehicleConstructionTech,
  getConventionalFighterConstructionTech,
  getDropshipConstructionTech,
  getDualTurretTech,
  getFixedWingSupportConstructionTech,
  getHandheldWeaponConstructionTech,
  getJumpshipConstructionTech,
  getLamConstructionTech,
  getMekConstructionTech,
  getProtoMekConstructionTech,
  getProtoMekInterfaceCockpitTech,
  getQuadVeeConstructionTech,
  getSmallCraftConstructionTech,
  getSpaceStationConstructionTech,
  getSupportTankConstructionTech,
  getSupportVtolConstructionTech,
  getWarshipConstructionTech,
  getVtolChinTurretTech,
} from './construction-tech-data';

export {
  MIXED_TECH,
  OMNI_TECH,
  OMNI_VEHICLE_TECH,
  PATCHWORK_ARMOR_TECH,
} from './entity-system-tech-data';

export {
  getConventionalInfantryConstructionTech,
  getInfantryMotiveTech,
  getInfantrySpecializationTech,
} from './infantry-tech-data';

export {
  MountedStructure,
  type MountedStructureOptions,
  STANDARD_STRUCTURE_EQUIPMENT,
  getStructureByName,
  getStructureByTypeId,
  getStructureTechAdvancement,
} from './structure';

export {
  type MountedArmorType,
  MountedArmor,
  type MountedArmorOptions,
} from './armor';

export {
  type LocationComponentLayout,
  createLocationComponentLayout,
  locationComponentAt,
  withLocationComponent,
  withUniformLocationComponent,
  effectiveLocationComponents,
  uniformLocationComponent,
} from './location-component-layout';

export {
  MountedEngine,
  type MountedEngineInit,
  type EnginePowerSource,
  type EngineMovementHeat,
  type EngineTypeDescriptor,
  ENGINE_DATA,
  getEngineTechAdvancement,
  getEngineBaseWeight,
  buildCTSystemLayout,
  buildSideTorsoSystemLayout,
  ENGINE_WEIGHT_TABLE,
} from './engine';
