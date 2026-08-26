// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    applyEquipmentRowOrder,
    freezeEquipmentRowOrder,
    setEquipmentRowOrder,
} from './equipment-row-order';

describe('equipment row order', () => {
    it('stores only non-canonical permutations and preserves the other group', () => {
        const ranged = setEquipmentRowOrder(undefined, 'ranged', [1, 0, 2], 3);
        expect(ranged).toEqual({ ranged: [1, 0, 2] });

        const both = setEquipmentRowOrder(ranged, 'physical', [1, 0], 2);
        expect(both).toEqual({ ranged: [1, 0, 2], physical: [1, 0] });

        const physicalOnly = setEquipmentRowOrder(both, 'ranged', [0, 1, 2], 3);
        expect(physicalOnly).toEqual({ physical: [1, 0] });
        expect(setEquipmentRowOrder(physicalOnly, 'physical', [0, 1], 2)).toBeUndefined();
    });

    it('applies valid order and falls back to Entity order after topology drift', () => {
        expect(applyEquipmentRowOrder(['a', 'b', 'c'], [2, 0, 1]))
            .toEqual(['c', 'a', 'b']);
        expect(applyEquipmentRowOrder(['a', 'b'], [2, 0, 1]))
            .toEqual(['a', 'b']);
    });

    it('rejects duplicate, missing, or out-of-range canonical indexes', () => {
        expect(() => setEquipmentRowOrder(undefined, 'ranged', [0, 0], 2)).toThrow();
        expect(() => setEquipmentRowOrder(undefined, 'ranged', [0], 2)).toThrow();
        expect(() => freezeEquipmentRowOrder({ physical: [0, 2] })).toThrow();
    });
});
