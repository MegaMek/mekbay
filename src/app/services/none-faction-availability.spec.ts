// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { createEnvironmentInjector, type EnvironmentInjector, Injector, signal } from '@angular/core';
import type { Era } from '../models/eras.model';
import type { Faction } from '../models/factions.model';
import type { UnitSummary } from '../models/unit-summary.model';
import { MULFACTION_EXTINCT, MULFACTION_NONE } from '../models/mulfactions.model';
import { createEmptyUnit } from '../testing/unit-test-helpers';
import { MulAvailabilityIndex } from '../utils/mul-availability-index';
import { DataService } from './data.service';
import { OptionsService } from './options.service';
import { UnitAvailabilitySourceService } from './unit-availability-source.service';
import { UnitSearchIndexService } from './unit-search-index.service';

function createEra(id: number, name: string, from: number, to?: number): Era {
    return { id, name, years: { from, to }, factions: new Set<number>(), units: new Set<number>() };
}

function createFaction(id: number, name: string, eras: Faction['eras'] = {}): Faction {
    return { id, name, group: 'Other', img: '', eras };
}

describe('UUID-based MUL availability', () => {
    for (const mul1id of [null, 0, -1, -37, 99]) {
        for (const introductionYear of [3140, 3150]) {
            it(`keeps a ${introductionYear} Malice with MUL ID ${mul1id} out of earlier eras`, () => {
                const oldUnit = createEmptyUnit({ mul1id, name: 'Old Unlisted Unit', year: 2500 });
                const malice = createEmptyUnit({ mul1id, name: 'BMMalice_MALYSHRISC', year: introductionYear });
                const futureUnit = createEmptyUnit({ mul1id, name: 'Future Unlisted Unit', year: 3151 });
                const units = [oldUnit, malice, futureUnit];
                const earlyEra = createEra(9, 'Age of War', 2005, 2570);
                const previousEra = createEra(254, 'Late Republic', 3101, 3130);
                const introEra = createEra(16, 'Dark Age', 3131, 3150);
                const openEra = createEra(257, 'ilClan', 3151);
                const eras = [earlyEra, previousEra, introEra, openEra];
                const noneFaction = createFaction(MULFACTION_NONE, 'None');
                const index = new UnitSearchIndexService();
                index.rebuildIndexes(units, eras, [noneFaction]);
                const injector = createEnvironmentInjector([
                    UnitAvailabilitySourceService,
                    { provide: DataService, useValue: {
                        searchCorpusVersion: signal(1),
                        getUnits: () => units,
                        getEras: () => eras,
                        getFactions: () => [noneFaction],
                        getFactionById: (id: number) => id === MULFACTION_NONE ? noneFaction : undefined,
                        getMulAvailabilityIndex: () => index.getMulAvailabilityIndex(),
                    } },
                    { provide: OptionsService, useValue: { options: signal({ availabilitySource: 'mul' }) } },
                ], Injector.NULL as EnvironmentInjector);
                try {
                    const availability = injector.get(UnitAvailabilitySourceService);
                    const forceContext = availability.createForceAvailabilityContextForUnits(units, eras, 'mul');
                    const expectations: Array<[Era, string[]]> = [
                        [earlyEra, [oldUnit.uuid]],
                        [previousEra, [oldUnit.uuid]],
                        [introEra, [oldUnit.uuid, malice.uuid]],
                        [openEra, [oldUnit.uuid, malice.uuid, futureUnit.uuid]],
                    ];
                    for (const [era, expectedUuids] of expectations) {
                        const expected = new Set(expectedUuids);
                        const eraIds = new Set([era.id]);
                        expect(new Set(index.getIndexedUnitIds('era', era.name))).toEqual(expected);
                        expect(index.getFactionEraUnitUuids([era.name], ['None'])).toEqual(expected);
                        expect(availability.getVisibleEraUnitIds(era, 'mul')).toEqual(expected);
                        expect(availability.getFactionEraUnitIds(noneFaction, era, 'mul')).toEqual(expected);
                        expect(availability.getFactionUnitIds(noneFaction, eraIds, 'mul')).toEqual(expected);
                        expect(forceContext.getVisibleEraUnitIds(era)).toEqual(expected);
                        expect(forceContext.getFactionEraUnitIds(noneFaction, era)).toEqual(expected);
                        expect(forceContext.getFactionUnitIds(noneFaction, eraIds)).toEqual(expected);
                        expect(availability.unitBelongsToEra(malice, era, 'mul')).toBe(expected.has(malice.uuid));
                        expect(availability.unitBelongsToFaction(malice, noneFaction, eraIds, 'mul')).toBe(expected.has(malice.uuid));
                    }
                    expect(units.map(unit => unit.mul1id)).toEqual([mul1id, mul1id, mul1id]);
                    expect(noneFaction.eras).toEqual({});
                    expect(earlyEra.units).toEqual(new Set<number>());
                } finally {
                    injector.destroy();
                }
            });
        }
    }

    it('uses valid MUL IDs only to bootstrap UUID memberships and keeps assigned units out of None', () => {
        const oldEra = createEra(1, 'Old', 2500, 3000);
        const lateEra = createEra(2, 'Late', 3001, 3150);
        const first = createEmptyUnit({ mul1id: 42, year: 2900 });
        const duplicate = createEmptyUnit({ mul1id: 42, year: 2900 });
        const unassigned = createEmptyUnit({ mul1id: 99, year: 3140 });
        const invalid = createEmptyUnit({ mul1id: -1, year: 3140 });
        const house = createFaction(10, 'House', { [lateEra.id]: new Set([42, -1, 0]) });
        const none = createFaction(MULFACTION_NONE, 'None');
        lateEra.units = new Set([42, -1, 0]);
        const index = new MulAvailabilityIndex([first, duplicate, unassigned, invalid], [oldEra, lateEra], [house, none]);

        expect(index.getFactionEraUnitUuids(house.id, lateEra.id)).toEqual(new Set([first.uuid, duplicate.uuid]));
        expect(index.getFactionEraUnitUuids(none.id, oldEra.id).size).toBe(0);
        expect(index.getFactionEraUnitUuids(none.id, lateEra.id)).toEqual(new Set([unassigned.uuid, invalid.uuid]));
        expect(index.getEraUnitUuids(lateEra.id)).toEqual(new Set([first.uuid, duplicate.uuid, unassigned.uuid, invalid.uuid]));
        expect(index.unitBelongsToNamedFactionEra(first.uuid, [oldEra.name], [house.name])).toBeFalse();
        expect(index.unitBelongsToNamedFactionEra(first.uuid, [lateEra.name], [house.name])).toBeTrue();
        expect(index.unitBelongsToNamedFactionEra(first.uuid, ['Missing'], [house.name])).toBeFalse();
        expect(index.unitBelongsToNamedFactionEra(first.uuid, [lateEra.name], ['Missing'])).toBeFalse();
    });

    it('retains extinct faction membership without showing extinct units in the era search', () => {
        const era = createEra(1, 'Test Era', 3000, 3050);
        const unit = createEmptyUnit({ mul1id: 42, year: 2900 });
        const extinct = createFaction(MULFACTION_EXTINCT, 'Extinct', { [era.id]: new Set([42]) });
        const none = createFaction(MULFACTION_NONE, 'None');
        era.units = new Set([42]);
        const index = new MulAvailabilityIndex([unit], [era], [extinct, none]);
        expect(index.getEraUnitUuids(era.id).size).toBe(0);
        expect(index.getFactionEraUnitUuids(extinct.id, era.id)).toEqual(new Set([unit.uuid]));
        expect(index.getFactionUnitUuids(none.id).size).toBe(0);
    });

    for (const scopeKind of ['faction', 'era', 'era+faction'] as const) {
        it(`filters a ${scopeKind} without rebuilding or copying memberships for each unit`, () => {
            const units = Array.from({ length: 256 }, (_, i) => createEmptyUnit({
                mul1id: i + 1, name: `Indexed Unit ${i}`, year: 2900,
            }));
            const referenceIds = new Set(units.map(unit => unit.mul1id!));
            const early = createEra(1, 'Early', 2800, 3000);
            const late = createEra(2, 'Late', 3001, 3150);
            early.units = referenceIds;
            late.units = referenceIds;
            const eras = [early, late];
            const faction = createFaction(10, 'House', { 1: referenceIds, 2: referenceIds });
            const index = new MulAvailabilityIndex(units, eras, [faction]);
            let visitedMembers = 0;
            for (const membership of [
                index.getFactionUnitUuids(faction.id),
                ...eras.map(era => index.getEraUnitUuids(era.id)),
                ...eras.map(era => index.getFactionEraUnitUuids(faction.id, era.id)),
            ]) {
                const iterator = membership[Symbol.iterator].bind(membership);
                spyOn(membership as Set<UnitSummary['uuid']>, Symbol.iterator).and.callFake(function* (): SetIterator<UnitSummary['uuid']> {
                    for (const uuid of iterator()) {
                        visitedMembers++;
                        yield uuid;
                    }
                });
            }
            const injector = createEnvironmentInjector([
                UnitAvailabilitySourceService,
                { provide: DataService, useValue: {
                    searchCorpusVersion: signal(1), megaMekAvailabilityVersion: signal(1),
                    getUnits: () => units, getEras: () => eras, getFactions: () => [faction],
                    getFactionById: (id: number) => id === faction.id ? faction : undefined,
                    getMulAvailabilityIndex: () => index,
                    getMegaMekAvailabilityRecordForUnit: () => undefined,
                } },
                { provide: OptionsService, useValue: { options: signal({ availabilitySource: 'mul' }) } },
            ], Injector.NULL as EnvironmentInjector);
            try {
                const availability = injector.get(UnitAvailabilitySourceService);
                const matches: ReadonlySet<string> = availability.getMegaMekMembershipUnitIds({
                    bridgeThroughMulMembership: true,
                    ...(scopeKind !== 'era' ? { factionIds: new Set([faction.id]) } : {}),
                    ...(scopeKind !== 'faction' ? { eraIds: new Set([early.id]) } : {}),
                });
                expect(visitedMembers).toBe(0);
                expect(matches.size).toBe(units.length);
                for (const unit of units) {
                    expect(matches.has(availability.getUnitAvailabilityKey(unit, 'megamek'))).toBeTrue();
                    expect(index.unitBelongsToNamedFactionEra(unit.uuid, [early.name], [faction.name])).toBeTrue();
                }
                expect(visitedMembers).toBe(0);
                // Public mutable results must not expose the shared index to callers.
                availability.getVisibleEraUnitIds(early, 'mul').clear();
                availability.getFactionUnitIds(faction, undefined, 'mul').clear();
                expect(index.getEraUnitUuids(early.id).size).toBe(units.length);
                expect(index.getFactionUnitUuids(faction.id).size).toBe(units.length);
            } finally {
                injector.destroy();
            }
        });
    }
});
