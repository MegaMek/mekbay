// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal } from '@angular/core';
import { AutoFitTextDirective } from '../../directives/auto-fit-text.directive';


@Component({
    selector: 'dice-roller',
    imports: [AutoFitTextDirective],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './dice-roller.component.html',
    styleUrl: './dice-roller.component.scss'
})
export class DiceRollerComponent {
    private endTimer: ReturnType<typeof setTimeout> | null = null;
    private activeDiceCount = 0;
    private finalResults: number[] | null = null;
    diceCount = input<number>(2);
    diceSides = input<number>(6);
    /** Completed faces to display when a parent workflow is resumed. */
    initialResults = input<readonly number[] | null>(null);
    modifier = input<number>(0);
    showSum = input<boolean>(true);
    /** Use small dice instead of large (default) */
    small = input<boolean>(false);
    rollOnDieClick = input<boolean>(false);
    rollDurationMs = input<number>(500);
    animationIntervalMs = input<number>(50);
    freezeOnRollEnd = input<number>(0);
    rolled = signal<boolean>(false);
    showOverlay = input<boolean>(false);
    showInline = input<boolean>(true);
    overlayResult = input<string | null>(null);
    reserveOverlayResultSpace = input<boolean>(false);
    compactOverlayResult = input<boolean>(false);
    overlayResultTone = input<'default' | 'success' | 'failed'>('default');
    overlayRollingHint = input<string>('Tap or click to reveal the result');
    overlayCloseHint = input<string>('');

    // outputs
    finished = output<{ results: number[]; sum: number }>();
    overlayClosed = output<void>();

    // runtime state
    diceResults = signal<(number | null)[]>([]);
    diceSum = computed(() => this.diceResults().reduce<number>(
        (sum, value) => sum + (value ?? 0),
        this.modifier(),
    ));
    isRolling = signal(false);
    overlayVisible = signal(false);
    canCloseOverlay = signal(false);
    rollFinished = computed(() => !this.isRolling() && this.rolled());

    private animationTimer: ReturnType<typeof setInterval> | null = null;
    private postEndTimer: ReturnType<typeof setTimeout> | null = null;

    constructor() {
        effect((cleanup) => {
            const diceCount = Math.max(0, Math.floor(this.diceCount()));
            const diceSides = Math.max(1, Math.floor(this.diceSides()));
            const restored = this.validInitialResults(this.initialResults(), diceCount, diceSides);
            this.clearTimers();
            this.finalResults = null;
            this.activeDiceCount = diceCount;
            this.diceResults.set(restored ?? Array(diceCount).fill(null));
            this.rolled.set(restored !== null);
            this.isRolling.set(false);
            this.overlayVisible.set(false);
            this.canCloseOverlay.set(false);
            cleanup(() => {
                this.clearTimers();
            });
        });
        inject(DestroyRef).onDestroy(() => {
            this.clearTimers();
        });
    }

    public roll(finalResults?: readonly number[]) {
        if (this.isRolling()) {
            return;
        }

        const diceCount = Math.max(0, Math.floor(this.diceCount()));
        this.finalResults = finalResults ? this.validateFinalResults(finalResults, diceCount) : null;
        this.rolled.set(false);
        this.isRolling.set(true);
        this.overlayVisible.set(this.showOverlay());
        this.canCloseOverlay.set(false);
        this.clearTimers();

        const animationIntervalMs = Math.max(1, this.animationIntervalMs());
        this.activeDiceCount = diceCount;

        // start fast-changing overlay values
        this.animationTimer = setInterval(() => {
            this.diceResults.set(this.rollFaces(diceCount));
        }, animationIntervalMs);

        // stop after configured duration
        this.endTimer = setTimeout(() => this.finishRoll(), Math.max(0, this.rollDurationMs()));
    }

    onDieClick() {
        if (!this.rollOnDieClick()) {
            return;
        }
        if (this.isRolling()) {
            this.finishRoll();
            return;
        }
        this.roll();
    }

    onOverlayBackgroundClick() {
        if (this.isRolling()) {
            this.finishRoll();
            return;
        }
        if (!this.canCloseOverlay()) {
            return;
        }
        this.overlayVisible.set(false);
        this.overlayClosed.emit();
    }

    private finishRoll() {
        if (!this.isRolling()) {
            return;
        }

        this.clearRollTimers();
        this.isRolling.set(false);

        const results = this.finalResults ?? this.rollFaces(this.activeDiceCount);
        this.finalResults = null;
        this.diceResults.set(results);

        const freezeOnRollEnd = Math.max(0, this.freezeOnRollEnd());
        this.canCloseOverlay.set(freezeOnRollEnd === 0);
        if (freezeOnRollEnd > 0) {
            this.postEndTimer = setTimeout(() => {
                this.canCloseOverlay.set(true);
            }, freezeOnRollEnd);
        }

        this.rolled.set(true);
        this.finished.emit({ results, sum: this.diceSum() });
    }

    private validInitialResults(
        results: readonly number[] | null,
        diceCount: number,
        diceSides: number,
    ): number[] | null {
        return results !== null
            && results.length === diceCount
            && results.every(value => Number.isInteger(value) && value >= 1 && value <= diceSides)
            ? [...results]
            : null;
    }

    private randomFace() {
        return Math.floor(Math.random() * Math.max(1, Math.floor(this.diceSides()))) + 1;
    }

    private rollFaces(diceCount: number): number[] {
        return Array.from({ length: diceCount }, () => this.randomFace());
    }

    private validateFinalResults(results: readonly number[], diceCount: number): number[] {
        const sides = Math.max(1, Math.floor(this.diceSides()));
        if (results.length !== diceCount
            || results.some(value => !Number.isInteger(value) || value < 1 || value > sides)) {
            throw new RangeError(`Final dice results must contain ${diceCount} values between 1 and ${sides}.`);
        }
        return [...results];
    }

    private clearRollTimers() {
        if (this.animationTimer) {
            clearInterval(this.animationTimer);
            this.animationTimer = null;
        }
        if (this.endTimer) {
            clearTimeout(this.endTimer);
            this.endTimer = null;
        }
    }

    private clearTimers() {
        this.clearRollTimers();
        if (this.postEndTimer) {
            clearTimeout(this.postEndTimer);
            this.postEndTimer = null;
        }
    }
}
