// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    actionableMekPilotChecks,
    composeMekPsrDisplayModifiers,
    composeMekTurnSummaryHeatRows,
} from './page-turn-summary.util';
import { asLocationId } from '../../../models/entity/entity-identifiers';
import type { MekPilotCheckV2 } from '../../../models/runtime/mek-movement-psr-v2';

describe('actionableMekPilotChecks', () => {
    const check = (triggerKind: MekPilotCheckV2['source']['triggerKind']): MekPilotCheckV2 => ({
        checkId: triggerKind,
        source: { triggerKind },
        status: 'pending',
    } as unknown as MekPilotCheckV2);

    it('keeps every check when there is no automatic fall', () => {
        const checks = [check('leg-destroyed'), check('shutdown'), check('get-up')];
        expect(actionableMekPilotChecks(checks, false)).toEqual(checks);
    });

    it('replaces fall outcomes but keeps shutdown and stand checks actionable', () => {
        const shutdown = check('shutdown');
        const stand = check('get-up');
        expect(actionableMekPilotChecks([
            check('damage-total-20'),
            check('leg-destroyed'),
            shutdown,
            stand,
        ], true)).toEqual([shutdown, stand]);
    });
});

describe('composeMekTurnSummaryHeatRows', () => {
    it('shows selected weapon heat beside committed weapon heat and water cooling', () => {
        expect(composeMekTurnSummaryHeatRows([
            { id: 'movement', label: 'Movement', value: 2 },
            { id: 'weapons', label: 'Weapons', value: 5 },
        ], 8, 3)).toEqual([
            { id: 'movement', label: 'Movement', value: 2 },
            { id: 'weapons', label: 'Weapons', value: 5, selectedValue: 8 },
            {
                id: 'underwater-dissipation',
                label: 'Water',
                value: -3,
                underwater: true,
            },
        ]);
    });

    it('adds a selected-only row when no committed weapon heat exists', () => {
        expect(composeMekTurnSummaryHeatRows([
            { id: 'movement', label: 'Movement', value: 1 },
        ], 4, 0)).toEqual([
            {
                id: 'selected-weapons',
                label: 'Selected Weapons',
                value: 4,
                selectedOnly: true,
            },
            { id: 'movement', label: 'Movement', value: 1 },
        ]);
    });
});

describe('composeMekPsrDisplayModifiers', () => {
    it('keeps rules-owned permanent modifiers and adds phase-only modifiers in production order', () => {
        expect(composeMekPsrDisplayModifiers([
            { modifier: 1, reason: 'Hip Destroyed', locationId: asLocationId('location:left-leg') },
            { modifier: -2, reason: 'Mounts AES in its legs' },
        ], [{
            reason: 'Received 20 damage',
            source: { triggerKind: 'damage-total-20', triggerModifier: 1 },
        }])).toEqual([
            { modifier: -2, reason: 'Mounts AES in its legs' },
            { modifier: 1, reason: 'Hip Destroyed', locationId: 'location:left-leg' },
            { modifier: 1, reason: 'Received 20 damage' },
        ]);
    });

    it('shows the current gyro check instead of double-counting committed gyro damage', () => {
        expect(composeMekPsrDisplayModifiers([
            { modifier: 3, reason: 'Gyro damaged' },
        ], [{
            reason: 'Gyro hit',
            source: { triggerKind: 'gyro-hit', triggerModifier: 3 },
        }])).toEqual([{ modifier: 3, reason: 'Gyro hit' }]);
    });
});
