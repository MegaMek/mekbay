// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { enclosingGroupBounds, getOverlapArea, rectsOverlap, resolveCollisionPosition } from './force-org-layout';

describe('TO&E canvas layout', () => {
    it('wraps child cards and groups with the same header and padding used by previews', () => {
        expect(enclosingGroupBounds([
            { x: 40, y: 100, width: 220, height: 70 },
            { x: -20, y: 220, width: 320, height: 160 },
        ])).toEqual({ x: -40, y: 20, width: 360, height: 380 });
        expect(enclosingGroupBounds([])).toBeNull();
    });

    it('treats touching edges as collisions but not positive-area drop overlaps', () => {
        const first = { x: 0, y: 0, width: 220, height: 70 };
        const touching = { x: 220, y: 0, width: 220, height: 70 };
        expect(rectsOverlap(first, touching)).toBeTrue();
        expect(getOverlapArea(first, touching)).toBe(0);
    });

    it('keeps the first nearest candidate when two clear positions are equally far away', () => {
        const card = { x: 0, y: 0, width: 220, height: 70 };
        expect(resolveCollisionPosition(card, [card], 'force')).toEqual({ x: 0, y: -80 });
    });

    it('checks every sibling before accepting a candidate', () => {
        const card = { x: 0, y: 0, width: 220, height: 70 };
        const above = { x: -20, y: -100, width: 260, height: 70 };
        expect(resolveCollisionPosition(card, [card, above], 'force')).toEqual({ x: 0, y: 80 });
    });

    it('retains the untouched axis for off-grid group bounds', () => {
        const group = { x: -13, y: -7, width: 300, height: 190 };
        expect(resolveCollisionPosition(group, [group], 'group')).toEqual({ x: -13, y: 200 });
    });

    it('does not move clear rectangles, including an empty canvas', () => {
        const card = { x: 0, y: 0, width: 220, height: 70 };
        expect(resolveCollisionPosition(card, [], 'force')).toBeNull();
        expect(resolveCollisionPosition(card, [{ ...card, x: 240 }], 'force')).toBeNull();
    });
});
