// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { CBTForceMember } from '../models/force-member.model';
import type { UnitSummary } from '../models/unit-summary.model';
import { ToastService } from '../services/toast.service';

@Component({
    selector: 'unit-construction-button',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <button type="button" class="bt-button construction-button" [disabled]="disabled()"
            (click)="open()" [title]="label()" [attr.aria-label]="label()">
            <svg viewBox="0 0 512 512" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
                <path fill-rule="evenodd" d="
                M202.62 344.8 196.15 357.21A80.47 80.47 0 0 1 48.19 333.93L37.92 412.74H211.54Z
                M212.88 59.09 66.45 280.94a69.94 69.94 0 0 0 120.6 70.91l99.39-191.06-54.79-52.08C217.36 93.97 212.5 77.52 212.88 59.09Z
                M98.84 316.39a27.9 27.9 0 1 0 55.8 0 27.9 27.9 0 1 0-55.8 0Z
                M11.83 512v-67.3a22.45 22.45 0 0 1 22.45-22.45H216.4a22.45 22.45 0 0 1 22.44 22.45V512Z
                M328.5 19.54a60.54 60.54 0 0 0-89.08 82.01L389.37 244.01a60.73 60.73 0 0 1 81.13-54.71Z
                M260.88 60.55a23.08 23.08 0 1 0 46.16 0 23.08 23.08 0 1 0-46.16 0Z
                M431.67 328.98h39.15v36.25l-19.57 22.02-19.58-22.02Z
                M399.87 318.62v-72.17a50.15 50.15 0 0 1 100.3 0v72.17Z
                M430.45 244.91a19.58 19.58 0 1 0 39.16 0 19.58 19.58 0 1 0-39.16 0Z
            "/></svg>
        </button>
    `,
    styles: `
        :host { display: inline-flex; flex: 0 0 auto; }
        .construction-button { width: 40px; height: 40px; padding: 0; }
        .construction-button svg { width: 22px; height: 22px; }
    `,
})
export class UnitConstructionButtonComponent {
    private readonly router = inject(Router);
    private readonly toast = inject(ToastService);
    readonly unit = input.required<UnitSummary>();
    readonly forceMember = input<CBTForceMember>();
    readonly opening = signal(false);
    readonly disabled = computed(() => this.opening() || this.forceMember()?.force.readOnly() === true);
    readonly label = computed(() => this.forceMember()
        ? 'Refit this force unit in Unit Construction'
        : 'Open in Unit Construction');

    async open(): Promise<void> {
        if (this.disabled()) return;
        const member = this.forceMember();
        this.opening.set(true);
        try {
            await this.router.navigate(['/meklab', member?.entity.uuid() ?? this.unit().uuid], {
                queryParamsHandling: 'preserve',
                // A live force member belongs to this navigation, not browser history.
                info: member,
            });
        } catch (error) {
            this.toast.showToast(error instanceof Error ? error.message : 'Unit construction could not be opened', 'error');
        } finally {
            this.opening.set(false);
        }
    }
}
