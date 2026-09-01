// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { getMotiveModeLabel, getMotiveModeMaxDistance, getMotiveModesByUnit } from './motiveModes.model';
import type { UnitSummary } from './unit-summary.model';

function createUnit(overrides: Partial<UnitSummary> = {}): UnitSummary {
    return {
        type: 'Mek',
        subtype: 'Biped',
        walk: 5,
        walk2: 0,
        run: 8,
        run2: 0,
        jump: 5,
        umu: 0,
        ...overrides,
    } as UnitSummary;
}

describe('motiveModes', () => {
    it('places Sprint after Run for grounded Meks', () => {
        const unit = createUnit();

        expect(getMotiveModesByUnit(unit, false)).toEqual([
            'stationary', 'walk', 'run', 'sprint', 'jump',
        ]);
        expect(getMotiveModeLabel('sprint', unit)).toBe('Sprint');
        expect(getMotiveModeMaxDistance('sprint', unit)).toBe(10);
    });

    it('maps Aero movement to stationary and thrust modes', () => {
        const unit = createUnit({ type: 'Aero', subtype: 'Spheroid DropShip', moveType: 'Spheroid', jump: 5, umu: 2 });

        expect(getMotiveModesByUnit(unit, false)).toEqual(['stationary', 'walk', 'run']);
        expect(getMotiveModesByUnit(unit, true)).toEqual(['stationary', 'walk', 'run']);
        expect(getMotiveModeLabel('walk', unit)).toBe('Safe Thrust');
        expect(getMotiveModeLabel('run', unit)).toBe('Maximum Thrust');
    });

    it('omits stationary for airborne LAMs', () => {
        const unit = createUnit({ subtype: 'Land-Air BattleMek' });

        expect(getMotiveModesByUnit(unit, true)).not.toContain('stationary');
        expect(getMotiveModesByUnit(unit, true)).toContain('walk');
        expect(getMotiveModesByUnit(unit, true)).toContain('run');
        expect(getMotiveModesByUnit(unit, true)).not.toContain('sprint');
    });

    it('keeps stationary for grounded LAMs and non-LAM airborne units', () => {
        expect(getMotiveModesByUnit(createUnit({ subtype: 'Land-Air BattleMek' }), false)).toContain('stationary');
        expect(getMotiveModesByUnit(createUnit({ moveType: 'VTOL' }), true)).toContain('stationary');
    });
});
