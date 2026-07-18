import {
  AmmoEquipment,
  Equipment,
  MiscEquipment,
  WeaponDamageProfile,
  WeaponEquipment,
} from '../models/equipment.model';
import { BaseEntity } from '../models/entity/base-entity';
import { MekEntity, MekWithArmsEntity } from '../models/entity/entities/mek/mek-entity';
import { EntityMountedEquipment } from '../models/entity/types/equipment';
import { UnitComponent } from '../models/units.model';

type ExportComponent = Omit<UnitComponent, 'l'> & { l?: string };

const MEK_LOCATION_IDS: Readonly<Record<string, number>> = {
  HD: 0,
  CT: 1,
  RT: 2,
  LT: 3,
  RA: 4,
  LA: 5,
  RL: 6,
  LL: 7,
  CL: 8,
};

export function buildUnitComponentMetadata(entity: BaseEntity): UnitComponent[] | undefined {
  if (!(entity instanceof MekEntity)) return undefined;

  const components = new Map<string, ExportComponent>();
  addMekSystems(components, entity);

  for (const mount of entity.equipment()) {
    if (mount.allocation.kind === 'engine') continue;
    const equipment = mount.equipment;
    if (!equipment) continue;

    if (equipment instanceof WeaponEquipment) {
      addWeapon(components, entity, mount, equipment);
    } else if (equipment instanceof AmmoEquipment) {
      addAmmo(components, entity, mount, equipment);
    } else if (equipment instanceof MiscEquipment) {
      addMisc(components, entity, mount, equipment);
    }
  }

  addIntegralHeatSinks(components, entity);
  return [...components.values()] as UnitComponent[];
}

function addMekSystems(components: Map<string, ExportComponent>, entity: MekEntity): void {
  const structures = new Map<string, Equipment>();
  for (const mountedStructure of entity.structureByLocation().values()) {
    structures.set(mountedStructure.structure.id, mountedStructure.structure);
  }
  for (const structure of structures.values()) addSyntheticStructural(components, entity, structure);

  const armors = new Map<string, Equipment>();
  for (const mountedArmor of entity.armorByLocation().values()) {
    armors.set(mountedArmor.armor.id, mountedArmor.armor);
  }
  for (const armor of armors.values()) addSyntheticStructural(components, entity, armor);

  if (entity instanceof MekWithArmsEntity) {
    const hands = entity.hasHandActuator();
    if (hands.left) addHand(components, 'LA');
    if (hands.right) addHand(components, 'RA');
  }
}

function addSyntheticStructural(
  components: Map<string, ExportComponent>,
  entity: MekEntity,
  equipment: Equipment,
): void {
  const key = `${equipment.shortName}__S`;
  const existing = components.get(key);
  if (existing) {
    existing.q++;
    return;
  }

  components.set(key, baseComponent(
    equipment, 1, -1, undefined, 'S',
    criticals(equipment.critSlots === 'variable' ? 'variable' : equipment.getNumCriticalSlots(entity, 1)),
  ));
}

function addHand(components: Map<string, ExportComponent>, location: 'LA' | 'RA'): void {
  components.set(`${location}:hand`, {
    id: 'hand', n: 'Hand', t: 'S', q: 1, q2: 0,
    p: MEK_LOCATION_IDS[location], l: location, c: '1', os: 0,
  });
}

function addWeapon(
  components: Map<string, ExportComponent>,
  entity: MekEntity,
  mount: EntityMountedEquipment,
  equipment: WeaponEquipment,
): void {
  if (equipment.isInternalRepresentation) return;

  const location = mountLocations(mount);
  const key = `${equipment.shortName}_${location}${mount.rearMounted ? '_rear' : ''}`;
  const existing = components.get(key);
  if (existing) {
    existing.q++;
    return;
  }

  const entry = baseComponent(
    equipment, 1, locationId(mount.location), location,
    weaponCategory(mount.getWeaponCharacteristics(entity)?.category), criticals(mount.getCriticalSlotRequirement(entity)),
  );
  const characteristics = mount.getWeaponCharacteristics(entity);
  if (!characteristics) return;
  if (mount.rearMounted) entry.rear = true;
  entry.r = characteristics.ranges.slice(0, 3).join('/');
  entry.m = String(characteristics.minimumRange);
  entry.d = formatWeaponDamage(characteristics.damage);
  entry.md = formatDecimal(characteristics.damage.maximum);
  entry.os = characteristics.oneShotCount ?? 0;
  components.set(key, entry);
}

function addAmmo(
  components: Map<string, ExportComponent>,
  entity: MekEntity,
  mount: EntityMountedEquipment,
  equipment: AmmoEquipment,
): void {
  const name = `${equipment.shortName.replace('Ammo', '').trim()} Ammo`;
  const location = mountLocations(mount);
  const key = `${name}_${location}`;
  const shots = mount.getAmmoShots() ?? 0;
  const existing = components.get(key);
  if (existing) {
    existing.q++;
    existing.q2 = (existing.q2 ?? 0) + shots;
    return;
  }

  const entry = baseComponent(
    equipment, 1, locationId(mount.location), location, 'X',
    criticals(mount.getCriticalSlotRequirement(entity)),
  );
  entry.n = name;
  entry.q2 = shots;
  components.set(key, entry);
}

function addMisc(
  components: Map<string, ExportComponent>,
  entity: MekEntity,
  mount: EntityMountedEquipment,
  equipment: MiscEquipment,
): void {
  const location = mountLocations(mount);
  const structural = equipment.isArmorKit;
  const type = structural ? 'S' : 'C';
  const key = `${equipment.shortName}_${location}_${type}`;
  const existing = components.get(key);
  if (existing) {
    existing.q++;
    return;
  }

  components.set(key, baseComponent(
    equipment, 1, locationId(mount.location), location, type,
    criticals(mount.getCriticalSlotRequirement(entity)),
  ));
}

function addIntegralHeatSinks(components: Map<string, ExportComponent>, entity: MekEntity): void {
  const heatSinks = entity.integralHeatSinks();
  if (!heatSinks) return;
  const equipment = heatSinks.equipment;

  components.set(`${equipment.shortName}__C`, {
    id: equipment.id,
    q: heatSinks.count,
    q2: 0,
    n: equipment.shortName,
    t: 'C',
    p: -1,
    c: criticals(equipment.critSlots === 'variable'
      ? 'variable'
      : equipment.getNumCriticalSlots(entity, 1)),
    os: 0,
  });
}

function baseComponent(
  equipment: Equipment,
  quantity: number,
  position: number,
  location: string | undefined,
  type: ExportComponent['t'],
  criticalSlots: string,
): ExportComponent {
  return {
    id: equipment.id,
    q: quantity,
    q2: 0,
    n: equipment.shortName,
    t: type,
    p: position,
    ...(location ? { l: location } : {}),
    c: criticalSlots,
    os: 0,
  };
}

function mountLocations(mount: EntityMountedEquipment): string {
  return mount.getOccupiedLocations().join('/');
}

function locationId(location: string): number {
  return MEK_LOCATION_IDS[location] ?? -1;
}

function criticals(requirement: number | 'variable' | undefined): string {
  return requirement === 'variable' ? 'V' : String(requirement ?? 0);
}

function weaponCategory(category: ReturnType<WeaponEquipment['getWeaponCategory']> | undefined): ExportComponent['t'] {
  switch (category) {
    case 'energy': return 'E';
    case 'missile': return 'M';
    case 'ballistic': return 'B';
    case 'artillery': return 'A';
    default: return 'O';
  }
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