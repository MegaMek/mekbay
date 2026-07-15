import { signal } from '@angular/core';
import type { BaseEntity } from '../base-entity';
import type { EntityTransporter } from '../types';
import { parseLegacyDockingCollars } from './blk-base-parser';
import { BuildingBlock } from './building-block';

describe('BLK base parser', () => {
  it('normalizes legacy docking-collar counts into transporters', () => {
    const transporters = signal<EntityTransporter[]>([
      { type: 'dockingcollar', capacity: 0, doors: 0, bayNumber: -1, bare: true },
    ]);
    const entity = { transporters } as BaseEntity;
    const buildingBlock = new BuildingBlock(`
      <docking_collar>
      2
      </docking_collar>
    `);

    parseLegacyDockingCollars(buildingBlock, entity);

    expect(transporters().length).toBe(3);
    expect(transporters().every(transporter => transporter.type === 'dockingcollar')).toBeTrue();
  });
});