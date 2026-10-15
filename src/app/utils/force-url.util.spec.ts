// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { GameSystem } from '../models/common.model';
import type { Force } from '../models/force.model';
import type { ForceUnit } from '../models/force-unit.model';
import type { UnitSummary } from '../models/unit-summary.model';
import { createEmptyUnit } from '../testing/unit-test-helpers';
import { buildMultiForceQueryParams, generateUnitUrlParams, parseForceFromUrl } from './force-url.util';

type WritableArraySignal<T> = (() => T[]) & { set: (next: T[]) => void };

function createWritableArraySignal<T>(initialValue: T[] = []): WritableArraySignal<T> {
    let value = initialValue;
    const signal = (() => value) as WritableArraySignal<T>;
    signal.set = (next: T[]) => {
        value = next;
    };
    return signal;
}

function createMockGroup(id: string) {
    return {
        id,
        name: { set: jasmine.createSpy('setName') },
        formation: { set: jasmine.createSpy('setFormation') },
        formationLock: false,
        units: createWritableArraySignal<ForceUnit>([])
    };
}

function createMockForce(): Force {
    const groups = [createMockGroup('default-group')];
    let nextForceUnitId = 0;

    return {
        gameSystem: GameSystem.CLASSIC,
        addGroup: jasmine.createSpy('addGroup').and.callFake(() => {
            const group = createMockGroup(`group-${groups.length}`);
            groups.push(group);
            return group;
        }),
        addUnit: jasmine.createSpy('addUnit').and.callFake((unit: UnitSummary) => {
            const forceUnit = {
                id: `force-unit-${nextForceUnitId++}`,
                getUnit: () => unit
            } as ForceUnit;
            const defaultGroup = groups[0];
            defaultGroup.units.set([...defaultGroup.units(), forceUnit]);
            return forceUnit;
        }),
        groups: () => groups
    } as unknown as Force;
}

/** Stands in for the DataService UUID-then-name lookup, whose rules are tested in UnitRuntimeService. */
function identifierLookup(units: readonly UnitSummary[]): (identifier: string) => UnitSummary | undefined {
    return identifier => units.find(unit => unit.uuid === identifier || unit.name === identifier);
}

describe('force URL parsing', () => {
    it('resolves each legacy name or UUID token through the catalog lookup', () => {
        const force = createMockForce();
        const units = [
            createEmptyUnit({ name: 'BMAtlas_AS7D', mul1id: 140 }),
            createEmptyUnit({ name: 'BMLocust_LCT1V', mul1id: 1901 })
        ];
        const getUnit = jasmine.createSpy('getUnit').and.callFake(identifierLookup(units));

        const forceUnits = parseForceFromUrl(force, `BMAtlas_AS7D,${units[1].uuid}`, getUnit);

        expect(getUnit.calls.allArgs()).toEqual([['BMAtlas_AS7D'], [units[1].uuid]]);
        expect(forceUnits.map(unit => unit.getUnit().name)).toEqual(['BMAtlas_AS7D', 'BMLocust_LCT1V']);
    });

    it('parses grouped UUIDs independently of shared or missing MUL IDs', () => {
        const force = createMockForce();
        const logger = { warn: jasmine.createSpy('warn') };
        const units = [
            createEmptyUnit({ name: 'BMAtlas_AS7D', mul1id: 140 }),
            createEmptyUnit({ name: 'BMAtlas_AS7K', mul1id: 140 }),
            createEmptyUnit({ name: 'BMLocust_LCT1V', mul1id: null })
        ];

        const forceUnits = parseForceFromUrl(force, `Alpha~${units[1].uuid},${units[2].uuid}`, identifierLookup(units), logger);
        const groups = force.groups() as unknown as Array<ReturnType<typeof createMockGroup>>;
        expect(forceUnits.map(unit => unit.getUnit().uuid)).toEqual([units[1].uuid, units[2].uuid]);

        expect(forceUnits.map(unit => unit.getUnit().name)).toEqual(['BMAtlas_AS7K', 'BMLocust_LCT1V']);
        expect(groups[1]?.name.set).toHaveBeenCalledWith('Alpha');
        expect(groups[1]?.units().map(unit => unit.getUnit().name)).toEqual(['BMAtlas_AS7K', 'BMLocust_LCT1V']);
        expect(logger.warn).not.toHaveBeenCalled();
    });
});

describe('force URL serialization', () => {
    it('round-trips remote-unit UUIDs containing URL separators without a MUL ID', () => {
        const summary = createEmptyUnit({ uuid: 'custom:server:Unit%20~Variant,1|A', mul1id: null });
        const source = createMockForce();
        const units = generateUnitUrlParams([source.addUnit(summary)]).join(',');
        const params = new URLSearchParams({ units });
        const decoded = new URLSearchParams(params.toString()).get('units')!;
        const restored = parseForceFromUrl(createMockForce(), decoded, identifierLookup([summary]));

        expect(restored.map(unit => unit.getUnit())).toEqual([summary]);
    });

    it('omits session-only lobby forces', () => {
        const persistedForce = { instanceId: () => 'persisted-force' } as unknown as Force;
        const lobbyForce = { instanceId: () => 'lobby-force' } as unknown as Force;

        const params = buildMultiForceQueryParams([
            { force: persistedForce, alignment: 'friendly', changeSub: null },
            { force: lobbyForce, alignment: 'enemy', changeSub: null, persistInUrl: false },
        ]);

        expect(params.instance).toBe('persisted-force');
    });
});
