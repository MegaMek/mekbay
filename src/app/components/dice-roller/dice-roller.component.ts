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

import { Component, effect, input, output, signal, DestroyRef, inject, ChangeDetectionStrategy } from '@angular/core';

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
    private _endTimer: any = null;
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

    // outputs
    finished = output<{ results: number[]; sum: number }>();

    // runtime state
    diceResults = signal<(number | null)[]>([]);
    isRolling = signal(false);
    overlayVisible = signal(false);

    private _animationTimer: any = null;
    private _postEndTimer: any = null;
    private _canCloseOverlay = false;

    constructor() {
        let lastDiceCount = 0;
        effect((cleanup) => {
            if (this.diceCount() === lastDiceCount) {
                return;
            }
            lastDiceCount = this.diceCount();
            this._resetArrays();
            this._clearTimers();
            cleanup(() => {
                this._clearTimers();
            });
        });
        inject(DestroyRef).onDestroy(() => {
            this._clearTimers();
        });
    }

    public roll() {
        if (this.isRolling()) {
            return;
        }

        this.rolled.set(false);
        this.isRolling.set(true);
        this.overlayVisible.set(this.showOverlay());
        this._canCloseOverlay = false;
        this._clearTimers();


        const diceCount = this.diceCount();

        // start fast-changing overlay values
        this._animationTimer = setInterval(() => {
            for (let i = 0; i < diceCount; i++) {
                const faces = this.diceResults();
                faces[i] = this._randomFace();
                this.diceResults.set([...faces]);
            }
        }, this.animationIntervalMs());

        // stop after configured duration
        this._endTimer = setTimeout(() => {
            if (this._animationTimer) {
                clearInterval(this._animationTimer);
                this._animationTimer = null;
            }

            this.isRolling.set(false);

            const freezeOnRollEnd = this.freezeOnRollEnd();
            this._canCloseOverlay = freezeOnRollEnd <= 0;
            if (freezeOnRollEnd > 0) {
                this._postEndTimer = setTimeout(() => {
                    this._canCloseOverlay = true;
                }, freezeOnRollEnd);
            }

            // emit finished event
            const results = this.diceResults();
            this.sumDie();
            this.rolled.set(true);
            this.finished.emit({ results: results.map(v => v ?? 0), sum: this.diceSum() });
        }, this.rollDurationMs());
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
        if (!this._canCloseOverlay) {
            return;
        }
        this.overlayVisible.set(false);
    }

    rollFinished() {
        return !this.isRolling() && this.rolled();
    }

    sumDie() {
        const results = this.diceResults();
        let sum = 0;
        for (const v of results) {
            if (v !== null) {
                sum += v;
            }
        }
        sum += this.modifier();
        this.diceSum.set(sum);
    }

    private _resetArrays() {
        this.diceResults.set(Array(this.diceCount()).fill(null));
    }

    private _randomFace() {
        return Math.floor(Math.random() * this.diceSides()) + 1;
    }

    private _clearTimers() {
        if (this._animationTimer) {
            clearInterval(this._animationTimer);
            this._animationTimer = null;
        }
        if (this._postEndTimer) {
            clearTimeout(this._postEndTimer);
            this._postEndTimer = null;
        }
        if (this._endTimer) {
            clearTimeout(this._endTimer);
            this._endTimer = null;
        }
    }
}