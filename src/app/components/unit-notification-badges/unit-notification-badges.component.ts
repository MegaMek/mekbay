// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TooltipDirective } from '../../directives/tooltip.directive';
import type { CBTForceUnit } from '../../models/cbt-force-unit.model';
import {
    buildFallTooltip,
    buildPendingNotificationSummary,
    type PendingNotificationSummary,
    type UnitNotificationKind,
} from './unit-notification-tooltip.util';

export type { UnitNotificationKind } from './unit-notification-tooltip.util';

export interface UnitNotificationActivation {
    kind: UnitNotificationKind;
    event: Event;
}

@Component({
    selector: 'unit-notification-badges',
    standalone: true,
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
    unit = input<CBTForceUnit | null>(null);
    display = input<'inline' | 'overlay'>('inline');
    interactive = input(false);
    activated = output<UnitNotificationActivation>();

    pendingFallCount = computed(() => this.unit()?.pendingFallCount?.() ?? 0);
    hasPendingFalls = computed(() => this.pendingFallCount() > 0);
    fallTooltip = computed(() => buildFallTooltip(this.unit()));
    hasAutoFall = computed(() => !this.hasPendingFalls() && this.fallTooltip() !== null);

    pendingNotification = computed(() => buildPendingNotificationSummary(this.unit()));
    hasNotifications = computed(() => this.hasAutoFall() || this.pendingNotification() !== null);

    pendingNotificationAriaLabel(notification: PendingNotificationSummary): string {
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
