// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { createConstructionEntity } from '../../construction/domain/construction-factory';
import { installConstructionEquipment, moveConstructionEquipment } from '../../construction/domain/construction-rules';
import { MiscEquipment } from '../equipment.model';
import type { MekEntity } from '../entity/entities';
import { createTestEquipmentRegistry } from '../entity/testing/test-equipment-registry';
import { buildMekRuntimeIndex } from './mek-runtime-index';
import { createPristineMekTurnStateV2 } from './mek-turn-state-v2';
import { rebaseConstructionMekTurn } from './construction-refit-turn-state';
import { refitComponentIds } from './unit-construction-refit';
import { refitCriticalSlotTargets } from './construction-refit-critical-slots';

const equipment = new MiscEquipment({ id: 'Refit System', name: 'Refit System', type: 'misc',
  flags: ['F_MEK_EQUIPMENT'], tech: { base: 'All', level: 'Standard', advancement: { is: { common: '2500' }, clan: { common: '2500' } } },
  stats: { tonnage: 1, criticalSlots: 1 } });
const registry = createTestEquipmentRegistry({ [equipment.id]: equipment });

function fixture() {
  const entity = createConstructionEntity('Biped', registry) as MekEntity;
  const mount = installConstructionEquipment(entity, equipment, 'RT');
  const oldIndex = buildMekRuntimeIndex(entity);
  const moved = moveConstructionEquipment(entity, mount, 'LA', 4);
  // Native codecs can give retained equipment a different ID; model that regeneration explicitly.
  entity.removeEquipment(moved);
  const replacement = entity.addEquipment({ equipmentId: equipment.id, equipment, allocation: moved.allocation,
    rearMounted: false, turretMounted: false, omniPodMounted: false, armored: false });
  const nextIndex = buildMekRuntimeIndex(entity);
  const components = refitComponentIds(oldIndex, nextIndex, new Map([[replacement.mountId, mount.mountId]]));
  const slots = new Map([...refitCriticalSlotTargets(oldIndex, nextIndex, components)]
    .flatMap(([id, targets]) => targets.length === 1 ? [[id, targets[0]] as const] : []));
  const oldId = [...oldIndex.components.values()].find(component => component.mount?.mountId === mount.mountId)!.id;
  const nextId = components.get(oldId)!;
  return { oldIndex, nextIndex, components, slots, oldId, nextId };
}

describe('construction refit Mek turn facts', () => {
  it('remaps settled component and charged-capacitor heat without changing totals or turn progress', () => {
    const { oldIndex, nextIndex, components, slots, oldId, nextId } = fixture();
    const turn = { ...createPristineMekTurnStateV2(), weaponsHeat: 9, heatDissipationConsumed: 7,
      endTurnCheckpoint: 'phase-ended' as const, acknowledgedHeatSources: new Map([
        [`equipment:${oldId}`, '[10,null,null]'], [`ppc-capacitor:${oldId}`, JSON.stringify([5, oldId, null])],
        [`radical-heat-sink:${oldId}:movement`, '[1,null,null]'],
      ]) };
    const result = rebaseConstructionMekTurn(turn, oldIndex, nextIndex, components, slots);
    expect(result.acknowledgedHeatSources.get(`equipment:${nextId}`)).toBe('[10,null,null]');
    expect(result.acknowledgedHeatSources.get(`ppc-capacitor:${nextId}`)).toBe(JSON.stringify([5, nextId, null]));
    expect(result.acknowledgedHeatSources.get(`radical-heat-sink:${nextId}:movement`)).toBe('[1,null,null]');
    expect(result.weaponsHeat).toBe(9);
    expect(result.heatDissipationConsumed).toBe(7);
    expect(result.endTurnCheckpoint).toBe('phase-ended');
  });

  it('remaps component and critical-slot witnesses in settled movement heat', () => {
    const { oldIndex, nextIndex, components, slots, oldId, nextId } = fixture();
    const oldSlot = [...oldIndex.slots.values()].find(slot => slot.componentIds.includes(oldId))!.id;
    const witness = ['jump', 3, 0, false, [oldId], [], [], [oldSlot]];
    const turn = { ...createPristineMekTurnStateV2(), acknowledgedHeatSources: new Map([
      ['movement', JSON.stringify([3, null, JSON.stringify(witness)])],
    ]) };
    const result = rebaseConstructionMekTurn(turn, oldIndex, nextIndex, components, slots);
    expect(result.acknowledgedHeatSources.get('movement')).toBe(JSON.stringify([3, null,
      JSON.stringify(['jump', 3, 0, false, [nextId], [], [], [slots.get(oldSlot)]])]));
  });

  it('rejects deleting a system with a settled heat acknowledgement', () => {
    const { oldIndex, nextIndex, slots, oldId } = fixture();
    const turn = { ...createPristineMekTurnStateV2(), acknowledgedHeatSources: new Map([[`equipment:${oldId}`, '[10,null,null]']]) };
    expect(() => rebaseConstructionMekTurn(turn, oldIndex, nextIndex, new Map(), slots)).toThrowError(/End Turn/);
  });

  it('does not redirect an already-rolled critical hit onto newly installed equipment', () => {
    const { oldIndex, nextIndex, components, slots, oldId } = fixture();
    const locationId = [...oldIndex.slots.values()].find(slot => slot.componentIds.includes(oldId))!.locationId;
    const turn = { ...createPristineMekTurnStateV2(), pendingCriticalEvents: [{ eventId: 'critical:1', type: 'critical-hit' as const,
      locationId, target: 'committed' as const, remainingHits: 1, caseIIDiscards: [false], roll: [1, 1] }] };
    expect(() => rebaseConstructionMekTurn(turn, oldIndex, nextIndex, components, slots)).toThrowError(/pending combat/);
  });

  it('retains pending pilot injury rolls and refuses removing their crew position', () => {
    const { oldIndex, nextIndex, components, slots } = fixture();
    const pilot = [...oldIndex.crewPositions.keys()][0];
    const fall = { eventId: 'fall:1', totalDamage: 10, hitArcLabel: 'Front', applyPilotHits: true,
      forceSeatbeltFailure: false, seatbeltPositionIds: [pilot], headHits: 1, stage: 'crew-hits' as const };
    const turn = { ...createPristineMekTurnStateV2(), pendingFallConsequences: fall };
    expect(rebaseConstructionMekTurn(turn, oldIndex, nextIndex, components, slots).pendingFallConsequences).toEqual(fall);
    expect(() => rebaseConstructionMekTurn(turn, oldIndex, { ...nextIndex, crewPositions: new Map() }, components, slots)).toThrowError(/pending combat/);
  });
});
