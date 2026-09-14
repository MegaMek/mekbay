// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { createEmptyUnit } from '../../testing/unit-test-helpers';
import { IS_LANCE } from './definitions';
import { getGroupFactsSignatureKey } from './org-composition.util';
import { collectGroupUnitAllocations, compileGroupFacts, compileUnitFactsList, DEFAULT_ORG_RULE_REGISTRY } from './org-facts.util';
import { materializeLeafCountRuleRecords } from './org-leaf-rules.util';
import { resolveFromGroups, resolveFromUnits } from './org-solver.util';
import type { GroupFacts, GroupSizeResult } from './org-types';

const faction = { id: -1, name: 'Mercenary', group: 'Mercenary' as const, img: '', eras: {} };
const wrapper = (data: Partial<GroupSizeResult>): GroupSizeResult => ({
    name: 'Imported organization', type: 'Force', modifierKey: '', countsAsType: null, tier: 0, ...data,
});
function infantry(squads: number) {
    return createEmptyUnit({ type: 'Infantry', subtype: 'Conventional Infantry', moveType: 'Leg', squads, internal: squads * 7, as: { TP: 'CI' } });
}
function unitAggregates(facts: GroupFacts) {
    return {
        types: facts.unitTypeCounts, classes: facts.unitClassCounts, tags: facts.unitTagCounts,
        buckets: facts.descendantUnitBucketCounts,
    };
}

describe('organization facts and allocations', () => {
    it('uses identical descendant buckets for a planned group and its concrete result', () => {
        const units = Array.from({ length: 4 }, (_, index) => createEmptyUnit({ moveType: index % 2 ? 'Quad' : 'Biped' }));
        const record = materializeLeafCountRuleRecords(IS_LANCE, compileUnitFactsList(units), DEFAULT_ORG_RULE_REGISTRY).records[0];
        const concrete = compileGroupFacts(record.materialize());
        expect(unitAggregates(record.facts)).toEqual(unitAggregates(concrete));
        expect([...concrete.descendantUnitBucketCounts.get('moveType')!]).toEqual([['move:Biped', 2], ['move:Quad', 2]]);
    });

    it('keeps catalog IDs and tonnage out of structural state equivalence', () => {
        const first = createEmptyUnit({ mul1id: 10, tons: 20 });
        const second = createEmptyUnit({ mul1id: 999, tons: 100 });
        const group = (unit: typeof first): GroupSizeResult => ({ name: 'Unit', type: 'Unit', modifierKey: '', countsAsType: null, tier: 0, units: [unit] });
        expect(getGroupFactsSignatureKey(compileGroupFacts(group(first)))).toBe(getGroupFactsSignatureKey(compileGroupFacts(group(second))));
        const omni = createEmptyUnit({ omni: 1 });
        expect(getGroupFactsSignatureKey(compileGroupFacts(group(omni)))).not.toBe(getGroupFactsSignatureKey(compileGroupFacts(group(first))));
    });

    it('loads allocation-only wrapper inputs without replacing original unit objects', () => {
        const unit = infantry(4);
        const result = resolveFromGroups([wrapper({ unitAllocations: [{ unit, squads: 4 }] })], faction);
        expect(result.map(group => group.name)).toEqual(['Platoon']);
        expect(result.flatMap(collectGroupUnitAllocations)).toEqual([{ unit, squads: 4 }]);
        expect(result[0].units?.[0]).toBe(unit);
    });

    it('combines split allocations and ignores their unit aliases', () => {
        const unit = infantry(8);
        const input = wrapper({
            units: [unit], unitAllocations: [{ unit, squads: 2 }],
            leftoverUnits: [unit], leftoverUnitAllocations: [{ unit, squads: 1 }],
            children: [wrapper({ units: [unit], unitAllocations: [{ unit, squads: 3 }] })],
        });
        expect(collectGroupUnitAllocations(input)).toEqual([{ unit, squads: 6 }]);
        const result = resolveFromGroups([input], faction);
        expect(result.flatMap(collectGroupUnitAllocations).reduce((sum, allocation) => sum + (allocation.squads ?? 0), 0)).toBe(6);
        expect(unit.squads).toBe(8);
    });

    it('re-evaluates emitted infantry groups without expanding each split into a full unit', () => {
        const unit = infantry(8);
        const children = resolveFromUnits([unit], faction);
        const result = resolveFromGroups([wrapper({ children })], faction);
        expect(result.flatMap(collectGroupUnitAllocations).reduce((sum, allocation) => sum + (allocation.squads ?? 0), 0)).toBe(8);
    });

    it('preserves partial quantities through factions that count infantry units instead of squads', () => {
        const unit = infantry(4);
        const clan = { ...faction, name: 'Clan Wolf', group: 'IS Clan' as const };
        const result = resolveFromGroups([wrapper({ unitAllocations: [{ unit, squads: 2 }] })], clan);
        const allocations = result.flatMap(collectGroupUnitAllocations);
        expect(allocations).toEqual([{ unit, squads: 2 }]);
    });

    it('retains mixed leftovers when infantry normalization replaces their original group', () => {
        const unit = infantry(8);
        const mech = createEmptyUnit();
        const initial = wrapper({ unitAllocations: [{ unit, squads: 1 }, { unit: mech }], units: [unit, mech] });
        let result = resolveFromGroups([initial], faction);
        for (let round = 0; round < 3; round++) {
            const allocations = result.flatMap(collectGroupUnitAllocations);
            expect(allocations.length).toBe(2);
            expect(allocations.find(allocation => allocation.unit === unit)?.squads).toBe(1);
            expect(allocations.some(allocation => allocation.unit === mech)).toBeTrue();
            result = resolveFromGroups(result, faction);
        }
    });
});
