// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    applyEquipmentRowOrder,
    freezeEquipmentRowOrder,
    setEquipmentRowOrder,
} from './equipment-row-order';

describe('equipment row order', () => {
    it('stores each permutation and preserves the other group', () => {
        const ranged = setEquipmentRowOrder(undefined, 'ranged', [1, 0, 2], 3);
        expect(ranged).toEqual({ ranged: [1, 0, 2] });

        const both = setEquipmentRowOrder(ranged, 'physical', [1, 0], 2);
        expect(both).toEqual({ ranged: [1, 0, 2], physical: [1, 0] });
        expect(setEquipmentRowOrder(both, 'physical', [1, 0], 2)).toBe(both);
    });

    it('keeps Entity order as a choice, since the default order differs from it', () => {
        // Unit file: Small Laser, LRM 20; the default shows the LRM first. Dragging the laser back up is [0, 1].
        const chosen = setEquipmentRowOrder(undefined, 'ranged', [0, 1], 2);
        expect(chosen).toEqual({ ranged: [0, 1] });
        expect(freezeEquipmentRowOrder(chosen)).toEqual({ ranged: [0, 1] });
        const longestFirst = (rows: readonly string[]) => [...rows].reverse();
        expect(applyEquipmentRowOrder(['small laser', 'lrm 20'], freezeEquipmentRowOrder(chosen)?.ranged, longestFirst))
            .toEqual(['small laser', 'lrm 20']);
    });

    it('applies valid order and falls back to Entity order after topology drift', () => {
        expect(applyEquipmentRowOrder(['a', 'b', 'c'], [2, 0, 1]))
            .toEqual(['c', 'a', 'b']);
        expect(applyEquipmentRowOrder(['a', 'b'], [2, 0, 1]))
            .toEqual(['a', 'b']);
    });

    it('gives rows without a valid saved order their default order', () => {
        const reversed = (rows: readonly string[]) => [...rows].reverse();
        expect(applyEquipmentRowOrder(['a', 'b', 'c'], undefined, reversed)).toEqual(['c', 'b', 'a']);
        expect(applyEquipmentRowOrder(['a', 'b'], [2, 0, 1], reversed)).toEqual(['b', 'a']);
        expect(applyEquipmentRowOrder(['a', 'b', 'c'], [1, 2, 0], reversed)).toEqual(['b', 'c', 'a']);
    });

    it('rejects duplicate, missing, or out-of-range canonical indexes', () => {
        expect(() => setEquipmentRowOrder(undefined, 'ranged', [0, 0], 2)).toThrow();
        expect(() => setEquipmentRowOrder(undefined, 'ranged', [0], 2)).toThrow();
        expect(() => freezeEquipmentRowOrder({ physical: [0, 2] })).toThrow();
    });
});
