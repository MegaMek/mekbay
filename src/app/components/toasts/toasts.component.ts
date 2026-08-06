// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, inject, type Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService } from '../../services/toast.service';


@Component({
    selector: 'app-toasts',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule],
    template: `
    <div class="toast-container">
        @for (toast of toastService.toasts(); let i = $index; track i) {
            <div class="toast" [ngClass]="toast.type" (click)="toastService.dismiss(toast.id)">
                {{ toast.message }}
            </div>
        }
    </div>
    `,
    styleUrls: ['./toasts.component.css']
})
export class ToastsComponent {
    public toastService = inject(ToastService);
    constructor() {}
}