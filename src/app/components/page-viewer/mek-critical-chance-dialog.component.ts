// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { DiceRollerComponent } from '../dice-roller/dice-roller.component';
import {
    resolveMekCriticalChance,
    type MekCriticalChanceModifier,
    type MekCriticalChanceResult,
} from '../../utils/mek-critical-hit.util';

export interface MekCriticalChanceDialogData {
    readonly locationLabel: string;
    readonly canBlowOff: boolean;
    readonly industrialMek: boolean;
    readonly modifiers?: readonly MekCriticalChanceModifier[];
    readonly initialResult?: MekCriticalChanceResult;
    readonly initialRoll?: readonly [number, number];
    readonly onResultChange?: (result: MekCriticalChanceResult | null) => void;
    readonly onRollChange?: (roll: readonly [number, number]) => void;
    readonly manual?: boolean;
}

@Component({
    selector: 'mek-critical-chance-dialog',
    standalone: true,
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
                    <div
                        class="critical-random-row"
                        [class.roll-disabled]="isRolling()"
                        (click)="roll()"
                    >
                        <button
                            class="random-button large"
                            type="button"
                            aria-label="Roll critical chance"
                            title="Roll critical chance"
                            [disabled]="isRolling()"
                        ></button>
                        <div
                            class="critical-dice-trigger"
                            role="button"
                            [attr.tabindex]="isRolling() ? -1 : 0"
                            aria-label="Roll critical chance dice"
                            [attr.aria-disabled]="isRolling()"
                            (keydown.enter)="roll()"
                            (keydown.space)="roll(); $event.preventDefault()"
                        >
                            <dice-roller
                                #roller
                                [diceCount]="2"
                                [initialResults]="data.initialRoll ?? null"
                                [modifier]="modifierTotal()"
                                (finished)="onFinished($event)"
                            />
                        </div>
                    </div>
                    <div class="critical-result-slot">
                        <div class="critical-table-hint">
                            {{ criticalTableHint() }}
                        </div>
                    </div>
                </div>
            </div>
            <div class="actions critical-dismiss-actions">
                @if (result(); as currentResult) {
                    <div class="critical-chance-options rolled-result-action">
                        <button
                            class="bt-button critical-result-action"
                            [class.success]="currentResult.kind === 'none'"
                            [class.danger]="currentResult.kind !== 'none'"
                            type="button"
                            [disabled]="isRolling()"
                            (click)="continueWith(currentResult)"
                        >
                            {{ continueLabel(currentResult) }}
                        </button>
                    </div>
                } @else {
                    <div class="critical-manual-results">
                        <div class="critical-manual-results-label">Criticals</div>
                        <div class="critical-chance-options" aria-label="Set critical hit count manually">
                            @for (manualResult of manualResults; track manualResult.label) {
                                <button
                                    class="bt-button"
                                    [class.success]="manualResult.result.kind === 'none'"
                                    [class.primary]="manualResult.result.kind !== 'none'"
                                    type="button"
                                    [disabled]="isRolling()"
                                    (click)="continueWith(manualResult.result)">{{ manualResult.label }}</button>
                            }
                        </div>
                    </div>
                }
                <button class="bt-button" type="button" [disabled]="isRolling()" (click)="close()">
                    {{ data.manual ? 'CANCEL' : 'CLOSE' }}
                </button>
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
    readonly result = signal<MekCriticalChanceResult | null>(this.data.initialResult ?? null);
    readonly modifiers = this.data.modifiers ?? [];
    readonly isRolling = computed(() => this.roller()?.isRolling() ?? false);
    private readonly optionalModifiers = signal(new Set(
        this.modifiers.filter(modifier => modifier.optional && modifier.enabled !== false)
            .map(modifier => modifier.label),
    ));
    readonly situationalModifierEnabled = signal(false);
    readonly situationalModifier = signal(0);
    readonly manualResults: readonly { label: string; result: MekCriticalChanceResult }[] = [
        { label: 'NO CRITICAL', result: { kind: 'none' } },
        { label: '1', result: { kind: 'critical-hits', count: 1 } },
        { label: '2', result: { kind: 'critical-hits', count: 2 } },
        {
            label: this.data.canBlowOff ? 'BLOWN OFF' : '3',
            result: resolveMekCriticalChance(12, this.data.canBlowOff, this.data.industrialMek),
        },
    ];
    readonly modifierTotal = computed(() => this.modifiers.reduce((total, modifier) =>
        total + (!modifier.optional || this.optionalModifiers().has(modifier.label) ? modifier.value : 0),
    this.situationalModifierEnabled() ? this.situationalModifier() : 0));

    roll(): void {
        if (this.isRolling()) return;
        this.roller()?.roll();
    }

    onFinished(event: { readonly results: readonly number[] }): void {
        if (event.results.length === 2) {
            this.data.onRollChange?.([event.results[0], event.results[1]]);
        }
        this.resolveRoll(event.results.reduce((total, die) => total + die, 0));
    }

    private resolveRoll(raw: number): void {
        const modifier = this.modifierTotal();
        const modified = Math.min(this.data.industrialMek ? 14 : 12, raw + modifier);
        this.setResult(resolveMekCriticalChance(modified, this.data.canBlowOff, this.data.industrialMek));
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
            this.setResult(null);
            return;
        }
        this.resolveRoll(results.reduce<number>((total, die) => total + (die ?? 0), 0));
    }

    signed(value: number): string {
        return value >= 0 ? `+${value}` : String(value);
    }

    continueLabel(result: MekCriticalChanceResult): string {
        if (result.kind === 'none') return 'NO CRITICAL HITS';
        if (result.kind === 'blown-off') return 'APPLY BLOWN-OFF';
        return `APPLY ${result.count} CRITICAL${result.count === 1 ? '' : 'S'}`;
    }

    criticalTableHint(): string {
        const twelve = this.data.canBlowOff ? 'blow off' : '3';
        if (!this.data.industrialMek) {
            return `2–7: No Critical | 8–9: 1 | 10–11: 2 | 12: ${twelve}`;
        }
        const fourteen = this.data.canBlowOff ? 'blow off' : '4';
        return `2–7: No Critical | 8–9: 1 | 10–11: 2 | 12–13: ${twelve} | 14+: ${fourteen}`;
    }

    continueWith(result: MekCriticalChanceResult): void {
        this.setResult(result);
        this.dialogRef.close(result);
    }

    close(): void {
        if (this.isRolling()) return;
        this.dialogRef.close(undefined);
    }

    private setResult(result: MekCriticalChanceResult | null): void {
        this.result.set(result);
        this.data.onResultChange?.(result);
    }
}
