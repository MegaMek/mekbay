// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    mekConsciousnessTarget,
    mekHeatAmmoExplosionTarget,
    mekHeatAutomationChecks,
    mekHeatShutdownTarget,
    roll2D6,
} from './mek-automation-rules';

describe('direct Mek automation rules', () => {
    it('uses the cumulative shutdown and ammunition-explosion thresholds', () => {
        expect([13, 14, 18, 22, 26, 30].map(mekHeatShutdownTarget))
            .toEqual([undefined, 4, 6, 8, 10, 100]);
        expect([18, 19, 23, 28].map(mekHeatAmmoExplosionTarget))
            .toEqual([undefined, 4, 6, 8]);
    });

    it('keeps shutdown, restart, and ammunition checks independent', () => {
        expect(mekHeatAutomationChecks({
            heat: 23, shutdown: false, consciousPilot: true, hasExplosiveAmmo: true,
        })).toEqual([
            { kind: 'shutdown', target: 8 },
            { kind: 'ammo-explosion', target: 6 },
        ]);
        expect(mekHeatAutomationChecks({
            heat: 30, shutdown: false, consciousPilot: true, hasExplosiveAmmo: false,
        })).toEqual([{ kind: 'shutdown', automaticOutcome: 'failed' }]);
        expect(mekHeatAutomationChecks({
            heat: 13, shutdown: true, consciousPilot: false, hasExplosiveAmmo: false,
        })).toEqual([{ kind: 'startup', automaticOutcome: 'success' }]);
        expect(mekHeatAutomationChecks({
            heat: 18, shutdown: true, consciousPilot: true, hasExplosiveAmmo: false,
        })).toEqual([{ kind: 'startup', target: 6 }]);
    });

    it('automatically fails shutdown checks when no conscious pilot can intervene', () => {
        expect(mekHeatAutomationChecks({
            heat: 14, shutdown: false, consciousPilot: false, hasExplosiveAmmo: false,
        })).toEqual([{ kind: 'shutdown', automaticOutcome: 'failed' }]);
    });

    it('owns consciousness targets and two-die evidence', () => {
        expect([0, 1, 2, 3, 4, 5, 6].map(mekConsciousnessTarget))
            .toEqual([undefined, 3, 5, 7, 10, 11, undefined]);
        expect(roll2D6(() => 0)).toEqual([1, 1]);
        expect(roll2D6(() => 0.999)).toEqual([6, 6]);
    });
});
