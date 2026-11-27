// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { createEmptyUnit } from '../testing/unit-test-helpers';
import type { DataService } from '../services/data.service';
import { resolveForcePackUnits } from './force-pack.util';

describe('Force pack unit identity', () => {
    it('resolves exact UUIDs even when catalog keys collide or change', () => {
        const first = createEmptyUnit({ name: 'same-key', chassis: 'Crab', model: 'CRB-20' });
        const second = createEmptyUnit({ name: 'same-key', chassis: 'Crab', model: 'CRB-27' });
        const getUnitByUuid = jasmine.createSpy('getUnitByUuid').and.callFake(uuid =>
            [first, second].find(unit => unit.uuid === uuid));
        const getUnitByIdentifier = jasmine.createSpy('getUnitByIdentifier').and.throwError('Legacy lookup is forbidden');
        const data = { getUnitByUuid, getUnitByIdentifier } as unknown as DataService;
        const entries = [{ uuid: second.uuid }, { uuid: first.uuid }];
        expect(resolveForcePackUnits(entries, data).map(entry => entry.unit)).toEqual([second, first]);
        first.name = 'renamed-key';
        expect(resolveForcePackUnits(entries, data).map(entry => entry.model)).toEqual(['CRB-27', 'CRB-20']);
        expect(getUnitByIdentifier).not.toHaveBeenCalled();
    });
});
