// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { GameSystem } from '../../models/common.model';
import { createEmptyUnit } from '../../testing/unit-test-helpers';
import {
    createLowestCostCandidateForSkillSettings,
    createSkillAdjustedCandidateOptions,
    createSkillAdjustedCandidateOptionsForSettings,
    getBudgetMetric,
    getForceGenerationCBTSkillPairs,
} from './skill-options';

describe('force generation skill options', () => {
    const settings = { gunnery: { min: 3, max: 5 }, piloting: { min: 4, max: 6 }, maxDelta: 1 };

    it('enumerates Alpha Strike skills in ascending order and preserves other candidate facts', () => {
        const candidate = { unit: createEmptyUnit({ as: { PV: 20 } }), cost: 20, locked: false, alias: 'Pilot', skill: undefined as number | undefined, gunnery: 4, piloting: 5 };
        const options = createSkillAdjustedCandidateOptions(candidate, GameSystem.AS, settings);

        expect(options.map(option => option.skill)).toEqual([3, 4, 5]);
        expect(options.map(option => option.cost)).toEqual([getBudgetMetric(candidate.unit, GameSystem.AS, 3, 4), 20, getBudgetMetric(candidate.unit, GameSystem.AS, 5, 4)]);
        expect(options.every(option => option.alias === 'Pilot' && option.gunnery === undefined && option.piloting === undefined)).toBeTrue();
        expect(candidate.gunnery).toBe(4);
    });

    it('keeps locked and ordinary fixed-skill candidates unchanged while allowing explicit formation repricing', () => {
        const candidate = { unit: createEmptyUnit({ bv: 100 }), cost: 100, locked: false, gunnery: 4, piloting: 5 };
        const fixed = { gunnery: { min: 3, max: 3 }, piloting: { min: 4, max: 4 }, maxDelta: 1 };
        expect(createSkillAdjustedCandidateOptions(candidate, GameSystem.CBT, fixed)[0]).toBe(candidate);
        expect(createSkillAdjustedCandidateOptionsForSettings(candidate, GameSystem.CBT, fixed)[0].gunnery).toBe(3);
        const locked = { ...candidate, locked: true };
        expect(createSkillAdjustedCandidateOptionsForSettings(locked, GameSystem.CBT, settings)[0]).toBe(locked);
    });

    it('enumerates conventional infantry Anti-Mech skill once per gunnery value, independent of the requested delta', () => {
        const unit = createEmptyUnit({ type: 'Infantry', subtype: 'Conventional Infantry', canAntiMech: false });
        const pairs = getForceGenerationCBTSkillPairs({ ...settings, maxDelta: 0 }, unit);
        expect(pairs).toEqual([{ gunnery: 3, piloting: 8 }, { gunnery: 4, piloting: 8 }, { gunnery: 5, piloting: 8 }]);
    });

    it('finds the lowest cost across the same valid skill options and falls back when no pair is valid', () => {
        const candidate = { unit: createEmptyUnit({ bv: 100 }), cost: 100, locked: false };
        const options = createSkillAdjustedCandidateOptionsForSettings(candidate, GameSystem.CBT, settings);
        expect(createLowestCostCandidateForSkillSettings(candidate, GameSystem.CBT, settings).cost).toBe(Math.min(...options.map(option => option.cost)));
        const invalid = { gunnery: { min: 0, max: 0 }, piloting: { min: 8, max: 8 }, maxDelta: 0 };
        expect(createSkillAdjustedCandidateOptionsForSettings(candidate, GameSystem.CBT, invalid)[0]).toBe(candidate);
        expect(createLowestCostCandidateForSkillSettings(candidate, GameSystem.CBT, invalid)).toBe(candidate);
    });
});
