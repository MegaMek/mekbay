// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

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
        cost: 1000000,
        level: 'Standard',
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
        normalization: null,
    };
}

describe('unit-search worker', () => {
    it('retains mixed-tech units during final semantic evaluation', () => {
        const mixedClan = createUnit('Mixed Clan Unit');
        mixedClan.mixed = true;
        mixedClan._techBaseDisplay = 'Mixed (Clan)';
        const nonmixedClan = createUnit('Clan Unit');

        const runtime = __test__.hydrateCorpus({
            corpusVersion: '1:0',
            units: [mixedClan, nonmixedClan],
            indexes: {
                _techBaseDisplay: {
                    'Mixed (Clan)': ['Mixed Clan Unit'],
                    Clan: ['Clan Unit'],
                },
            },
            factionEraIndex: {},
        });
        const baseRequest = createRequest();

        expect(__test__.buildResultMessage(runtime, {
            ...baseRequest,
            executionQuery: 'tech="Mixed (Clan)"',
            telemetryQuery: 'tech="Mixed (Clan)"',
        }).entries).toEqual([{ unitName: 'Mixed Clan Unit' }]);
        expect(__test__.buildResultMessage(runtime, {
            ...baseRequest,
            executionQuery: 'tech=Clan',
            telemetryQuery: 'tech=Clan',
        }).entries).toEqual([{ unitName: 'Clan Unit' }]);
    });

    it('requires faction membership in every selected multistate era', () => {
        const runtime = __test__.hydrateCorpus(createSnapshot());
        const result = __test__.buildResultMessage(runtime, createRequest());

        expect(result.entries).toEqual([]);
    });

    it('emits normalization metadata only in canonical result entries', () => {
        const unit = createUnit('Normalized Unit');
        const runtime = __test__.hydrateCorpus({
            corpusVersion: '1:0',
            units: [unit],
            indexes: {},
            factionEraIndex: {},
        });
        const result = __test__.buildResultMessage(runtime, {
            ...createRequest(),
            executionQuery: '',
            telemetryQuery: '',
            normalization: {
                kind: 'bv',
                settings: {
                    targetBv: { min: 1000, max: 1000 },
                    gunnery: { min: 4, max: 4 },
                    piloting: { min: 5, max: 5 },
                    maxDelta: 1,
                },
            },
        });

        expect(result.entries).toEqual([{
            unitName: 'Normalized Unit',
            match: { kind: 'bv', adjustedValue: 1000, gunnery: 4, piloting: 5 },
        }]);
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
        }).entries).toEqual([{ unitName: 'Published Canon' }]);
        expect(__test__.buildResultMessage(runtime, {
            ...baseRequest,
            executionQuery: 'published:no',
            telemetryQuery: 'published:no',
        }).entries).toEqual([{ unitName: 'Unpublished Non-Canon' }]);
        expect(__test__.buildResultMessage(runtime, {
            ...baseRequest,
            executionQuery: 'canon:no',
            telemetryQuery: 'canon:no',
        }).entries).toEqual([{ unitName: 'Unpublished Non-Canon' }]);
    });

    it('ignores extra rulebook expansions until a baseline is selected in the worker', () => {
        const unitA = createUnit('Unit A');
        unitA.rulesRefs = ['BMM', 'Shrap01', 'IO:AE'];
        const unitB = createUnit('Unit B');
        unitB.rulesRefs = ['TW', 'Shrap01', 'AAA'];

        const runtime = __test__.hydrateCorpus({
            corpusVersion: '1:0',
            units: [unitA, unitB],
            indexes: {
                rulesRefs: {
                    BMM: ['Unit A'],
                    TW: ['Unit B'],
                    Shrap01: ['Unit A', 'Unit B'],
                    'IO:AE': ['Unit A'],
                    AAA: ['Unit B'],
                },
            },
            factionEraIndex: {},
        });
        const baseRequest = createRequest();

        const getEntries = (executionQuery: string) => __test__.buildResultMessage(runtime, {
            ...baseRequest,
            executionQuery,
            telemetryQuery: executionQuery,
        }).entries;

        expect(getEntries('rulesRefs=Shrap01')).toEqual([
            { unitName: 'Unit A' },
            { unitName: 'Unit B' },
        ]);
        expect(getEntries('rulesRefs=Shrap01,AAA')).toEqual([
            { unitName: 'Unit A' },
            { unitName: 'Unit B' },
        ]);
        expect(getEntries('rulesRefs=TW,Shrap01')).toEqual([]);
        expect(getEntries('rulesRefs=TW')).toEqual([]);
        expect(getEntries('rulesRefs=TW,Shrap01,AAA')).toEqual([{ unitName: 'Unit B' }]);
    });
});
