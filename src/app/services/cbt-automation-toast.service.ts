// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { inject, Injectable } from '@angular/core';
import type { Toast } from './toast.service';
import { ToastService } from './toast.service';

export interface CBTAutomationToastUnit {
    readonly id: string;
    getNotificationDisplayName(): string;
}

/**
 * Presents results produced by CBT automation. The unit name is only needed
 * when the affected unit is not one of the record sheets currently visible.
 */
@Injectable({ providedIn: 'root' })
export class CBTAutomationToastService {
    private readonly toasts = inject(ToastService);
    private readonly visibleUnitIdsByOwner = new Map<object, ReadonlySet<string>>();

    setVisibleUnitIds(owner: object, unitIds: Iterable<string>): void {
        this.visibleUnitIdsByOwner.set(owner, new Set(unitIds));
    }

    clearVisibleUnitIds(owner: object): void {
        this.visibleUnitIdsByOwner.delete(owner);
    }

    show(unit: CBTAutomationToastUnit, message: string, type: Toast['type']): void {
        const unitVisible = Array.from(this.visibleUnitIdsByOwner.values())
            .some(unitIds => unitIds.has(unit.id));
        this.toasts.showToast(
            unitVisible ? message : `${unit.getNotificationDisplayName()} — ${message}`,
            type,
        );
    }
}
