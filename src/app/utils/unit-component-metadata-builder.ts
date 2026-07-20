import {
  AmmoEquipment,
  ArmorEquipment,
  Equipment,
  MiscEquipment,
  WeaponDamageProfile,
  WeaponEquipment,
} from '../models/equipment.model';
import { BaseEntity } from '../models/entity/base-entity';
import { AeroEntity } from '../models/entity/entities/aero/aero-entity';
import { BattleArmorEntity } from '../models/entity/entities/infantry/battle-armor-entity';
import { InfantryEntity } from '../models/entity/entities/infantry/infantry-entity';
import { MekEntity, MekWithArmsEntity } from '../models/entity/entities/mek/mek-entity';
import { EntityMountedEquipment } from '../models/entity/types/equipment';
import { weaponBayEquipmentId } from '../models/entity/utils/implicit-equipment';
import { UnitComponent } from '../models/units.model';

type ExportComponent = Omit<UnitComponent, 'l' | 'bay'> & {
  l?: string;
  bay?: ExportComponent[];
};
type ComponentType = ExportComponent['t'];

const LOCATION_DATA: Readonly<Partial<Record<BaseEntity['entityType'], readonly string[]>>> = {
  Mek: ['HD', 'CT', 'RT', 'LT', 'RA', 'LA', 'RL', 'LL', 'CL', 'FRL', 'FLL', 'RRL', 'RLL'],
  Tank: ['Body', 'Front', 'Right', 'Left', 'Rear', 'Turret', 'Front Turret', 'Rear Turret'],
  SupportTank: ['Body', 'Front', 'Right', 'Left', 'Rear', 'Turret', 'Front Turret', 'Rear Turret'],
  LargeSupportTank: ['Body', 'Front', 'Front Right', 'Front Left', 'Rear Right', 'Rear Left', 'Rear', 'Turret', 'Rear Turret', 'Front Turret'],
  Naval: ['Body', 'Front', 'Right', 'Left', 'Rear', 'Turret', 'Front Turret', 'Rear Turret'],
  SupportNaval: ['Body', 'Front', 'Right', 'Left', 'Rear', 'Turret', 'Front Turret', 'Rear Turret'],
  VTOL: ['Body', 'Front', 'Right', 'Left', 'Rear', 'Turret', 'Rotor'],
  SupportVTOL: ['Body', 'Front', 'Right', 'Left', 'Rear', 'Turret', 'Rotor'],
  Aero: ['Nose', 'Left Wing', 'Right Wing', 'Aft', 'Wings', 'Fuselage'],
  ConvFighter: ['Nose', 'Left Wing', 'Right Wing', 'Aft', 'Wings', 'Fuselage'],
  FixedWingSupport: ['Nose', 'Left Wing', 'Right Wing', 'Aft', 'Wings', 'Body'],
  SmallCraft: ['Nose', 'Left Side', 'Right Side', 'Aft', 'Hull'],
  DropShip: ['Nose', 'Left Side', 'Right Side', 'Aft', 'Hull'],
  JumpShip: ['Nose', 'FLS', 'FRS', 'Aft', 'ALS', 'ARS', 'Hull'],
  WarShip: ['Nose', 'FLS', 'FRS', 'Aft', 'ALS', 'ARS', 'Hull', 'Left Broadside', 'Right Broadside'],
  SpaceStation: ['Nose', 'FLS', 'FRS', 'Aft', 'ALS', 'ARS', 'Hull'],
  ProtoMek: ['Body', 'Head', 'Torso', 'Right Arm', 'Left Arm', 'Legs', 'Main Gun'],
  Infantry: ['Infantry', 'Field Guns'],
  BattleArmor: ['Squad'],
  HandheldWeapon: ['Gun'],
};

const LOCATION_ABBREVIATIONS: Readonly<Record<string, string>> = {
  Body: 'BD', Front: 'FR', Right: 'RS', Left: 'LS', Rear: 'RR', Turret: 'TU',
  'Front Turret': 'FT', 'Rear Turret': 'RT', Rotor: 'RO',
  'Front Right': 'FRR', 'Front Left': 'FRL', 'Rear Right': 'RRR', 'Rear Left': 'RRL',
  Nose: 'NOS', 'Left Wing': 'LW', 'Right Wing': 'RW', Aft: 'AFT', Wings: 'WNG',
  Fuselage: 'FSLG', Hull: 'HULL', 'Left Side': 'LS', 'Right Side': 'RS',
  FLS: 'FLS', FRS: 'FRS', ALS: 'ALS', ARS: 'ARS',
  'Left Broadside': 'LBS', 'Right Broadside': 'RBS',
  Head: 'HD', Torso: 'T', 'Right Arm': 'RA', 'Left Arm': 'LA', Legs: 'L',
  'Main Gun': 'MG', Infantry: 'TPRS', 'Field Guns': 'FGUN', Gun: 'GUN', Squad: 'Squad',
};

/** Mirrors SVGMassPrinter.Components while using only canonical parser state. */
export function buildUnitComponentMetadata(entity: BaseEntity): UnitComponent[] | undefined {
  const components = new Map<string, ExportComponent>();
  addConventionalInfantryWeapons(components, entity);
  addMekSystems(components, entity);

  if (usesWeaponBays(entity)) addWeaponBays(components, entity);
  else addOrdinaryEquipment(components, entity);

  addIntegralHeatSinks(components, entity);
  return [...components.values()] as UnitComponent[];
}

function addOrdinaryEquipment(components: Map<string, ExportComponent>, entity: BaseEntity): void {
  for (const mount of entity.equipment()) {
    if (mount.allocation.kind === 'engine' || !mount.equipment) continue;
    const equipment = mount.equipment;

    if (equipment instanceof ArmorEquipment) {
      addStructuralMaterialMount(components, entity, mount, equipment);
    } else if (equipment instanceof AmmoEquipment) {
      addAmmo(components, entity, mount, equipment);
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
  if (entity instanceof MekEntity && entity.chassisConfig === 'QuadVee' && equipment.hasFlag('F_TRACKS')) return true;
  return skipUnallocatedBattleArmorEquipment(entity, mount);
}

function skipUnallocatedBattleArmorEquipment(entity: BaseEntity, mount: EntityMountedEquipment): boolean {
  if (!(entity instanceof BattleArmorEntity) || mount.isDWP) return false;
  const slots = mount.equipment?.getNumCriticalSlots(entity, mount.size ?? 1) ?? 0;
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
    d: String(damage), md: String(damage),
  });
  delete components.get(key)?.c;
}

function addMekSystems(components: Map<string, ExportComponent>, entity: BaseEntity): void {
  if (!(entity instanceof MekEntity)) return;

  const structures = new Map([...entity.structureByLocation().values()]
    .map(mounted => [mounted.structure.id, mounted.structure]));
  const armors = new Map([...entity.armorByLocation().values()]
    .map(mounted => [mounted.armor.id, mounted.armor]));
  for (const equipment of [...structures.values(), ...armors.values()]) {
    if (entity.equipment().some(mount => mount.equipmentId === equipment.id && mount.placements?.length)) continue;
    const entry = baseComponent(equipment, 1, -1, undefined, 'S', criticals(equipment, entity));
    components.set(`${equipment.id}__S`, entry);
  }

  if (entity instanceof MekWithArmsEntity) {
    const hands = entity.hasHandActuator();
    if (hands.left) addHand(components, entity, 'LA');
    if (hands.right) addHand(components, entity, 'RA');
  }
}

function addHand(components: Map<string, ExportComponent>, entity: BaseEntity, location: 'LA' | 'RA'): void {
  components.set(`${location}:hand`, {
    id: 'hand', n: 'Hand', t: 'S', q: 1, q2: 0,
    p: locationId(entity, location), l: location, c: '1', os: 0,
  });
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
    entity, equipment, 1, location.id, location.name, mount.rearMounted,
    criticals(equipment, entity, mount),
  ));
  if (entity instanceof InfantryEntity && mount.location === 'Field Guns') {
    components.get(key)!.cw = Math.max(2, Math.ceil(mount.getTonnage(entity) ?? 0));
  }
}

function weaponComponent(
  entity: BaseEntity, equipment: WeaponEquipment, quantity: number,
  position: number, location: string | undefined, rear: boolean, criticalSlots: string,
): ExportComponent {
  const aero = entity instanceof AeroEntity;
  const entry = baseComponent(
    equipment, quantity, position, location, weaponCategory(equipment), criticalSlots,
  );
  if (rear) entry.rear = true;
  entry.r = aero ? aeroRange(equipment) : equipment.isInfantryWeapon()
    ? String(equipment.infantry.range) : equipment.ranges.slice(0, 3).join('/');
  entry.m = aero ? '-' : String(equipment.minimumRange);
  entry.d = aero ? aeroDamage(equipment) : formatWeaponDamage(equipment.getDamageProfile());
  entry.md = formatDecimal(aero ? maximumAeroDamage(equipment) : equipment.getDamageProfile().maximum);
  entry.os = equipment.oneShotCount ?? 0;
  return entry;
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
  const type: ComponentType = isPhysicalEquipment(equipment) ? 'P' : structural ? 'S' : 'C';

  if (equipment.isSpreadable && mount.placements?.length) {
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
  if (type === 'P') Object.assign(entry, physicalDamage(entity, equipment));
  components.set(key, entry);
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
      else nested.set(key, weaponComponent(entity, equipment, 1, 0, undefined, member.rearMounted,
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
    name: locations.map(location => locationAbbreviation(entity, location)).join('/'),
  };
}

function primaryFirstLocations(mount: EntityMountedEquipment): readonly string[] {
  const occupied = mount.getOccupiedLocations();
  return mount.allocation.kind !== 'location' || occupied[0] === mount.location
    ? occupied
    : [mount.location, ...occupied.filter(location => location !== mount.location)];
}

function locationId(entity: BaseEntity, location: string): number {
  const locations = entity instanceof MekEntity && entity.chassisConfig === 'Quad'
    ? ['HD', 'CT', 'RT', 'LT', 'FRL', 'FLL', 'RRL', 'RLL']
    : entity instanceof MekEntity && entity.chassisConfig === 'Tripod'
      ? ['HD', 'CT', 'RT', 'LT', 'RA', 'LA', 'RL', 'LL', 'CL']
      : LOCATION_DATA[entity.entityType] ?? entity.locationOrder;
  return locations.indexOf(location);
}

function locationAbbreviation(entity: BaseEntity, location: string): string {
  if (entity.entityType === 'FixedWingSupport' && location === 'Body') return 'BOD';
  return LOCATION_ABBREVIATIONS[location] ?? location;
}

function criticals(
  equipment: Equipment, entity: BaseEntity, mount?: EntityMountedEquipment,
): string {
  if (equipment.critSlots === 'variable' && (entity instanceof MekEntity || entity.isSupportVehicle())) return 'V';
  const slots = equipment.getNumCriticalSlots(entity, mount?.size ?? 1) ?? 0;
  if (entity.entityType === 'ProtoMek') return String(slots > 0 ? 1 : 0);
  return String(slots);
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
  if (equipment.isArmorKit || equipment.hasFlag('F_STRUCTURE')) return true;
  if (!(entity instanceof BattleArmorEntity)) return false;
  return equipment.hasAnyFlag([
    'F_FIRE_RESISTANT', 'F_ARTEMIS', 'F_ARTEMIS_V', 'F_APOLLO', 'F_HARJEL', 'F_MASS',
    'F_DETACHABLE_WEAPON_PACK', 'F_MODULAR_WEAPON_MOUNT',
  ]) || (equipment.hasFlag('F_AP_MOUNT') && !equipment.hasFlag('F_BA_MANIPULATOR'));
}

function isPhysicalEquipment(equipment: MiscEquipment): boolean {
  return equipment.hasAnyFlag(['F_CLUB', 'F_HAND_WEAPON', 'F_TALON']);
}

function physicalDamage(entity: BaseEntity, equipment: MiscEquipment): Pick<ExportComponent, 'd' | 'md'> {
  const weight = entity.tonnage();
  let damage: number;
  if (equipment.hasFlag('F_TALON')) damage = Math.round(Math.floor(weight / 5) * 1.5);
  else if (equipment.hasAllFlags(['F_HAND_WEAPON', 'S_CLAW'])) damage = Math.ceil(weight / 7);
  else if (equipment.hasFlag('S_SWORD')) damage = Math.ceil(weight / 10) + 1;
  else if (equipment.hasFlag('S_RETRACTABLE_BLADE')) damage = Math.ceil(weight / 10);
  else if (equipment.hasFlag('S_MACE')) damage = Math.ceil(weight / 4);
  else if (equipment.hasFlag('S_PILE_DRIVER')) damage = 10;
  else if (equipment.hasFlag('S_FLAIL')) damage = 9;
  else if (equipment.hasFlag('S_DUAL_SAW')) damage = 7;
  else if (equipment.hasFlag('S_CHAINSAW')) damage = 5;
  else if (equipment.hasFlag('S_BACKHOE')) damage = 6;
  else if (equipment.hasFlag('S_MINING_DRILL')) damage = 4;
  else if (equipment.hasFlag('S_WRECKING_BALL')) damage = 8;
  else if (equipment.hasFlag('S_VIBRO_LARGE')) damage = 14;
  else if (equipment.hasFlag('S_VIBRO_MEDIUM')) damage = 10;
  else if (equipment.hasFlag('S_VIBRO_SMALL')) damage = 7;
  else if (equipment.hasFlag('S_CHAIN_WHIP')) damage = 3;
  else if (equipment.hasFlag('S_COMBINE')) damage = 3;
  else if (equipment.hasAnyFlag(['S_ROCK_CUTTER', 'S_SPOT_WELDER'])) damage = 5;
  else damage = Math.floor(weight / 5);

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

function activeAeroValues(equipment: WeaponEquipment): number[] {
  const count = ({ short: 1, medium: 2, long: 3, extreme: 4 })[equipment.maxRangeBracket];
  return equipment.weapon.av.slice(0, count).map(Math.round);
}

function formatWeaponDamage(profile: WeaponDamageProfile): string {
  switch (profile.kind) {
    case 'fixed': return `${profile.damage}${profile.perShot ? '/Shot' : ''}`;
    case 'missile-cluster': return `${profile.damagePerMissile}/msl`;
    case 'cluster': return String(profile.damage);
    case 'artillery': return `${profile.damage}A`;
    case 'range': return profile.damage.join('/');
    case 'variable': return '0';
    case 'special': return 'Special';
  }
}

function formatDecimal(value: number): string {
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

function addStructuralMaterialMount(
  components: Map<string, ExportComponent>, entity: BaseEntity,
  mount: EntityMountedEquipment, equipment: ArmorEquipment,
): void {
  const countByLocation = new Map<string, number>();
  for (const placement of mount.placements ?? []) {
    countByLocation.set(placement.location, (countByLocation.get(placement.location) ?? 0) + 1);
  }
  if (countByLocation.size === 0) {
    countByLocation.set(mount.location, 1);
  }
  for (const [location, quantity] of countByLocation) {
    const displayLocation = locationAbbreviation(entity, location);
    const key = `${equipment.id}_${displayLocation}_S`;
    const existing = components.get(key);
    if (existing) existing.q += quantity;
    else components.set(key, baseComponent(
      equipment, quantity, locationId(entity, location), displayLocation, 'S',
      criticals(equipment, entity, mount),
    ));
  }
}