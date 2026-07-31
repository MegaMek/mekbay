import * as fs from 'fs';
import * as path from 'path';
import {
  createEquipment,
  WeaponEquipment,
  type Equipment,
  type RawEquipmentData,
} from '../src/app/models/equipment.model';
import type { BaseEntity } from '../src/app/models/entity/base-entity';
import { MountedEngine } from '../src/app/models/entity/components';
import { DropShipEntity } from '../src/app/models/entity/entities/aero/dropship-entity';
import { BattleArmorEntity } from '../src/app/models/entity/entities/infantry/battle-armor-entity';
import { BipedMekEntity } from '../src/app/models/entity/entities/mek/biped-mek-entity';
import { ProtoMekEntity } from '../src/app/models/entity/entities/protomek/protomek-entity';
import { SupportVtolEntity } from '../src/app/models/entity/entities/vehicle/support-vtol-entity';
import { TankEntity } from '../src/app/models/entity/entities/vehicle/tank-entity';
import { EntityMountedEquipment } from '../src/app/models/entity/types/equipment';

const fixturePath = path.join(__dirname, 'fixtures', 'equipment2.json');
const rawData: RawEquipmentData = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const variableEquipment = Object.entries(rawData.equipment)
  .filter(([, raw]) => raw.stats?.tonnage === 'variable');

if (variableEquipment.length !== 99) {
  throw new Error(`Expected 99 variable-tonnage fixture records, found ${variableEquipment.length}`);
}

const failures: string[] = [];
for (const [id, raw] of variableEquipment) {
  const equipment = createEquipment(raw);
  const entity = createRepresentativeEntity(equipment);
  const mount = createMount(equipment);
  seedAggregateEquipment(entity, mount, equipment);

  const tonnage = mount.getTonnage(entity);
  if (tonnage === undefined || !Number.isFinite(tonnage) || tonnage < 0) {
    failures.push(`${id} [${raw.flags?.join(', ') ?? ''}] on ${entity.entityType}: ${String(tonnage)}`);
  }
}

if (failures.length > 0) {
  throw new Error(`Variable-tonnage parity failed:\n${failures.join('\n')}`);
}

console.log(`Variable-tonnage parity: ${variableEquipment.length}/${variableEquipment.length} fixture records resolved.`);

function createRepresentativeEntity(equipment: Equipment): BaseEntity {
  if (equipment.hasFlag('F_JET_BOOSTER')) {
    const entity = new SupportVtolEntity();
    entity.tonnage.set(4);
    entity.originalWalkMP.set(3);
    entity.engineTechRating.set(3);
    entity.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 20, techBase: 'IS' }));
    return entity;
  }
  if (equipment.hasFlag('F_PROTOMEK_EQUIPMENT')) {
    const entity = new ProtoMekEntity();
    entity.tonnage.set(6);
    return entity;
  }
  if (equipment.hasFlag('F_BA_EQUIPMENT') || equipment.hasFlag('F_BA_MISSION_EQUIPMENT')) {
    const entity = new BattleArmorEntity();
    entity.tonnage.set(1);
    return entity;
  }
  if (equipment.hasAnyFlag(['F_SRCS', 'F_SASRCS', 'F_CASPAR', 'F_CASPAR_II'])) {
    const entity = new DropShipEntity();
    entity.tonnage.set(1000);
    return entity;
  }
  if (equipment.hasFlag('F_SPONSON_TURRET') || equipment.hasFlag('F_PINTLE_TURRET')) {
    const entity = new TankEntity();
    entity.tonnage.set(50);
    return entity;
  }

  const entity = new BipedMekEntity();
  entity.tonnage.set(75);
  entity.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 300, techBase: 'IS' }));
  return entity;
}

function createMount(equipment: Equipment): EntityMountedEquipment {
  const location = equipment.hasFlag('F_HEAD_TURRET') ? 'HD' : 'RA';
  return new EntityMountedEquipment({
    mountId: equipment.id,
    equipmentId: equipment.id,
    equipment,
    location,
    rearMounted: false,
    turretMounted: false,
    omniPodMounted: false,
    armored: false,
    size: 1,
  });
}

function seedAggregateEquipment(
  entity: BaseEntity,
  mount: EntityMountedEquipment,
  equipment: Equipment,
): void {
  const turretType = equipment.hasFlag('F_SPONSON_TURRET')
    ? 'sponson'
    : equipment.hasFlag('F_PINTLE_TURRET') ? 'pintle' : undefined;
  const weapon = new WeaponEquipment({
    id: 'parity-direct-fire-weapon',
    name: 'Parity Direct-Fire Weapon',
    type: 'weapon',
    flags: ['F_DIRECT_FIRE'],
    stats: { tonnage: 5, cost: 0 },
  });
  const weaponMount = new EntityMountedEquipment({
    mountId: weapon.id,
    equipmentId: weapon.id,
    equipment: weapon,
    location: mount.location,
    rearMounted: false,
    turretMounted: equipment.hasAnyFlag(['F_QUAD_TURRET', 'F_SHOULDER_TURRET', 'F_HEAD_TURRET']),
    turretType,
    omniPodMounted: false,
    armored: false,
  });
  entity.equipment.set([mount, weaponMount]);
}