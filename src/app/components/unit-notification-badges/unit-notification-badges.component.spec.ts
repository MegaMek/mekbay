// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { MekPilotCheckV2 } from '../../models/runtime/mek-movement-psr-v2';
import type { MekTurnPanelSnapshot } from '../../models/runtime/mek-turn-panel';
import {
    projectRuntimeFallTooltip,
    projectRuntimePendingNotification,
} from './unit-notification-badges.component';

describe('direct runtime unit notifications', () => {
    it('keeps a separate automatic-fall warning and counts only still-actionable checks', () => {
        const snapshot = notificationSnapshot(
            [check('leg-destroyed', 'Damaged leg'), check('shutdown', 'Shutdown')],
            [{ triggerKind: 'gyro-destroyed', locationIds: [] }],
        );

        expect(projectRuntimeFallTooltip(snapshot)).toEqual([{
            label: 'Automatic fall',
            value: 'Gyro destroyed',
        }]);
        expect(projectRuntimePendingNotification(snapshot)).toEqual({
            kind: 'psr',
            count: 1,
            tooltip: [{ label: 'Shutdown', value: 'Target 5+' }],
        });
    });

    it('aggregates all ordinary pending PSRs into the numbered badge', () => {
        const snapshot = notificationSnapshot([
            check('gyro-hit', 'Gyro hit'),
            check('damage-total-20', '20+ damage'),
        ]);

        expect(projectRuntimeFallTooltip(snapshot)).toBeNull();
        expect(projectRuntimePendingNotification(snapshot)).toEqual(jasmine.objectContaining({
            kind: 'psr',
            count: 2,
        }));
    });

    it('includes a durable torso rule check in the PSR badge', () => {
        const snapshot = notificationSnapshot([], [], [{
            key: 'core.torso-crippling',
            check: { status: 'pending' },
            reason: 'Crippling destruction',
            targetNumber: 6,
        }] as unknown as MekTurnPanelSnapshot['ruleChecks']);

        expect(projectRuntimePendingNotification(snapshot)).toEqual({
            kind: 'psr',
            count: 1,
            tooltip: [{ label: 'Crippling destruction', value: 'Target 6+' }],
        });
    });
});

function check(
    triggerKind: MekPilotCheckV2['source']['triggerKind'],
    reason: string,
): MekPilotCheckV2 {
    return {
        checkId: reason,
        source: { triggerKind } as MekPilotCheckV2['source'],
        producingRevision: 0,
        ordinal: 0,
        targetNumber: 5,
        reason,
        status: 'pending',
    };
}

function notificationSnapshot(
    checks: readonly MekPilotCheckV2[],
    automaticFalls: MekTurnPanelSnapshot['movementState']['automaticFalls'] = [],
    ruleChecks: MekTurnPanelSnapshot['ruleChecks'] = [],
): MekTurnPanelSnapshot {
    return {
        movementState: { checks, automaticFalls },
        ruleChecks,
    } as unknown as MekTurnPanelSnapshot;
}
