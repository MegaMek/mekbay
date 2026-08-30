// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { ASUnitTypeCode } from '../../../../unit-summary.model';
import { WeaponEquipment } from '../../../../equipment.model';
import { BattleArmorEntity, InfantryEntity, MekEntity, ProtoMekEntity, type BaseEntity, VehicleEntity } from '../../../entities';
import { isAerospaceElement, isFighter, LARGE_AEROSPACE_TYPES } from '../foundation/unit-classification';
import { tmmForMovement, type AlphaStrikeMovement } from '../foundation/movement';
import { hasExplosiveComponent } from './explosive-components';
import { AlphaStrikeSpecialAbilityCollector } from './special-ability-collector';
import { isAeroEntity, isMekEntity } from '../../entity-type-guards';
import { CommandCockpits } from '../../../types';
import { alphaStrikeArmor } from '../foundation/integrity';
import { ecmAlphaStrikeAbility } from '../../../../ecm-mode.model';
import { activeProbeAlphaStrikeAbility, isBapEquipment } from '../../../../bap-equipment.model';
import { escalatingEquipmentAlphaStrikeAbilities } from '../../../../escalating-equipment.model';
import {
  isSimpleCamoEquipment,
  stealthAlphaStrikeAbilities,
} from '../../../../stealth-equipment.model';
import {
  isPhysicalEngineeringToolEquipment,
  isPhysicalSawEquipment,
  isPhysicalWeaponEquipment,
  isShieldEquipment,
} from '../../physical-weapon';
import { isUmuEquipment } from '../../../../jump-equipment.model';
import {
  tripleStrengthMyomerAlphaStrikeAbility,
  tripleStrengthMyomerKind,
} from '../../../../myomer-equipment.model';
import { isDroneOperatingSystemEquipment } from '../../../../drone-operating-system.model';
import { isSpikesEquipment } from '../../../../physical-augmentation.model';
import { caseAlphaStrikeAbility } from '../../../../case-equipment.model';
import {
  chassisAlphaStrikeAbilities,
  isEnvironmentalSealingEquipment,
  isMagneticClampEquipment,
} from '../../../../chassis-equipment.model';
import { fireControlAlphaStrikeAbility } from '../../fire-control';
import {
  isAtacEquipment,
  largeCraftAlphaStrikeAbilities,
} from '../../../../large-craft-equipment.model';
import {
  isStandardCargoEquipment,
  supportEquipmentAlphaStrikeFacts,
} from '../../../../support-equipment.model';
import { utilityEquipmentAlphaStrikeAbilities } from '../../../../utility-equipment.model';
import {
  aerospaceMineDispenserCapacity,
  aerospaceSupportAlphaStrikeAbilities,
  isBoobyTrapEquipment,
} from '../../../../aerospace-support-equipment.model';
import { sensorAlphaStrikeFacts } from '../../../../sensor-equipment.model';
import { c3AlphaStrikeFacts } from '../../../../c3-network.model';
import { isEquipmentForPlatform } from '../../../../equipment-platform.model';
import { battleArmorEquipmentAlphaStrikeAbility } from '../../../../battle-armor-equipment.model';
import { isSpaceAdaptationEquipment } from '../../../../infantry-equipment.model';

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
    const ecmAbility = ecmAlphaStrikeAbility(equipment);
    addCommonEquipmentSpecials(equipment, specials);
    const supportFacts = supportEquipmentAlphaStrikeFacts(entity, mount);
    if (supportFacts.droneControl !== undefined) specials.addNumeric('DCC', supportFacts.droneControl);
    if (supportFacts.mash !== undefined) specials.addNumeric('MASH', supportFacts.mash);
    if (supportFacts.mobileHeadquarters !== undefined) {
      addCommandSpecial(specials, 'MHQ', supportFacts.mobileHeadquarters);
    }
    if (supportFacts.reconnaissance) specials.add('RCN');
    for (const ability of supportFacts.abilities) specials.add(ability);
    if (isAtacEquipment(equipment)) {
      specials.addNumeric('ATAC', Math.trunc(mount.size ?? 1));
    }
    if (equipment instanceof WeaponEquipment && equipment.ammoType === 'SCREEN_LAUNCHER') {
      specials.addNumeric('SCR', 1);
    }
    if (isBoobyTrapEquipment(equipment) && !['PM', 'CI', 'BA'].includes(type)) specials.add('BT');
    const mineDispenser = aerospaceMineDispenserCapacity(equipment);
    if (mineDispenser !== null) specials.addNumeric('MDS', mineDispenser);
    const sensorFacts = sensorAlphaStrikeFacts(equipment);
    const c3Facts = c3AlphaStrikeFacts(
      equipment,
      isEquipmentForPlatform(equipment, 'battle-armor'),
    );
    if (sensorFacts.abilities.length > 0) {
      for (const ability of sensorFacts.abilities) specials.add(ability);
      if (sensorFacts.remoteSensorDispenser !== undefined) {
        specials.addNumeric('RSD', sensorFacts.remoteSensorDispenser);
      }
    } else if (c3Facts.abilities.length > 0) {
      for (const ability of c3Facts.abilities) specials.add(ability);
      if (c3Facts.mobileHeadquarters !== undefined) {
        addCommandSpecial(specials, 'MHQ', c3Facts.mobileHeadquarters);
      }
      if (c3Facts.emergencyMaster) specials.addOptionalCount('C3EM');
    } else if (isBapEquipment(equipment)) {
      specials.add(activeProbeAlphaStrikeAbility(
        entity instanceof BattleArmorEntity,
        mount.getTonnage(entity),
      ));
    } else if (ecmAbility !== null) {
      specials.add(ecmAbility);
    } else if (caseEligible) {
      const caseAbility = caseAlphaStrikeAbility(equipment);
      if (caseAbility !== null) specials.add(caseAbility);
    }
  }
}

function addCommonEquipmentSpecials(
  equipment: NonNullable<ReturnType<BaseEntity['equipment']>[number]['equipment']>,
  specials: AlphaStrikeSpecialAbilityCollector,
): void {
  const fireControlAbility = fireControlAlphaStrikeAbility(equipment);
  if (fireControlAbility !== null) specials.add(fireControlAbility);
  if (isPhysicalWeaponEquipment(equipment) || isSpikesEquipment(equipment)) {
    specials.add('MEL');
  }
  if (isShieldEquipment(equipment)) specials.add('SHLD');
  if (isPhysicalSawEquipment(equipment)) specials.add('SAW');
  if (isPhysicalEngineeringToolEquipment(equipment)) {
    specials.add('ENG');
  }
  for (const ability of utilityEquipmentAlphaStrikeAbilities(equipment)) specials.add(ability);
  if (isDroneOperatingSystemEquipment(equipment)) specials.add('DRO');
  for (const ability of largeCraftAlphaStrikeAbilities(equipment)) specials.add(ability);
  for (const ability of escalatingEquipmentAlphaStrikeAbilities(equipment)) specials.add(ability);
  const myomerAbility = tripleStrengthMyomerAlphaStrikeAbility(
    tripleStrengthMyomerKind(equipment),
  );
  if (myomerAbility !== null) specials.add(myomerAbility);
  for (const ability of stealthAlphaStrikeAbilities(equipment)) specials.add(ability);
  for (const ability of chassisAlphaStrikeAbilities(equipment)) specials.add(ability);
  if (isUmuEquipment(equipment)) specials.add('UMU');
  for (const ability of aerospaceSupportAlphaStrikeAbilities(equipment)) specials.add(ability);
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
    if (entity.equipment().some(mount => isMagneticClampEquipment(mount.equipment))) {
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
    && equipment.some(mount => isSpaceAdaptationEquipment(mount.equipment))) {
    specials.add('SOA');
  }

  const supportsEnvironmentalSealing = entity instanceof VehicleEntity
    || entity instanceof MekEntity && entity.isIndustrial();
  if (!supportsEnvironmentalSealing
    || !equipment.some(mount => isEnvironmentalSealingEquipment(mount.equipment))) return;

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
    if (isStandardCargoEquipment(mount.equipment)) capacity += mount.getTonnage(entity) ?? 0;
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
  const serializedCapacity = Number.isInteger(capacity)
    ? String(capacity)
    : String(Number(capacity.toFixed(6)));
  specials.add(`${ability}${serializedCapacity}${showDoors && doors > 0 ? `-D${doors}` : ''}`);
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
  if (!(entity instanceof InfantryEntity) && !(entity instanceof BattleArmorEntity)) return;
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

  for (const mount of entity.equipment()) {
    const equipment = mount.equipment;
    if (!equipment) continue;
    const visualCamo = isSimpleCamoEquipment(equipment);
    const equipmentAbility = battleArmorEquipmentAlphaStrikeAbility(equipment);
    if (visualCamo || equipmentAbility === 'LMAS') {
      specials.add('LMAS');
    } else if (equipmentAbility !== null) {
      specials.add(equipmentAbility);
    } else if (isMagneticClampEquipment(equipment)) {
      specials.add('XMEC');
    }
  }

  if (!(entity instanceof BattleArmorEntity)) return;
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
