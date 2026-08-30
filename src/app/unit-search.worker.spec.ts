// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { GameSystem } from './models/common.model';
import type { UnitSummary } from './models/unit-summary.model';
import { createEmptyUnit } from './testing/unit-test-helpers';
import { __test__ } from './unit-search.worker';
import { asUnitProviderId, MM_DATA_UNIT_PROVIDER_ID, type UnitProviderId } from './services/unit-catalog/unit-catalog.types';
import { getUnitSearchIdentityKey } from './utils/unit-search-shared.util';
import type {
    UnitSearchWorkerCorpusSnapshot,
    UnitSearchWorkerFactionEraSnapshot,
    UnitSearchWorkerQueryRequest,
    UnitSearchWorkerUnit,
} from './utils/unit-search-worker-protocol.util';
import { projectUnitSearchWorkerUnit } from './utils/unit-search-worker-request.util';

const EMPTY_FACTION_ERA_INDEX: UnitSearchWorkerFactionEraSnapshot = {
    unitIdentityKeysByMulId: {},
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

function resultEntry(unit: { provider?: UnitProviderId; uuid: string; name: string }) {
    return {
        provider: MM_DATA_UNIT_PROVIDER_ID,
        uuid: unit.uuid,
        unitName: unit.name,
    };
}

function createSnapshot(): UnitSearchWorkerCorpusSnapshot {
    const unitName = 'Masakari Prime';
    const unit = createUnit(unitName);
    const unitIdentityKey = getUnitSearchIdentityKey(unit);

    return {
        corpusVersion: '1:0',
        units: [workerUnit(unit)],
        indexes: {
            era: {
                'Clan Invasion': [unitIdentityKey],
                ilClan: [unitIdentityKey],
            },
            faction: {
                'Clan Jade Falcon': [unitIdentityKey],
                'Clan Wolf': [unitIdentityKey],
            },
        },
        factionEraIndex: {
            unitIdentityKeysByMulId: {
                [String(unit.id)]: [unitIdentityKey],
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
                    'Mixed (Clan)': [getUnitSearchIdentityKey(mixedClan)],
                    Clan: [getUnitSearchIdentityKey(nonmixedClan)],
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

    it('hydrates compact faction-era ids without eagerly expanding identity sets', () => {
        const snapshot = createSnapshot();
        const identityKey = getUnitSearchIdentityKey(snapshot.units[0]!);
        expect(JSON.stringify(snapshot.factionEraIndex).split(identityKey).length - 1).toBe(1);

        const runtime = __test__.hydrateCorpus(snapshot);
        expect(runtime.factionEraUnitIds.size).toBe(0);

        const result = __test__.buildResultMessage(runtime, {
            ...createRequest(),
            executionQuery: 'era="Clan Invasion" faction="Clan Jade Falcon"',
            telemetryQuery: 'era="Clan Invasion" faction="Clan Jade Falcon"',
        });
        expect(result.entries).toEqual([resultEntry(snapshot.units[0]!)]);
        expect(runtime.factionEraUnitIds.get('Clan Invasion')?.get('Clan Jade Falcon')).toEqual(
            new Set([identityKey]),
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
                    yes: [getUnitSearchIdentityKey(publishedCanon)],
                    no: [getUnitSearchIdentityKey(unpublishedNonCanon)],
                },
                published: {
                    yes: [getUnitSearchIdentityKey(publishedCanon)],
                    no: [getUnitSearchIdentityKey(unpublishedNonCanon)],
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

    it('filters same-name and custom units by exact filter, tag, and faction-era identity', () => {
        const unitSummary = createUnit('Shared Name') as UnitSummary & { provider: UnitProviderId };
        unitSummary.provider = MM_DATA_UNIT_PROVIDER_ID;
        unitSummary.id = 101;
        unitSummary.canon = true;
        unitSummary._nameTags = [{ tag: 'example-tag', quantity: 1 }];
        const custom = createUnit('Shared Name') as UnitSummary & { provider: UnitProviderId };
        custom.provider = asUnitProviderId('custom:test');
        custom.id = 202;
        custom.canon = false;
        custom._nameTags = [{ tag: 'custom-only', quantity: 1 }];
        const unitKey = getUnitSearchIdentityKey(unitSummary);
        const customKey = getUnitSearchIdentityKey(custom);
        const runtime = __test__.hydrateCorpus({
            corpusVersion: '1:0',
            units: [workerUnit(unitSummary), workerUnit(custom)],
            indexes: {
                canon: { yes: [unitKey], no: [customKey] },
                _tags: { 'example-tag': [unitKey], 'custom-only': [customKey] },
                era: { 'Test Era': [unitKey] },
                faction: { 'Test Faction': [unitKey] },
            },
            factionEraIndex: {
                unitIdentityKeysByMulId: {
                    [String(unitSummary.id)]: [unitKey],
                    [String(custom.id)]: [customKey],
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
            { provider: custom.provider, uuid: custom.uuid, unitName: custom.name },
        ]);
        expect(__test__.buildResultMessage(runtime, {
            ...baseRequest, executionQuery: 'canon:yes', telemetryQuery: 'canon:yes',
        }).entries).toEqual([resultEntry(unitSummary)]);
        expect(__test__.buildResultMessage(runtime, {
            ...baseRequest, executionQuery: 'tags=custom-only', telemetryQuery: 'tags=custom-only',
        }).entries).toEqual([
            { provider: custom.provider, uuid: custom.uuid, unitName: custom.name },
        ]);
        expect(__test__.buildResultMessage(runtime, {
            ...baseRequest,
            executionQuery: 'era="Test Era" faction="Test Faction"',
            telemetryQuery: 'era="Test Era" faction="Test Faction"',
        }).entries).toEqual([resultEntry(unitSummary)]);
    });
});
