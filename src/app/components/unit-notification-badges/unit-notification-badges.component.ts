// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { TooltipDirective } from '../../directives/tooltip.directive';
import type { TooltipLine } from '../tooltip/tooltip.component';
import type {
    RuntimeUnitNotificationKind,
    RuntimeUnitNotificationSnapshot,
} from './unit-notification-runtime.util';

export type UnitNotificationKind = RuntimeUnitNotificationKind;

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
    snapshot: RuntimeUnitNotificationSnapshot | null | undefined,
): RuntimePendingNotificationSummary | null {
    if (!snapshot) return null;
    const events = snapshot.pendingEvents.filter(event => event.count > 0);
    const count = events.reduce((total, event) => total + event.count, 0);
    if (count === 0) return null;
    const critical = events.find(event =>
        event.kind === 'critical-chance' || event.kind === 'critical-hit');
    const kind: UnitNotificationKind = events.some(event => event.kind === 'fall')
        ? 'fall'
        : events.some(event => event.kind === 'unit-check')
            ? 'unit-check'
            : critical?.kind ?? 'psr';
    const ordered = [
        ...events.filter(event => event.kind === 'fall'),
        ...events.filter(event => event.kind === 'unit-check'),
        ...events.filter(event => event.kind === 'critical-chance' || event.kind === 'critical-hit'),
        ...events.filter(event => event.kind === 'psr'),
    ];
    return Object.freeze({
        kind,
        count,
        tooltip: Object.freeze(ordered.flatMap(event => event.tooltip)),
    });
}

export function projectRuntimeFallTooltip(
    snapshot: RuntimeUnitNotificationSnapshot | null | undefined,
): readonly TooltipLine[] | null {
    return snapshot?.automaticFallTooltip ?? null;
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
    readonly snapshot = input<RuntimeUnitNotificationSnapshot | null>(null);
    readonly display = input<'inline' | 'overlay'>('inline');
    readonly interactive = input(false);
    readonly activated = output<UnitNotificationActivation>();

    readonly fallTooltip = computed(() => projectRuntimeFallTooltip(this.snapshot()));
    readonly pendingNotification = computed(() => projectRuntimePendingNotification(this.snapshot()));
    readonly hasPendingFalls = computed(() =>
        this.snapshot()?.pendingEvents.some(event => event.kind === 'fall' && event.count > 0) === true);
    readonly hasAutoFall = computed(() => !this.hasPendingFalls() && this.fallTooltip() !== null);
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
