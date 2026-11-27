// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService } from '../../services/toast.service';


@Component({
    selector: 'app-toasts',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    <div class="toast-container">
        @for (toast of toastService.visibleToasts(); track toast.id) {
            <div class="toast" [class]="toast.type" (click)="toastService.dismiss(toast.id)">
                {{ toast.message }}
            </div>
        }
    </div>
    `,
    styleUrl: './toasts.component.css'
})
export class ToastsComponent {
    protected readonly toastService = inject(ToastService);
}
