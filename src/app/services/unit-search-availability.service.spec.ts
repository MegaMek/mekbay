// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Era } from '../models/eras.model';
import type { Faction } from '../models/factions.model';
import type { AvailabilitySource } from '../models/options.model';
import type { AvailabilityFilterScope, MegaMekWeightedAvailabilityRecord } from '../models/megamek/availability.model';
import { createEmptyUnit } from '../testing/unit-test-helpers';
import { DataService } from './data.service';
import { OptionsService } from './options.service';
import { UnitSearchAvailabilityService } from './unit-search-availability.service';
import { UnitSearchIndexService } from './unit-search-index.service';

describe('UnitSearchAvailabilityService', () => {
    const units = [
        createEmptyUnit({ id: 1, name: 'Atlas', uuid: 'atlas-a' }),
        createEmptyUnit({ id: 1, name: 'Atlas', uuid: 'atlas-b' }),
        createEmptyUnit({ id: 2, name: 'Locust', uuid: 'locust' }),
        createEmptyUnit({ id: 3, name: 'Unknown Mek', uuid: 'unknown' }),
    ];
    let eras: Era[];
    let factions: Faction[];
    let records: Map<string, MegaMekWeightedAvailabilityRecord>;
    let service: UnitSearchAvailabilityService;
    const version = signal(1);
    const options = signal({ availabilitySource: 'megamek' as AvailabilitySource, megaMekAvailabilityFiltersUseAllScopedOptions: false });

    beforeEach(() => {
        eras = [
            { id: 100, name: 'Early', years: {}, factions: [10, 20], units: new Set([1, 2, 3]) },
            { id: 200, name: 'Late', years: {}, factions: [10], units: new Set([1]) },
        ];
        factions = [
            { id: 10, name: 'First', group: 'Inner Sphere', img: '', eras: { 100: new Set([1, 2, 3]), 200: new Set([1]) } },
            { id: 20, name: 'Second', group: 'Inner Sphere', img: '', eras: { 100: new Set([1]) } },
        ];
        records = new Map<string, MegaMekWeightedAvailabilityRecord>([
            ['Atlas', { n: 'Atlas', e: { 100: { 10: [10, 0], 20: [90, 0] }, 200: { 10: [0, 30] } } }],
            ['Locust', { n: 'Locust', e: { 100: { 10: [0, 0] } } }],
        ]);
        version.set(1);
        options.set({ availabilitySource: 'megamek', megaMekAvailabilityFiltersUseAllScopedOptions: false });
        TestBed.configureTestingModule({ providers: [
            { provide: DataService, useValue: {
                isDataReady: () => true,
                searchCorpusVersion: version,
                megaMekAvailabilityVersion: () => 1,
                getUnits: () => units,
                getUnitsByName: (name: string) => units.filter(unit => unit.name === name),
                getEras: () => eras,
                getFactions: () => factions,
                getEraByName: (name: string) => eras.find(era => era.name === name),
                getFactionByName: (name: string) => factions.find(faction => faction.name === name),
                getFactionById: (id: number) => factions.find(faction => faction.id === id),
                getMegaMekAvailabilityRecordForUnit: (unit: { name: string }) => records.get(unit.name),
            } },
            { provide: OptionsService, useValue: { options } },
            { provide: UnitSearchIndexService, useValue: {} },
        ] });
        service = TestBed.inject(UnitSearchAvailabilityService);
    });

    it('distinguishes an unrestricted scope from an empty or unresolved era/faction scope', () => {
        expect(service.resolveContext(undefined)).not.toBeNull();
        for (const scope of [{ eraNames: [] }, { factionNames: [] }, { eraNames: ['Missing'] }, { factionNames: ['Missing'] }]) {
            expect(service.resolveContext(scope)).toBeNull();
            expect(service.getCandidateUnitIds(scope, [], []).size).toBe(0);
        }
    });

    it('reuses resolved scopes until the catalog, source or explicit rarity policy changes', () => {
        const scope: AvailabilityFilterScope = { eraNames: ['Early'], availabilityRarityNames: ['Very Rare'] };
        const initial = service.resolveContext(scope, false);
        expect(service.resolveContext(scope, false)).toBe(initial);
        expect(initial?.availabilityRarities).toBeUndefined();
        expect(service.resolveContext(scope, true)?.availabilityRarities).toEqual(new Set(['Very Rare']));
        options.update(value => ({ ...value, availabilitySource: 'mul' }));
        expect(service.resolveContext(scope, true)?.bridgeThroughMulMembership).toBeTrue();
        eras = [{ ...eras[0], id: 300 }, eras[1]];
        version.update(value => value + 1);
        expect(service.resolveContext(scope, true)?.eraIds).toEqual(new Set([300]));
    });

    it('translates a MegaMek name to every matching UUID and keeps era/faction pairs scoped', () => {
        expect(service.getIndexedUnitIds('era', 'Early', { factionNames: ['First'] }, false))
            .toEqual(new Set([units[0].uuid, units[1].uuid]));
        expect(service.getIndexedUnitIds('faction', 'Second', { eraNames: ['Late'] }, false)?.size).toBe(0);
    });

    it('combines faction intersections and era exclusions in the availability key domain', () => {
        options.update(value => ({ ...value, availabilitySource: 'mul' }));
        expect(service.getUnitIdsForSelection(
            { or: ['Early'], and: [], not: ['Late'] },
            { or: ['First'], and: [], not: [] },
        )).toEqual(new Set(['2', '3']));
        expect(service.getUnitIdsForSelection(
            { or: ['Early'], and: [], not: [] },
            { or: ['First'], and: ['Second'], not: [] },
        )).toEqual(new Set(['1']));
    });

    it('enumerates rarity facets using either each scoped value or each source maximum', () => {
        const scope = { factionNames: ['First', 'Second'], availabilityRarityNames: ['Very Rare'] };
        expect(service.collectAvailableOptionIds(units, scope, 'era', false)).toEqual(new Set<number>());
        expect(service.collectAvailableOptionIds(units, scope, 'era', true)).toEqual(new Set([100]));
    });

    it('keeps Unknown and Not Available separate when enumerating source/rarity facets', () => {
        const scope = { eraNames: ['Early'], factionNames: ['First'] };
        const rarityOptions = service.getFacetOptions('availabilityRarity', units, scope);
        const available = new Set(rarityOptions.filter(option => option.available).map(option => option.name));
        expect(available).toEqual(new Set(['Not Available', 'Very Rare']));
        expect(service.getCandidateUnitIds(scope, ['Unknown'], ['Unknown']).size).toBe(0);
        options.update(value => ({ ...value, availabilitySource: 'mul' }));
        expect(service.getFacetOptions('availabilityRarity', units, scope).filter(option => option.available).map(option => option.name))
            .toEqual(['Unknown', 'Not Available', 'Very Rare']);
        expect(service.getCandidateUnitIds(scope, ['Unknown'], ['Not Available']).size).toBe(0);
        expect(service.getCandidateUnitIds(scope, ['Unknown'], ['Unknown'])).toEqual(new Set(['Unknown Mek']));
    });

    it('keeps MUL-only units in Unknown facet availability without inventing a rarity', () => {
        options.update(value => ({ ...value, availabilitySource: 'mul' }));
        const scope = { factionNames: ['First'], availabilityFromNames: ['Unknown'] };
        expect(service.collectAvailableOptionIds([units[3]], scope, 'era', false)).toEqual(new Set([100]));
        expect(service.getBadges(units[3], { ...scope, eraNames: ['Early'] }, false))
            .toEqual([{ source: 'Unknown', score: -1, rarity: 'Unknown' }]);
    });

    it('honors an explicit request to query MegaMek records outside MUL membership', () => {
        options.update(value => ({ ...value, availabilitySource: 'mul' }));
        records.set('Unknown Mek', { n: 'Unknown Mek', e: { 200: { 20: [10, 0] } } });
        const scope = { eraNames: ['Late'], factionNames: ['Second'], bridgeThroughMulMembership: false };
        expect(service.getCandidateUnitIds(scope, ['Requisition'], [])).toEqual(new Set(['Unknown Mek']));
        expect(service.getBadges(units[3], scope, false))
            .toEqual([{ source: 'Requisition', score: 10, rarity: 'Very Rare' }]);
    });
});
