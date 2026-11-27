// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ComponentId, CriticalSlotId } from '../entity/entity-identifiers';
import type { CBTRuleset } from '../cbt-ruleset.model';
import type { MekRuntimeIndex } from './mek-runtime-index';
import type { CriticalSlotRuntimeState } from './runtime-state';
import { mekCriticalSlotDirectHitThreshold, mekCriticalSlotMaximumHits } from './mek-critical-slot-rules';

export type ConstructionCriticalSlotTargets = ReadonlyMap<CriticalSlotId, readonly CriticalSlotId[]>;

/** Shared superheavy slots can split: their damage must follow every retained mounted component. */
export function refitCriticalSlotTargets(
  original: MekRuntimeIndex, next: MekRuntimeIndex, components: ReadonlyMap<ComponentId, ComponentId>,
): ConstructionCriticalSlotTargets {
  const targets = new Map<CriticalSlotId, Set<CriticalSlotId>>();
  const associate = (source: CriticalSlotId, target: CriticalSlotId) => {
    const existing = targets.get(source) ?? new Set<CriticalSlotId>();
    existing.add(target);
    targets.set(source, existing);
  };
  for (const [sourceId, targetId] of components) {
    const sourceSlots = [...original.slots.values()].filter(slot => slot.componentIds.includes(sourceId));
    const targetSlots = [...next.slots.values()].filter(slot => slot.componentIds.includes(targetId));
    // Occupancy belongs to this component: another retained component can share the same target slot.
    const used = new Set<CriticalSlotId>();
    const pending = sourceSlots.filter(source => {
      const exact = next.slots.get(source.id);
      if (!exact?.componentIds.includes(targetId)) return true;
      associate(source.id, exact.id);
      used.add(exact.id);
      return false;
    });
    const available = targetSlots.filter(target => !used.has(target.id));
    pending.forEach((source, index) => {
      if (available[index]) associate(source.id, available[index].id);
    });
  }
  return new Map([...targets].map(([source, nextSlots]) => [source, Object.freeze([...nextSlots])]));
}

/** Rebase committed and preview totals separately so sharing and armor changes cannot repair a component. */
export function refitCriticalDamage(
  original: MekRuntimeIndex, next: MekRuntimeIndex, ruleset: CBTRuleset,
  committed: ReadonlyMap<CriticalSlotId, CriticalSlotRuntimeState>, pending: ReadonlyMap<CriticalSlotId, number>,
  targets: ConstructionCriticalSlotTargets,
): Readonly<{ slots: ReadonlyMap<CriticalSlotId, CriticalSlotRuntimeState>; pendingHits: ReadonlyMap<CriticalSlotId, number> }> {
  const totals = new Map<CriticalSlotId, { committed: number; preview: number; destroyedTurn?: number }>();
  for (const [sourceId, targetIds] of targets) {
    const source = original.slots.get(sourceId);
    if (!source) continue;
    const current = committed.get(sourceId);
    const hits = current?.hits ?? 0;
    const previewHits = Math.max(0, hits + (pending.get(sourceId) ?? 0));
    for (const targetId of targetIds) {
      const target = next.slots.get(targetId);
      if (!target) continue;
      const adaptHits = (value: number) => {
        const direct = Math.max(0, value - (source.armored ? 1 : 0));
        return direct > 0 ? direct + (target.armored ? 1 : 0) : target.armored && value > 0 ? 1 : 0;
      };
      const total = totals.get(targetId) ?? { committed: 0, preview: 0 };
      total.committed += adaptHits(hits);
      total.preview += adaptHits(previewHits);
      if (hits >= mekCriticalSlotDirectHitThreshold(source)) {
        total.destroyedTurn = Math.min(total.destroyedTurn ?? Infinity, current?.destroyedTurn ?? 0);
      }
      totals.set(targetId, total);
    }
  }
  const slots = new Map<CriticalSlotId, CriticalSlotRuntimeState>();
  const pendingHits = new Map<CriticalSlotId, number>();
  for (const [id, total] of totals) {
    const definition = next.slots.get(id)!;
    const maximum = mekCriticalSlotMaximumHits(next, ruleset, definition);
    const hits = Math.min(maximum, total.committed);
    const preview = Math.min(maximum, total.preview);
    if (hits > 0) slots.set(id, { hits,
      ...(hits >= mekCriticalSlotDirectHitThreshold(definition) && total.destroyedTurn != null && total.destroyedTurn > 0
        ? { destroyedTurn: total.destroyedTurn } : {}) });
    if (preview !== hits) pendingHits.set(id, preview - hits);
  }
  return { slots, pendingHits };
}
