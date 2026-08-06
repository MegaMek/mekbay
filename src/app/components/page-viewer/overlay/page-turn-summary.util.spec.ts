// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { composeTurnSummaryHeatRows, countActionablePsrChecks, displayPsrModifiers } from './page-turn-summary.util';

describe('countActionablePsrChecks', () => {
    const fallCheck = { failureOutcome: 'Fall' };
    const crippleCheck = { failureOutcome: 'Crippled' };

    it('shows all checks when the unit is not automatically falling', () => {
        expect(countActionablePsrChecks([fallCheck, crippleCheck], false)).toBe(2);
    });

    it('hides the warning when autofall already represents every check', () => {
        expect(countActionablePsrChecks([fallCheck, fallCheck], true)).toBe(0);
    });

    it('keeps non-fall checks actionable during autofall', () => {
        expect(countActionablePsrChecks([fallCheck, crippleCheck], true)).toBe(1);
    });
});

describe('displayPsrModifiers', () => {
    it('filters and preserves the rules-level modifier order', () => {
        expect(displayPsrModifiers([
            { reason: 'Leg Destroyed', pilotCheck: 4 },
            { reason: 'Ignored', pilotCheck: 0 },
            { reason: 'Gyro damaged', modifierReason: 'Gyro hit', pilotCheck: 2 },
        ]).map(modifier => modifier.reason)).toEqual(['Leg Destroyed', 'Gyro hit']);
    });

    it('uses a dedicated modifier reason without changing the source check', () => {
        const check = {
            reason: 'Hip hit, Leg Actuator hit',
            modifierReason: 'Hip hit, Leg Actuators hit (2)',
            pilotCheck: 3,
        };

        expect(displayPsrModifiers([check])[0].reason).toBe('Hip hit, Leg Actuators hit (2)');
        expect(check.reason).toBe('Hip hit, Leg Actuator hit');
    });
});

describe('composeTurnSummaryHeatRows', () => {
    it('keeps committed Weapons when no weapon is selected', () => {
        expect(composeTurnSummaryHeatRows(
            [{ id: 'weapons', label: 'Weapons', value: 20 }],
            { hasSelection: false, value: 0, entryIds: new Set() }
        )).toEqual([{ id: 'weapons', label: 'Weapons', value: 20 }]);
    });

    it('shows Selected Weapons when there is no committed Weapons heat', () => {
        expect(composeTurnSummaryHeatRows(
            [{ id: 'engine', label: 'Engine', value: 5 }],
            { hasSelection: true, value: 15, entryIds: new Set(['laser']) }
        )).toEqual([
            { id: 'selected-weapons', label: 'Selected Weapons', value: 15, selectedOnly: true },
            { id: 'engine', label: 'Engine', value: 5 },
        ]);
    });

    it('combines committed and selected Weapons as alternative values', () => {
        expect(composeTurnSummaryHeatRows(
            [
                { id: 'weapons', label: 'Weapons', value: 20 },
                { id: 'engine', label: 'Engine', value: 5 },
            ],
            { hasSelection: true, value: 15, entryIds: new Set(['laser']) }
        )).toEqual([
            { id: 'weapons', label: 'Weapons', value: 20, selectedValue: 15 },
            { id: 'engine', label: 'Engine', value: 5 },
        ]);
    });
});