// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { planLargeAeroRecordSheetPages } from './large-aero-record-sheet-page-plan';

describe('planLargeAeroRecordSheetPages', () => {
    it('keeps a compact capital-vessel inventory on one page', () => {
        const plan = planLargeAeroRecordSheetPages({
            capitalWeaponLines: 12,
            standardWeaponLines: 8,
            hasAr10: false,
            gravDeckCount: 2,
            transportBayLines: 2,
        });

        expect(plan.pageCount).toBe(1);
        expect([...plan.reverse]).toEqual([]);
        expect(plan.front.has('capital-weapons')).toBeTrue();
        expect(plan.front.has('standard-weapons')).toBeTrue();
    });

    it('moves standard-scale weapons first for a crowded dual-scale vessel', () => {
        const plan = planLargeAeroRecordSheetPages({
            capitalWeaponLines: 20,
            standardWeaponLines: 24,
            hasAr10: true,
            gravDeckCount: 8,
            transportBayLines: 3,
        });

        expect(plan.pageCount).toBe(2);
        expect(plan.front.has('capital-weapons')).toBeTrue();
        expect(plan.reverse.has('standard-weapons')).toBeTrue();
        expect(plan.reverse.has('grav-decks')).toBeTrue();
    });

    it('does not move the only standard-scale weapon table off the front', () => {
        const plan = planLargeAeroRecordSheetPages({
            capitalWeaponLines: 0,
            standardWeaponLines: 38,
            hasAr10: false,
            gravDeckCount: 8,
            transportBayLines: 4,
        });

        expect(plan.pageCount).toBe(2);
        expect(plan.front.has('standard-weapons')).toBeTrue();
        expect(plan.reverse.has('standard-weapons')).toBeFalse();
        expect(plan.reverse.has('grav-decks')).toBeTrue();
        expect(plan.reverse.has('transport-bays')).toBeTrue();
    });
});
