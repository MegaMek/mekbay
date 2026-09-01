// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { shouldWrapTacticalDamageTracks } from './tactical-armor-layout.directive';

describe('shouldWrapTacticalDamageTracks', () => {
    it('keeps every row side by side when their content fits', () => {
        expect(shouldWrapTacticalDamageTracks([
            { availableWidth: 300, stripWidths: [150, 120], gap: 5 },
            { availableWidth: 300, stripWidths: [100, 80], gap: 5 },
        ])).toBeFalse();
    });

    it('wraps every row when one armor and internal pair does not fit', () => {
        expect(shouldWrapTacticalDamageTracks([
            { availableWidth: 300, stripWidths: [150, 120], gap: 5 },
            { availableWidth: 300, stripWidths: [180, 120], gap: 5 },
        ])).toBeTrue();
    });

    it('does not let a rear armor-only row force the shared layout to wrap', () => {
        expect(shouldWrapTacticalDamageTracks([
            { availableWidth: 100, stripWidths: [300], gap: 5 },
            { availableWidth: 300, stripWidths: [150, 120], gap: 5 },
        ])).toBeFalse();
    });
});
