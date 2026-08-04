/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal } from '@angular/core';

/*
 * Author: Drake
 */
@Component({
    selector: 'dice-roller',
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './dice-roller.component.html',
    styleUrls: ['./dice-roller.component.scss']
})
export class DiceRollerComponent {
    private endTimer: ReturnType<typeof setTimeout> | null = null;
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

        // start fast-changing overlay values
        this.animationTimer = setInterval(() => {
            this.diceResults.set(this.rollFaces(diceCount));
        }, animationIntervalMs);

        // stop after configured duration
        this.endTimer = setTimeout(() => {
            if (this.animationTimer) {
                clearInterval(this.animationTimer);
                this.animationTimer = null;
            }

            this.isRolling.set(false);

            const results = this.rollFaces(diceCount);
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
        }, Math.max(0, this.rollDurationMs()));
    }

    onDieClick() {
        if (!this.rollOnDieClick()) {
            return;
        }
        this.roll();
    }

    onOverlayBackgroundClick() {
        if (this.isRolling()) {
            return;
        }
        if (!this.canCloseOverlay()) {
            return;
        }
        this.overlayVisible.set(false);
        this.overlayClosed.emit();
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

    private clearTimers() {
        if (this.animationTimer) {
            clearInterval(this.animationTimer);
            this.animationTimer = null;
        }
        if (this.postEndTimer) {
            clearTimeout(this.postEndTimer);
            this.postEndTimer = null;
        }
        if (this.endTimer) {
            clearTimeout(this.endTimer);
            this.endTimer = null;
        }
    }
}