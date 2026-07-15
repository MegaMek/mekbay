import { FixedWingSupportEntity } from '../models/entity/entities/aero/fixed-wing-support-entity';
import { DropShipEntity } from '../models/entity/entities/aero/dropship-entity';
import { HandheldWeaponEntity } from '../models/entity/entities/misc/handheld-weapon-entity';
import { BattleArmorEntity } from '../models/entity/entities/infantry/battle-armor-entity';
import { InfantryEntity } from '../models/entity/entities/infantry/infantry-entity';
import { locationArmor } from '../models/entity/types';
import { SupportNavalEntity } from '../models/entity/entities/vehicle/support-naval-entity';
import { SupportTankEntity } from '../models/entity/entities/vehicle/support-tank-entity';
import { SupportVtolEntity } from '../models/entity/entities/vehicle/support-vtol-entity';
import { Equipment, EquipmentRawData, StructureEquipment } from '../models/equipment.model';
import { UnitMetadataBuilder } from './unit-metadata-builder';
import type { Sourcebook } from '../models/sourcebook.model';

describe('UnitMetadataBuilder', () => {
  const builder = new UnitMetadataBuilder();

  it('classifies support naval vehicles without changing their canonical entity type', () => {
    const entity = new SupportNavalEntity();
    entity.motiveType.set('Submarine');

    expect(Object.getPrototypeOf(SupportNavalEntity.prototype).constructor.name).toBe('NavalEntity');
    expect(entity.isSupportVehicle()).toBeTrue();
    expect(entity.entityType).toBe('SupportNaval');
    expect(builder.build(entity).type).toBe('Naval');
  });

  it('keeps non-naval support vehicles in the tank category', () => {
    const entity = new SupportTankEntity();
    entity.motiveType.set('Tracked');

    expect(builder.build(entity).type).toBe('Tank');
    expect(builder.build(entity).structureType).toBeNull();

    entity.mountedStructure.set(
      new StructureEquipment({
        id: 'Standard',
        name: 'Standard',
        type: 'structure',
        structure: { typeId: 0 },
      }),
    );
    expect(builder.build(entity).structureType).toBe('Standard');
  });

  it('exports Java role values for undetermined and explicit roles', () => {
    const entity = new SupportTankEntity();

    expect(builder.build(entity).role).toBe('None');

    entity.role.set('Scout');
    expect(builder.build(entity).role).toBe('Scout');
  });

  it('exports source and publication lists without reparsing them', () => {
    const entity = new SupportTankEntity();
    entity.source.set([
      sourcebook('TR:3050'),
      { abbrev: 'Unknown', canon: false, unresolved: true },
    ]);
    entity.published.set([sourcebook('RS:3050')]);

    expect(builder.build(entity).source).toEqual(['TR:3050', 'Unknown']);
    expect(builder.build(entity).published).toEqual(['RS:3050']);
  });

  it('derives canon state from sourcebook references', () => {
    const entity = new SupportTankEntity();

    expect(builder.build(entity).canon).toBeFalse();

    const canonSource = sourcebook('TR:3050');
    entity.source.set([canonSource]);
    expect(entity.source()[0]).toBe(canonSource);
    expect(builder.build(entity).canon).toBeTrue();

    entity.source.set([{ abbrev: 'Unknown', canon: false, unresolved: true }]);
    expect(builder.build(entity).canon).toBeFalse();
  });

  it('exports Battle Armor squad armor from its per-trooper value', () => {
    const entity = new BattleArmorEntity();
    entity.trooperCount.set(5);
    entity.armorValues.set(new Map([['Squad', locationArmor(7)]]));

    expect(entity.tonnage()).toBe(5);
    expect(builder.build(entity).tons).toBe(5);
    expect(entity.totalArmorPoints()).toBe(35);
    expect(builder.build(entity).armor).toBe(35);
  });

  it('exports calculated conventional infantry tonnage', () => {
    const entity = new InfantryEntity();
    entity.squadSize.set(7);
    entity.squadCount.set(4);

    expect(builder.build(entity).tons).toBe(2.5);

    entity.specializations.set(new Set(['bridge-engineers', 'paramedics']));
    entity.addEquipment({
      mountId: 'anti-mek-gear', equipmentId: 'AntiMekGear', location: 'Infantry',
      rearMounted: false, turretMounted: false, omniPodMounted: false, armored: false,
      equipment: new Equipment({
        id: 'AntiMekGear', name: 'Anti-Mek Gear', type: 'misc', flags: ['F_ANTI_MEK_GEAR'],
      } as EquipmentRawData),
    });
    expect(builder.build(entity).tons).toBe(7);
  });

  it('exports calculated beast-mounted infantry tonnage', () => {
    const entity = new InfantryEntity();
    entity.squadSize.set(4);
    entity.squadCount.set(2);
    entity.mount.set({
      name: 'Test Beast', size: 'Very Large', weight: 1.2,
      movementPoints: 3, movementMode: 'Leg', burstDamage: 0,
      vehicleDamage: 0, damageDivisor: 1, maxWaterDepth: 0,
      secondaryGroundMP: 0, uwEndurance: 0,
    });

    expect(builder.build(entity).tons).toBe(4);
  });

  it('combines physical inheritance with the shared support capability', () => {
    const cases = [
      [SupportTankEntity, 'TankEntity'],
      [SupportNavalEntity, 'NavalEntity'],
      [SupportVtolEntity, 'VtolEntity'],
      [FixedWingSupportEntity, 'AeroEntity'],
    ] as const;

    for (const [EntityClass, physicalBase] of cases) {
      const entity = new EntityClass();
      expect(Object.getPrototypeOf(EntityClass.prototype).constructor.name).toBe(physicalBase);
      expect(entity.isSupportVehicle()).toBeTrue();
    }
  });

  it('uses Java Alpha Strike prefixes for DropShip forms', () => {
    const dropShip = new DropShipEntity();
    dropShip.chassis.set('Leopard');

    dropShip.motiveType.set('Aerodyne');
    expect(builder.buildName(dropShip)).toBe('DALeopard');

    dropShip.motiveType.set('Spheroid');
    expect(builder.buildName(dropShip)).toBe('DSLeopard');
  });

  it('does not prefix handheld weapons with a non-Java unit type', () => {
    const handheld = new HandheldWeaponEntity();
    handheld.chassis.set('ER Medium Laser Weapon');

    expect(builder.buildName(handheld)).toBe('ERMediumLaserWeapon');
  });
});

function sourcebook(abbrev: string, canon = true): Sourcebook {
  return { id: 0, sku: '', abbrev, title: abbrev, canon };
}