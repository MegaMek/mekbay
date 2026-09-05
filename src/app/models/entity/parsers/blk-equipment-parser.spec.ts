// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { AmmoEquipment, WeaponEquipment } from '../../equipment.model';
import { TestDropShipEntity } from '../testing/test-entities';
import { createTestEquipmentRegistry } from '../testing/test-equipment-registry';
import { parseBlkEquipment } from './blk-base-parser';
import { BuildingBlock } from './building-block';
import { ParseContext } from './parse-context';

describe('BLK equipment installation', () => {
  const cannon = new WeaponEquipment({
    id: 'Cannon', name: 'Cannon', type: 'weapon',
    weapon: { ammoType: 'AC', rackSize: 10, atClass: 'AC', av: [400, 400, 0, 0] },
  });
  const ammo = new AmmoEquipment({
    id: 'Cannon Ammo', name: 'Cannon Ammo', type: 'ammo',
    ammo: { type: 'AC', rackSize: 10, shots: 10 },
  });
  const registry = createTestEquipmentRegistry({ [cannon.id]: cannon, [ammo.id]: ammo });

  it('retains source identity order, damage-limited and authored bays, rear arcs, and ammo assignment', () => {
    const entity = new TestDropShipEntity(registry);
    const context = new ParseContext('bays.blk', registry);
    parseBlkEquipment(new BuildingBlock(`<Nose Equipment>
Cannon Ammo:7
Cannon
Cannon
Cannon Ammo:8
(B) Cannon
(R) Cannon Ammo:9
(R) Cannon
Unknown Equipment
</Nose Equipment>
<Aft Equipment>
Cannon
</Aft Equipment>`), entity, context, [
      ['Nose Equipment', 'Nose'], ['Aft Equipment', 'Aft'],
    ], { equipmentLineProfile: 'dropship' });

    expect(entity.equipment().map(mount => String(mount.mountId))).toEqual([
      'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9',
    ]);
    expect(entity.equipmentBays().map(bay => bay.mounts.map(mount => String(mount.mountId)))).toEqual([
      ['m2', 'm1'], ['m3', 'm4'], ['m5'], ['m7', 'm6'], ['m9'],
    ]);
    expect(entity.equipment().filter(mount => mount.equipment === ammo).map(mount => mount.shotsCount))
      .toEqual([7, 8, 9]);
    expect(entity.equipment()[7].equipmentId).toBe('Unknown Equipment');
    expect(entity.equipment()[7].equipment).toBeUndefined();
    expect(context.diagnostics.length).toBe(1);
  });

  it('preserves existing equipment and bays when a later block is appended', () => {
    const entity = new TestDropShipEntity(registry);
    const source = new BuildingBlock('<Nose Equipment>\nCannon\n</Nose Equipment>');
    const context = new ParseContext('bays.blk', registry);
    const tags = [['Nose Equipment', 'Nose']] as const;
    parseBlkEquipment(source, entity, context, tags, { equipmentLineProfile: 'dropship' });
    const first = entity.equipment()[0];

    parseBlkEquipment(source, entity, context, tags, { equipmentLineProfile: 'dropship' });

    expect(entity.equipment()[0]).toBe(first);
    expect(entity.equipmentBays().map(bay => bay.mounts.map(mount => String(mount.mountId)))).toEqual([['m1'], ['m2']]);
  });
});
