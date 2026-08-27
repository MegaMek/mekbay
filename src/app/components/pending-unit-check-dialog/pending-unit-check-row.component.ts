// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, input, viewChild } from '@angular/core';
import type { SerializedPendingUnitCheck } from '../../models/force-serialization';
import { getMekLocationLabel } from '../../models/entity/types';
import { getPreferredHeatAmmoExplosionCandidates } from '../../utils/heat-effects.util';
import {
    isAmmoExplosionCheck,
    isPendingUnitCheckEntry,
    type PendingCheckReviewEntry,
    pendingUnitCheckActionLabel,
    pendingUnitCheckAutomaticLabel,
    pendingUnitCheckDescription,
    pendingUnitCheckFailureOutcome,
    pendingUnitCheckIsAutomatic,
    pendingUnitCheckLabel,
    pendingUnitCheckOutcome,
} from '../../utils/unit-check.util';
import { DiceRollerComponent } from '../dice-roller/dice-roller.component';

@Component({
    selector: 'pending-unit-check-row',
    standalone: true,
    imports: [DiceRollerComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (isPresent()) {
            <article class="unit-check-event" [class.resolved]="outcome()" [class.failed]="outcome() === 'failed'">
                <div class="unit-check-layout">
                    <div class="unit-check-info">
                        <div class="unit-check-heading">
                            <div class="unit-check-heading-copy">
                                @if (showUnitName()) {
                                    <h3>{{ entry().unit.getNotificationDisplayName() }}</h3>
                                }
                                <div class="unit-check-name">{{ label() }}</div>
                            </div>
                        </div>
                        <div class="unit-check-description">
                            @if (description(); as description) {
                                <span>{{ description }}</span>
                            }
                            @if (failureOutcome(); as failure) {
                                <span class="unit-check-failure">
                                    <span class="unit-check-failure-label">Failure:</span>
                                    <span class="unit-check-failure-outcome">{{ failure }}</span>
                                </span>
                            }
                        </div>
                    </div>

                    @if (target() !== undefined) {
                        <div class="unit-check-roll-column">
                            <div class="unit-check-roll-summary">
                                <div class="unit-check-target"><span>Target</span><strong>{{ target() }}+</strong></div>
                            </div>
                        </div>
                    }
                </div>

                <div class="unit-check-controls">
                    @if (isAutomatic()) {
                        <div class="unit-check-automatic" [class.success]="outcome() === 'success'"
                            [class.danger]="outcome() === 'failed'">
                            {{ automaticLabel() }}
                        </div>
                    } @else {
                        <div class="unit-check-control-group virtual-dice-group">
                            <div
                                class="unit-check-random-row"
                                [class.roll-disabled]="isRolling()"
                                (click)="roll()"
                            >
                                <button class="random-button" type="button" [disabled]="isRolling()"
                                    [attr.aria-label]="'Roll ' + label()" [title]="'Roll ' + label()"></button>
                                <div class="unit-check-dice-trigger" role="button"
                                    [attr.tabindex]="isRolling() ? -1 : 0"
                                    [attr.aria-disabled]="isRolling()"
                                    [attr.aria-label]="'Roll dice for ' + label()"
                                    (keydown.enter)="roll()"
                                    (keydown.space)="roll(); $event.preventDefault()">
                                    <dice-roller #roller [diceCount]="2" [small]="true"
                                        [initialResults]="restoredDice()"
                                        (finished)="onFinished($event)" />
                                </div>
                            </div>
                        </div>
                        <div class="unit-check-control-group manual-result-group">
                            <div class="unit-check-manual-actions" role="radiogroup" aria-label="Enter physical dice result">
                                <button type="button" class="bt-button success" role="radio"
                                    [class.selected]="outcome() === 'success'"
                                    [attr.aria-checked]="outcome() === 'success'"
                                    [disabled]="isRolling()" (click)="choose('success')">{{ successLabel() }}</button>
                                <button type="button" class="bt-button danger" role="radio"
                                    [class.selected]="outcome() === 'failed'"
                                    [attr.aria-checked]="outcome() === 'failed'"
                                    [disabled]="isRolling()" (click)="choose('failed')">{{ failedLabel() }}</button>
                            </div>
                        </div>
                    }
                </div>

                @if (ammoChoices().length > 1 && outcome() === 'failed') {
                    <div class="unit-check-ammo-choices" aria-label="Choose the ammunition bin that explodes">
                        @for (choice of ammoChoices(); track choice.id) {
                            <button type="button" class="bt-button"
                                [class.selected]="selectedAmmoId() === choice.id"
                                (click)="selectAmmo(choice.id)">
                                <span>{{ choice.equipment }}{{ choice.location ? ' · ' + choice.location : '' }}</span>
                                <small>{{ choice.damagePerShot }}/shot · {{ choice.shots }} shots</small>
                            </button>
                        }
                    </div>
                }
            </article>
        }
    `,
    styleUrl: './pending-unit-check-dialog.component.scss',
})
export class PendingUnitCheckRowComponent {
    readonly entry = input.required<PendingCheckReviewEntry>();
    readonly forcedPsrFailure = input(false);
    readonly showUnitName = input(true);
    readonly roller = viewChild<DiceRollerComponent>('roller');
    readonly currentUnitCheck = computed(() => {
        const entry = this.entry();
        return isPendingUnitCheckEntry(entry)
            ? entry.unit.turnState().getPendingUnitCheck(entry.check.id)
            : undefined;
    });
    readonly currentPsrCheck = computed(() => {
        const entry = this.entry();
        if (isPendingUnitCheckEntry(entry) || !entry.check.id) return undefined;
        return entry.unit.turnState().getPSRChecks().find(check => check.id === entry.check.id);
    });
    readonly isPresent = computed(() => this.currentUnitCheck() !== undefined
        || this.currentPsrCheck() !== undefined);
    readonly label = computed(() => {
        const entry = this.entry();
        if (!isPendingUnitCheckEntry(entry)) return 'Piloting Skill Check';
        const check = this.currentUnitCheck() ?? entry.check;
        return pendingUnitCheckLabel(check, true);
    });
    readonly description = computed(() => {
        const entry = this.entry();
        if (isPendingUnitCheckEntry(entry)) {
            const check = this.currentUnitCheck();
            return check ? pendingUnitCheckDescription(entry.unit, check) : '';
        }
        const check = this.currentPsrCheck();
        if (!check) return '';
        const location = check.loc ? getMekLocationLabel(check.loc) ?? check.loc : undefined;
        return `${check.reason}${location ? ` · ${location}` : ''}.`;
    });
    readonly failureOutcome = computed(() => {
        const entry = this.entry();
        if (isPendingUnitCheckEntry(entry)) {
            const check = this.currentUnitCheck();
            return check ? pendingUnitCheckFailureOutcome(check) : '';
        }
        return this.currentPsrCheck()?.failureOutcome ?? 'Fall';
    });
    readonly target = computed(() => {
        const entry = this.entry();
        return isPendingUnitCheckEntry(entry)
            ? this.currentUnitCheck()?.target
            : entry.unit.PSRTargetRoll();
    });
    readonly outcome = computed(() => {
        const entry = this.entry();
        if (isPendingUnitCheckEntry(entry)) {
            const check = this.currentUnitCheck();
            return check ? pendingUnitCheckOutcome(check) : undefined;
        }
        if (this.forcedPsrFailure()) return 'failed';
        return entry.check.id
            ? entry.unit.psrOutcomeSelections()[entry.check.id]
                ?? entry.unit.turnState().getPSROutcome(entry.check.id)
            : undefined;
    });
    readonly restoredDice = computed(() => {
        const entry = this.entry();
        if (isPendingUnitCheckEntry(entry)) {
            const result = this.currentUnitCheck()?.result;
            return result?.kind === 'roll' ? result.dice : null;
        }
        return !this.forcedPsrFailure() && entry.check.id
            ? entry.unit.psrDiceSelections()[entry.check.id] ?? null
            : null;
    });
    readonly ammoChoices = computed(() => {
        const entry = this.entry();
        return isPendingUnitCheckEntry(entry) && isAmmoExplosionCheck(entry.check)
            ? getPreferredHeatAmmoExplosionCandidates(entry.unit)
            : [];
    });
    readonly selectedAmmoId = computed(() => {
        const check = this.currentUnitCheck();
        return check && isAmmoExplosionCheck(check) ? check.selectionId : undefined;
    });
    readonly isRolling = computed(() => this.roller()?.isRolling() ?? false);
    readonly isAutomatic = computed(() => {
        const entry = this.entry();
        if (!isPendingUnitCheckEntry(entry)) return this.forcedPsrFailure();
        const check = this.currentUnitCheck();
        return check ? pendingUnitCheckIsAutomatic(check) : false;
    });
    readonly successLabel = computed(() => {
        const entry = this.entry();
        if (!isPendingUnitCheckEntry(entry)) return 'PASSED';
        const check = this.currentUnitCheck();
        return check ? pendingUnitCheckActionLabel(check, 'success') : 'SUCCESS';
    });
    readonly failedLabel = computed(() => {
        const entry = this.entry();
        if (!isPendingUnitCheckEntry(entry)) return 'FAILED';
        const check = this.currentUnitCheck();
        return check ? pendingUnitCheckActionLabel(check, 'failed') : 'FAILED';
    });

    roll(): void {
        if (!this.isRolling()) this.roller()?.roll();
    }

    onFinished(event: { readonly results: readonly number[]; readonly sum: number }): void {
        const entry = this.entry();
        const target = this.target();
        if (target === undefined) return;
        const outcome = event.sum >= target ? 'success' : 'failed';
        if (isPendingUnitCheckEntry(entry)) {
            const check = this.currentUnitCheck();
            if (check) entry.unit.turnState().setPendingUnitCheckOutcome(check.id, outcome, event.results);
            return;
        }
        this.selectPsrOutcome(outcome, event.results);
    }

    choose(outcome: 'success' | 'failed'): void {
        if (this.isRolling() || this.isAutomatic()) return;
        const entry = this.entry();
        if (!isPendingUnitCheckEntry(entry)) {
            this.selectPsrOutcome(outcome);
            return;
        }
        const check = this.currentUnitCheck();
        if (check) entry.unit.turnState().setPendingUnitCheckOutcome(check.id, outcome);
    }

    selectAmmo(id: string): void {
        const check = this.currentUnitCheck();
        if (check && this.ammoChoices().some(choice => choice.id === id)) {
            this.entry().unit.turnState().setPendingUnitCheckSelection(check.id, id);
        }
    }

    rollTotal(check: SerializedPendingUnitCheck): number {
        return check.result?.kind === 'roll'
            ? check.result.dice[0] + check.result.dice[1]
            : 0;
    }

    automaticLabel(): string {
        const check = this.currentUnitCheck();
        return check
            ? pendingUnitCheckAutomaticLabel(check, this.outcome() ?? 'failed')
            : this.outcome() === 'success' ? 'AUTOMATIC SUCCESS' : 'AUTOMATIC FAILURE';
    }

    private selectPsrOutcome(
        outcome: 'success' | 'failed',
        dice?: readonly number[],
    ): void {
        const entry = this.entry();
        if (isPendingUnitCheckEntry(entry) || !entry.check.id || this.forcedPsrFailure()) return;
        const checkId = entry.check.id;
        entry.unit.psrOutcomeSelections.update(current => ({ ...current, [checkId]: outcome }));
        entry.unit.psrDiceSelections.update(current => {
            if (dice?.length === 2) {
                return { ...current, [checkId]: [dice[0], dice[1]] as readonly [number, number] };
            }
            const { [checkId]: _removed, ...remaining } = current;
            return remaining;
        });
    }
}
