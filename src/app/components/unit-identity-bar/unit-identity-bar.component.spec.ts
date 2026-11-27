// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { shouldShowAdjustedPilotSkills, unitValueDisplay } from './unit-identity-bar.component';
import { createEmptyUnit } from '../../testing/unit-test-helpers';

describe('unit identity bar value', () => {
    describe('shouldShowAdjustedPilotSkills', () => {
        it('shows skills when adjusted BV differs from base BV', () => {
            expect(shouldShowAdjustedPilotSkills(1200, 1000, 3, 4)).toBeTrue();
        });

        it('hides skills when adjusted BV equals base BV', () => {
            expect(shouldShowAdjustedPilotSkills(1000, 1000, 4, 5)).toBeFalse();
        });

        it('hides skills when BV or skill data is unavailable or invalid', () => {
            expect(shouldShowAdjustedPilotSkills(null, 1000, 3, 4)).toBeFalse();
            expect(shouldShowAdjustedPilotSkills(Number.NaN, 1000, 3, 4)).toBeFalse();
            expect(shouldShowAdjustedPilotSkills(1200, 1000, undefined, 4)).toBeFalse();
            expect(shouldShowAdjustedPilotSkills(1200, 1000, 3, undefined)).toBeFalse();
        });
    });

    it('notes the base under an override, the skills a catalog unit is priced at, and nothing for its plain value', () => {
        const unit = createEmptyUnit({ bv: 1906 });

        expect(unitValueDisplay(unit, undefined, 'none' as never, 2097, undefined, undefined, false))
            .toEqual({ label: 'BV', value: 2097, base: 1906, skills: null });
        const atSkills = unitValueDisplay(unit, undefined, 'none' as never, undefined, 3, 4, false);
        expect(atSkills.value).not.toBe(1906);
        expect(atSkills.base).toBe(1906);
        expect(atSkills.skills).toBe('3/4');
        expect(unitValueDisplay(unit, undefined, 'none' as never, undefined, undefined, undefined, false))
            .toEqual({ label: 'BV', value: 1906, base: null, skills: null });
    });
});
