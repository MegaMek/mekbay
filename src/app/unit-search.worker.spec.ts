import { GameSystem } from './models/common.model';
import type { Unit } from './models/units.model';
import { __test__ } from './unit-search.worker';
import type {
    UnitSearchWorkerCorpusSnapshot,
    UnitSearchWorkerQueryRequest,
} from './utils/unit-search-worker-protocol.util';

function createUnit(name: string): Unit {
    return {
        name,
        id: 1,
        chassis: 'Masakari',
        model: 'Prime',
        year: 3050,
        weightClass: 'Medium',
        tons: 50,
        offSpeedFactor: 0,
        bv: 1000,
        pv: 35,
        cost: 1000000,
        level: 2,
        techBase: 'Clan',
        techRating: 'F',
        type: 'Mek',
        subtype: 'BattleMek Omni',
        omni: 1,
        engine: 'Fusion',
        engineRating: 300,
        engineHS: 10,
        engineHSType: 'Heat Sink',
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
        jump: 0,
        umu: 0,
        c3: '',
        dpt: 10,
        comp: [],
        su: 1,
        crewSize: 1,
        quirks: [],
        features: [],
        icon: '',
        sheets: [],
        as: {
            TP: 'BM',
            PV: 35,
            SZ: 2,
            TMM: 1,
            usesOV: false,
            OV: 0,
            MV: '8',
            MVm: { '': 8 },
            usesTh: false,
            Th: 0,
            Arm: 4,
            Str: 4,
            specials: [],
            dmg: {
                dmgS: '3',
                dmgM: '2',
                dmgL: '1',
                dmgE: '0',
            },
            usesE: false,
            usesArcs: false,
        },
        _searchKey: '',
        _displayType: '',
        _maxRange: 0,
        _weightedMaxRange: 0,
        _dissipationEfficiency: 0,
        _mdSumNoPhysical: 0,
        _mdSumNoPhysicalNoOneshots: 0,
        _nameTags: [],
        _chassisTags: [],
        _publicTags: [],
    };
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
});