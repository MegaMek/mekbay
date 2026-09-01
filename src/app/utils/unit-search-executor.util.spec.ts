// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { GameSystem } from '../models/common.model';
import type { UnitSummary } from '../models/unit-summary.model';
import { createEmptyUnit } from '../testing/unit-test-helpers';
import { parseSemanticQueryAST } from './semantic-filter-ast.util';
import { executeUnitSearch } from './unit-search-executor.util';
import { parseASSpecials } from './as-special-filter.util';
import { applyFilterStateToUnits } from './unit-filter-kernel.util';

function createUnit(overrides: Pick<UnitSummary, 'name' | 'chassis' | 'model' | 'tons'>): UnitSummary {
    return createEmptyUnit(overrides);
}

function executeSortedUnits(units: UnitSummary[], sortKey: string): UnitSummary[] {
    return executeUnitSearch({
        units,
        parsedQuery: parseSemanticQueryAST('', GameSystem.CBT),
        searchTokens: [],
        gameSystem: GameSystem.CBT,
        sortKey,
        sortDirection: 'asc',
        bvPvLimit: 0,
        forceTotalBvPv: 0,
        getAdjustedBV: unit => unit.bv,
        getAdjustedPV: unit => unit.as.PV,
        unitBelongsToEra: () => false,
        unitBelongsToFaction: () => false,
        unitBelongsToForcePack: () => false,
        getAllEraNames: () => [],
        getAllFactionNames: () => [],
    }).results;
}

function executeQuery(units: UnitSummary[], query: string): UnitSummary[] {
    return executeUnitSearch({
        units,
        parsedQuery: parseSemanticQueryAST(query, GameSystem.CBT),
        searchTokens: [],
        gameSystem: GameSystem.CBT,
        sortKey: 'name',
        sortDirection: 'asc',
        bvPvLimit: 0,
        forceTotalBvPv: 0,
        getAdjustedBV: unit => unit.bv,
        getAdjustedPV: unit => unit.as.PV,
        unitBelongsToEra: () => false,
        unitBelongsToFaction: () => false,
        unitBelongsToForcePack: () => false,
        getAllEraNames: () => [],
        getAllFactionNames: () => [],
    }).results;
}

describe('unit-search-executor', () => {
    it('ignores a normalization contract for the wrong game system', () => {
        const unit = createEmptyUnit({ name: 'AS Unit', as: { ...createEmptyUnit().as, PV: 20 } });
        const execution = executeUnitSearch({
            units: [unit],
            parsedQuery: parseSemanticQueryAST('', GameSystem.AS),
            searchTokens: [],
            gameSystem: GameSystem.AS,
            sortKey: 'name',
            sortDirection: 'asc',
            bvPvLimit: 0,
            forceTotalBvPv: 0,
            getAdjustedBV: result => result.bv,
            getAdjustedPV: result => result.as.PV,
            normalization: {
                kind: 'bv',
                settings: {
                    targetBv: { min: 1, max: 1 },
                    gunnery: { min: 8, max: 8 },
                    piloting: { min: 8, max: 8 },
                    maxDelta: 0,
                },
            },
            unitBelongsToEra: () => false,
            unitBelongsToFaction: () => false,
            unitBelongsToForcePack: () => false,
            getAllEraNames: () => [],
            getAllFactionNames: () => [],
        });

        expect(execution.results).toEqual([unit]);
        expect(execution.normalizationMatchesByUnitUuid.size).toBe(0);
    });

    it('normalizes Alpha Strike results and excludes units outside the target PV range', () => {
        const matching = createEmptyUnit({
            name: 'Matching',
            as: { ...createEmptyUnit().as, PV: 20 },
        });
        const excluded = createEmptyUnit({
            name: 'Excluded',
            as: { ...createEmptyUnit().as, PV: 100 },
        });

        const execution = executeUnitSearch({
            units: [excluded, matching],
            parsedQuery: parseSemanticQueryAST('', GameSystem.AS),
            searchTokens: [],
            gameSystem: GameSystem.AS,
            sortKey: 'as.PV',
            sortDirection: 'asc',
            bvPvLimit: 0,
            forceTotalBvPv: 0,
            getAdjustedBV: unit => unit.bv,
            getAdjustedPV: unit => unit.as.PV,
            normalization: {
                kind: 'pv',
                settings: { targetPv: { min: 18, max: 18 }, skill: { min: 5, max: 5 } },
            },
            unitBelongsToEra: () => false,
            unitBelongsToFaction: () => false,
            unitBelongsToForcePack: () => false,
            getAllEraNames: () => [],
            getAllFactionNames: () => [],
        });

        expect(execution.results.map(unit => unit.name)).toEqual(['Matching']);
        expect(execution.normalizationMatchesByUnitUuid.get(matching.uuid)).toEqual({
            kind: 'pv',
            adjustedValue: 18,
            skill: 5,
        });
    });

    it('sorts Alpha Strike normalization results by adjusted PV', () => {
        const lowerBase = createEmptyUnit({ name: 'Zulu', as: { ...createEmptyUnit().as, PV: 20 } });
        const higherBase = createEmptyUnit({ name: 'Alpha', as: { ...createEmptyUnit().as, PV: 25 } });
        const execution = executeUnitSearch({
            units: [higherBase, lowerBase],
            parsedQuery: parseSemanticQueryAST('', GameSystem.AS),
            searchTokens: [],
            gameSystem: GameSystem.AS,
            sortKey: 'as.PV',
            sortDirection: 'asc',
            bvPvLimit: 0,
            forceTotalBvPv: 0,
            getAdjustedBV: unit => unit.bv,
            getAdjustedPV: unit => unit.as.PV,
            normalization: {
                kind: 'pv',
                settings: { targetPv: { min: 1, max: 100 }, skill: { min: 5, max: 5 } },
            },
            unitBelongsToEra: () => false,
            unitBelongsToFaction: () => false,
            unitBelongsToForcePack: () => false,
            getAllEraNames: () => [],
            getAllFactionNames: () => [],
        });

        expect(execution.results.map(unit => unit.name)).toEqual(['Zulu', 'Alpha']);
    });

    it('filters mixed and nonmixed tech bases as distinct values', () => {
        const units = [
            createEmptyUnit({ name: 'Inner Sphere Unit', techBase: 'Inner Sphere', mixed: false }),
            createEmptyUnit({ name: 'Clan Unit', techBase: 'Clan', mixed: false }),
            createEmptyUnit({ name: 'Mixed Inner Sphere Unit', techBase: 'Inner Sphere', mixed: true }),
            createEmptyUnit({ name: 'Mixed Clan Unit', techBase: 'Clan', mixed: true }),
        ];

        expect(executeQuery(units, 'tech="Inner Sphere"').map(unit => unit.name))
            .toEqual(['Inner Sphere Unit']);
        expect(executeQuery(units, 'tech=Clan').map(unit => unit.name))
            .toEqual(['Clan Unit']);
        expect(executeQuery(units, 'tech="Mixed (Inner Sphere)"').map(unit => unit.name))
            .toEqual(['Mixed Inner Sphere Unit']);
        expect(executeQuery(units, 'tech="Mixed (Clan)"').map(unit => unit.name))
            .toEqual(['Mixed Clan Unit']);
    });

    it('uses unit name order as the tie-breaker for equal sort option values', () => {
        const locust10 = createUnit({ name: 'Locust IIC 10', chassis: 'Locust IIC', model: '10', tons: 25 });
        const locust2 = createUnit({ name: 'Locust IIC 2', chassis: 'Locust IIC', model: '2', tons: 25 });
        const atlas = createUnit({ name: 'Atlas AS7-D', chassis: 'Atlas', model: 'AS7-D', tons: 100 });

        const sortedNames = executeSortedUnits([locust10, atlas, locust2], 'tons').map(unit => unit.name);

        expect(sortedNames).toEqual(['Locust IIC 2', 'Locust IIC 10', 'Atlas AS7-D']);
    });

    it('filters plain worker-safe weapon-type counts by minimum quantity', () => {
        const oneAI = createEmptyUnit({ name: 'One AI', _weaponTypes: ['AI'], _weaponTypeCounts: { AI: 1 } });
        const twoAI = createEmptyUnit({ name: 'Two AI', _weaponTypes: ['AI'], _weaponTypeCounts: { AI: 2 } });
        const noAI = createEmptyUnit({ name: 'No AI' });

        expect(executeQuery([oneAI, twoAI, noAI], 'weaponType="AI:>=2"').map(unit => unit.name))
            .toEqual(['Two AI']);
        expect(executeQuery([oneAI, twoAI, noAI], 'WEAPONTYPE=AP').map(unit => unit.name))
            .toEqual(['One AI', 'Two AI']);
    });

    it('evaluates selected weapon types independently for OR and AND queries', () => {
        const dualTyped = createEmptyUnit({
            name: 'Dual Typed',
            _weaponTypes: ['AE', 'AI'],
            _weaponTypeCounts: { AE: 2, AI: 2 },
        });
        const areaEffectOnly = createEmptyUnit({
            name: 'Area Effect Only',
            _weaponTypes: ['AE'],
            _weaponTypeCounts: { AE: 2 },
        });

        expect(executeQuery([dualTyped, areaEffectOnly], 'weaponType="AI:>=2","AE:>=2"').map(unit => unit.name))
            .toEqual(['Dual Typed', 'Area Effect Only']);
        expect(executeQuery([dualTyped, areaEffectOnly], 'weaponType&="AI:>=2" weaponType&="AE:>=2"').map(unit => unit.name))
            .toEqual(['Dual Typed']);
    });

    it('uses the sync pre-parsed specials index for numeric minima', () => {
        const unit = createEmptyUnit({
            name: 'Indexed AC',
            as: { ...createEmptyUnit().as, specials: ['AC1/1/1'] },
        });
        const indexedSpecials = parseASSpecials(['TUR(3/3/3,AC1/4/1)']);
        const execution = executeUnitSearch({
            units: [unit],
            parsedQuery: parseSemanticQueryAST('specials="AC*/>=4/*"', GameSystem.AS),
            searchTokens: [],
            gameSystem: GameSystem.AS,
            sortKey: 'name',
            sortDirection: 'asc',
            bvPvLimit: 0,
            forceTotalBvPv: 0,
            getAdjustedBV: value => value.bv,
            getAdjustedPV: value => value.as.PV,
            unitBelongsToEra: () => false,
            unitBelongsToFaction: () => false,
            unitBelongsToForcePack: () => false,
            getAllEraNames: () => [],
            getAllFactionNames: () => [],
            getIndexedASSpecials: unitUuid => unitUuid === unit.uuid ? indexedSpecials : undefined,
        });

        expect(execution.results.map(result => result.name)).toEqual(['Indexed AC']);
    });

    it('uses specials token postings before sync UI tuple evaluation', () => {
        const matching = createEmptyUnit({
            name: 'Matching AC',
            as: { ...createEmptyUnit().as, specials: ['AC1/4/1'] },
        });
        const unrelated = createEmptyUnit({
            name: 'Unrelated TAG',
            as: { ...createEmptyUnit().as, specials: ['TAG'] },
        });
        const parsedByUnit = new Map([
            [matching.uuid, parseASSpecials(matching.as.specials)],
            [unrelated.uuid, parseASSpecials(unrelated.as.specials)],
        ]);
        const getIndexedUnitIds = jasmine.createSpy('getIndexedUnitIds')
            .and.callFake((_filterKey: string, token: string) => token === 'AC' ? new Set([matching.uuid]) : undefined);
        const getIndexedASSpecials = jasmine.createSpy('getIndexedASSpecials')
            .and.callFake((unitUuid: string) => parsedByUnit.get(unitUuid as UnitSummary['uuid']));

        const results = applyFilterStateToUnits({
            units: [matching, unrelated],
            state: {
                'as.specials': {
                    interactedWith: true,
                    value: {
                        AC: { name: 'AC', state: 'or', count: 1, minimumValues: [null, 4, null] },
                    },
                },
            },
            dependencies: {
                getProperty: (unit, key) => key === 'as.specials' ? unit.as.specials : undefined,
                getAdjustedBV: unit => unit.bv,
                getAdjustedPV: unit => unit.as.PV,
                getUnitIdsForExternalFilters: () => null,
                getPositiveFactionNames: () => [],
                unitMatchesAvailabilityFrom: () => false,
                unitMatchesAvailabilityRarity: () => false,
                getForcePackLookupSet: () => undefined,
                getAvailabilityLookupKey: unit => unit.name,
                getIndexedUnitIds,
                getIndexedASSpecials,
            },
        });

        expect(results).toEqual([matching]);
        expect(getIndexedUnitIds).toHaveBeenCalledOnceWith('as.specials', 'AC');
        expect(getIndexedASSpecials).toHaveBeenCalledOnceWith(matching.uuid);
    });

    it('matches when the selected rulebooks cover one complete bucket', () => {
        const unitA = createEmptyUnit({ name: 'Unit A', rulesRefs: [['Core'], ['TW', 'IO:AE']] });
        const unitB = createEmptyUnit({
            name: 'Unit B',
            rulesRefs: [['TW', 'Shrap01', 'AAA'], ['TM', 'Shrap01']],
        });
        const units = [unitA, unitB];

        expect(executeQuery(units, 'rulesRefs=Core').map(unit => unit.name)).toEqual(['Unit A']);
        expect(executeQuery(units, 'rulesRefs=TW').map(unit => unit.name)).toEqual([]);
        expect(executeQuery(units, 'rulesRefs=TW,IO:AE').map(unit => unit.name)).toEqual(['Unit A']);
        expect(executeQuery(units, 'rulesRefs=TW,Shrap01').map(unit => unit.name)).toEqual([]);
        expect(executeQuery(units, 'rulesRefs=TW,Shrap01,AAA').map(unit => unit.name)).toEqual(['Unit B']);
        expect(executeQuery(units, 'rulesRefs=IO:AE').map(unit => unit.name)).toEqual(['Unit A']);
        expect(executeQuery(units, 'rulesRefs=Shrap01').map(unit => unit.name)).toEqual(['Unit B']);
        expect(executeQuery(units, 'rulesRefs=AAA').map(unit => unit.name)).toEqual([]);
    });
});
