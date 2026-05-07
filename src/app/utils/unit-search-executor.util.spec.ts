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

describe('unit-search-executor', () => {
    it('uses unit name order as the tie-breaker for equal sort option values', () => {
        const locust10 = createUnit({ name: 'Locust IIC 10', chassis: 'Locust IIC', model: '10', tons: 25 });
        const locust2 = createUnit({ name: 'Locust IIC 2', chassis: 'Locust IIC', model: '2', tons: 25 });
        const atlas = createUnit({ name: 'Atlas AS7-D', chassis: 'Atlas', model: 'AS7-D', tons: 100 });

        const sortedNames = executeSortedUnits([locust10, atlas, locust2], 'tons').map(unit => unit.name);

        expect(sortedNames).toEqual(['Locust IIC 2', 'Locust IIC 10', 'Atlas AS7-D']);
    });
});