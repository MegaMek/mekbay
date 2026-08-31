// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    actionableMekPilotChecks,
    composeMekPsrDisplayModifiers,
    composeTurnSummaryHeatRows,
    runWithTurnSummaryCloseBlocked,
} from './page-turn-summary.util';
import { asLocationId } from '../../../models/entity/entity-identifiers';
import type { MekPilotCheckV2 } from '../../../models/runtime/mek-movement-psr-v2';
import type { OverlayManagerService } from '../../../services/overlay-manager.service';

describe('runWithTurnSummaryCloseBlocked', () => {
    it('keeps the summary blocked until a dismissed confirmation settles', async () => {
        const overlayManager = jasmine.createSpyObj<OverlayManagerService>(
            'OverlayManagerService',
            ['blockCloseUntil', 'unblockClose'],
        );
        let dismiss!: (confirmed: boolean) => void;
        const operation = jasmine.createSpy('operation').and.returnValue(
            new Promise<boolean>(resolve => dismiss = resolve),
        );

        const result = runWithTurnSummaryCloseBlocked(overlayManager, 'unit-1', operation);

        expect(overlayManager.blockCloseUntil).toHaveBeenCalledOnceWith('turnSummary-unit-1');
        expect(overlayManager.unblockClose).not.toHaveBeenCalled();

        dismiss(false);

        await expectAsync(result).toBeResolvedTo(false);
        expect(overlayManager.unblockClose).toHaveBeenCalledOnceWith('turnSummary-unit-1');
    });
});

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

describe('composeTurnSummaryHeatRows', () => {
    it('shows selected weapon heat beside committed weapon heat and water cooling', () => {
        expect(composeTurnSummaryHeatRows([
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
        expect(composeTurnSummaryHeatRows([
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

    it('omits zero heat and keeps compact equipment groups detailed', () => {
        expect(composeTurnSummaryHeatRows([
            { id: 'movement', label: 'Movement', value: 0 },
            { id: 'stealth:null-signature', label: 'Stealth', value: 10, group: 'Equipment' },
            { id: 'engine', label: 'Engine', value: 5 },
            { id: 'nova-cews', label: 'Nova CEWS', value: 2, group: 'Equipment' },
        ], null, 0)).toEqual([
            { id: 'stealth:null-signature', label: 'Stealth', value: 10 },
            { id: 'engine', label: 'Engine', value: 5 },
            { id: 'nova-cews', label: 'Nova CEWS', value: 2 },
        ]);
    });

    it('combines repeated detailed labels without applying their compact group', () => {
        expect(composeTurnSummaryHeatRows([
            { id: 'nova-a', label: 'Nova CEWS', value: 2, group: 'Equipment' },
            { id: 'nova-b', label: 'Nova CEWS', value: 2, group: 'Equipment' },
        ], null, 0)).toEqual([
            { id: 'nova cews', label: 'Nova CEWS', value: 4 },
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
