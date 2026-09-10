// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Component, ChangeDetectionStrategy, input, computed, signal, viewChild, ElementRef, DestroyRef, inject, afterNextRender, afterRenderEffect } from '@angular/core';
import type { ASForceUnit } from '../../../models/as-force-unit.model';

/*
 * 
 * Reusable component for displaying critical hit pips.
 * Automatically switches to numeric display when total damage exceeds visible pips.
 */

@Component({
    selector: 'g[as-crit-pips]',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (showNumeric()) {
            <svg:text #count x="0.52" y="0.88" class="pip-count"
                  [class.pending-damage]="pendingChange() > 0"
                  [class.pending-heal]="pendingChange() < 0">
                {{ committedHits() }}@if (pendingChange() !== 0) {<svg:tspan class="pending-delta">{{ pendingDelta() }}</svg:tspan>}
            </svg:text>
            <svg:circle class="pip damaged" [attr.cx]="numericWidth() + 1.89" cy="0" r="0.891666667" />
        } @else {
            @for (i of pipsArray(); track i) {
                <svg:circle class="pip"
                     [class.damaged]="isDamaged(i)"
                     [class.pending-damage]="isPendingDamage(i)"
                     [class.pending-heal]="isPendingHeal(i)"
                     [attr.cx]="1.07 + i * 2.44" cy="0" r="0.891666667" />
            }
        }
    `,
    styles: [`
        .pip-count {
            font-weight: bold;
            font-size: 2.6px;
            font-family: 'Roboto Condensed', sans-serif;
            fill: var(--damage-color, #cd0000);
        }
        .pending-damage .pending-delta {
            fill: #ff5722;
        }
        .pending-heal .pending-delta {
            fill: #006797;
        }
        .pip {
            fill: #fff;
            stroke: #000;
            stroke-width: 0.237777778;
        }
        .pip.damaged { fill: var(--damage-color, #cd0000); }
        .pip.pending-damage { fill: orange; }
        .pip.pending-heal { fill: #03a9f4; }
    `]
})
export class AsCritPipsComponent {
    forceUnit = input<ASForceUnit>();
    critKey = input.required<string>();
    // The parent positions its following description from width() in the same
    // render pass that initializes this component's inputs.
    maxPips = input(0);

    private readonly count = viewChild<ElementRef<SVGTextElement>>('count');
    protected readonly numericWidth = signal(0);

    /** Width in the card's original em units, shared with the following description. */
    readonly width = computed(() => {
        if (this.maxPips() === 0) return 0;
        return this.showNumeric()
            ? this.numericWidth() + 2.96
            : this.maxPips() * 2.14 + (this.maxPips() - 1) * 0.3;
    });

    constructor() {
        const destroyRef = inject(DestroyRef);
        afterRenderEffect(() => {
            this.committedHits();
            this.pendingChange();
            this.measureCount();
        });
        afterNextRender(() => {
            void document.fonts.ready.then(() => {
                if (!destroyRef.destroyed) this.measureCount();
            });
        });
    }

    private measureCount(): void {
        const count = this.count()?.nativeElement;
        if (count) this.numericWidth.set(count.getComputedTextLength());
    }

    /** Committed critical hits */
    committedHits = computed<number>(() => {
        const fu = this.forceUnit();
        if (!fu) return 0;
        return fu.getState().getCommittedCritHits(this.critKey());
    });

    /** Pending change (positive = damage, negative = heal) */
    pendingChange = computed<number>(() => {
        const fu = this.forceUnit();
        if (!fu) return 0;
        return fu.getState().getPendingCritChange(this.critKey());
    });

    /** Total damaged (committed + positive pending) */
    totalDamaged = computed<number>(() => {
        return this.committedHits() + Math.max(0, this.pendingChange());
    });

    /** Whether there's any pending change */
    hasPendingChange = computed<boolean>(() => {
        return this.pendingChange() !== 0;
    });

    /** Formatted pending delta string (e.g., "+2" or "-1") */
    pendingDelta = computed<string>(() => {
        const change = this.pendingChange();
        if (change > 0) return `+${change}`;
        if (change < 0) return `${change}`;
        return '';
    });

    /** Whether to show numeric display instead of pips */
    showNumeric = computed<boolean>(() => {
        return this.totalDamaged() > this.maxPips();
    });

    /** Array of pip indices for @for loop */
    pipsArray = computed<number[]>(() => {
        return Array.from({ length: this.maxPips() }, (_, i) => i);
    });

    /** Check if pip at index is committed damage */
    isDamaged(pipIndex: number): boolean {
        return pipIndex < this.committedHits();
    }

    /** Check if pip at index is pending damage */
    isPendingDamage(pipIndex: number): boolean {
        const committed = this.committedHits();
        const pending = this.pendingChange();
        if (pending > 0) {
            return pipIndex >= committed && pipIndex < committed + pending;
        }
        return false;
    }

    /** Check if pip at index is pending heal */
    isPendingHeal(pipIndex: number): boolean {
        const committed = this.committedHits();
        const pending = this.pendingChange();
        if (pending < 0) {
            const healCount = -pending;
            const startHealIndex = Math.max(0, committed - healCount);
            return pipIndex >= startHealIndex && pipIndex < committed;
        }
        return false;
    }
}
