import { GameSystem } from '../models/common.model';
import type { Unit } from '../models/units.model';
import { createEmptyUnit } from '../testing/unit-test-helpers';
import { parseSemanticQueryAST } from './semantic-filter-ast.util';
import { executeUnitSearch } from './unit-search-executor.util';

function createUnit(overrides: Pick<Unit, 'name' | 'chassis' | 'model' | 'tons'>): Unit {
    return createEmptyUnit(overrides);
}

function executeSortedUnits(units: Unit[], sortKey: string): Unit[] {
    return executeUnitSearch({
        units,
        parsedQuery: parseSemanticQueryAST('', GameSystem.CLASSIC),
        searchTokens: [],
        gameSystem: GameSystem.CLASSIC,
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

function executeQuery(units: Unit[], query: string): Unit[] {
    return executeUnitSearch({
        units,
        parsedQuery: parseSemanticQueryAST(query, GameSystem.CLASSIC),
        searchTokens: [],
        gameSystem: GameSystem.CLASSIC,
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
});