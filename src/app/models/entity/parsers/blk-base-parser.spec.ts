import { signal } from '@angular/core';
import { EMPTY_EQUIPMENT_REGISTRY } from '../../equipment-lookup';
import type { BaseEntity } from '../base-entity';
import { createMountedArmor, type MountedArmor } from '../components';
import type { EntityTechBase, EntityTransporter } from '../types';
import { BipedMekEntity } from '../entities/mek/biped-mek-entity';
import { TankEntity } from '../entities/vehicle/tank-entity';
import { parseBaseBlk, parseBlkArmor, parseLegacyDockingCollars } from './blk-base-parser';
import { BuildingBlock } from './building-block';
import { ParseContext } from './parse-context';

describe('BLK base parser', () => {
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

  it('decodes explicit armor compound technology into structured state', () => {
    const mountedArmor = signal<MountedArmor>(createMountedArmor());
    const entity = armorEntity(mountedArmor);
    const buildingBlock = new BuildingBlock(`
      <armor_type>
      0
      </armor_type>
      <armor_tech_level>
      12
      </armor_tech_level>
    `);

    parseBlkArmor(buildingBlock, entity, new ParseContext('test.blk', EMPTY_EQUIPMENT_REGISTRY));

    expect(mountedArmor().technology).toEqual({ level: 'Standard', scope: 'All Clan' });
    expect(mountedArmor().techBase).toBe('Clan');
  });

  it('calculates armor technology from entity rules when no compound value exists', () => {
    const mountedArmor = signal<MountedArmor>(createMountedArmor());
    const entity = armorEntity(mountedArmor, 'IS', 4);

    parseBlkArmor(new BuildingBlock('<armor_type>\n0\n</armor_type>'), entity,
      new ParseContext('test.blk', EMPTY_EQUIPMENT_REGISTRY));

    expect(mountedArmor().technology).toEqual({ level: 'Experimental', scope: 'IS' });
  });
});

function armorEntity(
  mountedArmor: ReturnType<typeof signal<MountedArmor>>,
  techBase: EntityTechBase = 'IS',
  rulesLevel = 2,
): BaseEntity {
  return {
    mountedArmor,
    techBase: signal<EntityTechBase>(techBase),
    rulesLevel: signal(rulesLevel),
  } as BaseEntity;
}

function identityEntity(): BaseEntity {
  return {
    uuid: signal('generated-uuid'),
    chassis: signal(''),
    model: signal(''),
    fluff: signal({}),
  } as BaseEntity;
}