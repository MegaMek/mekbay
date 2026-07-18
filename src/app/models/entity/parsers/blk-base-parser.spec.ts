import { signal } from '@angular/core';
import { EMPTY_EQUIPMENT_REGISTRY, EquipmentRegistry } from '../../equipment-lookup';
import { ArmorEquipment } from '../../equipment.model';
import type { BaseEntity } from '../base-entity';
import type { EntityTransporter } from '../types';
import {
  TestBipedMekEntity as BipedMekEntity,
  TestSupportTankEntity as SupportTankEntity,
  TestTankEntity as TankEntity,
} from '../testing/test-entities';
import { createTestEquipmentRegistry } from '../testing/test-equipment-registry';
import { parseBaseBlk, parseBlkArmor, parseBlkSupportArmor, parseLegacyDockingCollars } from './blk-base-parser';
import { BuildingBlock } from './building-block';
import { ParseContext } from './parse-context';

describe('BLK base parser', () => {
  const standardArmor = armorEquipment('Standard Armor', 'STANDARD');
  const standardArmorRegistry = new EquipmentRegistry({ [standardArmor.id]: standardArmor });

  it('preserves an existing UUID', () => {
    const uuid = '019f6767-0dcb-7bb8-992f-aef08202f5e1';
    const entity = identityEntity();

    parseBaseBlk(new BuildingBlock(`<UUID>\n${uuid}\n</UUID>`), entity, new ParseContext('test.blk', EMPTY_EQUIPMENT_REGISTRY));

    expect(entity.uuid()).toBe(uuid);
  });

  it('keeps the generated UUID when the file does not provide one', () => {
    const entity = identityEntity();
    const generatedUuid = entity.uuid();

    parseBaseBlk(new BuildingBlock(''), entity, new ParseContext('test.blk', EMPTY_EQUIPMENT_REGISTRY));

    expect(entity.uuid()).toBe(generatedUuid);
  });

  it('normalizes legacy docking-collar counts into transporters', () => {
    const transporters = signal<EntityTransporter[]>([
      { id: 'transporter-1', kind: 'docking-collar', collarNumber: 1, omni: false },
    ]);
    const entity = { transporters } as BaseEntity;
    const buildingBlock = new BuildingBlock(`
      <docking_collar>
      2
      </docking_collar>
    `);

    parseLegacyDockingCollars(buildingBlock, entity);

    expect(transporters().length).toBe(3);
    expect(transporters().every(transporter => transporter.kind === 'docking-collar')).toBeTrue();
  });

  it('constructs handles for OmniMeks and OmniVehicles instead of loading their saved state', () => {
    const source = new BuildingBlock(`
      <omni>
      1
      </omni>
      <transporters>
      BattleArmorHandles - troopers:42
      </transporters>
    `);

    for (const entity of [new BipedMekEntity(), new TankEntity()]) {
      parseBaseBlk(source, entity, new ParseContext('test.blk', EMPTY_EQUIPMENT_REGISTRY));
      expect(entity.transporters()).toEqual([{
        id: 'transporter-1', kind: 'battle-armor-handles', troopers: -1, omni: false,
      }]);
    }
  });

  it('decodes explicit armor compound technology into effective tech base', () => {
    const entity = new BipedMekEntity();
    const buildingBlock = new BuildingBlock(`
      <armor_type>
      0
      </armor_type>
      <armor_tech_level>
      12
      </armor_tech_level>
    `);

    parseBlkArmor(buildingBlock, entity, new ParseContext('test.blk', standardArmorRegistry));

    expect(entity.armorAt('CT').techBase).toBe('Clan');
    expect(entity.armorByLocation().size).toBe(entity.armorLocations.length);
  });

  it('uses the entity tech base when no compound armor value exists', () => {
    const entity = new BipedMekEntity();
    entity.techBase.set('IS');
    entity.rulesLevel.set(4);

    parseBlkArmor(new BuildingBlock('<armor_type>\n0\n</armor_type>'), entity,
      new ParseContext('test.blk', standardArmorRegistry));

    expect(entity.armorAt('CT').techBase).toBe('IS');
  });

  it('remaps missing and legacy Standard armor through a family policy', () => {
    const standardProtoMek = armorEquipment('Standard ProtoMek Armor', 'STANDARD_PROTOMEK');
    const registry = new EquipmentRegistry({ [standardProtoMek.id]: standardProtoMek });

    for (const source of ['', '<armor_type>\n0\n</armor_type>']) {
      const entity = new BipedMekEntity();
      parseBlkArmor(new BuildingBlock(source), entity, new ParseContext('test.blk', registry), {
        remapStandardTo: 'STANDARD_PROTOMEK',
      });

      expect(entity.armorAt('CT').type).toBe('STANDARD_PROTOMEK');
      expect(entity.armorAt('CT').armor).toBe(standardProtoMek);
    }
  });

  it('does not replace non-Standard armor through a family policy', () => {
    const aerospace = armorEquipment('Standard Aerospace Armor', 'AEROSPACE');
    const reactive = armorEquipment('Reactive Armor', 'REACTIVE');
    const registry = new EquipmentRegistry({
      [aerospace.id]: aerospace,
      [reactive.id]: reactive,
    });
    const entity = new BipedMekEntity();

    parseBlkArmor(
      new BuildingBlock('<armor_type>\n2\n</armor_type>'),
      entity,
      new ParseContext('test.blk', registry),
      { remapStandardTo: 'AEROSPACE' },
    );

    expect(entity.armorAt('CT').type).toBe('REACTIVE');
    expect(entity.armorAt('CT').armor).toBe(reactive);
  });

  it('derives support armor from BAR only when armor_type is absent', () => {
    const bar2 = armorEquipment('BAR 2 Armor', 'SV_BAR_2');
    const registry = createTestEquipmentRegistry({
      [standardArmor.id]: standardArmor,
      [bar2.id]: bar2,
    });

    const derived = new SupportTankEntity(registry);
    parseBlkSupportArmor(
      new BuildingBlock('<barrating>\n2\n</barrating>'),
      derived,
      new ParseContext('test.blk', registry),
    );
    expect(derived.uniformArmor()?.type).toBe('SV_BAR_2');
    expect(derived.barRating()).toBe(2);

    const explicit = new SupportTankEntity(registry);
    parseBlkSupportArmor(
      new BuildingBlock('<armor_type>\n0\n</armor_type>\n<barrating>\n2\n</barrating>'),
      explicit,
      new ParseContext('test.blk', registry),
    );
    expect(explicit.uniformArmor()?.type).toBe('STANDARD');
    expect(explicit.barRating()).toBe(2);
  });

  it('preserves a literal support armor type and Java default BAR without a BAR block', () => {
    const bar2 = armorEquipment('BAR 2 Armor', 'SV_BAR_2');
    const registry = createTestEquipmentRegistry({ [bar2.id]: bar2 });
    const entity = new SupportTankEntity(registry);

    parseBlkSupportArmor(
      new BuildingBlock('<armor_type>\n43\n</armor_type>'),
      entity,
      new ParseContext('test.blk', registry),
    );

    expect(entity.uniformArmor()?.type).toBe('SV_BAR_2');
    expect(entity.barRating()).toBe(0);
  });

  it('reports missing support armor inputs instead of defaulting to Standard', () => {
    const entity = new SupportTankEntity();
    const context = new ParseContext('test.blk', EMPTY_EQUIPMENT_REGISTRY);

    parseBlkSupportArmor(new BuildingBlock(''), entity, context);

    expect(context.errors).toEqual([
      jasmine.objectContaining({ field: 'armor_type' }),
    ]);
  });
});

function identityEntity(): BaseEntity {
  return {
    uuid: signal('generated-uuid'),
    chassis: signal(''),
    model: signal(''),
    fluff: signal({}),
  } as BaseEntity;
}

function armorEquipment(
  id: string,
  type: 'AEROSPACE' | 'REACTIVE' | 'STANDARD' | 'STANDARD_PROTOMEK' | 'SV_BAR_2',
): ArmorEquipment {
  return new ArmorEquipment({
    id,
    name: id,
    type: 'armor',
    armor: { type, ...(type === 'SV_BAR_2' ? { bar: 2 } : {}) },
    tech: { base: 'All' },
  });
}