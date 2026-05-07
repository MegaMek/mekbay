import { GameSystem } from './models/common.model';
import type { Unit } from './models/units.model';
import { createEmptyUnit } from './testing/unit-test-helpers';
import { __test__ } from './unit-search.worker';
import type {
    UnitSearchWorkerCorpusSnapshot,
    UnitSearchWorkerQueryRequest,
} from './utils/unit-search-worker-protocol.util';

function createUnit(name: string): Unit {
    return createEmptyUnit({
        name,
        chassis: 'Masakari',
        model: 'Prime',
        year: 3050,
        bv: 1000,
        pv: 35,
        cost: 1000000,
        level: 2,
        techBase: 'Clan',
        techRating: 'F',
        subtype: 'BattleMek Omni',
        omni: 1,
        engineRating: 300,
        engineHS: 10,
        source: ['SRC-A'],
        role: 'Sniper',
        armorType: 'Standard',
        structureType: 'Standard',
        armor: 100,
        armorPer: 80,
        internal: 50,
        heat: 10,
        dissipation: 10,
        moveType: 'Biped',
        walk: 5,
        walk2: 5,
        run: 8,
        run2: 8,
        dpt: 10,
        su: 1,
        as: {
            PV: 35,
            SZ: 2,
            TMM: 1,
            MV: '8',
            MVm: { '': 8 },
            Arm: 4,
            Str: 4,
            dmg: {
                dmgS: '3',
                dmgM: '2',
                dmgL: '1',
            },
        },
        _publicTags: [],
    });
}

function createSnapshot(): UnitSearchWorkerCorpusSnapshot {
    const unitName = 'Masakari Prime';

    return {
        corpusVersion: '1:0',
        units: [createUnit(unitName)],
        indexes: {
            era: {
                'Clan Invasion': [unitName],
                ilClan: [unitName],
            },
            faction: {
                'Clan Jade Falcon': [unitName],
                'Clan Wolf': [unitName],
            },
        },
        factionEraIndex: {
            'Clan Invasion': {
                'Clan Jade Falcon': [unitName],
            },
            ilClan: {
                'Clan Wolf': [unitName],
            },
        },
    };
}

function createRequest(): UnitSearchWorkerQueryRequest {
    return {
        revision: 1,
        corpusVersion: '1:0',
        executionQuery: 'masak era&="Clan Invasion",ilClan faction="Clan Jade Falcon"',
        telemetryQuery: 'masak era&="Clan Invasion",ilClan faction="Clan Jade Falcon"',
        gameSystem: GameSystem.CLASSIC,
        sortKey: '',
        sortDirection: 'asc',
        bvPvLimit: 0,
        forceTotalBvPv: 0,
        pilotGunnerySkill: 4,
        pilotPilotingSkill: 5,
    };
}

describe('unit-search worker', () => {
    it('requires faction membership in every selected multistate era', () => {
        const runtime = __test__.hydrateCorpus(createSnapshot());
        const result = __test__.buildResultMessage(runtime, createRequest());

        expect(result.unitNames).toEqual([]);
    });

    it('filters canon and published record sheet status from worker execution queries', () => {
        const publishedCanon = createUnit('Published Canon');
        publishedCanon.canon = true;
        publishedCanon.published = ['RS:3050'];

        const unpublishedNonCanon = createUnit('Unpublished Non-Canon');
        unpublishedNonCanon.canon = false;
        unpublishedNonCanon.published = [];

        const runtime = __test__.hydrateCorpus({
            corpusVersion: '1:0',
            units: [publishedCanon, unpublishedNonCanon],
            indexes: {
                canon: {
                    yes: ['Published Canon'],
                    no: ['Unpublished Non-Canon'],
                },
                published: {
                    yes: ['Published Canon'],
                    no: ['Unpublished Non-Canon'],
                },
            },
            factionEraIndex: {},
        });
        const baseRequest = createRequest();

        expect(__test__.buildResultMessage(runtime, {
            ...baseRequest,
            executionQuery: 'published:yes',
            telemetryQuery: 'published:yes',
        }).unitNames).toEqual(['Published Canon']);
        expect(__test__.buildResultMessage(runtime, {
            ...baseRequest,
            executionQuery: 'published:no',
            telemetryQuery: 'published:no',
        }).unitNames).toEqual(['Unpublished Non-Canon']);
        expect(__test__.buildResultMessage(runtime, {
            ...baseRequest,
            executionQuery: 'canon:no',
            telemetryQuery: 'canon:no',
        }).unitNames).toEqual(['Unpublished Non-Canon']);
    });
});