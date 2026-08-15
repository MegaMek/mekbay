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
    styleUrls: ['./dice-roller.component.scss']
})
export class DiceRollerComponent {
    private endTimer: ReturnType<typeof setTimeout> | null = null;
    private activeDiceCount = 0;
    diceCount = input<number>(2);
    diceSides = input<number>(6);
    modifier = input<number>(0);
    /** Use small dice instead of large (default) */
    small = input<boolean>(false);
    rollOnDieClick = input<boolean>(false);
    rollDurationMs = input<number>(500);
    animationIntervalMs = input<number>(50);
    freezeOnRollEnd = input<number>(0);
    rolled = signal<boolean>(false);
    diceSum = signal<number>(0);
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
    isRolling = signal(false);
    overlayVisible = signal(false);
    canCloseOverlay = signal(false);
    rollFinished = computed(() => !this.isRolling() && this.rolled());

    private animationTimer: ReturnType<typeof setInterval> | null = null;
    private postEndTimer: ReturnType<typeof setTimeout> | null = null;

    constructor() {
        let lastDiceCount = 0;
        effect((cleanup) => {
            if (this.diceCount() === lastDiceCount) {
                return;
            }
            lastDiceCount = this.diceCount();
            this.resetArrays();
            this.clearTimers();
            cleanup(() => {
                this.clearTimers();
            });
        });
        inject(DestroyRef).onDestroy(() => {
            this.clearTimers();
        });
    }

    public roll() {
        if (this.isRolling()) {
            return;
        }

        this.rolled.set(false);
        this.isRolling.set(true);
        this.overlayVisible.set(this.showOverlay());
        this.canCloseOverlay.set(false);
        this.clearTimers();

        const diceCount = Math.max(0, Math.floor(this.diceCount()));
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

        const results = this.rollFaces(this.activeDiceCount);
        this.diceResults.set(results);
        this.diceSum.set(results.reduce((sum, value) => sum + value, this.modifier()));

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

    private resetArrays() {
        this.diceResults.set(Array(Math.max(0, Math.floor(this.diceCount()))).fill(null));
    }

    private randomFace() {
        return Math.floor(Math.random() * Math.max(1, Math.floor(this.diceSides()))) + 1;
    }

    private rollFaces(diceCount: number): number[] {
        return Array.from({ length: diceCount }, () => this.randomFace());
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
