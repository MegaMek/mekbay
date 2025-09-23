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
import { ChangeDetectionStrategy, Component, signal, input, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';

/*
 * Author: Drake
 */
@Component({
    selector: 'update-button',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule], 
    templateUrl: './update-button.component.html',
    styleUrls: ['./update-button.component.css']
})
export class UpdateButtonComponent {
    updateAvailable = input<boolean>(false);
    countdown = signal(10);
    isVisible = signal(false);
    private countdownInterval?: ReturnType<typeof setInterval>;

    showUpdate = computed(() => this.updateAvailable() && this.isVisible());

    constructor() {
        effect(() => {
            if (this.updateAvailable()) {
                this.isVisible.set(true);
                this.startCountdown();
            } else {
                this.cancelReload();
                }
        });
    }

    startCountdown() {
        if (this.countdownInterval) {
            return;
        }
        this.countdown.set(10);
        this.countdownInterval = setInterval(() => {
            if (this.countdown() > 0) {
                this.countdown.set(this.countdown() - 1);
            } else {
                this.countdownInterval = undefined;
                this.reloadForUpdate();
            }
        }, 1000);
    }

    reloadForUpdate() {
        window.location.reload();
    }

    cancelReload() {
        this.isVisible.set(false);
        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
            this.countdownInterval = undefined;
        }
    }
}