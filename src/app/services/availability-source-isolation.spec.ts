// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { createEnvironmentInjector, type EnvironmentInjector, Injector, signal } from '@angular/core';
import type { Era } from '../models/eras.model';
import type { Faction } from '../models/factions.model';
import type { AvailabilitySource } from '../models/options.model';
import type { UnitSummary } from '../models/unit-summary.model';
import type { MegaMekWeightedAvailabilityRecord } from '../models/megamek/availability.model';
import { MULFACTION_NONE } from '../models/mulfactions.model';
import { createEmptyUnit } from '../testing/unit-test-helpers';
import { MulAvailabilityIndex } from '../utils/mul-availability-index';
import { DataService } from './data.service';
import { OptionsService } from './options.service';
import { UnitAvailabilitySourceService, type MegaMekAvailabilityFilterContext } from './unit-availability-source.service';

describe('MUL and MegaMek RAT availability isolation', () => {
    const mappedUnit = createEmptyUnit({ mul1id: 42, name: 'Different MUL and RAT memberships', year: 2800 });
    const unlistedUnits = [null, 0, -1, -37].map(mul1id => createEmptyUnit({
        mul1id, name: `RAT unit with MUL ID ${mul1id}`, year: 3140,
    }));
    const units = [mappedUnit, ...unlistedUnits];
    const early: Era = { id: 100, name: 'Early', years: { from: 2500, to: 3000 }, factions: [10], units: new Set([42]) };
    const late: Era = { id: 200, name: 'Late', years: { from: 3001, to: 3150 }, factions: [], units: new Set<number>() };
    const eras = [early, late];
    const mulFaction: Faction = { id: 10, name: 'MUL faction', group: 'Other', img: '', eras: { 100: new Set([42]) } };
    const ratFaction: Faction = { id: 20, name: 'RAT faction', group: 'Other', img: '', eras: {} };
    const none: Faction = { id: MULFACTION_NONE, name: 'None', group: 'Other', img: '', eras: {} };
    const factions = [mulFaction, ratFaction, none];
    const records = new Map<string, MegaMekWeightedAvailabilityRecord>(units.map(unit => [unit.name, {
        n: unit.name,
        e: { 200: { 20: unit === mappedUnit ? [10, 0] : [0, 35] } },
    }]));
    const options = signal<{ availabilitySource: AvailabilitySource }>({ availabilitySource: 'mul' });
    let injector: EnvironmentInjector;
    let service: UnitAvailabilitySourceService;
    let getMulIndex: jasmine.Spy;

    beforeEach(() => {
        options.set({ availabilitySource: 'mul' });
        getMulIndex = jasmine.createSpy('getMulAvailabilityIndex')
            .and.returnValue(new MulAvailabilityIndex(units, eras, factions));
        injector = createEnvironmentInjector([
            UnitAvailabilitySourceService,
            { provide: DataService, useValue: {
                searchCorpusVersion: signal(1), megaMekAvailabilityVersion: signal(1),
                getUnits: () => units, getEras: () => eras, getFactions: () => factions,
                getFactionById: (id: number) => factions.find(faction => faction.id === id),
                getMulAvailabilityIndex: getMulIndex,
                getMegaMekAvailabilityRecordForUnit: (unit: Pick<UnitSummary, 'name'>) => records.get(unit.name),
            } },
            { provide: OptionsService, useValue: { options } },
        ], Injector.NULL as EnvironmentInjector);
        service = injector.get(UnitAvailabilitySourceService);
    });

    afterEach(() => injector.destroy());

    for (const unit of unlistedUnits) {
        it(`uses RAT lookups for MUL ID ${unit.mul1id} without consulting the MUL index`, () => {
            options.set({ availabilitySource: 'megamek' });
            const key = service.getUnitAvailabilityKey(unit);
            const scope: MegaMekAvailabilityFilterContext = { eraIds: new Set([late.id]), factionIds: new Set([ratFaction.id]) };
            expect(service.getVisibleEraUnitIds(late).has(key)).toBeTrue();
            expect(service.getVisibleEraUnitIds(early).has(key)).toBeFalse();
            expect(service.getFactionUnitIds(ratFaction).has(key)).toBeTrue();
            expect(service.getFactionEraUnitIds(ratFaction, late).has(key)).toBeTrue();
            expect(service.getFactionEraUnitIds(none, late).size).toBe(0);
            expect(service.unitBelongsToEra(unit, late)).toBeTrue();
            expect(service.unitBelongsToFaction(unit, ratFaction, scope.eraIds)).toBeTrue();
            expect(service.unitMatchesMegaMekMembership(unit, scope)).toBeTrue();
            expect(service.unitMatchesAvailabilityFrom(unit, 'Salvage', scope)).toBeTrue();
            expect(service.unitMatchesAvailabilityFrom(unit, 'Requisition', scope)).toBeFalse();
            expect(service.getMegaMekAvailabilityScore(unit, scope)).toBe(35);
            expect(getMulIndex).not.toHaveBeenCalled();
        });
    }

    it('switches era, faction, combined and force membership between the two independent sources', () => {
        for (const source of ['mul', 'megamek', 'mul', 'megamek'] as const) {
            options.set({ availabilitySource: source });
            const force = service.createForceAvailabilityContextForUnits(units, eras);
            const expectedEarly = new Set(source === 'mul' ? [mappedUnit.uuid] : []);
            const expectedLate = new Set(source === 'mul'
                ? unlistedUnits.map(unit => unit.uuid)
                : units.map(unit => service.getUnitAvailabilityKey(unit)));
            const expectedMulFaction = expectedEarly;
            const expectedRatFaction = source === 'mul' ? new Set<string>() : expectedLate;

            expect(service.getVisibleEraUnitIds(early)).toEqual(expectedEarly);
            expect(service.getVisibleEraUnitIds(late)).toEqual(expectedLate);
            expect(service.getFactionUnitIds(mulFaction)).toEqual(expectedMulFaction);
            expect(service.getFactionUnitIds(ratFaction)).toEqual(expectedRatFaction);
            expect(service.getFactionEraUnitIds(mulFaction, early)).toEqual(expectedMulFaction);
            expect(service.getFactionEraUnitIds(ratFaction, late)).toEqual(expectedRatFaction);
            expect(service.getFactionEraUnitIds(ratFaction, early).size).toBe(0);
            expect(service.getFactionEraUnitIds(mulFaction, late).size).toBe(0);
            expect(force.source).toBe(source);
            expect(force.getVisibleEraUnitIds(early)).toEqual(expectedEarly);
            expect(force.getVisibleEraUnitIds(late)).toEqual(expectedLate);
            expect(force.getFactionUnitIds(mulFaction)).toEqual(expectedMulFaction);
            expect(force.getFactionUnitIds(ratFaction)).toEqual(expectedRatFaction);
            expect(force.getFactionEraUnitIds(mulFaction, early)).toEqual(expectedMulFaction);
            expect(force.getFactionEraUnitIds(ratFaction, late)).toEqual(expectedRatFaction);
        }
    });

    for (const firstSource of ['mul', 'megamek'] as const) {
        it(`keeps rarity-filtered score caches separate when switching away from ${firstSource}`, () => {
            const secondSource = firstSource === 'mul' ? 'megamek' : 'mul';
            for (const source of [firstSource, secondSource, firstSource] as const) {
                options.set({ availabilitySource: source });
                const scope: MegaMekAvailabilityFilterContext = {
                    eraIds: new Set([late.id]), factionIds: new Set([ratFaction.id]),
                    availabilityFrom: new Set(['Requisition']), availabilityRarities: new Set(['Very Rare']),
                    bridgeThroughMulMembership: !service.useMegaMekAvailability(),
                };
                const expectedMembers = new Set(source === 'mul'
                    ? [] : [service.getUnitAvailabilityKey(mappedUnit, 'megamek')]);
                expect(service.getMegaMekRarityUnitIds('Very Rare', scope)).toEqual(expectedMembers);
                expect(service.getMegaMekAvailabilityScore(mappedUnit, scope)).toBe(source === 'mul' ? 0 : 10);
            }
        });
    }
});
