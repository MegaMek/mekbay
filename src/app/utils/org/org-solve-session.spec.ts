// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { createEmptyUnit } from '../../testing/unit-test-helpers';
import { IS_COMPANY } from './definitions';
import { planComposedCountRuleInternal } from './org-composition.util';
import { collectGroupUnitAllocations, compileGroupFacts, DEFAULT_ORG_RULE_REGISTRY } from './org-facts.util';
import { enumeratePatternCandidates } from './org-patterns.util';
import { createSolverGuard, getLastOrgSolveMetrics, runOrgSolve, shouldAbortSearch, visitOrgSearch } from './org-solve-session';
import { resolveFromGroups, resolveFromUnits } from './org-solver.util';
import type { GroupSizeResult, OrgComposedCountRule } from './org-types';

const faction = { id: -1, name: 'Mercenary', group: 'Mercenary' as const, img: '', eras: {} };

describe('organization solve session', () => {
    it('reports exhausted pattern enumeration separately from a deadline', () => {
        runOrgSolve(guard => {
            guard.patternVisits = 50_000;
            expect(enumeratePatternCandidates(new Map([['BM', 4]]), { copySize: 4 }, guard)).toEqual([]);
        });
        expect(getLastOrgSolveMetrics()?.stopReason).toBe('pattern-visits');
        expect(getLastOrgSolveMetrics()?.timedOut).toBeFalse();
    });

    it('does not cache exhausted composition as an impossible plan', () => {
        const groups = Array.from({ length: 3 }, () => compileGroupFacts({
            name: 'Lance', type: 'Lance', modifierKey: '', countsAsType: null, tier: 1,
        }));
        const cache = new Set<string>();
        const limited = createSolverGuard();
        limited.compositionVisits = 50_001;
        const rule: OrgComposedCountRule = { ...IS_COMPANY, childRoles: [{ matches: ['Lance'], min: 1 }, { matches: ['Lance'], min: 1 }] };
        expect(planComposedCountRuleInternal(rule, groups, DEFAULT_ORG_RULE_REGISTRY, limited, undefined, cache).candidates.length).toBe(0);
        expect(limited.session.stopReason).toBe('composition-visits');
        expect(cache.size).toBe(0);
        expect(planComposedCountRuleInternal(rule, groups, DEFAULT_ORG_RULE_REGISTRY, createSolverGuard(), undefined, cache).candidates.length).toBe(1);
        // The exhausted enumeration quota must not block this separate, linear fast path.
        expect(planComposedCountRuleInternal(IS_COMPANY, groups, DEFAULT_ORG_RULE_REGISTRY, limited).candidates.length).toBe(1);
    });

    it('shares the public-call deadline across search phases and preserves the roster when stopped', () => {
        const units = Array.from({ length: 40 }, () => createEmptyUnit());
        let time = 0;
        spyOn(performance, 'now').and.callFake(() => time += 100);
        const result = resolveFromUnits(units, faction);
        const members = result.flatMap(collectGroupUnitAllocations).map(allocation => allocation.unit);
        expect(new Set(members).size).toBe(units.length);
        expect(units.every(unit => members.includes(unit))).toBeTrue();
        expect(getLastOrgSolveMetrics()?.stopReason).toBe('deadline');
        expect(getLastOrgSolveMetrics()?.timedOut).toBeTrue();
    });

    it('publishes fresh metrics for a pass-through group', () => {
        const groups = resolveFromUnits(Array.from({ length: 4 }, () => createEmptyUnit()), faction);
        const previous = getLastOrgSolveMetrics();
        expect(resolveFromGroups(groups, faction)[0]).toBe(groups[0]);
        expect(getLastOrgSolveMetrics()).not.toBe(previous);
        expect(getLastOrgSolveMetrics()?.composedPlanMetrics).toEqual([]);
        expect(getLastOrgSolveMetrics()?.regularPromotionSearches).toBe(0);
        expect(getLastOrgSolveMetrics()?.stopReason).toBeNull();
    });

    it('keeps a nested public solve from consuming its caller\'s guard', () => {
        runOrgSolve(outer => {
            runOrgSolve(inner => {
                inner.patternVisits = 50_001;
                expect(visitOrgSearch(inner, 'pattern')).toBeFalse();
            });
            expect(shouldAbortSearch(outer)).toBeFalse();
            expect(outer.patternVisits).toBe(0);
        });
        expect(getLastOrgSolveMetrics()?.stopReason).toBeNull();
    });

    it('clears previous metrics after a failed solve', () => {
        resolveFromGroups([], faction);
        expect(() => runOrgSolve<GroupSizeResult[]>(() => { throw new Error('bad rule'); })).toThrowError('bad rule');
        expect(getLastOrgSolveMetrics()).toBeNull();
    });
});
