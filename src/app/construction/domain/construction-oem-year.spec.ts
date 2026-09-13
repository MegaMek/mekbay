// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { createConstructionEntity } from './construction-factory';
import { getConstructionFields } from './construction-fields';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';

describe('construction OEM year fields', () => {
    const registry = createTestEquipmentRegistry();

    it('stores only an earlier OEM year and clears blank or equal values', () => {
        const entity = createConstructionEntity('Biped', registry);
        entity.year.set(3100);
        const field = getConstructionFields(entity).find(field => field.id === 'originalBuildYear')!;
        expect(field.get()).toBe('');
        field.set(3025);
        expect(entity.originalBuildYear()).toBe(3025);
        field.set(3100);
        expect(entity.originalBuildYear()).toBe(-1);
        expect(field.get()).toBe('');
        field.set(3025);
        field.set('');
        expect(entity.originalBuildYear()).toBe(-1);
        for (const invalid of [0, -1, 3101, 3025.5, Number.NaN]) {
            expect(() => field.set(invalid)).toThrowError('OEM year must be earlier than the introduction year.');
        }
        expect(entity.originalBuildYear()).toBe(-1);
    });

    it('keeps the OEM interval valid when the introduction year changes', () => {
        const entity = createConstructionEntity('Tank', registry);
        entity.year.set(3100);
        entity.originalBuildYear.set(3025);
        const field = getConstructionFields(entity).find(field => field.id === 'year')!;
        expect(() => field.set(3024)).toThrowError('Introduction year cannot be earlier than the OEM year.');
        expect(entity.year()).toBe(3100);
        expect(entity.originalBuildYear()).toBe(3025);
        field.set(3150);
        expect(entity.originalBuildYear()).toBe(3025);
        field.set(3025);
        expect(entity.year()).toBe(3025);
        expect(entity.originalBuildYear()).toBe(-1);
    });
});
