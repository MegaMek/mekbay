// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, computed, input, output, viewChild } from '@angular/core';

import type {
    AutomationCheck,
    AutomationCheckOutcome,
} from '../../models/automation-check.model';
import { DiceRollerComponent } from '../dice-roller/dice-roller.component';

export type AutomationCheckResolutionSource = 'selected' | 'cascade' | 'automatic';

export interface AutomationCheckDisplayResolution {
    readonly outcome: AutomationCheckOutcome;
    readonly source: AutomationCheckResolutionSource;
    readonly dice: readonly [number, number] | null;
    readonly selectionId?: string;
}

@Component({
    selector: 'pending-unit-check-row',
    imports: [DiceRollerComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <article class="unit-check-event" [class.resolved]="resolution()"
            [class.failed]="resolution()?.outcome === 'failed'">
            <div class="unit-check-layout">
                <div class="unit-check-info">
                    <div class="unit-check-heading">
                        <div class="unit-check-heading-copy">
                            @if (showSubject()) {
                                <h3>{{ check().subject }}</h3>
                            }
                            <div class="unit-check-name">{{ check().label }}</div>
                        </div>
                    </div>
                    <div class="unit-check-description">
                        <span>{{ check().description }}</span>
                        <span class="unit-check-failure">
                            <span class="unit-check-failure-label">Failure:</span>
                            <span class="unit-check-failure-outcome">{{ check().failureOutcome }}</span>
                        </span>
                    </div>
                </div>

                @if (check().targetNumber !== undefined) {
                    <div class="unit-check-roll-column">
                        <div class="unit-check-roll-summary">
                            <div class="unit-check-target"><span>Target</span><strong>{{ check().targetNumber }}+</strong></div>
                        </div>
                    </div>
                }
            </div>

            <div class="unit-check-controls">
                @if (isAutomatic()) {
                    <div class="unit-check-automatic" [class.success]="resolution()?.outcome === 'success'"
                        [class.danger]="resolution()?.outcome === 'failed'">
                        {{ automaticLabel() }}
                    </div>
                } @else {
                    <div class="unit-check-control-group virtual-dice-group">
                        <div class="unit-check-random-row" [class.roll-disabled]="isRolling()" (click)="roll()">
                            <button class="random-button" type="button" [disabled]="isRolling()"
                                [attr.aria-label]="'Roll ' + check().label" [title]="'Roll ' + check().label"></button>
                            <div class="unit-check-dice-trigger" role="button"
                                [attr.tabindex]="isRolling() ? -1 : 0"
                                [attr.aria-disabled]="isRolling()"
                                [attr.aria-label]="'Roll dice for ' + check().label"
                                (keydown.enter)="roll()"
                                (keydown.space)="roll(); $event.preventDefault()">
                                <dice-roller #roller [diceCount]="2" [small]="true"
                                    [initialResults]="resolution()?.dice ?? null"
                                    (finished)="onFinished($event)" />
                            </div>
                        </div>
                    </div>
                    <div class="unit-check-control-group manual-result-group">
                        <div class="unit-check-manual-actions" role="radiogroup" aria-label="Enter physical dice result">
                            <button type="button" class="bt-button success" role="radio"
                                [class.selected]="resolution()?.outcome === 'success'"
                                [attr.aria-checked]="resolution()?.outcome === 'success'"
                                [disabled]="isRolling()" (click)="choose('success')">
                                {{ check().successLabel ?? 'PASSED' }}
                            </button>
                            <button type="button" class="bt-button danger" role="radio"
                                [class.selected]="resolution()?.outcome === 'failed'"
                                [attr.aria-checked]="resolution()?.outcome === 'failed'"
                                [disabled]="isRolling()" (click)="choose('failed')">
                                {{ check().failedLabel ?? 'FAILED' }}
                            </button>
                        </div>
                    </div>
                }
            </div>

            @if ((check().failureChoices?.length ?? 0) > 1 && resolution()?.outcome === 'failed') {
                <div class="unit-check-ammo-choices" aria-label="Choose the ammunition bin that explodes">
                    @for (choice of check().failureChoices!; track choice.id) {
                        <button type="button" class="bt-button"
                            [class.selected]="resolution()?.selectionId === choice.id"
                            (click)="selectionChanged.emit(choice.id)">
                            <span>{{ choice.label }}</span>
                            @if (choice.detail) { <small>{{ choice.detail }}</small> }
                        </button>
                    }
                </div>
            }
        </article>
    `,
    styleUrl: './pending-unit-check-dialog.component.scss',
})
export class PendingUnitCheckRowComponent {
    readonly check = input.required<AutomationCheck>();
    readonly resolution = input<AutomationCheckDisplayResolution>();
    readonly showSubject = input(true);
    readonly selected = output<Readonly<{
        outcome: AutomationCheckOutcome;
        dice: readonly [number, number] | null;
    }>>();
    readonly selectionChanged = output<string>();
    readonly roller = viewChild<DiceRollerComponent>('roller');
    readonly isRolling = computed(() => this.roller()?.isRolling() ?? false);
    readonly isAutomatic = computed(() => {
        const source = this.resolution()?.source;
        return source === 'automatic' || source === 'cascade';
    });

    roll(): void {
        if (!this.isRolling() && !this.isAutomatic()) this.roller()?.roll();
    }

    onFinished(event: { readonly results: readonly number[]; readonly sum: number }): void {
        const target = this.check().targetNumber;
        if (target === undefined || event.results.length !== 2) return;
        this.selected.emit({
            outcome: event.sum >= target ? 'success' : 'failed',
            dice: [event.results[0]!, event.results[1]!],
        });
    }

    choose(outcome: AutomationCheckOutcome): void {
        if (!this.isRolling() && !this.isAutomatic()) this.selected.emit({ outcome, dice: null });
    }

    automaticLabel(): string {
        if (this.resolution()?.source === 'automatic' && this.check().automaticLabel) {
            return this.check().automaticLabel!;
        }
        return this.resolution()?.outcome === 'success'
            ? 'AUTOMATIC SUCCESS'
            : this.resolution()?.source === 'cascade'
                ? this.check().cascadeFailureLabel ?? 'AUTOMATIC FAILURE'
                : 'AUTOMATIC FAILURE';
    }
}
