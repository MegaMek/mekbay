// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { shouldShowAdjustedPilotSkills } from './unit-details-general-tab.component';

describe('UnitDetailsGeneralTabComponent', () => {
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
});