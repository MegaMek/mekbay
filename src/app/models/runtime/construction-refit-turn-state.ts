// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ComponentId, CriticalSlotId } from '../entity/entity-identifiers';
import type { MekRuntimeIndex } from './mek-runtime-index';
import { canonicalizeMekTurnStateV2, type MekTurnStateV2 } from './mek-turn-state-v2';

const COMPONENT_HEAT_PREFIXES = ['ppc-capacitor:', 'risc-viral-jammer:', 'vibroblade:', 'equipment:', 'nova-cews:', 'mobile-hpg:'];
const COOLANT_HEAT_PREFIXES = ['radical-heat-sink:', 'risc-emergency-coolant:'];
const pendingError = () => new Error('Finish this unit’s pending combat and End Turn steps before removing or replacing systems they reference.');

/** Preserve settled heat and unresolved combat facts across native mount-ID regeneration. */
export function rebaseConstructionMekTurn(
  turn: MekTurnStateV2, original: MekRuntimeIndex, next: MekRuntimeIndex,
  components: ReadonlyMap<ComponentId, ComponentId>, slots: ReadonlyMap<CriticalSlotId, CriticalSlotId>,
): MekTurnStateV2 {
  const fall = turn.pendingFallConsequences;
  if (fall && [...fall.seatbeltPositionIds, ...fall.seatbeltFailures ?? []].some(id => !next.crewPositions.has(id))) throw pendingError();
  for (const event of turn.pendingCriticalEvents ?? []) {
    if (!next.locations.has(event.locationId)) throw pendingError();
    const previousSlots = [...original.slots.values()].filter(slot => slot.locationId === event.locationId);
    const nextSlots = [...next.slots.values()].filter(slot => slot.locationId === event.locationId);
    if (previousSlots.length !== nextSlots.length || previousSlots.some(previous => {
      const target = next.slots.get(previous.id);
      return !target || target.armored !== previous.armored || previous.componentIds.length !== target.componentIds.length
        || previous.componentIds.some(id => !components.has(id) || !target.componentIds.includes(components.get(id)!));
    })) throw pendingError();
  }
  const component = (id: string): ComponentId => {
    const target = components.get(id as ComponentId);
    if (!target) throw pendingError();
    return target;
  };
  const slot = (id: string): CriticalSlotId => {
    const target = slots.get(id as CriticalSlotId);
    if (!target) throw pendingError();
    return target;
  };
  const componentOrder = new Map([...next.components.keys()].map((id, index) => [id, index]));
  const slotOrder = new Map([...next.slots.keys()].map((id, index) => [id, index]));
  const acknowledgements = new Map<string, string>();
  for (const [source, signature] of turn.acknowledgedHeatSources) {
    let target = source;
    const prefix = COMPONENT_HEAT_PREFIXES.find(prefix => source.startsWith(prefix));
    const coolantPrefix = COOLANT_HEAT_PREFIXES.find(prefix => source.startsWith(prefix));
    if (prefix) target = prefix + component(source.slice(prefix.length));
    else if (coolantPrefix) {
      const suffix = source.endsWith(':movement') ? ':movement' : source.endsWith(':weapons') ? ':weapons' : null;
      if (!suffix) throw pendingError();
      target = coolantPrefix + component(source.slice(coolantPrefix.length, -suffix.length)) + suffix;
    }
    // This is the exact tuple produced by mekHeatSourceSignatureV2; only identity witnesses change.
    let tuple: unknown;
    try { tuple = JSON.parse(signature); } catch { throw pendingError(); }
    if (!Array.isArray(tuple) || tuple.length !== 3 || typeof tuple[0] !== 'number') throw pendingError();
    if (typeof tuple[1] === 'string') tuple[1] = component(tuple[1]);
    if (source === 'damaged-engine' && typeof tuple[2] === 'string') {
      tuple[2] = tuple[2].split('|').filter(Boolean).map(slot).sort().join('|');
    } else if (source === 'movement' && typeof tuple[2] === 'string') {
      let witness: unknown;
      try { witness = JSON.parse(tuple[2]); } catch { throw pendingError(); }
      if (!Array.isArray(witness) || witness.length !== 8) throw pendingError();
      for (const position of [4, 5, 6, 7]) {
        const ids: unknown = witness[position];
        if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw pendingError();
        witness[position] = position === 7 ? ids.map(slot).sort((a, b) => slotOrder.get(a)! - slotOrder.get(b)!)
          : ids.map(component).sort((a, b) => componentOrder.get(a)! - componentOrder.get(b)!);
      }
      tuple[2] = JSON.stringify(witness);
    }
    if (acknowledgements.has(target)) throw pendingError();
    acknowledgements.set(target, JSON.stringify(tuple));
  }
  return canonicalizeMekTurnStateV2({ ...turn, acknowledgedHeatSources: acknowledgements });
}
