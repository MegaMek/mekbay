import { signal } from '@angular/core';
import type { BaseEntity } from '../base-entity';
import { BipedMekEntity } from '../entities/mek/biped-mek-entity';
import type { EntityTransporter } from '../types';
import { parseBaseBlk, parseLegacyDockingCollars } from './blk-base-parser';
import { BuildingBlock } from './building-block';
import { ParseContext } from './parse-context';

describe('BLK base parser', () => {
  it('preserves an existing UUID', () => {
    const uuid = '019f6767-0dcb-7bb8-992f-aef08202f5e1';
    const entity = new BipedMekEntity();

    parseBaseBlk(new BuildingBlock(`<UUID>\n${uuid}\n</UUID>`), entity, new ParseContext('test.blk', {}));

    expect(entity.uuid()).toBe(uuid);
  });

  it('keeps the generated UUID when the file does not provide one', () => {
    const entity = new BipedMekEntity();
    const generatedUuid = entity.uuid();

    parseBaseBlk(new BuildingBlock(''), entity, new ParseContext('test.blk', {}));

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
});