// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { GameSystem } from './models/common.model';
import type { UnitSummary } from './models/unit-summary.model';
import { createEmptyUnit } from './testing/unit-test-helpers';
import { __test__ } from './unit-search.worker';
import type {
    UnitSearchWorkerCorpusSnapshot,
    UnitSearchWorkerFactionEraSnapshot,
    UnitSearchWorkerQueryRequest,
    UnitSearchWorkerUnit,
} from './utils/unit-search-worker-protocol.util';
import { projectUnitSearchWorkerUnit } from './utils/unit-search-worker-request.util';

const EMPTY_FACTION_ERA_INDEX: UnitSearchWorkerFactionEraSnapshot = {
    unitUuidsByMulId: {},
    referenceIdsByEraAndFaction: {},
};

function createUnit(name: string): UnitSummary {
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

function workerUnit(unit: UnitSummary): UnitSearchWorkerUnit {
    return projectUnitSearchWorkerUnit(unit, {
        tags: [
            ...(unit._nameTags ?? []).map(entry => entry.tag),
            ...(unit._chassisTags ?? []).map(entry => entry.tag),
        ],
        weaponTypes: unit._weaponTypes ?? [],
        weaponTypeCounts: unit._weaponTypeCounts ?? {},
    });
}

function resultEntry(unit: Pick<UnitSummary, 'uuid'>) {
    return { unitUuid: unit.uuid };
}

function createSnapshot(): UnitSearchWorkerCorpusSnapshot {
    const unitName = 'Masakari Prime';
    const unit = createUnit(unitName);

    return {
        corpusVersion: '1:0',
        units: [workerUnit(unit)],
        indexes: {
            era: {
                'Clan Invasion': [unit.uuid],
                ilClan: [unit.uuid],
            },
            faction: {
                'Clan Jade Falcon': [unit.uuid],
                'Clan Wolf': [unit.uuid],
            },
        },
        factionEraIndex: {
            unitUuidsByMulId: {
                [String(unit.id)]: [unit.uuid],
            },
            referenceIdsByEraAndFaction: {
                'Clan Invasion': {
                    'Clan Jade Falcon': [unit.id],
                },
                ilClan: {
                    'Clan Wolf': [unit.id],
                },
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
            units: [workerUnit(mixedClan), workerUnit(nonmixedClan)],
            indexes: {
                _techBaseDisplay: {
                    'Mixed (Clan)': [mixedClan.uuid],
                    Clan: [nonmixedClan.uuid],
                },
            },
            factionEraIndex: EMPTY_FACTION_ERA_INDEX,
        });
        const baseRequest = createRequest();

        expect(__test__.buildResultMessage(runtime, {
            ...baseRequest,
            executionQuery: 'tech="Mixed (Clan)"',
            telemetryQuery: 'tech="Mixed (Clan)"',
        }).entries).toEqual([resultEntry(mixedClan)]);
        expect(__test__.buildResultMessage(runtime, {
            ...baseRequest,
            executionQuery: 'tech=Clan',
            telemetryQuery: 'tech=Clan',
        }).entries).toEqual([resultEntry(nonmixedClan)]);
    });

    it('requires faction membership in every selected multistate era', () => {
        const runtime = __test__.hydrateCorpus(createSnapshot());
        const result = __test__.buildResultMessage(runtime, createRequest());

        expect(result.entries).toEqual([]);
    });

    it('evaluates exclusive faction membership only within the queried era', () => {
        const exclusiveUnit = createUnit('Exclusive Unit');
        exclusiveUnit.id = 1;
        const sharedInLaterEra = createUnit('Shared In Later Era');
        sharedInLaterEra.id = 2;
        const runtime = __test__.hydrateCorpus({
            corpusVersion: '1:0',
            units: [workerUnit(exclusiveUnit), workerUnit(sharedInLaterEra)],
            indexes: {
                era: {
                    'Clan Invasion': [exclusiveUnit.uuid, sharedInLaterEra.uuid],
                    Jihad: [sharedInLaterEra.uuid],
                },
                faction: {
                    'Clan Coyote': [exclusiveUnit.uuid, sharedInLaterEra.uuid],
                    'Federated Suns': [sharedInLaterEra.uuid],
                },
            },
            factionEraIndex: {
                unitUuidsByMulId: {
                    '1': [exclusiveUnit.uuid],
                    '2': [sharedInLaterEra.uuid],
                },
                referenceIdsByEraAndFaction: {
                    'Clan Invasion': { 'Clan Coyote': [1, 2] },
                    Jihad: { 'Federated Suns': [2] },
                },
            },
        });
        const request = {
            ...createRequest(),
            executionQuery: 'era="Clan Invasion" faction=="Clan Coyote"',
            telemetryQuery: 'era="Clan Invasion" faction=="Clan Coyote"',
        };

        expect(__test__.buildResultMessage(runtime, request).entries).toEqual([
            resultEntry(exclusiveUnit),
            resultEntry(sharedInLaterEra),
        ]);
        expect(__test__.buildResultMessage(runtime, {
            ...request,
            executionQuery: 'faction=="Clan Coyote"',
            telemetryQuery: 'faction=="Clan Coyote"',
        }).entries).toEqual([resultEntry(exclusiveUnit)]);
    });

    it('hydrates compact faction-era ids without eagerly expanding identity sets', () => {
        const snapshot = createSnapshot();
        const unitUuid = snapshot.units[0]!.uuid;
        expect(JSON.stringify(snapshot.factionEraIndex).split(unitUuid).length - 1).toBe(1);

        const runtime = __test__.hydrateCorpus(snapshot);
        expect(runtime.factionEraUnitIds.size).toBe(0);

        const result = __test__.buildResultMessage(runtime, {
            ...createRequest(),
            executionQuery: 'era="Clan Invasion" faction="Clan Jade Falcon"',
            telemetryQuery: 'era="Clan Invasion" faction="Clan Jade Falcon"',
        });
        expect(result.entries).toEqual([resultEntry(snapshot.units[0]!)]);
        expect(runtime.factionEraUnitIds.get('Clan Invasion')?.get('Clan Jade Falcon')).toEqual(
            new Set([unitUuid]),
        );
    });

    it('emits normalization metadata only in canonical result entries', () => {
        const unit = createUnit('Normalized Unit');
        const runtime = __test__.hydrateCorpus({
            corpusVersion: '1:0',
            units: [workerUnit(unit)],
            indexes: {},
            factionEraIndex: EMPTY_FACTION_ERA_INDEX,
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
            ...resultEntry(unit),
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
            units: [workerUnit(publishedCanon), workerUnit(unpublishedNonCanon)],
            indexes: {
                canon: {
                    yes: [publishedCanon.uuid],
                    no: [unpublishedNonCanon.uuid],
                },
                published: {
                    yes: [publishedCanon.uuid],
                    no: [unpublishedNonCanon.uuid],
                },
            },
            factionEraIndex: EMPTY_FACTION_ERA_INDEX,
        });
        const baseRequest = createRequest();

        expect(__test__.buildResultMessage(runtime, {
            ...baseRequest,
            executionQuery: 'published:yes',
            telemetryQuery: 'published:yes',
        }).entries).toEqual([resultEntry(publishedCanon)]);
        expect(__test__.buildResultMessage(runtime, {
            ...baseRequest,
            executionQuery: 'published:no',
            telemetryQuery: 'published:no',
        }).entries).toEqual([resultEntry(unpublishedNonCanon)]);
        expect(__test__.buildResultMessage(runtime, {
            ...baseRequest,
            executionQuery: 'canon:no',
            telemetryQuery: 'canon:no',
        }).entries).toEqual([resultEntry(unpublishedNonCanon)]);
    });

    it('matches a complete rulebook bucket in the worker', () => {
        const unitA = createUnit('Unit A');
        unitA.rulesRefs = [['Core'], ['TW', 'IO:AE']];
        const unitB = createUnit('Unit B');
        unitB.rulesRefs = [['TW', 'Shrap01', 'AAA'], ['TM', 'Shrap01']];
        const runtime = __test__.hydrateCorpus({
            corpusVersion: '1:0',
            units: [workerUnit(unitA), workerUnit(unitB)],
            indexes: {
                rulesRefs: {
                    Core: [unitA.uuid],
                    TW: [unitA.uuid, unitB.uuid],
                    TM: [unitB.uuid],
                    'IO:AE': [unitA.uuid],
                    Shrap01: [unitB.uuid],
                    AAA: [unitB.uuid],
                },
            },
            factionEraIndex: EMPTY_FACTION_ERA_INDEX,
        });
        const getEntries = (executionQuery: string) => __test__.buildResultMessage(runtime, {
            ...createRequest(),
            executionQuery,
            telemetryQuery: executionQuery,
        }).entries;

        expect(getEntries('rulesRefs=Core')).toEqual([resultEntry(unitA)]);
        expect(getEntries('rulesRefs=TW')).toEqual([]);
        expect(getEntries('rulesRefs=TW,IO:AE')).toEqual([resultEntry(unitA)]);
        expect(getEntries('rulesRefs=TW,Shrap01')).toEqual([]);
        expect(getEntries('rulesRefs=TW,Shrap01,AAA')).toEqual([resultEntry(unitB)]);
        expect(getEntries('rulesRefs=IO:AE')).toEqual([resultEntry(unitA)]);
        expect(getEntries('rulesRefs=Shrap01')).toEqual([resultEntry(unitB)]);
        expect(getEntries('rulesRefs=AAA')).toEqual([]);
    });

    it('uses the canonical token and pre-parsed value indexes for numeric minima', () => {
        const lowAC = createUnit('Low AC');
        lowAC.as.specials = ['AC2/2/2'];
        const nestedHighAC = createUnit('Nested High AC');
        nestedHighAC.as.specials = ['TUR(3/3/3,AC1/1/4)'];
        const noAC = createUnit('No AC');
        noAC.as.specials = ['TAG'];
        const runtime = __test__.hydrateCorpus({
            corpusVersion: '1:0',
            units: [workerUnit(lowAC), workerUnit(nestedHighAC), workerUnit(noAC)],
            indexes: {
                'as.specials': {
                    AC: [lowAC.uuid, nestedHighAC.uuid],
                    TAG: [noAC.uuid],
                    TUR: [nestedHighAC.uuid],
                },
            },
            factionEraIndex: EMPTY_FACTION_ERA_INDEX,
        });
        nestedHighAC.as.specials = ['TAG'];
        const query = 'specials="AC*/*/>=3"';

        expect(__test__.buildResultMessage(runtime, {
            ...createRequest(),
            executionQuery: query,
            telemetryQuery: query,
            gameSystem: GameSystem.ALPHA_STRIKE,
        }).entries).toEqual([resultEntry(nestedHighAC)]);
    });

    it('keeps repeated specials constraints and implicit values identical in worker execution', () => {
        const mediumOnly = createUnit('Medium Only');
        mediumOnly.as.specials = ['AC1/5/1'];
        const longOnly = createUnit('Long Only');
        longOnly.as.specials = ['AC1/1/4'];
        const both = createUnit('Both Ranges');
        both.as.specials = ['AC1/5/4'];
        const implicitSnarc = createUnit('Implicit SNARC');
        implicitSnarc.as.specials = ['SNARC'];
        const runtime = __test__.hydrateCorpus({
            corpusVersion: '1:0',
            units: [workerUnit(mediumOnly), workerUnit(longOnly), workerUnit(both), workerUnit(implicitSnarc)],
            indexes: {
                'as.specials': {
                    AC: [mediumOnly.uuid, longOnly.uuid, both.uuid],
                    SNARC: [implicitSnarc.uuid],
                },
            },
            factionEraIndex: EMPTY_FACTION_ERA_INDEX,
        });
        const execute = (executionQuery: string) => __test__.buildResultMessage(runtime, {
            ...createRequest(),
            executionQuery,
            telemetryQuery: executionQuery,
            gameSystem: GameSystem.ALPHA_STRIKE,
        }).entries;

        expect(execute('specials&="AC*/>=4/*" specials&="AC*/*/>=3"')).toEqual([resultEntry(both)]);
        expect(execute('specials="SNARC>=1"')).toEqual([resultEntry(implicitSnarc)]);
    });

    it('filters same-name units by UUID across filters, tags, and faction-era membership', () => {
        const unitSummary = createUnit('Shared Name');
        unitSummary.uuid = 'shared-name-one' as UnitSummary['uuid'];
        unitSummary.id = 101;
        unitSummary.canon = true;
        unitSummary._nameTags = [{ tag: 'example-tag', quantity: 1 }];
        const other = createUnit('Shared Name');
        other.uuid = 'shared-name-two' as UnitSummary['uuid'];
        other.id = 202;
        other.canon = false;
        other._nameTags = [{ tag: 'other-only', quantity: 1 }];
        const unitKey = unitSummary.uuid;
        const otherKey = other.uuid;
        const runtime = __test__.hydrateCorpus({
            corpusVersion: '1:0',
            units: [workerUnit(unitSummary), workerUnit(other)],
            indexes: {
                canon: { yes: [unitKey], no: [otherKey] },
                _tags: { 'example-tag': [unitKey], 'other-only': [otherKey] },
                era: { 'Test Era': [unitKey] },
                faction: { 'Test Faction': [unitKey] },
            },
            factionEraIndex: {
                unitUuidsByMulId: {
                    [String(unitSummary.id)]: [unitKey],
                    [String(other.id)]: [otherKey],
                },
                referenceIdsByEraAndFaction: {
                    'Test Era': { 'Test Faction': [unitSummary.id] },
                },
            },
        });

        const baseRequest = {
            ...createRequest(),
            executionQuery: '',
            telemetryQuery: '',
        };
        expect(__test__.buildResultMessage(runtime, baseRequest).entries).toEqual([
            resultEntry(unitSummary),
            resultEntry(other),
        ]);
        expect(__test__.buildResultMessage(runtime, {
            ...baseRequest, executionQuery: 'canon:yes', telemetryQuery: 'canon:yes',
        }).entries).toEqual([resultEntry(unitSummary)]);
        expect(__test__.buildResultMessage(runtime, {
            ...baseRequest, executionQuery: 'tags=other-only', telemetryQuery: 'tags=other-only',
        }).entries).toEqual([resultEntry(other)]);
        expect(__test__.buildResultMessage(runtime, {
            ...baseRequest,
            executionQuery: 'era="Test Era" faction="Test Faction"',
            telemetryQuery: 'era="Test Era" faction="Test Faction"',
        }).entries).toEqual([resultEntry(unitSummary)]);
    });
});
