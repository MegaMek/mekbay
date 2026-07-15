import { signal } from '@angular/core';
import type { BaseEntity } from '../base-entity';
import type { EntityTransporter } from '../types';
import { parseLegacyDockingCollars } from './blk-base-parser';
import { BuildingBlock } from './building-block';

describe('BLK base parser', () => {
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