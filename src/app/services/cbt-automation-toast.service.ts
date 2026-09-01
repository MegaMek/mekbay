// SPDX-License-Identifier: GPL-3.0-or-later

import { inject, Injectable } from '@angular/core';

import type { Toast } from './toast.service';
import { ToastService } from './toast.service';

/** Result notifications shared by automatic CBT workflows. */
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

    show(
        unitId: string,
        displayName: string,
        message: string,
        type: Toast['type'],
    ): void {
        const visible = [...this.visibleUnitIdsByOwner.values()]
            .some(unitIds => unitIds.has(unitId));
        this.toasts.showToast(visible ? message : `${displayName} — ${message}`, type);
    }
}
