// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { ASUnitTypeCode } from '../../../../units.model';
import { ArmorEquipment, WeaponEquipment } from '../../../../equipment.model';
import { BattleArmorEntity, InfantryEntity, MekEntity, ProtoMekEntity, type BaseEntity, VehicleEntity } from '../../../entities';
import { isAerospaceElement, isFighter, LARGE_AEROSPACE_TYPES } from '../foundation/unit-classification';
import { tmmForMovement, type AlphaStrikeMovement } from '../foundation/movement';
import { hasExplosiveComponent } from './explosive-components';
import { AlphaStrikeSpecialAbilityCollector } from './special-ability-collector';
import { isAeroEntity, isMekEntity } from '../../entity-type-guards';
import { CommandCockpits } from '../../../types';
import { alphaStrikeArmor } from '../foundation/integrity';

export interface AlphaStrikeCoreSpecialContext {
  readonly type: ASUnitTypeCode;
  /** Aerospace elements only receive ENE when their standard damage is non-zero. */
  readonly hasStandardDamage: boolean;
  readonly movement?: AlphaStrikeMovement;
}

const STEALTH_ARMOR_TYPES = new Set([
  'STEALTH',
  'STEALTH_VEHICLE',
  'BA_STEALTH',
  'BA_STEALTH_BASIC',
  'BA_STEALTH_IMP',
  'BA_STEALTH_PROTOTYPE',
]);

const ARMOR_SPECIALS: Readonly<Partial<Record<string, string>>> = {
  FERRO_LAMELLOR: 'CR',
  HARDENED: 'CR',
  ANTI_PENETRATIVE_ABLATION: 'ABA',
  BALLISTIC_REINFORCED: 'BRA',
  BA_FIRE_RESIST: 'FR',
  HEAT_DISSIPATING: 'FR',
  IMPACT_RESISTANT: 'IRA',
  REACTIVE: 'RCA',
  BA_REACTIVE: 'RCA',
  REFLECTIVE: 'RFA',
  BA_REFLECTIVE: 'RFA',
  BA_MIMETIC: 'MAS',
};

/**
 * Converts export-visible, non-weapon Alpha Strike special abilities.
 * Weapon and transport abilities intentionally remain in their dedicated
 * conversion stages, where their values and locations can be represented.
 */
export function alphaStrikeCoreSpecials(
  entity: BaseEntity,
  context: AlphaStrikeCoreSpecialContext,
): string[] {
  return collectAlphaStrikeCoreSpecials(entity, context).toArray();
}

export function collectAlphaStrikeCoreSpecials(
  entity: BaseEntity,
  context: AlphaStrikeCoreSpecialContext,
): AlphaStrikeSpecialAbilityCollector {
  const specials = new AlphaStrikeSpecialAbilityCollector();
  const explosive = hasExplosiveComponent(entity);

  if (eligibleForENE(entity, context) && !explosive) specials.add('ENE');
  addEquipmentSpecials(entity, context.type, explosive, specials);
  addUnitSpecials(entity, context.type, specials);
  addMovementSpecials(context.movement, specials);
  finalizeSpecials(specials);
  return specials;
}

function eligibleForENE(entity: BaseEntity, context: AlphaStrikeCoreSpecialContext): boolean {
  if (context.type === 'CI' || context.type === 'BA' || LARGE_AEROSPACE_TYPES.has(context.type)) return false;
  return !isAerospaceElement(entity, context.type) || context.hasStandardDamage;
}

function addEquipmentSpecials(
  entity: BaseEntity,
  type: ASUnitTypeCode,
  explosive: boolean,
  specials: AlphaStrikeSpecialAbilityCollector,
): void {
  const caseEligible = eligibleForCASE(entity, type);
  if (explosive && caseEligible && entity.techBase() === 'Clan'
    && ['BM', 'IM', 'SV', 'CV', 'MS'].includes(type)) specials.add('CASE');

  for (const mount of entity.equipment()) {
    const equipment = mount.equipment;
    if (!equipment) continue;
    addCommonEquipmentSpecials(equipment, specials);
    if (equipment.hasFlag('F_DRONE_CARRIER_CONTROL')) {
      specials.addNumeric('DCC', Math.trunc(mount.size ?? 1));
    } else if (equipment.hasFlag('F_REMOTE_DRONE_COMMAND_CONSOLE')) {
      specials.addNumeric('DCC', 1);
    }
    if (equipment.hasFlag('F_MASH')) {
      specials.addNumeric('MASH', Math.trunc(mount.size ?? 1));
    }
    if (equipment.hasFlag('F_ATAC')) {
      specials.addNumeric('ATAC', Math.trunc(mount.size ?? 1));
    }
    if (equipment instanceof WeaponEquipment && equipment.ammoType === 'SCREEN_LAUNCHER') {
      specials.addNumeric('SCR', 1);
    }
    if (equipment.hasFlag('F_BOOBY_TRAP') && !['PM', 'CI', 'BA'].includes(type)) specials.add('BT');
    if (equipment.hasFlag('F_COMMUNICATIONS')) {
      const tonnage = mount.getTonnage(entity);
      if (tonnage !== undefined) {
        addCommandSpecial(specials, 'MHQ', Math.trunc(tonnage));
        if (tonnage >= entity.tonnage() / 20) specials.add('RCN');
      }
    }
    if (equipment.hasAnyFlag(['F_VEHICLE_MINE_DISPENSER', 'F_SPACE_MINE_DISPENSER'])) {
      specials.addNumeric('MDS', 2);
    }
    if (equipment.hasFlag('F_EW_EQUIPMENT')) {
      specials.add('ECM');
      specials.add('LPRB');
    } else if (equipment.hasFlag('F_NOVA')) {
      specials.add('PRB');
      specials.add('ECM');
      specials.add('NOVA');
      addCommandSpecial(specials, 'MHQ', 1.5);
    } else if (equipment.hasFlag('F_WATCHDOG')) {
      specials.add('LPRB');
      specials.add('ECM');
      specials.add('WAT');
    } else if (equipment.hasFlag('F_BLOODHOUND')) {
      specials.add('BH');
    } else if (equipment.hasFlag('F_BAP')) {
      specials.add(probeAbility(entity, mount.getTonnage(entity)));
    } else if (equipment.hasFlag('F_ECM')) {
      if (equipment.hasFlag('F_ANGEL_ECM')) specials.add('AECM');
      else if (equipment.hasFlag('F_SINGLE_HEX_ECM')) specials.add('LECM');
      else specials.add('ECM');
    } else if (caseEligible && equipment.hasFlag('F_CASE')) {
      specials.add('CASE');
    } else if (caseEligible && equipment.hasFlag('F_CASE_P')) {
      specials.add('CASEP');
    } else if (caseEligible && equipment.hasFlag('F_CASE_II')) {
      specials.add('CASEII');
    }
  }
}

function probeAbility(entity: BaseEntity, tonnage: number | undefined): 'PRB' | 'LPRB' | 'RCN' {
  if (tonnage === undefined) return 'PRB';
  if (entity instanceof BattleArmorEntity) {
    if (tonnage === 0.045 || tonnage === 0.065) return 'RCN';
    if (tonnage === 0.15 || tonnage === 0.25) return 'LPRB';
  } else if (tonnage === 0.5) {
    return 'LPRB';
  }
  return 'PRB';
}

function addCommonEquipmentSpecials(
  equipment: NonNullable<ReturnType<BaseEntity['equipment']>[number]['equipment']>,
  specials: AlphaStrikeSpecialAbilityCollector,
): void {
  if (equipment.hasFlag('F_ADVANCED_FIRE_CONTROL')) specials.add('AFC');
  if (equipment.hasFlag('F_BASIC_FIRE_CONTROL')) specials.add('BFC');
  if (equipment.hasAnyFlag(['F_HAND_WEAPON', 'F_TALON', 'F_CLUB', 'F_SPIKES', 'F_PROTOMEK_MELEE'])) specials.add('MEL');
  if (equipment.hasFlag('F_CLUB')
    && equipment.hasAnyFlag(['S_SHIELD_SMALL', 'S_SHIELD_MEDIUM', 'S_SHIELD_LARGE'])) {
    specials.add('SHLD');
  }
  if (equipment.hasAnyFlag(['S_DUAL_SAW', 'S_CHAINSAW', 'S_BUZZSAW', 'S_RETRACTABLE_BLADE'])) specials.add('SAW');
  if (equipment.hasFlag('F_BULLDOZER')
    || equipment.hasAnyFlag(['S_BACKHOE', 'S_PILE_DRIVER', 'S_MINING_DRILL', 'S_ROCK_CUTTER', 'S_WRECKING_BALL'])) {
    specials.add('ENG');
  }
  if (equipment.hasFlag('F_FIRE_RESISTANT')) specials.add('FR');
  if (equipment.hasFlag('F_DRONE_OPERATING_SYSTEM')) specials.add('DRO');
  if (equipment.hasAnyFlag(['F_SRCS', 'F_SASRCS', 'F_CASPAR', 'F_CASPAR_II'])) {
    specials.add('RBT');
    if (equipment.hasFlag('F_CASPAR')) specials.add('SDCS');
    if (equipment.hasFlag('F_SASRCS')) specials.add('ECM');
  }
  if (equipment.hasFlag('F_EJECTION_SEAT')) specials.add('ES');
  if (equipment.hasFlag('F_HARJEL')) specials.add('BHJ');
  if (equipment.hasFlag('F_HARJEL_II')) specials.add('BHJ2');
  if (equipment.hasFlag('F_HARJEL_III')) specials.add('BHJ3');
  if (equipment.hasFlag('F_RADICAL_HEATSINK')) specials.add('RHS');
  if (equipment.hasFlag('F_EMERGENCY_COOLANT_SYSTEM')) specials.add('ECS');
  if (equipment.hasFlag('F_TSM')) specials.add('TSM');
  if (equipment.hasFlag('F_INDUSTRIAL_TSM')) specials.add('I-TSM');
  if (equipment.hasAnyFlag(['F_NULL_SIG', 'F_CHAMELEON_SHIELD'])) specials.add('STL');
  if (equipment.hasFlag('F_VOID_SIG')) specials.add('MAS');
  if (equipment.hasFlag('F_VIRAL_JAMMER_DECOY')) specials.add('DJ');
  if (equipment.hasFlag('F_VIRAL_JAMMER_HOMING')) specials.add('HJ');
  if (equipment.hasFlag('F_ARMORED_MOTIVE_SYSTEM')) specials.add('ARS');
  if (equipment.hasFlag('F_UMU')) specials.add('UMU');
  if (equipment.hasFlag('F_MOBILE_HPG')) specials.add('HPG');
  if (equipment.hasFlag('F_MOBILE_FIELD_BASE')) specials.add('MFB');
  if (equipment.hasFlag('F_MINESWEEPER')) specials.add('MSW');
  if (equipment.hasAnyFlag(['F_AMPHIBIOUS', 'F_FULLY_AMPHIBIOUS', 'F_LIMITED_AMPHIBIOUS'])) {
    specials.add('AMP');
  }
  if (equipment.hasFlag('F_OFF_ROAD')) specials.add('ORO');
  if (equipment.hasFlag('F_DUNE_BUGGY')) specials.add('DUN');
  if (equipment.hasAnyFlag(['F_LIGHT_BRIDGE_LAYER', 'F_MEDIUM_BRIDGE_LAYER', 'F_HEAVY_BRIDGE_LAYER'])) {
    specials.add('BRID');
  }
  if (equipment.hasAnyFlag(['F_TRACTOR_MODIFICATION', 'F_TRAILER_MODIFICATION', 'F_HITCH'])) {
    specials.add('HTC');
  }
  if (equipment.hasFlag('F_SEARCHLIGHT') || equipment.hasFlag('F_BA_SEARCHLIGHT')) specials.add('SRCH');
  if (equipment.hasFlag('F_C3I')) {
    specials.add('C3I');
    addCommandSpecial(specials, 'MHQ', equipment.hasFlag('F_BA_EQUIPMENT') ? 2 : 2.5);
  }
  if (equipment.hasFlag('F_C3S')) {
    specials.add('C3S');
    addCommandSpecial(specials, 'MHQ', equipment.hasFlag('F_C3EM') ? 2 : 1);
    if (equipment.hasFlag('F_C3EM')) specials.addOptionalCount('C3EM');
  }
  if (equipment.hasFlag('F_C3SBS')) {
    specials.add('C3BSS');
    addCommandSpecial(specials, 'MHQ', 2);
  }
  if (equipment.hasFlag('F_NAVAL_C3')) specials.add('NC3');
  if (equipment.hasFlag('F_COMMAND_CONSOLE')) addCommandSpecial(specials, 'MHQ', 1);
  if (equipment.hasFlag('F_SENSOR_DISPENSER')) {
    specials.addNumeric('RSD', 1);
    specials.add('RCN');
  }
  if (equipment.hasAnyFlag(['F_LOOKDOWN_RADAR', 'F_RECON_CAMERA', 'F_HIRES_IMAGER', 'F_HYPERSPECTRAL_IMAGER', 'F_INFRARED_IMAGER'])) {
    specials.add('RCN');
  }
}

function addCommandSpecial(
  specials: AlphaStrikeSpecialAbilityCollector,
  ability: string,
  value: number,
): void {
  specials.addNumeric(ability, value);
}

function eligibleForCASE(entity: BaseEntity, type: ASUnitTypeCode): boolean {
  return type !== 'CI' && type !== 'BA' && type !== 'PM'
    && !isFighter(entity, type) && !LARGE_AEROSPACE_TYPES.has(type);
}

function addUnitSpecials(
  entity: BaseEntity,
  type: ASUnitTypeCode,
  specials: AlphaStrikeSpecialAbilityCollector,
): void {
  addInfantrySpecials(entity, type, specials);
  addIntrinsicCommandSpecial(entity, specials);
  addCargoSpecials(entity, type, specials);
  addTransportSpecials(entity, type, specials);
  if (entity.quirks().some(({ quirk }) => quirk.key === 'trailer_hitch')) specials.add('HTC');
  const armor = entity.uniformArmor()?.armor;
  if (!entity.hasPatchworkArmor() && armor && STEALTH_ARMOR_TYPES.has(armor.armorType)) {
    specials.add('STL');
  }
  if (!entity.hasPatchworkArmor() && armor) {
    const armorSpecial = ARMOR_SPECIALS[armor.armorType];
    if (armorSpecial) specials.add(armorSpecial);
    if (alphaStrikeArmor(entity) > 0
      && (armor.armorType === 'COMMERCIAL'
        || entity.isSupportVehicle() && entity.barRating() >= 1 && entity.barRating() <= 9)) {
      specials.add('BAR');
    }
  }
  const engine = entity.mountedEngine();
  if (engine.installed && !LARGE_AEROSPACE_TYPES.has(type)) {
    if (engine.isICE) specials.add('EE');
    else if (engine.type() === 'Fuel Cell') specials.add('FC');
  }
  if (entity.equipment().some(mount => mount.armored)
    || entity instanceof MekEntity && entity.armoredSystemSlots().size > 0) specials.add('ARM');
  if (entity instanceof MekEntity) {
    if (entity.chassisConfig === 'QuadVee') specials.add('QV');
    if (entity.isSuperHeavy()) specials.add('LG');
    if (entity.isIndustrial()) {
      specials.add(entity.mountedCockpit().isIndustrial ? 'BFC' : 'AFC');
    }
  }
  if ((entity instanceof MekEntity || entity instanceof VehicleEntity) && entity.omni()) {
    specials.add('OMNI');
  }
  if (entity instanceof ProtoMekEntity) {
    if (entity.isGlider()) specials.add('GLD');
    if (entity.equipment().some(mount => mount.equipment?.hasFlag('F_MAGNETIC_CLAMP'))) {
      specials.add(entity.tonnage() < 10 ? 'MCS' : 'UCS');
    }
  }
  if (entity instanceof VehicleEntity && !entity.isSupportVehicle()) specials.add('SRCH');
  addSpaceOperationsSpecials(entity, type, specials);
}

function addSpaceOperationsSpecials(
  entity: BaseEntity,
  type: ASUnitTypeCode,
  specials: AlphaStrikeSpecialAbilityCollector,
): void {
  const equipment = entity.equipment();
  if ((type === 'BA' || type === 'CI')
    && equipment.some(mount => mount.equipment?.hasFlag('F_SPACE_ADAPTATION'))) {
    specials.add('SOA');
  }

  const supportsEnvironmentalSealing = entity instanceof VehicleEntity
    || entity instanceof MekEntity && entity.isIndustrial();
  if (!supportsEnvironmentalSealing
    || !equipment.some(mount => mount.equipment?.hasFlag('F_ENVIRONMENTAL_SEALING'))) return;

  specials.add('SEAL');
  const engine = entity.mountedEngine();
  if (engine.installed && (engine.isFusion || engine.isFission || engine.type() === 'Fuel Cell')) {
    specials.add('SOA');
  }
}

const CARGO_BAY_TYPES = new Set(['cargo', 'liquid-cargo', 'insulated-cargo', 'refrigerated-cargo']);

function addCargoSpecials(
  entity: BaseEntity,
  type: ASUnitTypeCode,
  specials: AlphaStrikeSpecialAbilityCollector,
): void {
  let capacity = 0;
  let doors = 0;
  for (const mount of entity.equipment()) {
    if (mount.equipment?.hasFlag('F_CARGO')) capacity += mount.getTonnage(entity) ?? 0;
  }
  for (const transporter of entity.transporters()) {
    if (transporter.kind !== 'bay' || !CARGO_BAY_TYPES.has(transporter.configuration.type)) continue;
    capacity += transporter.capacity;
    doors += transporter.doors;
  }
  if (capacity <= 0) return;

  if (capacity > 1000) {
    addCargoSpecial('CK', Math.round(capacity / 1000), doors, LARGE_AEROSPACE_TYPES.has(type), specials);
  } else {
    const finalCapacity = LARGE_AEROSPACE_TYPES.has(type) ? Math.round(capacity) : capacity;
    addCargoSpecial('CT', finalCapacity, doors, LARGE_AEROSPACE_TYPES.has(type), specials);
  }
}

function addCargoSpecial(
  ability: 'CT' | 'CK',
  capacity: number,
  doors: number,
  showDoors: boolean,
  specials: AlphaStrikeSpecialAbilityCollector,
): void {
  specials.add(`${ability}${capacity}${showDoors && doors > 0 ? `-D${doors}` : ''}`);
}

const MOBILE_FIELD_BASE_BAY_TYPES = new Set([
  'fighter', 'mek', 'protomek', 'small-craft', 'light-vehicle', 'heavy-vehicle', 'naval-repair',
]);

function addTransportSpecials(
  entity: BaseEntity,
  type: ASUnitTypeCode,
  specials: AlphaStrikeSpecialAbilityCollector,
): void {
  const capacities = new Map<string, number>();
  const doors = new Map<string, number>();
  const addCapacity = (ability: string, capacity: number, doorCount?: number): void => {
    capacities.set(ability, (capacities.get(ability) ?? 0) + capacity);
    if (doorCount) doors.set(ability, (doors.get(ability) ?? 0) + doorCount);
  };

  for (const transporter of entity.transporters()) {
    if (transporter.kind === 'docking-collar') {
      addCapacity('DT', 1);
    } else if (transporter.kind === 'troop-space') {
      addCapacity('IT', transporter.totalSpace);
    } else if (transporter.kind === 'bay') {
      const ability = transportAbilityForBay(transporter.configuration.type);
      if (ability) addCapacity(ability, transporter.capacity, ability === 'IT' ? undefined : transporter.doors);
    }
  }
  for (const [ability, capacity] of capacities) {
    const doorSuffix = LARGE_AEROSPACE_TYPES.has(type) && doors.has(ability) ? `-D${doors.get(ability)}` : '';
    specials.add(`${ability}${capacity}${doorSuffix}`);
  }
  const mobileFieldBaseBays = entity.transporters().filter(transporter =>
    transporter.kind === 'bay' && MOBILE_FIELD_BASE_BAY_TYPES.has(transporter.configuration.type)).length;
  if (mobileFieldBaseBays > 0 && !specials.has('MFB')) {
    specials.add(`MFB${mobileFieldBaseBays}`);
  }
}

function transportAbilityForBay(type: string): string | null {
  const abilities: Readonly<Record<string, string>> = {
    fighter: 'AT',
    infantry: 'IT',
    mek: 'MT',
    protomek: 'PT',
    'small-craft': 'ST',
    'light-vehicle': 'VTM',
    'heavy-vehicle': 'VTH',
  };
  return abilities[type] ?? null;
}

function addInfantrySpecials(
  entity: BaseEntity,
  type: ASUnitTypeCode,
  specials: AlphaStrikeSpecialAbilityCollector,
): void {
  if (type !== 'CI' && type !== 'BA') return;
  specials.add(`CAR${Math.ceil(entity.tonnage())}`);

  if (entity instanceof InfantryEntity && entity.specializations().has('mine-engineers')) {
    specials.add('MSW');
  }
  if (entity instanceof InfantryEntity) {
    if (entity.specializations().has('fire-engineers')) specials.add('FF');
    if (entity.specializations().has('mountain-troops')) specials.add('MTN');
    if (entity.specializations().has('trench-engineers')) specials.add('TRN');
    if (entity.umuMP() > 0 || entity.specializations().has('scuba')) specials.add('UMU');
    if (entity.specializations().has('paratroops')) specials.add('PAR');
    if (entity.augmentations().includes('tsm_implant')) specials.add('TSI');
  }

  if (!(entity instanceof BattleArmorEntity)) return;
  if (entity.equipment().some(mount =>
    mount.equipment?.hasFlag('F_VISUAL_CAMO')
      && !(mount.equipment instanceof ArmorEquipment && mount.equipment.armorType === 'BA_MIMETIC'))) {
    specials.add('LMAS');
  }
  if (entity.equipment().some(mount =>
    mount.equipment?.hasFlag('F_TOOLS') && mount.equipment.hasFlag('S_MINESWEEPER'))) specials.add('MSW');
  if (entity.equipment().some(mount => mount.equipment?.hasFlag('F_PARAFOIL'))) specials.add('PAR');
  if (entity.equipment().some(mount => mount.equipment?.hasFlag('F_MAGNETIC_CLAMP'))) {
    specials.add('XMEC');
  }
  if (entity.mechanizedCapable()) specials.add('MEC');
}

function addMovementSpecials(
  movement: AlphaStrikeMovement | undefined,
  specials: AlphaStrikeSpecialAbilityCollector,
): void {
  if (!movement) return;
  addRelativeMovementSpecial(movement, 'j', 'JMPS', 'JMPW', specials);
  addRelativeMovementSpecial(movement, 's', 'SUBS', 'SUBW', specials);
}

function addRelativeMovementSpecial(
  movement: AlphaStrikeMovement,
  mode: 'j' | 's',
  strongerAbility: string,
  weakerAbility: string,
  specials: AlphaStrikeSpecialAbilityCollector,
): void {
  const alternateMovement = movement.values[mode];
  if (alternateMovement === undefined || movement.primary === mode) return;
  const primaryMovement = movement.values[movement.primary] ?? 0;
  const difference = tmmForMovement(alternateMovement) - tmmForMovement(primaryMovement);
  if (difference > 0) addNumericSpecial(specials, strongerAbility, difference);
  else if (difference < 0) addNumericSpecial(specials, weakerAbility, -difference);
}

function addNumericSpecial(
  specials: AlphaStrikeSpecialAbilityCollector,
  ability: string,
  value: number,
): void {
  specials.addNumeric(ability, value);
}

function finalizeSpecials(specials: AlphaStrikeSpecialAbilityCollector): void {
  if (specials.has('CASEII')) specials.delete('CASE');
  if (specials.has('AECM')) specials.delete('ECM');
  if (['PRB', 'LPRB', 'BH', 'WAT', 'NOVA'].some(special => specials.has(special))) {
    specials.add('RCN');
  }
  if (specials.has('ENE')) {
    specials.delete('CASE');
    specials.delete('CASEII');
    specials.delete('CASEP');
  }
  if (specials.has('XMEC')) specials.delete('MEC');
}

function addIntrinsicCommandSpecial(
  entity: BaseEntity,
  specials: AlphaStrikeSpecialAbilityCollector,
): void {
  if (isMekEntity(entity) || isAeroEntity(entity)) {
    if (entity.cockpitType() === 'Interface') specials.add('DN');
    if (CommandCockpits.has(entity.cockpitType())) {
      addCommandSpecial(specials, 'MHQ', 1);
    }
  }
}
