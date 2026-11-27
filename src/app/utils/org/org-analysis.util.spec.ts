// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { createForcePreviewEntryData } from '../../models/force-preview.model';
import { createEmptyUnit } from '../../testing/unit-test-helpers';
import { getOrgFromForce, getOrgFromForceCollection } from './org-analysis.util';
import { collectGroupUnitAllocations } from './org-facts.util';

describe('organization collection aggregation', () => {
  xit('aggregates 400 forces through 40, 4, and 1 collections while preserving all 5,600 units', () => {
    const faction = { id: -1, name: 'Mercenary', group: 'Mercenary' as const, img: '', eras: {} };
    // The original 400-force workload: 2–5 four-Mech groups per force.
    // Large 457-unit Blunder rosters are a separate solver benchmark.
    const entries = Array.from({ length: 400 }, (_, forceIndex) =>
      createForcePreviewEntryData({
        instanceId: `merc-${forceIndex}`,
        name: `Mercenary Force ${forceIndex}`,
        faction,
        groups: Array.from({ length: 2 + (forceIndex % 4) }, () => ({
          units: Array.from({ length: 4 }, () => ({ unit: createEmptyUnit({ moveType: 'Biped' }), destroyed: false })),
        })),
      }),
    );
    const units = entries.flatMap((entry) => entry.groups.flatMap((group) => group.units.map((entry) => entry.unit!)));
    let stages = entries.map((entry) => ({ entries: [entry], result: getOrgFromForce(entry) }));
    while (stages.length > 1) {
      const next: typeof stages = [];
      for (let index = 0; index < stages.length; index += 10) {
        const batch = stages.slice(index, index + 10);
        const entries = batch.flatMap((stage) => stage.entries);
        const children = batch.flatMap((stage) => stage.result.groups);
        next.push({ entries, result: getOrgFromForceCollection(entries, faction, null, children) });
      }
      stages = next;
    }
    const result = stages[0];
    const allocations = result.result.groups.flatMap(collectGroupUnitAllocations);
    expect(result.entries.length).toBe(400);
    expect(units.length).toBe(5600);
    expect(allocations.length).toBe(5600);
    const members = new Set(allocations.map((allocation) => allocation.unit));
    expect(members.size).toBe(units.length);
    expect(units.every((unit) => members.has(unit))).toBeTrue();
    expect(result.result.name).toContain('Brigade');
  });
});
