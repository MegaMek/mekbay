// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Era } from '../models/eras.model';
import type { Faction } from '../models/factions.model';
import type { UnitSummary } from '../models/unit-summary.model';
import { createEmptyUnit } from '../testing/unit-test-helpers';
import { UnitSearchIndexService, type PreparedUnitSearchIndexes } from './unit-search-index.service';

function custom(name: string, id: number): UnitSummary {
    return createEmptyUnit({ name, chassis: name, uuid: name, id, hash: name, origin: 'user', isCustom: true,
        comp: [{ id: name, n: name, q: 1, p: 1, l: 'RA', t: 'E', md: '5' }],
        as: { specials: ['IF1', 'TUR(2/2/1, AC2/2/1)'], MVm: { j: 8 } } });
}

function comparable(index: PreparedUnitSearchIndexes) {
    return {
        stats: index.unitStats,
        filters: new Map([...index.searchFilterIndex].map(([key, values]) => [key,
            new Map([...values].map(([value, posting]) => [value, new Set(posting)]))])),
        values: index.searchFilterValues, dropdowns: index.dropdownOptionUniverse,
        specials: index.asSpecialsByUnit, specialFields: index.asSpecialFieldCounts,
        ordinals: index.unitOrdinalLookup, memberships: index.factionEraSnapshot,
        indexStats: index.indexStats,
    };
}

describe('incremental custom search indexes', () => {
    const core = () => createEmptyUnit({ name: 'Core', chassis: 'Core', uuid: 'core', id: 10, hash: 'core',
        comp: [{ id: 'core-only', n: 'Core-only weapon', q: 1, p: 1, l: 'RA', t: 'E', md: '7' }] });
    const eras = (ids: number[]) => [{ id: 1, name: 'Early', units: new Set(ids), factions: new Set([1]), years: { to: 3050 } }] as Era[];
    const factions = (ids: number[]) => [{ id: 1, name: 'Faction', eras: { 1: new Set(ids) } }] as unknown as Faction[];

    it('matches a full rebuild after an edit, addition, deletion and reordering without altering the active index', () => {
        const service = new UnitSearchIndexService();
        const active = [core(), custom('Before', -2), custom('Removed', -3), custom('Unchanged', -4)];
        const initial = service.prepareCatalogIndexes(active, eras([10, -2, -3, -4]), factions([10, -2, -3, -4]));
        service.commitPreparedCatalogIndexes(initial);
        const preserved = service.getIndexedUnitIds('componentName', 'Core-only weapon');
        const changed = { ...structuredClone(active[1]), name: 'After', chassis: 'After', hash: 'after',
            role: 'Scout', comp: [], as: { ...structuredClone(active[1].as), specials: ['ECM'] } } as UnitSummary;
        const units = [structuredClone(active[3]), changed, structuredClone(active[0]), custom('Added', -5)];
        units[2]._nameTags = [{ tag: 'New tag during refresh', quantity: 1 }];
        const nextEras = eras([10, -4, -5]), nextFactions = factions([10, -4, -5]);
        const expectedUnits = structuredClone(units);
        const expected = new UnitSearchIndexService().prepareCatalogIndexes(expectedUnits, nextEras, nextFactions);
        const actual = service.prepareCatalogIndexes(units, nextEras, nextFactions, undefined, undefined, active);
        expect(comparable(actual)).toEqual(comparable(expected));
        expect(units).toEqual(expectedUnits);
        expect(actual.unitStats).toBe(initial.unitStats);
        expect(actual.searchFilterIndex.get('componentName')!.get('Core-only weapon')).toBe(preserved);
        expect(service.getIndexedUnitIds('componentName', 'Before')?.has(active[1].uuid)).toBeTrue();
        expect(service.getIndexedUnitIds('componentName', 'Added')).toBeUndefined();
        service.commitPreparedCatalogIndexes(actual);
        expect(service.getIndexedUnitIds('componentName', 'Before')).toBeUndefined();
        expect(service.getIndexedUnitIds('componentName', 'Added')?.has(units[3].uuid)).toBeTrue();
    });

    it('recalculates component derivatives for only the edited custom unit', () => {
        const service = new UnitSearchIndexService();
        const active = [core(), custom('Changed', -2), custom('Retained', -3)];
        service.commitPreparedCatalogIndexes(service.prepareCatalogIndexes(active, [], []));
        const unchangedType = service.getIndexedUnitIds('type', active[1].type);
        const unitComponents = spyOn(UnitSearchIndexService.prototype as unknown as {
            prepareUnitComponentIndexes(unit: UnitSummary): void;
        }, 'prepareUnitComponentIndexes').and.callThrough();
        const units = structuredClone(active);
        units[1].hash = 'changed';
        const actual = service.prepareCatalogIndexes(units, [], [], undefined, undefined, active);
        expect(unitComponents.calls.allArgs().map(args => args[0].uuid)).toEqual([active[1].uuid]);
        expect(actual.searchFilterIndex.get('type')?.get(active[1].type)).toBe(unchangedType);
    });

    it('removes the last special and tag values, and supports consecutive committed updates', () => {
        const service = new UnitSearchIndexService();
        let active = [core(), custom('Custom', -2)];
        active[1]._nameTags = [{ tag: 'Removed tag', quantity: 1 }];
        service.commitPreparedCatalogIndexes(service.prepareCatalogIndexes(active, [], []));
        for (let revision = 0; revision < 3; revision++) {
            const units = structuredClone(active);
            units[1].hash = String(revision);
            units[1].as.specials = revision % 2 ? ['AC1/2/3'] : [];
            units[1]._nameTags = [];
            const actual = service.prepareCatalogIndexes(units, [], [], undefined, undefined, active);
            const expected = new UnitSearchIndexService().prepareCatalogIndexes(structuredClone(units), [], []);
            expect(comparable(actual)).toEqual(comparable(expected));
            service.commitPreparedCatalogIndexes(actual);
            active = units;
        }
        expect(service.getIndexedFilterValues('_tags')).toEqual([]);
        expect(service.getIndexedFilterValues('as.specials')).toEqual([]);
    });
});
