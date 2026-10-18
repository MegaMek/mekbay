// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    actionableMekPilotChecks,
    composeTurnSummaryHeatRows,
    mekPsrDisplayModifiers,
    runWithTurnSummaryCloseBlocked,
} from './page-turn-summary.util';
import type { MekPilotCheckV2 } from '../../../models/runtime/mek-movement-psr-v2';
import { createDirectMekRuntimeFixture } from '../../../models/runtime/testing/direct-mek-runtime-fixture';
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

describe('mekPsrDisplayModifiers', () => {
    it('shows the damage the unit holds and the 20+ damage event every roll of the phase adds', () => {
        const fixture = createDirectMekRuntimeFixture('total-warfare');
        const query = () => fixture.instance.query();
        for (const face of fixture.index.armorFaces.values()) {
            if (query().mekMovementPsrState().damageThisPhase >= 20) break;
            if (face.maximumPoints === 0) continue;
            expect(fixture.instance.dispatch({ type: 'damage-armor', faceId: face.id, amount: face.maximumPoints,
                target: 'committed' }).accepted).toBeTrue();
        }
        const rows = mekPsrDisplayModifiers(query().mekMovementPsr());
        expect(rows).toContain({ modifier: 1, reason: `Received ${query().mekMovementPsrState().damageThisPhase} damage` });
        const target = fixture.instance.query().mekPilotChecks()[0]!.targetNumber;
        expect(target).toBe(5 + rows.reduce((sum, row) => sum + row.modifier, 0));
    });

    it('counts a gyro hit once: the damage the unit holds is the hit (TW p.60)', () => {
        const fixture = createDirectMekRuntimeFixture('total-warfare');
        const gyro = [...fixture.index.slots.values()].find(slot => slot.componentIds.some(componentId => {
            const component = fixture.index.components.get(componentId);
            return component?.kind === 'system' && component.systemType === 'Gyro';
        }))!;
        expect(fixture.instance.dispatch({ type: 'hit-critical', slotId: gyro.id, hits: 1, target: 'committed' })
            .accepted).toBeTrue();
        expect(mekPsrDisplayModifiers(fixture.instance.query().mekMovementPsr())
            .filter(row => row.reason.includes('Gyro'))).toEqual([{ modifier: 3, reason: 'Gyro damaged' }]);
    });
});
