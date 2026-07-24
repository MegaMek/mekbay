import { MiscEquipment, WeaponEquipment } from '../../equipment.model';
import { isQuartersBay } from '../bays/bay-definitions';
import { SmallCraftEntity } from '../entities/aero/small-craft-entity';
import {
  INFANTRY_TRANSPORT_WEIGHTS,
  type EntityTransportBay,
  type InfantryTransportType,
  type StandardTransportBayType,
} from '../types';

const INFANTRY_PERSONNEL: Readonly<Record<InfantryTransportType, { IS: number; Clan: number }>> = {
  Foot: { IS: 28, Clan: 25 },
  Jump: { IS: 21, Clan: 20 },
  Motorized: { IS: 28, Clan: 25 },
  Mechanized: { IS: 7, Clan: 5 },
};

const BAY_PERSONNEL_PER_CAPACITY: Partial<Record<StandardTransportBayType, number>> = {
  mek: 2,
  protomek: 6,
  'light-vehicle': 5,
  'heavy-vehicle': 8,
  'super-heavy-vehicle': 15,
};

/** Mirrors MegaMekLab AeroUtil.updateLoadedAero defaults for non-DropShip Small Craft. */
export function normalizeLoadedSmallCraft(entity: SmallCraftEntity): void {
  const requiredGunners = calculateRequiredGunners(entity);
  entity.gunners.set(Math.max(entity.gunners(), requiredGunners));

  const bayPersonnel = calculateBayPersonnel(entity);
  const minimumCrew = entity.gunners() + bayPersonnel + 3 + calculateEquipmentCrew(entity);
  entity.crew.set(Math.max(entity.crew(), minimumCrew));

  if (entity.officers() === 0) {
    entity.officers.set(Math.ceil((entity.crew() - bayPersonnel) / 5));
  }

  if (entity.transporters().some(transporter =>
    transporter.kind === 'bay' && isQuartersBay(transporter))) return;

  const standardQuarters = entity.crew() - bayPersonnel - entity.officers()
    + entity.marines() + entity.battleArmor();
  entity.transporters.update(transporters => [
    ...transporters,
    createQuarters(entity, 'first-class-quarters', entity.officers(), 10, 0),
    createQuarters(entity, 'second-class-quarters', entity.passengers(), 7, 1),
    ...(standardQuarters > 0
      ? [createQuarters(entity, 'crew-quarters', standardQuarters, 7, 2)]
      : []),
  ]);
}

export function calculateRequiredGunners(entity: SmallCraftEntity): number {
  if (entity.equipment().some(mount => mount.equipment?.hasFlag('F_DRONE_OPERATING_SYSTEM'))) return 0;

  let capitalWeapons = 0;
  let standardWeapons = 0;
  for (const mount of entity.equipment()) {
    const equipment = mount.equipment;
    if (!(equipment instanceof WeaponEquipment)) continue;
    if (equipment.ranges[2] <= 1 && equipment.ammoType !== 'MML') continue;
    if (equipment.capital) capitalWeapons++;
    else standardWeapons++;
  }
  return capitalWeapons + Math.ceil(standardWeapons / 6);
}

export function calculateBayPersonnel(entity: SmallCraftEntity): number {
  return entity.transporters().reduce((total, transporter) => {
    if (transporter.kind !== 'bay') return total;
    return total + personnelForBay(entity, transporter);
  }, 0);
}

function personnelForBay(entity: SmallCraftEntity, bay: EntityTransportBay): number {
  const configuration = bay.configuration;
  switch (configuration.type) {
    case 'fighter': return configuration.arts ? 0 : Math.trunc(bay.capacity) * 2;
    case 'small-craft': return configuration.arts ? 0 : Math.trunc(bay.capacity) * 5;
    case 'battle-armor': return Math.trunc(bay.capacity) * 6;
    case 'infantry': {
      const cubicles = Math.trunc(bay.capacity / INFANTRY_TRANSPORT_WEIGHTS[configuration.infantryType]);
      return cubicles * INFANTRY_PERSONNEL[configuration.infantryType][entity.techBase()];
    }
    case 'protomek': return Math.ceil(bay.capacity) * BAY_PERSONNEL_PER_CAPACITY.protomek!;
    default: return Math.trunc(bay.capacity)
      * (BAY_PERSONNEL_PER_CAPACITY[configuration.type as StandardTransportBayType] ?? 0);
  }
}

function calculateEquipmentCrew(entity: SmallCraftEntity): number {
  return entity.equipment().reduce((total, mount) => {
    const equipment = mount.equipment;
    if (!(equipment instanceof MiscEquipment)) return total;
    if (equipment.hasFlag('F_MOBILE_FIELD_BASE')) return total + 5;
    if (equipment.hasFlag('F_MASH')) return total + 5 * Math.trunc(mount.size ?? 1);
    if (equipment.hasFlag('F_FIELD_KITCHEN')) return total + 3;
    if (equipment.hasFlag('F_COMMUNICATIONS')) return total + Math.trunc(mount.getTonnage(entity) ?? 0);
    if (equipment.hasFlag('F_MOBILE_HPG')) return total + (equipment.hasFlag('F_TANK_EQUIPMENT') ? 1 : 10);
    if (equipment.hasFlag('F_SMALL_COMM_SCANNER_SUITE')) return total + 6;
    if (equipment.hasFlag('F_LARGE_COMM_SCANNER_SUITE')) return total + 12;
    return total;
  }, 0);
}

function createQuarters(
  entity: SmallCraftEntity,
  type: 'first-class-quarters' | 'second-class-quarters' | 'crew-quarters',
  capacity: number,
  tonsPerPerson: number,
  offset: number,
): EntityTransportBay {
  return {
    id: `transporter-${entity.transporters().length + offset + 1}`,
    kind: 'bay',
    configuration: { type },
    capacity,
    constructionWeight: capacity * tonsPerPerson,
    doors: 0,
    bayNumber: 0,
    omni: false,
  };
}