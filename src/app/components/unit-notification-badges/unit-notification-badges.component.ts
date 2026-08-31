// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { TooltipDirective } from '../../directives/tooltip.directive';
import type { MekTurnPanelSnapshot } from '../../models/runtime/mek-turn-panel';
import type { TooltipLine } from '../tooltip/tooltip.component';
import { actionableMekPilotChecks } from '../page-viewer/overlay/page-turn-summary.util';

export type UnitNotificationKind =
    | 'fall'
    | 'psr'
    | 'critical-chance'
    | 'critical-hit'
    | 'unit-check';

export interface UnitNotificationActivation {
    readonly kind: UnitNotificationKind;
    readonly event: Event;
}

export interface RuntimePendingNotificationSummary {
    readonly kind: UnitNotificationKind;
    readonly count: number;
    readonly tooltip: readonly TooltipLine[];
}

/** Direct Entity/runtime equivalent of origin/next's actionable unit badges. */
export function projectRuntimePendingNotification(
    snapshot: MekTurnPanelSnapshot | null | undefined,
): RuntimePendingNotificationSummary | null {
    if (!snapshot) return null;
    const checks = actionableMekPilotChecks(
        snapshot.movementState.checks,
        snapshot.movementState.automaticFalls.length > 0,
    ).filter(check => check.status === 'pending');
    const ruleChecks = snapshot.ruleChecks.filter(row => row.check.status === 'pending');
    if (checks.length === 0 && ruleChecks.length === 0) return null;
    return Object.freeze({
        kind: 'psr',
        count: checks.length + ruleChecks.length,
        tooltip: Object.freeze([
            ...ruleChecks.map(row => Object.freeze({
                label: row.reason,
                value: row.targetNumber === null ? 'Pending' : `Target ${row.targetNumber}+`,
            })),
            ...checks.map(check => Object.freeze({
                label: check.reason,
                value: `Target ${check.targetNumber}+`,
            })),
        ]),
    });
}

export function projectRuntimeFallTooltip(
    snapshot: MekTurnPanelSnapshot | null | undefined,
): readonly TooltipLine[] | null {
    const falls = snapshot?.movementState.automaticFalls ?? [];
    if (falls.length === 0) return null;
    return Object.freeze(falls.map(fall => Object.freeze({
        label: 'Automatic fall',
        value: fall.triggerKind === 'gyro-destroyed' ? 'Gyro destroyed' : 'Leg destroyed',
    })));
}

@Component({
    selector: 'unit-notification-badges',
    imports: [TooltipDirective],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './unit-notification-badges.component.html',
    styleUrl: './unit-notification-badges.component.scss',
    host: {
        '[class.overlay]': 'display() === "overlay"',
        '[class.interactive]': 'interactive()',
        '[class.preventZoomReset]': 'interactive()',
        '[class.empty]': '!hasNotifications()',
    },
})
export class UnitNotificationBadgesComponent {
    readonly snapshot = input<MekTurnPanelSnapshot | null>(null);
    readonly display = input<'inline' | 'overlay'>('inline');
    readonly interactive = input(false);
    readonly activated = output<UnitNotificationActivation>();

    readonly fallTooltip = computed(() => projectRuntimeFallTooltip(this.snapshot()));
    readonly hasAutoFall = computed(() => this.fallTooltip() !== null);
    readonly pendingNotification = computed(() => projectRuntimePendingNotification(this.snapshot()));
    readonly hasNotifications = computed(() =>
        this.hasAutoFall() || this.pendingNotification() !== null);

    pendingNotificationAriaLabel(notification: RuntimePendingNotificationSummary): string {
        const eventLabel = notification.count === 1 ? 'event' : 'events';
        const next = NOTIFICATION_KIND_LABELS[notification.kind];
        return `${this.interactive() ? 'Resume' : ''} ${notification.count} pending ${eventLabel}; next: ${next}`.trim();
    }

    activate(event: Event, kind: UnitNotificationKind): void {
        if (!this.interactive()) return;
        event.preventDefault();
        event.stopPropagation();
        this.activated.emit({ kind, event });
    }

    activateFromKeyboard(event: KeyboardEvent, kind: UnitNotificationKind): void {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        this.activate(event, kind);
    }
}

const NOTIFICATION_KIND_LABELS: Readonly<Record<UnitNotificationKind, string>> = {
    fall: 'fall damage',
    psr: 'PSR checks',
    'critical-chance': 'critical chance',
    'critical-hit': 'critical hit',
    'unit-check': 'unit checks',
};
