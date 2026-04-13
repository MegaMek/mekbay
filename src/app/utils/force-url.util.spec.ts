import { GameSystem } from '../models/common.model';
import type { Force } from '../models/force.model';
import type { ForceUnit } from '../models/force-unit.model';
import type { Unit } from '../models/units.model';
import { parseForceFromUrl } from './force-url.util';

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
        addUnit: jasmine.createSpy('addUnit').and.callFake((unit: Unit) => {
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

describe('force URL parsing', () => {
    it('parses units by name by default', () => {
        const force = createMockForce();
        const units = [
            { name: 'BMAtlas_AS7D', id: 140 } as Unit,
            { name: 'BMLocust_LCT1V', id: 1901 } as Unit
        ];

        const forceUnits = parseForceFromUrl(force, 'BMAtlas_AS7D,BMLocust_LCT1V', units);

        expect(forceUnits.map(unit => unit.getUnit().name)).toEqual(['BMAtlas_AS7D', 'BMLocust_LCT1V']);
    });

    it('parses units by name without matching case exactly', () => {
        const force = createMockForce();
        const units = [
            { name: 'BMAtlas_AS7D', id: 140 } as Unit,
            { name: 'BMLocust_LCT1V', id: 1901 } as Unit
        ];

        const forceUnits = parseForceFromUrl(force, 'bmatlas_as7d,bmlocust_lct1v', units);

        expect(forceUnits.map(unit => unit.getUnit().name)).toEqual(['BMAtlas_AS7D', 'BMLocust_LCT1V']);
    });

    it('parses units by mul id and keeps the first duplicate match', () => {
        const force = createMockForce();
        const logger = { warn: jasmine.createSpy('warn') };
        const units = [
            { name: 'BMAtlas_AS7D', id: 140 } as Unit,
            { name: 'BMAtlas_AS7K', id: 144 } as Unit,
            { name: 'BMLocust_LCT1V', id: 1901 } as Unit
        ];

        const forceUnits = parseForceFromUrl(force, 'Alpha~140,1901', units, logger, 'mulId');
        const groups = force.groups() as unknown as Array<ReturnType<typeof createMockGroup>>;

        expect(forceUnits.map(unit => unit.getUnit().name)).toEqual(['BMAtlas_AS7D', 'BMLocust_LCT1V']);
        expect(groups[1]?.name.set).toHaveBeenCalledWith('Alpha');
        expect(groups[1]?.units().map(unit => unit.getUnit().name)).toEqual(['BMAtlas_AS7D', 'BMLocust_LCT1V']);
        expect(logger.warn).not.toHaveBeenCalled();
    });
});