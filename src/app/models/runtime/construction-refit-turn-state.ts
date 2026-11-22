// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ComponentId } from '../entity/entity-identifiers';
import type { MekRuntimeIndex } from './mek-runtime-index';
import { rekeyMekHeatSourceId } from './mek-heat-state-v2';
import { withFiredWeapons } from './cbt-unit-runtime';
import { canonicalizeMekTurnStateV2, type MekTurnStateV2 } from './mek-turn-state-v2';

const pendingError = () => new Error('Finish this unit’s pending combat and End Turn steps before removing or replacing systems they reference.');

/** Preserve settled heat and unresolved combat facts across native mount-ID regeneration. */
export function rebaseConstructionMekTurn(
  turn: MekTurnStateV2, original: MekRuntimeIndex, next: MekRuntimeIndex,
  components: ReadonlyMap<ComponentId, ComponentId>,
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
  const settledHeat = new Map<string, number>();
  for (const [source, heat] of turn.settledHeat) {
    const target = rekeyMekHeatSourceId(source, component);
    if (target === null || settledHeat.has(target)) throw pendingError();
    settledHeat.set(target, heat);
  }
  // A fired weapon stays fired under its new id; one the refit removed has nothing left to fire.
  const { firedWeapons: fired, amsEngagements: engagements, ...rest } = turn;
  const amsEngagements = engagements?.flatMap(id => components.get(id) ?? []).sort();
  const firedWeapons = withFiredWeapons(undefined, (fired ?? []).flatMap(id => components.get(id) ?? []));
  return canonicalizeMekTurnStateV2({ ...rest, settledHeat, ...(firedWeapons === undefined ? {} : { firedWeapons }),
    ...(amsEngagements?.length ? { amsEngagements } : {}) });
}
