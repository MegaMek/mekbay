// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Subject } from 'rxjs';
import type { ManagedOverlayRef, OverlayManagerService } from '../../../services/overlay-manager.service';
import { composeTurnSummaryHeatRows, displayPsrModifiers, isMoveModeDisabledWhileProne, openTurnSummaryChildOverlay, runWithTurnSummaryCloseBlocked } from './page-turn-summary.util';

describe('runWithTurnSummaryCloseBlocked', () => {
    it('keeps the summary blocked until a dismissed confirmation settles', async () => {
        const overlayManager = jasmine.createSpyObj<OverlayManagerService>(
            'OverlayManagerService',
            ['blockCloseUntil', 'unblockClose'],
        );
        let dismiss!: (confirmed: boolean) => void;
        const operation = jasmine.createSpy('operation').and.returnValue(new Promise<boolean>(resolve => {
            dismiss = resolve;
        }));

        const result = runWithTurnSummaryCloseBlocked(overlayManager, 'unit-1', operation);

        expect(overlayManager.blockCloseUntil).toHaveBeenCalledOnceWith('turnSummary-unit-1');
        expect(overlayManager.unblockClose).not.toHaveBeenCalled();

        dismiss(false);

        await expectAsync(result).toBeResolvedTo(false);
        expect(overlayManager.unblockClose).toHaveBeenCalledOnceWith('turnSummary-unit-1');
    });
});

describe('openTurnSummaryChildOverlay', () => {
    it('blocks the parent summary until the child overlay closes', () => {
        const closed = new Subject<void>();
        const overlayManager = jasmine.createSpyObj<OverlayManagerService>(
            'OverlayManagerService',
            ['blockCloseUntil', 'unblockClose'],
        );
        const childOverlay = { closed } as ManagedOverlayRef<unknown>;
        const openOverlay = jasmine.createSpy('openOverlay').and.returnValue(childOverlay);

        expect(openTurnSummaryChildOverlay(overlayManager, 'unit-1', openOverlay)).toBe(childOverlay);
        expect(overlayManager.blockCloseUntil).toHaveBeenCalledOnceWith('turnSummary-unit-1');
        expect(openOverlay).toHaveBeenCalledTimes(1);
        expect(overlayManager.unblockClose).not.toHaveBeenCalled();

        closed.next();

        expect(overlayManager.unblockClose).toHaveBeenCalledOnceWith('turnSummary-unit-1');
    });

    it('unblocks the parent summary if the child overlay cannot be created', () => {
        const overlayManager = jasmine.createSpyObj<OverlayManagerService>(
            'OverlayManagerService',
            ['blockCloseUntil', 'unblockClose'],
        );
        const error = new Error('overlay creation failed');

        expect(() => openTurnSummaryChildOverlay(overlayManager, 'unit-1', () => { throw error; }))
            .toThrow(error);
        expect(overlayManager.unblockClose).toHaveBeenCalledOnceWith('turnSummary-unit-1');
    });
});
describe('isMoveModeDisabledWhileProne', () => {
    it('disables jump and sprint while prone', () => {
        expect(isMoveModeDisabledWhileProne('jump', true)).toBeTrue();
        expect(isMoveModeDisabledWhileProne('jump', false)).toBeFalse();
        expect(isMoveModeDisabledWhileProne('sprint', true)).toBeTrue();
        expect(isMoveModeDisabledWhileProne('sprint', false)).toBeFalse();
        expect(isMoveModeDisabledWhileProne('run', true)).toBeFalse();
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

    it('keeps compactly grouped equipment sources separate in the detailed turn summary', () => {
        expect(composeTurnSummaryHeatRows(
            [
                { id: 'stealth:null-signature', label: 'Stealth', value: 10, group: 'Equipment' },
                { id: 'engine', label: 'Engine', value: 5 },
                { id: 'nova-cews', label: 'Nova CEWS', value: 2, group: 'Equipment' },
            ],
            { hasSelection: false, value: 0, entryIds: new Set() }
        )).toEqual([
            { id: 'stealth:null-signature', label: 'Stealth', value: 10 },
            { id: 'engine', label: 'Engine', value: 5 },
            { id: 'nova-cews', label: 'Nova CEWS', value: 2 },
        ]);
    });

    it('adds extra underwater dissipation as a blue negative source', () => {
        expect(composeTurnSummaryHeatRows(
            [{ id: 'movement', label: 'Movement', value: 2 }],
            { hasSelection: false, value: 0, entryIds: new Set() },
            3,
        )).toEqual([
            { id: 'movement', label: 'Movement', value: 2 },
            { id: 'underwater-dissipation', label: 'Water', value: -3, underwater: true },
        ]);
    });

    it('does not add an underwater source without a positive bonus', () => {
        const selection = { hasSelection: false, value: 0, entryIds: new Set<string>() };
        expect(composeTurnSummaryHeatRows([], selection, 0)).toEqual([]);
        expect(composeTurnSummaryHeatRows([], selection, -1)).toEqual([]);
    });
});
