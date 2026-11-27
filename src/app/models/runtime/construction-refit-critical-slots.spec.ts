// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { createConstructionEntity } from '../../construction/domain/construction-factory';
import { AmmoEquipment } from '../equipment.model';
import type { MekEntity } from '../entity/entities';
import { createTestEquipmentRegistry } from '../entity/testing/test-equipment-registry';
import { buildMekRuntimeIndex } from './mek-runtime-index';
import { refitComponentIds } from './unit-construction-refit';
import { refitCriticalDamage, refitCriticalSlotTargets } from './construction-refit-critical-slots';

const ammo = new AmmoEquipment({ id: 'Refit Shared Ammo', name: 'Refit Shared Ammo', type: 'ammo',
  ammo: { type: 'AC', rackSize: 5, shots: 20 }, stats: { tonnage: 1, criticalSlots: 1 } });
const registry = createTestEquipmentRegistry({ [ammo.id]: ammo });
function fixture(shared: boolean) {
  const entity = createConstructionEntity('Biped', registry) as MekEntity;
  entity.setTonnage(125);
  const mounts = [0, shared ? 0 : 1].map(slotIndex => entity.addEquipment({ equipmentId: ammo.id, equipment: ammo,
    allocation: { kind: 'location', location: 'RT', placements: [{ location: 'RT', slotIndex }] },
    rearMounted: false, turretMounted: false, omniPodMounted: false, armored: false }));
  return { entity, mounts, original: buildMekRuntimeIndex(entity), origins: new Map(mounts.map(mount => [mount.mountId, mount.mountId])) };
}

describe('construction refit shared critical slots', () => {
  it('fans a shared source slot out to both retained components after one moves', () => {
    const { entity, mounts, original, origins } = fixture(true);
    const source = [...original.slots.values()].find(slot => slot.componentIds.length === 2)!;
    expect(source).toBeDefined();
    entity.moveEquipment(mounts[0], 'LA', [{ location: 'LA', slotIndex: 4 }]);
    const next = buildMekRuntimeIndex(entity);
    const mapping = refitCriticalSlotTargets(original, next, refitComponentIds(original, next, origins));
    const destinations = mapping.get(source.id)!;
    expect(destinations.length).toBe(2);
    expect(destinations).toContain(source.id);
    expect(destinations.some(id => next.slots.get(id)?.slotIndex === 4)).toBeTrue();
  });

  it('retains both damage sources when two original slots merge into one shared slot', () => {
    const { entity, mounts, original, origins } = fixture(false);
    const sources = [...original.slots.values()].filter(slot => slot.componentIds.some(id => original.components.get(id)?.mount?.equipmentId === ammo.id));
    entity.moveEquipment(mounts[1], 'RT', [{ location: 'RT', slotIndex: 0 }]);
    const next = buildMekRuntimeIndex(entity);
    const target = [...next.slots.values()].find(slot => slot.componentIds.length === 2)!;
    const mapping = refitCriticalSlotTargets(original, next, refitComponentIds(original, next, origins));
    expect(sources.length).toBe(2);
    for (const source of sources) expect(mapping.get(source.id)).toEqual([target.id]);
  });

  it('deduplicates the destination of an unchanged shared slot', () => {
    const { original, origins } = fixture(true);
    const source = [...original.slots.values()].find(slot => slot.componentIds.length === 2)!;
    const mapping = refitCriticalSlotTargets(original, original, refitComponentIds(original, original, origins));
    expect(mapping.get(source.id)).toEqual([source.id]);
  });

  it('preserves committed and pending damage on both halves of a split shared slot', () => {
    const { entity, mounts, original, origins } = fixture(true);
    const source = [...original.slots.values()].find(slot => slot.componentIds.length === 2)!;
    entity.moveEquipment(mounts[0], 'LA', [{ location: 'LA', slotIndex: 4 }]);
    const next = buildMekRuntimeIndex(entity);
    const targets = refitCriticalSlotTargets(original, next, refitComponentIds(original, next, origins));
    const damage = refitCriticalDamage(original, next, 'core-2026', new Map([[source.id, { hits: 1, destroyedTurn: 4 }]]), new Map([[source.id, -1]]), targets);
    for (const id of targets.get(source.id)!) {
      expect(damage.slots.get(id)).toEqual({ hits: 1, destroyedTurn: 4 });
      expect(damage.pendingHits.get(id)).toBe(-1);
    }
  });

  it('adding critical-slot armor preserves a direct hit and its destruction turn', () => {
    const { entity, mounts, original, origins } = fixture(false);
    const source = [...original.slots.values()].find(slot => slot.componentIds.some(id => original.components.get(id)?.mount?.mountId === mounts[0].mountId))!;
    entity.updateEquipment(all => all.map(mount => mount.mountId === mounts[0].mountId ? mount.clone({ armored: true }) : mount));
    const next = buildMekRuntimeIndex(entity);
    const targets = refitCriticalSlotTargets(original, next, refitComponentIds(original, next, origins));
    const damage = refitCriticalDamage(original, next, 'core-2026', new Map([[source.id, { hits: 1, destroyedTurn: 3 }]]), new Map(), targets);
    expect(damage.slots.get(source.id)).toEqual({ hits: 2, destroyedTurn: 3 });
  });

  it('removing armor drops only its protective hit while retaining pending direct damage', () => {
    const { entity, mounts, origins } = fixture(false);
    entity.updateEquipment(all => all.map(mount => mount.mountId === mounts[0].mountId ? mount.clone({ armored: true }) : mount));
    const original = buildMekRuntimeIndex(entity);
    const source = [...original.slots.values()].find(slot => slot.armored)!;
    entity.updateEquipment(all => all.map(mount => mount.mountId === mounts[0].mountId ? mount.clone({ armored: false }) : mount));
    const next = buildMekRuntimeIndex(entity);
    const targets = refitCriticalSlotTargets(original, next, refitComponentIds(original, next, origins));
    const damage = refitCriticalDamage(original, next, 'core-2026', new Map([[source.id, { hits: 1 }]]), new Map([[source.id, 1]]), targets);
    expect(damage.slots.has(source.id)).toBeFalse();
    expect(damage.pendingHits.get(source.id)).toBe(1);
  });
});
