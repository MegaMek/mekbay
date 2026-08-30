// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
  AmmoEquipment,
  ArmorEquipment,
  Equipment,
  MiscEquipment,
  StructureEquipment,
  WeaponEquipment,
} from '../models/equipment.model';
import { hasMekOrTankApplicability, isBattleArmorAmmo } from '../models/equipment-platform.model';
import { BaseEntity } from '../models/entity/base-entity';
import { AeroEntity } from '../models/entity/entities/aero/aero-entity';
import { BattleArmorEntity } from '../models/entity/entities/infantry/battle-armor-entity';
import { InfantryEntity } from '../models/entity/entities/infantry/infantry-entity';
import { MekEntity, MekWithArmsEntity } from '../models/entity/entities/mek/mek-entity';
import { VehicleEntity } from '../models/entity/entities/vehicle/vehicle-entity';
import { EntityMountedEquipment, EntityMountedWeapon } from '../models/entity/types/equipment';
import { weaponBayEquipmentId } from '../models/entity/utils/implicit-equipment';
import {
  isProtoMekMeleeEquipment,
  isShieldEquipment,
} from '../models/entity/utils/physical-weapon';
import { UnitComponent } from '../models/unit-summary.model';
import { formatWeaponDamage } from './weapon-damage.util';
import { isApolloEquipment } from '../models/apollo-mode.model';
import { isSingleHexEcmEquipment } from '../models/ecm-mode.model';
import {
  isBackhoeEquipment,
  isTalonEquipment,
} from '../models/entity/utils/physical-weapon';
import { isAnyJumpBoosterEquipment } from '../models/jump-equipment.model';
import { isArtemisEquipment } from '../models/artemis-equipment.model';
import {
  isChainDrapeEquipment,
  isEnvironmentalSealingEquipment,
  isTracksEquipment,
} from '../models/chassis-equipment.model';
import { isBlueShieldEquipment, isMascEquipment } from '../models/escalating-equipment.model';
import {
  isChameleonShieldEquipment,
  isNullSignatureEquipment,
  isStealthEquipment,
  isVoidSignatureEquipment,
} from '../models/stealth-equipment.model';
import {
  isBattleArmorStructuralUtility,
  isMastMountEquipment,
} from '../models/utility-equipment.model';
import {
  isAntiPersonnelMountEquipment,
  isBattleArmorManipulatorEquipment,
  isDetachableWeaponPackEquipment,
  isElectronicInterfaceEquipment,
  isModularWeaponMountEquipment,
} from '../models/battle-armor-equipment.model';
import {
  isJumpJetEquipment,
  isPartialWingEquipment,
  isSuperCooledMyomerEquipment,
  isUmuEquipment,
} from '../models/jump-equipment.model';
import { tripleStrengthMyomerKind } from '../models/myomer-equipment.model';
import { isRamPlateEquipment } from '../models/physical-augmentation.model';

type ExportComponent = Omit<UnitComponent, 'l' | 'bay'> & {
  l?: string;
  bay?: ExportComponent[];
};
type ComponentType = ExportComponent['t'];

/** Mirrors SVGMassPrinter.Components while using only canonical parser state. */
export function buildUnitComponentMetadata(entity: BaseEntity): UnitComponent[] | undefined {
  const components = new Map<string, ExportComponent>();
  addConventionalInfantryWeapons(components, entity);
  addSyntheticStructure(components, entity);
  addSyntheticArmor(components, entity);
  addMekSystems(components, entity);
  addImplicitSmallCraftEcm(components, entity);

  if (usesWeaponBays(entity)) addWeaponBays(components, entity);
  else addOrdinaryEquipment(components, entity);

  addImplicitClanCase(components, entity);
  addIntegralHeatSinks(components, entity);
  return [...components.values()] as UnitComponent[];
}

function addOrdinaryEquipment(components: Map<string, ExportComponent>, entity: BaseEntity): void {
  for (const mount of entity.equipment()) {
    if (mount.allocation.kind === 'engine' || !mount.equipment) continue;
    const equipment = mount.equipment;

    if (equipment instanceof StructureEquipment || equipment instanceof ArmorEquipment) {
      continue;
    } else if (equipment instanceof AmmoEquipment) {
      addAmmo(components, entity, mount, equipment);
    } else if (mount.isPhysicalWeapon() && !isProtoMekMeleeEquipment(equipment)) {
      if (equipment instanceof WeaponEquipment && skipWeapon(entity, mount, equipment)) continue;
      if (equipment instanceof MiscEquipment && skipMisc(entity, mount, equipment)) continue;
      addPhysicalEquipment(components, entity, mount, equipment);
    } else if (equipment instanceof WeaponEquipment) {
      if (skipWeapon(entity, mount, equipment)) continue;
      addWeapon(components, entity, mount, equipment);
    } else if (equipment instanceof MiscEquipment) {
      if (skipMisc(entity, mount, equipment)) continue;
      addMisc(components, entity, mount, equipment);
    }
  }
}

function skipWeapon(entity: BaseEntity, mount: EntityMountedEquipment, equipment: WeaponEquipment): boolean {
  if (equipment.isInternalRepresentation) return true;
  if (entity instanceof InfantryEntity && mount.location === 'Infantry') return true;
  return skipUnallocatedBattleArmorEquipment(entity, mount);
}

function skipMisc(entity: BaseEntity, mount: EntityMountedEquipment, equipment: MiscEquipment): boolean {
  if (entity instanceof MekEntity && entity.chassisConfig === 'QuadVee' && isTracksEquipment(equipment)) return true;
  return skipUnallocatedBattleArmorEquipment(entity, mount);
}

function skipUnallocatedBattleArmorEquipment(entity: BaseEntity, mount: EntityMountedEquipment): boolean {
  if (!(entity instanceof BattleArmorEntity) || mount.isDWP) return false;
  const slots = mount.getNumCriticalSlots(entity) ?? 0;
  return slots > 0 && !mount.baMountLocation;
}

function addConventionalInfantryWeapons(
  components: Map<string, ExportComponent>, entity: BaseEntity,
): void {
  if (!(entity instanceof InfantryEntity)) return;
  const primary = entity.primaryWeapon();
  const secondary = entity.secondaryWeapon();
  const squads = entity.squadCount();
  const secondaryPerSquad = entity.secondaryCount();

  if (primary) addSyntheticInfantryWeapon(
    components, '1st', primary,
    (entity.squadSize() - secondaryPerSquad) * squads,
    Math.min(0.6, primary.infantry.damage),
  );
  if (secondary) addSyntheticInfantryWeapon(
    components, '2nd', secondary, secondaryPerSquad * squads, secondary.infantry.damage,
  );
}

function addSyntheticInfantryWeapon(
  components: Map<string, ExportComponent>, key: string, equipment: WeaponEquipment,
  quantity: number, damage: number,
): void {
  components.set(key, {
    ...baseComponent(equipment, quantity, 0, 'Troop', weaponCategory(equipment), ''),
    r: String(equipment.infantry?.range ?? 0), m: '0',
    d: formatDecimal(damage), md: formatDecimal(damage),
  });
  delete components.get(key)?.c;
}

/** Exports the entity-selected internal structure once, independently of critical-slot mounts. */
function addSyntheticStructure(components: Map<string, ExportComponent>, entity: BaseEntity): void {
  const structures = entity.structureByLocation();
  if (structures.size === 0) return;

  const mounted = entity.uniformStructureMaterial();
  if (!mounted) return;

  const structure = mounted.structure;
  const id = entity.techBase() === 'Clan'
    ? structure.id.replace(/^IS /, 'Clan ')
    : structure.id.replace(/^Clan /, 'IS ');

  components.set(`${structure.id}__structure`, {
    ...baseComponent(structure, 1, -1, undefined, 'S', criticals(structure, entity)),
    id,
    n: withMaterialSuffix(structure.shortName, 'Structure'),
  });
}

/** Exports uniform armor once, retaining Patchwork as a configuration marker. */
function addSyntheticArmor(components: Map<string, ExportComponent>, entity: BaseEntity): void {
  const armorByLocation = entity.armorByLocation();
  if (armorByLocation.size === 0) return;

  if (entity.hasPatchworkArmor()) {
    const patchwork = new ArmorEquipment({
      id: 'Patchwork', name: 'Patchwork', shortName: 'Patchwork', type: 'armor',
      armor: { type: 'PATCHWORK' },
    });
    components.set(`${patchwork.id}__patchwork`, {
      ...baseComponent(patchwork, 1, -1, undefined, 'S', criticals(patchwork, entity)),
      n: withMaterialSuffix(patchwork.shortName, 'Armor'),
    });
    return;
  }

  const armor = entity.uniformArmor()?.armor;
  if (!armor) return;
  components.set(`${armor.id}__armor`, {
    ...baseComponent(armor, 1, -1, undefined, 'S', criticals(armor, entity)),
    n: withMaterialSuffix(armor.shortName, 'Armor'),
  });
}

function addMekSystems(components: Map<string, ExportComponent>, entity: BaseEntity): void {
  if (!(entity instanceof MekEntity)) return;

  const cockpit = entity.mountedCockpit();
  const cockpitLocation = cockpit.hasTorsoSlots ? 'CT' : 'HD';
  const cockpitCriticals = cockpit.hasTorsoSlots
    ? 1
    : cockpit.headLayout.filter(system => system === 'Cockpit').length;
  addMekSystem(
    components, entity, 'cockpit', withSystemSuffix(cockpit.fullName, 'Cockpit'),
    cockpitLocation, cockpitCriticals,
  );

  if (entity.gyroType() !== 'None') {
    const gyro = entity.mountedGyro();
    addMekSystem(
      components, entity, 'gyro', withSystemSuffix(gyro.fullName, 'Gyro'),
      'CT', gyro.criticalSlots,
    );
  }

  if (entity instanceof MekWithArmsEntity) {
    const lowerArms = entity.hasLowerArmActuator();
    const hands = entity.hasHandActuator();
    if (lowerArms.left) addActuator(components, entity, 'LA', 'lower-arm', 'Lower Arm Actuator');
    if (hands.left) addActuator(components, entity, 'LA', 'hand', 'Hand Actuator');
    if (lowerArms.right) addActuator(components, entity, 'RA', 'lower-arm', 'Lower Arm Actuator');
    if (hands.right) addActuator(components, entity, 'RA', 'hand', 'Hand Actuator');
  }
}

function withSystemSuffix(name: string, suffix: 'Cockpit' | 'Gyro'): string {
  return name.endsWith(suffix) ? name : `${name} ${suffix}`;
}

function addMekSystem(
  components: Map<string, ExportComponent>,
  entity: MekEntity,
  id: 'cockpit' | 'gyro',
  name: string,
  location: 'HD' | 'CT',
  criticalSlots: number,
): void {
  components.set(id, {
    id, n: name, t: 'S', q: 1, q2: 0,
    p: locationId(entity, location), l: location, c: String(criticalSlots), os: 0,
  });
}

function addActuator(
  components: Map<string, ExportComponent>,
  entity: BaseEntity,
  location: 'LA' | 'RA',
  id: 'lower-arm' | 'hand',
  name: 'Lower Arm Actuator' | 'Hand Actuator',
): void {
  components.set(`${location}:${id}`, {
    id, n: name, t: 'S', q: 1, q2: 0,
    p: locationId(entity, location), l: location, c: '1', os: 0,
  });
}

function addImplicitSmallCraftEcm(
  components: Map<string, ExportComponent>,
  entity: BaseEntity,
): void {
  if (entity.entityType !== 'SmallCraft') return;
  const ecm = entity.implicitSystemEquipment().find(equipment =>
    equipment instanceof MiscEquipment && isSingleHexEcmEquipment(equipment));
  if (!(ecm instanceof MiscEquipment)) return;
  components.set(`${ecm.id}_NOS_C`, baseComponent(ecm, 1, 0, 'NOS', 'C', criticals(ecm, entity)));
}

function withMaterialSuffix(name: string, suffix: 'Armor' | 'Structure'): string {
  return name.endsWith(suffix) ? name : `${name} ${suffix}`;
}

function addWeapon(
  components: Map<string, ExportComponent>, entity: BaseEntity,
  mount: EntityMountedEquipment, equipment: WeaponEquipment,
): void {
  const location = mount.isSSWM && entity instanceof BattleArmorEntity
    ? { id: 10, name: 'SSW' }
    : componentLocation(entity, mount);
  const key = `${equipment.id}_${location.name}${mount.rearMounted ? '_rear' : ''}`;
  const existing = components.get(key);
  if (existing) { existing.q++; return; }

  components.set(key, weaponComponent(
    entity, mount as EntityMountedWeapon, 1, location.id, location.name,
    criticals(equipment, entity, mount),
  ));
  if (entity instanceof InfantryEntity && mount.location === 'Field Guns') {
    components.get(key)!.cw = Math.max(2, Math.ceil(mount.getTonnage(entity) ?? 0));
  }
}

function weaponComponent(
  entity: BaseEntity, mount: EntityMountedWeapon, quantity: number,
  position: number, location: string | undefined, criticalSlots: string,
): ExportComponent {
  const equipment = mount.equipment;
  const aero = entity instanceof AeroEntity;
  const damage = entity.resolveMountedWeaponDamage(mount);
  const variableDamage = equipment.weapon.damage === 'variable';
  const entry = baseComponent(
    equipment, quantity, position, location, weaponCategory(equipment), criticalSlots,
  );
  if (mount.rearMounted) entry.rear = true;
  entry.r = aero ? aeroRange(equipment) : equipment.isInfantryWeapon()
    ? String(equipment.infantry.range) : equipment.ranges.slice(0, 3).join('/');
  entry.m = aero ? '-' : String(equipment.minimumRange);
  entry.d = aero ? aeroDamage(equipment)
    : variableDamage ? '0'
    : equipment.weapon.damage === 'special' || equipment.ammoType === 'MEK_MORTAR' ? 'Special'
      : equipment.ammoType === 'BA_TUBE' ? 'Cluster'
        : equipment.ammoType === 'IATM' && equipment.weapon.damage === 'cluster' ? '1/Msl'
        : equipment.isInfantryWeapon() && damage.values.length === 1
          ? formatDecimal(damage.values[0] ?? 0)
          : formatWeaponDamage(damage, { showZero: true, shotSuffix: '/Shot' });
  entry.md = formatDecimal(aero ? maximumAeroDamage(equipment)
    : variableDamage ? 0
      : maximumWeaponDamage(entity, equipment, damage.maximum));
  entry.os = equipment.oneShotCount ?? 0;
  return entry;
}

function maximumWeaponDamage(
  entity: BaseEntity,
  weapon: WeaponEquipment,
  resolvedMaximum: number,
): number {
  if (weapon.weapon.damage === 'special' || weapon.hasWeaponTrait('machine-gun-array')) return 0;
  if (weapon.ammoType === 'MEK_MORTAR') return weapon.rackSize;
  if (weapon.weapon.damage !== 'cluster') return resolvedMaximum;
  if (weapon.ammoType === 'MML') return weapon.rackSize * 2;
  if (weapon.ammoType === 'ATM' || weapon.ammoType === 'IATM') {
    const damagePerMissile = entity.equipment().reduce((maximum, mount) => {
      const ammo = mount.equipment;
      if (!(ammo instanceof AmmoEquipment)
        || ammo.ammoType !== weapon.ammoType
        || ammo.rackSize !== weapon.rackSize
        || isBattleArmorAmmo(ammo) !== weapon.hasWeaponTrait('battle-armor-weapon')) return maximum;
      return Math.max(maximum, ammo.damagePerShot);
    }, 2);
    return weapon.rackSize * damagePerMissile;
  }
  return resolvedMaximum;
}

function addAmmo(
  components: Map<string, ExportComponent>, entity: BaseEntity,
  mount: EntityMountedEquipment, equipment: AmmoEquipment,
): void {
  const location = componentLocation(entity, mount);
  const key = `${equipment.id}_${location.name}`;
  const shots = mount.getAmmoShots() ?? 0;
  const existing = components.get(key);
  if (existing) {
    existing.q++;
    existing.q2 = (existing.q2 ?? 0) + shots;
    return;
  }
  const entry = baseComponent(equipment, 1, location.id, location.name, 'X', criticals(equipment, entity, mount));
  entry.n = `${equipment.shortName.replace('Ammo', '').trim()} Ammo`;
  entry.q2 = shots;
  components.set(key, entry);
}

function addMisc(
  components: Map<string, ExportComponent>, entity: BaseEntity,
  mount: EntityMountedEquipment, equipment: MiscEquipment,
): void {
  const structural = isStructuralMisc(entity, equipment);
  const type: ComponentType = structural ? 'S' : 'C';

  if (equipment.isSpreadable && mount.placements?.length) {
    if (isFixedLocationSpreadEquipment(equipment)) {
      const location = spreadComponentLocation(entity, mount);
      addMiscAtLocation(
        components, entity, mount, equipment, type, location.name, 1, location.position,
      );
      return;
    }
    const countByLocation = new Map<string, number>();
    for (const placement of mount.placements) {
      countByLocation.set(placement.location, (countByLocation.get(placement.location) ?? 0) + 1);
    }
    for (const [location, count] of countByLocation) {
      addMiscAtLocation(components, entity, mount, equipment, type, location, count);
    }
    return;
  }

  const location = componentLocation(entity, mount);
  addMiscAtLocation(components, entity, mount, equipment, type, location.name, 1, location.id);
}

function addPhysicalEquipment(
  components: Map<string, ExportComponent>, entity: BaseEntity,
  mount: EntityMountedEquipment, equipment: Equipment,
): void {
  if (equipment.isSpreadable && mount.placements?.length) {
    const location = spreadComponentLocation(entity, mount);
    addPhysicalEquipmentAtLocation(
      components, entity, mount, equipment, location.name, 1, location.position,
    );
    return;
  }

  const location = componentLocation(entity, mount);
  addPhysicalEquipmentAtLocation(components, entity, mount, equipment, location.name, 1, location.id);
}

function addPhysicalEquipmentAtLocation(
  components: Map<string, ExportComponent>, entity: BaseEntity, mount: EntityMountedEquipment,
  equipment: Equipment, location: string, quantity: number, position = locationId(entity, location),
): void {
  const displayLocation = locationAbbreviation(entity, location);
  const key = `${equipment.id}_${displayLocation}_P`;
  const existing = components.get(key);
  if (existing) { existing.q += quantity; return; }

  components.set(key, {
    ...baseComponent(
      equipment, quantity, position, displayLocation, 'P', criticals(equipment, entity, mount),
    ),
    ...(isShieldEquipment(equipment) ? {} : physicalDamage(entity, mount, equipment)),
  });
}

function addMiscAtLocation(
  components: Map<string, ExportComponent>, entity: BaseEntity, mount: EntityMountedEquipment,
  equipment: MiscEquipment, type: ComponentType, location: string, quantity: number,
  position = locationId(entity, location),
): void {
  const displayLocation = locationAbbreviation(entity, location);
  const key = `${equipment.id}_${displayLocation}_${type}`;
  const existing = components.get(key);
  if (existing) { existing.q += quantity; return; }

  const entry = baseComponent(
    equipment, quantity, position, displayLocation, type, criticals(equipment, entity, mount),
  );
  components.set(key, entry);
}

function usesWeaponBays(entity: BaseEntity): boolean {
  return entity.entityType === 'DropShip' || entity.entityType === 'JumpShip'
    || entity.entityType === 'WarShip' || entity.entityType === 'SpaceStation';
}

/** Reconstruct Java WeaponMounted bays from BLK's ordered `(B)` boundary markers. */
function addWeaponBays(components: Map<string, ExportComponent>, entity: BaseEntity): void {
  for (const equipmentBay of entity.equipmentBays()) {
    if (equipmentBay.kind !== 'weapon-bay') continue;
    const members = equipmentBay.weapons;
    const first = members[0];
    if (!first || !(first.equipment instanceof WeaponEquipment)) continue;
    const bayId = weaponBayEquipmentId(first.equipment);
    const bayEquipment = entity.getEquipmentRegistry().findForTechBase(bayId, entity.techBase());
    const location = componentLocation(entity, first);
    const bay = baseComponent(
      bayEquipment ?? first.equipment, 1, location.id, location.name,
      bayEquipment instanceof WeaponEquipment ? weaponCategory(bayEquipment) : bayCategory(bayId), '',
    );
    bay.id = bayId;
    bay.n = bayEquipment?.shortName ?? bayId;
    delete bay.c;
    bay.bay = [];
    const nested = new Map<string, ExportComponent>();
    for (const member of members) {
      const equipment = member.equipment as WeaponEquipment;
      const key = `${equipment.id}_${member.rearMounted}`;
      const existing = nested.get(key);
      if (existing) existing.q++;
      else nested.set(key, weaponComponent(entity, member as EntityMountedWeapon, 1, 0, undefined,
        criticals(equipment, entity, member)));
    }
    bay.bay = [...nested.values()];
    components.set(`bay:${first.mountId}`, bay);
  }
}

function baseComponent(
  equipment: Equipment, quantity: number, position: number, location: string | undefined,
  type: ComponentType, criticalSlots: string,
): ExportComponent {
  return {
    id: equipment.id, q: quantity, q2: 0, n: equipment.shortName, t: type, p: position,
    ...(location ? { l: location } : {}), ...(criticalSlots ? { c: criticalSlots } : {}), os: 0,
  };
}

function componentLocation(entity: BaseEntity, mount: EntityMountedEquipment): { id: number; name: string } {
  const locations = primaryFirstLocations(mount);
  return {
    id: locationId(entity, mount.location),
    name: locations.map(location => locationAbbreviation(entity, location)).filter(Boolean).join('/'),
  };
}

function spreadComponentLocation(
  entity: BaseEntity,
  mount: EntityMountedEquipment,
): { position: number; name: string } {
  const locations = [...primaryFirstLocations(mount)]
    .sort((left, right) => locationId(entity, left) - locationId(entity, right));
  return {
    position: Math.max(locationId(entity, mount.location), ...locations.map(location => locationId(entity, location))),
    name: joinSpreadLocations(entity, locations),
  };
}

function joinSpreadLocations(entity: BaseEntity, locations: readonly string[]): string {
  const labels = locations.map(location => locationAbbreviation(entity, location)).filter(Boolean);
  if (labels.length <= 2) return labels.join('/');
  if (labels.every(location => location.endsWith('T'))) {
    return `${labels.map(location => location.slice(0, -1)).join('/')}T`;
  }
  if (entity instanceof MekEntity) {
    const legs = entity.chassisConfig === 'Tripod' ? ['RL', 'LL', 'CL']
      : entity.chassisConfig === 'Quad' || entity.chassisConfig === 'QuadVee'
        ? ['FRL', 'FLL', 'RRL', 'RLL'] : [];
    if (labels.length === legs.length && labels.every(location => legs.includes(location))) return 'Legs';
  }
  return '*';
}

function primaryFirstLocations(mount: EntityMountedEquipment): readonly string[] {
  const occupied = mount.getOccupiedLocations();
  return mount.allocation.kind !== 'location' || occupied[0] === mount.location
    ? occupied
    : [mount.location, ...occupied.filter(location => location !== mount.location)];
}

function locationId(entity: BaseEntity, location: string): number {
  if (entity instanceof BattleArmorEntity) {
    const trooper = /^Trooper (\d+)$/.exec(location);
    if (trooper) return Number(trooper[1]);
  }
  return entity.componentLocationOrder().indexOf(location);
}

function addIntegralHeatSinks(components: Map<string, ExportComponent>, entity: BaseEntity): void {
  if (!(entity instanceof MekEntity)) return;
  const heatSinks = entity.integralHeatSinks();
  if (!heatSinks) return;
  const entry = baseComponent(
    heatSinks.equipment, heatSinks.count, -1, undefined, 'C', criticals(heatSinks.equipment, entity),
  );
  components.set(`${heatSinks.equipment.shortName}__C`, entry);
}

function addImplicitClanCase(
  components: Map<string, ExportComponent>,
  entity: BaseEntity,
): void {
  if (!(entity instanceof MekEntity)) return;
  const clanCase = entity.getEquipmentRegistry().findForTechBase('CLCASE', 'Clan');
  if (!(clanCase instanceof MiscEquipment)) return;

  for (const location of entity.automaticClanCaseLocations()) {
    const label = locationAbbreviation(entity, location);
    components.set(`implicit:CLCASE:${label}`, baseComponent(
      clanCase, 1, locationId(entity, location), label, 'C', criticals(clanCase, entity),
    ));
  }
}

function locationAbbreviation(entity: BaseEntity, location: string): string {
  if (entity instanceof BattleArmorEntity && location === 'Squad' && entity.techBase() === 'Clan') {
    return 'Point';
  }
  return entity.componentLocationLabel(location);
}

function criticals(
  equipment: Equipment, entity: BaseEntity, mount?: EntityMountedEquipment,
): string {
  if (!equipment.hasFixedCriticalSlots() && (entity instanceof MekEntity || entity.isSupportVehicle())) return 'V';
  if (entity.entityType === 'ProtoMek') return String(protoMekRequiresSlot(equipment) ? 1 : 0);
  if (entity instanceof MekEntity) return String(equipment.critSlots);
  if (entity.isSupportVehicle()) {
    if (equipment instanceof ArmorEquipment && equipment.armorType === 'SV_BAR_10') {
      const armorTechRating = entity.uniformArmor()?.techRating;
      if (armorTechRating === 'E') return '2';
      if (armorTechRating === 'F') return '1';
    }
    return String(equipment.svSlots >= 0 ? equipment.svSlots : equipment.critSlots);
  }
  if (entity instanceof VehicleEntity) {
    return String(equipment instanceof MiscEquipment && isBlueShieldEquipment(equipment)
      ? entity.locationOrder.length
      : equipment.tankSlots);
  }
  return String(equipment.getNumCriticalSlots(entity, mount?.size ?? 1) ?? 0);
}

function protoMekRequiresSlot(equipment: Equipment): boolean {
  if (equipment instanceof AmmoEquipment) return false;
  return !(equipment instanceof MiscEquipment)
    || (!isMascEquipment(equipment)
      && !isUmuEquipment(equipment)
      && !isJumpJetEquipment(equipment)
      && !isElectronicInterfaceEquipment(equipment));
}

function weaponCategory(equipment: WeaponEquipment): ComponentType {
  switch (equipment.getWeaponCategory()) {
    case 'energy': return 'E';
    case 'missile': return 'M';
    case 'ballistic': return 'B';
    case 'artillery': return 'A';
    default: return 'O';
  }
}

function bayCategory(id: string): ComponentType {
  if (/laser|ppc/i.test(id)) return 'E';
  if (/missile|lrm|srm|mrm|mml|atm|rocket|thunderbolt/i.test(id)) return 'M';
  return 'O';
}

function isStructuralMisc(entity: BaseEntity, equipment: MiscEquipment): boolean {
  if (equipment.isArmorKit) return true;
  if (!(entity instanceof BattleArmorEntity)) return false;
  return isApolloEquipment(equipment)
    || isDetachableWeaponPackEquipment(equipment)
    || isModularWeaponMountEquipment(equipment)
    || isBattleArmorStructuralUtility(equipment)
    || isArtemisEquipment(equipment)
    || (isAntiPersonnelMountEquipment(equipment)
      && !isBattleArmorManipulatorEquipment(equipment));
}

function physicalDamage(
  entity: BaseEntity,
  mount: EntityMountedEquipment,
  equipment: Equipment,
): Pick<ExportComponent, 'd' | 'md'> {
  let damage = mount.getPhysicalWeaponDamage()?.value ?? 0;
  if (isBackhoeEquipment(equipment)
    && entity.equipment().some(candidate => tripleStrengthMyomerKind(candidate.equipment) === 'industrial')) {
    damage *= 2;
  }
  return { d: String(damage), md: String(damage) };
}

function aeroRange(equipment: WeaponEquipment): string {
  return ({ short: 'Short', medium: 'Medium', long: 'Long', extreme: 'Extreme' })[equipment.maxRangeBracket];
}

function aeroDamage(equipment: WeaponEquipment): string {
  const values = activeAeroValues(equipment);
  return values.every(value => value === values[0]) ? String(values[0] ?? 0) : values.join('/');
}

function maximumAeroDamage(equipment: WeaponEquipment): number {
  return Math.max(0, ...activeAeroValues(equipment));
}

function isFixedLocationSpreadEquipment(equipment: Equipment): boolean {
  if (isStealthEquipment(equipment) && hasMekOrTankApplicability(equipment)) return true;
  return isBlueShieldEquipment(equipment)
    || isNullSignatureEquipment(equipment)
    || isVoidSignatureEquipment(equipment)
    || isChameleonShieldEquipment(equipment)
    || isPartialWingEquipment(equipment)
    || isSuperCooledMyomerEquipment(equipment)
    || isRamPlateEquipment(equipment)
    || isTalonEquipment(equipment)
    || isAnyJumpBoosterEquipment(equipment)
    || isEnvironmentalSealingEquipment(equipment)
    || isTracksEquipment(equipment)
    || isChainDrapeEquipment(equipment)
    || isBattleArmorManipulatorEquipment(equipment)
    || isMastMountEquipment(equipment);
}

function activeAeroValues(equipment: WeaponEquipment): number[] {
  const count = ({ short: 1, medium: 2, long: 3, extreme: 4 })[equipment.maxRangeBracket];
  return equipment.weapon.av.slice(0, count).map(Math.round);
}

function formatDecimal(value: number): string {
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}
