// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { aeroHeatEffects } from '../rules/aero-runtime-rules';
import { projectAeroHeatAutomationChecks } from './aero-heat-automation-rules';

describe('aerospace heat automation projection', () => {
    it('projects every actionable high-heat check in rules order', () => {
        expect(projectAeroHeatAutomationChecks({
            heat: 30,
            effects: aeroHeatEffects(30),
            shutdown: false,
            activeController: false,
            hasExplosiveAmmo: true,
            hadHeatControlEffect: false,
        })).toEqual([
            { kind: 'shutdown', automaticOutcome: 'failed' },
            { kind: 'ammo-explosion', target: 8 },
            { kind: 'random-movement', target: 10 },
            { kind: 'pilot-damage', target: 9 },
        ]);
    });

    it('projects automatic startup and clearing a stale heat-control effect', () => {
        expect(projectAeroHeatAutomationChecks({
            heat: 3,
            effects: aeroHeatEffects(3),
            shutdown: true,
            activeController: true,
            hasExplosiveAmmo: false,
            hadHeatControlEffect: true,
        })).toEqual([
            { kind: 'startup', automaticOutcome: 'success' },
            { kind: 'clear-heat-control', automaticOutcome: 'success' },
        ]);
    });
});
