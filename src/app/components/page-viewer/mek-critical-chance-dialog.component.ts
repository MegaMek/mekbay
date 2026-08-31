// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';

import type {
    MekCriticalChanceModifier,
    MekCriticalChanceResult,
} from '../../models/runtime/mek-critical-hit-v2';
import { resolveMekCriticalChance } from '../../models/runtime/mek-critical-hit-v2';
import { DiceRollerComponent } from '../dice-roller/dice-roller.component';

export interface MekCriticalChanceDialogData {
    readonly locationLabel: string;
    readonly canBlowOff: boolean;
    readonly industrialMek?: boolean;
    readonly modifiers?: readonly MekCriticalChanceModifier[];
}

@Component({
    selector: 'mek-critical-chance-dialog',
    imports: [DiceRollerComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="panel glass preventZoomReset framed-borders has-shadow" (click)="$event.stopPropagation()">
            <div class="header">Critical Chance · {{ data.locationLabel }}</div>
            <div class="body">
                <div class="critical-dialog-body">
                    <div class="roll-details critical-roll-details" aria-label="Critical chance modifiers">
                        <div class="roll-details-label">Modifiers</div>
                        <div class="modifiers critical-modifiers">
                            @for (modifier of modifiers; track modifier.label; let index = $index) {
                                @if (modifier.optional) {
                                    <div
                                        class="modifier-item critical-modifier optional"
                                        [class.inactive]="!optionalModifierEnabled(modifier)"
                                    >
                                        <span class="modifier-location critical-modifier-checkbox">
                                            <input
                                                [id]="'critical-modifier-' + index"
                                                type="checkbox"
                                                class="bt-checkbox"
                                                [checked]="optionalModifierEnabled(modifier)"
                                                [disabled]="isRolling()"
                                                (change)="toggleOptionalModifier(modifier)"
                                            />
                                        </span>
                                        <label class="modifier-reason" [for]="'critical-modifier-' + index">
                                            {{ modifier.label }}
                                        </label>
                                        <strong class="modifier-value" [class.bonus]="modifier.value < 0">
                                            {{ signed(modifier.value) }}
                                        </strong>
                                    </div>
                                } @else {
                                    <div class="modifier-item critical-modifier">
                                        <span class="modifier-location" aria-hidden="true">&mdash;</span>
                                        <span class="modifier-reason">{{ modifier.label }}</span>
                                        <strong class="modifier-value" [class.bonus]="modifier.value < 0">
                                            {{ signed(modifier.value) }}
                                        </strong>
                                    </div>
                                }
                            }
                            <div
                                class="modifier-item critical-modifier other-modifier"
                                [class.inactive]="!situationalModifierEnabled()"
                            >
                                <span class="modifier-location critical-modifier-checkbox">
                                    <input
                                        id="critical-other-modifier"
                                        type="checkbox"
                                        class="bt-checkbox"
                                        [checked]="situationalModifierEnabled()"
                                        [disabled]="isRolling()"
                                        (change)="toggleSituationalModifier()"
                                    />
                                </span>
                                <label class="modifier-reason" for="critical-other-modifier">Other modifiers</label>
                                @if (situationalModifierEnabled()) {
                                    <div class="critical-modifier-controls">
                                        <button
                                            class="critical-modifier-step"
                                            type="button"
                                            aria-label="Decrease modifier"
                                            title="Decrease modifier"
                                            [disabled]="isRolling() || situationalModifier() <= -12"
                                            (click)="adjustSituationalModifier(-1)"
                                        >−</button>
                                        <strong
                                            class="modifier-value situational-modifier-value"
                                            [class.bonus]="situationalModifier() < 0"
                                            [class.neutral]="situationalModifier() === 0"
                                        >{{ signed(situationalModifier()) }}</strong>
                                        <button
                                            class="critical-modifier-step"
                                            type="button"
                                            aria-label="Increase modifier"
                                            title="Increase modifier"
                                            [disabled]="isRolling() || situationalModifier() >= 12"
                                            (click)="adjustSituationalModifier(1)"
                                        >+</button>
                                    </div>
                                }
                            </div>
                        </div>
                    </div>
                    <dice-roller
                        #roller
                        [diceCount]="2"
                        [modifier]="modifierTotal()"
                        (finished)="onFinished($event)"
                    />
                    <div class="critical-result-slot">
                        <div
                            class="critical-result"
                            [class.no-critical]="result()?.kind === 'none'"
                            [class.result-slot-hidden]="!result()"
                            aria-live="polite"
                        >
                            @if (result(); as currentResult) {
                                {{ resultLabel(currentResult) }}
                            } @else {
                                No critical hits.
                            }
                        </div>
                        <div class="critical-table-hint" [class.result-slot-hidden]="result()">
                            @if (data.industrialMek) {
                                2–7: None | 8–9: 1 | 10–11: 2 | 12–13: {{ data.canBlowOff ? 'blow off' : '3' }} | 14: {{ data.canBlowOff ? 'blow off' : '4' }}
                            } @else {
                                2–7: No Critical | 8–9: 1 | 10–11: 2 | 12: {{ data.canBlowOff ? 'blow off' : '3' }}
                            }
                        </div>
                    </div>
                </div>
            </div>
            <div class="actions critical-chance-actions">
                <button class="bt-button" type="button" [disabled]="roller.isRolling()" (click)="roll()">
                    {{ result() ? 'ROLL AGAIN' : 'ROLL 2D6' }}
                </button>
                <button
                    class="bt-button primary critical-action"
                    type="button"
                    [disabled]="!canContinue()"
                    [class.action-unavailable]="!canContinue()"
                    (click)="continueWithCurrentResult()"
                >
                    {{ result() ? continueLabel(result()!) : '' }}
                </button>
                <button class="bt-button" type="button" (click)="close()">DISMISS</button>
            </div>
        </div>
    `,
    styleUrls: [
        './overlay/page-psr-warning-panel.component.scss',
        './mek-critical-dialog.component.scss',
    ],
})
export class MekCriticalChanceDialogComponent {
    private readonly dialogRef = inject(DialogRef<MekCriticalChanceResult | undefined>);
    readonly data = inject<MekCriticalChanceDialogData>(DIALOG_DATA);
    readonly roller = viewChild<DiceRollerComponent>('roller');
    readonly result = signal<MekCriticalChanceResult | null>(null);
    readonly modifiers = this.data.modifiers ?? [];
    readonly isRolling = computed(() => this.roller()?.isRolling() ?? false);
    readonly canContinue = computed(() => {
        const result = this.result();
        return !this.isRolling() && result !== null && result.kind !== 'none';
    });
    private readonly optionalModifiers = signal(new Set(
        this.modifiers.filter(modifier => modifier.optional && modifier.enabled !== false)
            .map(modifier => modifier.label),
    ));
    readonly situationalModifierEnabled = signal(false);
    readonly situationalModifier = signal(0);
    readonly modifierTotal = computed(() => this.modifiers.reduce((total, modifier) =>
        total + (!modifier.optional || this.optionalModifiers().has(modifier.label) ? modifier.value : 0),
    this.situationalModifierEnabled() ? this.situationalModifier() : 0));

    roll(): void {
        this.result.set(null);
        this.roller()?.roll();
    }

    onFinished(event: { readonly results: readonly number[] }): void {
        this.resolveRoll(event.results.reduce((total, die) => total + die, 0));
    }

    private resolveRoll(raw: number): void {
        const modified = Math.min(this.data.industrialMek ? 14 : 12, raw + this.modifierTotal());
        this.result.set(resolveMekCriticalChance(
            modified,
            this.data.canBlowOff,
            this.data.industrialMek ?? false,
        ));
    }

    optionalModifierEnabled(modifier: MekCriticalChanceModifier): boolean {
        return this.optionalModifiers().has(modifier.label);
    }

    toggleOptionalModifier(modifier: MekCriticalChanceModifier): void {
        this.optionalModifiers.update(current => {
            const next = new Set(current);
            if (next.has(modifier.label)) next.delete(modifier.label);
            else next.add(modifier.label);
            return next;
        });
        this.refreshResolvedRoll();
    }

    toggleSituationalModifier(): void {
        this.situationalModifierEnabled.update(enabled => !enabled);
        this.refreshResolvedRoll();
    }

    adjustSituationalModifier(delta: -1 | 1): void {
        this.situationalModifier.update(value => Math.max(-12, Math.min(12, value + delta)));
        this.refreshResolvedRoll();
    }

    private refreshResolvedRoll(): void {
        const roller = this.roller();
        const results = roller?.diceResults();
        if (!roller?.rollFinished() || !results || results.some(value => value === null)) {
            this.result.set(null);
            return;
        }
        this.resolveRoll(results.reduce<number>((total, die) => total + (die ?? 0), 0));
    }

    signed(value: number): string {
        return value >= 0 ? `+${value}` : String(value);
    }

    resultLabel(result: MekCriticalChanceResult): string {
        if (result.kind === 'none') return 'No critical hits.';
        if (result.kind === 'blown-off') return 'Location blown off!';
        return `${result.count} critical hit${result.count === 1 ? '' : 's'}.`;
    }

    continueLabel(result: MekCriticalChanceResult): string {
        if (result.kind === 'none') return '';
        if (result.kind === 'blown-off') return 'APPLY BLOWN-OFF';
        return `APPLY ${result.count} CRITICAL${result.count === 1 ? '' : 'S'}`;
    }

    continueWithCurrentResult(): void {
        const result = this.result();
        if (!result || result.kind === 'none') return;
        this.dialogRef.close(result);
    }

    close(): void {
        this.dialogRef.close();
    }
}
