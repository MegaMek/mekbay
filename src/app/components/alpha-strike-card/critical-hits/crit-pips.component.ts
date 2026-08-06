// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Component, ChangeDetectionStrategy, input, computed } from '@angular/core';
import type { ASForceUnit } from '../../../models/as-force-unit.model';

/*
 * 
 * Reusable component for displaying critical hit pips.
 * Automatically switches to numeric display when total damage exceeds visible pips.
 */

@Component({
    selector: 'as-crit-pips',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (showNumeric()) {
            <span class="pip-count" 
                  [class.damaged]="isDamaged(0)"
                  [class.pending-damage]="pendingChange() > 0"
                  [class.pending-heal]="pendingChange() < 0">
                {{ committedHits() }}@if (pendingChange() !== 0) {<span class="pending-delta">{{ pendingDelta() }}</span>}
                
            </span>
            <svg class="pip damaged" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /></svg>
        } @else {
            @for (i of pipsArray(); track i) {
                <svg class="pip" 
                     [class.damaged]="isDamaged(i)"
                     [class.pending-damage]="isPendingDamage(i)"
                     [class.pending-heal]="isPendingHeal(i)"
                     viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /></svg>
            }
        }
    `,
    styles: [`
        :host {
            display: flex;
            flex-direction: row;
            align-items: center;
            gap: 0.3em;
            position: relative;
            flex-shrink: 0;
        }
        .pip-count {
            font-weight: bold;
            font-size: 2.6em;
            line-height: 1em;
            color: var(--damage-color);
            margin-left: 0.2em;
            text-align: center;
            &.damaged {
                color: var(--damage-color);
            }
        }
        .pending-damage .pending-delta {
            color: #ff5722;
        }
        .pending-heal .pending-delta {
            color: #006797;
        }
        
        .pip {
            width: 2.14em;
            height: 2.14em;

            circle {
                fill: #fff;
                stroke: #000;
                stroke-width: 2pt;
            }

            &.structure circle {
                fill: #bbb;
            }

            &.damaged circle {
                fill: var(--damage-color);
            }

            &.pending-damage circle {
                fill: orange;
            }

            &.pending-heal circle {
                fill: #03a9f4;
            }
        }
    `]
})
export class AsCritPipsComponent {
    forceUnit = input<ASForceUnit>();
    critKey = input.required<string>();
    maxPips = input.required<number>();

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
