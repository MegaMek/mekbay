// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { createEmptyUnit } from '../testing/unit-test-helpers';
import type { Era } from '../models/eras.model';
import type { Faction } from '../models/factions.model';
import { MULFACTION_NONE } from '../models/mulfactions.model';
import { DataService } from './data.service';
import { OptionsService } from './options.service';
import { UnitAvailabilitySourceService } from './unit-availability-source.service';
import { UnitSearchIndexService } from './unit-search-index.service';

describe('unlisted unit availability', () => {
    const eras: Era[] = [
        { id: 1, name: 'Early', years: { from: 3000, to: 3049 }, factions: [], units: [] },
        { id: 2, name: 'Late', years: { from: 3050, to: 3099 }, factions: [], units: [] },
    ];
    const none: Faction = { id: MULFACTION_NONE, name: 'None', group: 'Other', img: '', eras: {} };
    const units = [createEmptyUnit({ id: null, name: 'Local first', year: 3050 }), createEmptyUnit({ id: null, name: 'Local second', year: 3060 })];

    it('keeps separate UUID memberships from the introduction year without synthetic MUL IDs', () => {
        TestBed.configureTestingModule({ providers: [
            { provide: OptionsService, useValue: { options: signal({ availabilitySource: 'mul' }) } },
            { provide: DataService, useValue: {
                getUnits: () => units, getEras: () => eras, getFactions: () => [none],
                getFactionById: (id: number) => id === none.id ? none : undefined,
                searchCorpusVersion: signal(1),
            } },
        ] });
        const service = TestBed.inject(UnitAvailabilitySourceService);
        expect(service.getVisibleEraUnitIds(eras[0])).toEqual(new Set());
        expect(service.getVisibleEraUnitIds(eras[1])).toEqual(new Set(units.map(unit => unit.uuid)));
        expect(service.getFactionEraUnitIds(none, eras[1])).toEqual(new Set(units.map(unit => unit.uuid)));
        const context = service.createForceAvailabilityContextForUnits([units[1]], eras, 'mul');
        expect(context.getVisibleEraUnitIds(eras[1])).toEqual(new Set([units[1].uuid]));
        expect(context.getFactionEraUnitIds(none, eras[0])).toEqual(new Set());
        expect(context.getUnitKey(units[0])).not.toBe(context.getUnitKey(units[1]));
    });

    it('indexes unlisted designs for era/faction search and their combined filter', () => {
        const index = new UnitSearchIndexService();
        index.commitPreparedCatalogIndexes(index.prepareCatalogIndexes(units, eras, [none]));
        expect([...(index.getIndexedUnitIds('era', 'Late') ?? [])]).toEqual(units.map(unit => unit.uuid));
        expect(index.getIndexedUnitIds('era', 'Early')?.size ?? 0).toBe(0);
        expect(index.getFactionEraUnitUuids(['Late'], ['None'])).toEqual(new Set(units.map(unit => unit.uuid)));
        expect(index.getFactionEraUnitUuids(['Early'], ['None']).size).toBe(0);
        expect(units.every(unit => unit.id === null)).toBeTrue();
    });
});
