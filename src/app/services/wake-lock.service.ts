/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
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

import { DestroyRef, Injectable, effect, inject } from '@angular/core';
import { ForceBuilderService } from './force-builder.service';
import { LoggerService } from './logger.service';

interface WakeLockSentinelLike {
    released: boolean;
    release(): Promise<void>;
}

interface WakeLockApiLike {
    request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

/**
 * Author: Drake
 * 
 * Service to manage a screen wake lock while the force builder has any forces in it.
 * The wake lock is acquired when the first force is added and released when the last force is removed.
 * It is also released when the document becomes hidden and re-acquired when it becomes visible again.
 * This prevents the screen from sleeping while actively building/using a force, but allows normal sleep behavior otherwise.
 */
@Injectable({ providedIn: 'root' })
export class WakeLockService {
    private forceBuilderService = inject(ForceBuilderService);
    private logger = inject(LoggerService);
    private destroyRef = inject(DestroyRef);

    private wakeLockSentinel: WakeLockSentinelLike | null = null;
    private shouldHoldWakeLock = false;
    private syncChain: Promise<void> = Promise.resolve();
    private unsupportedLogged = false;

    constructor() {
        if (typeof window !== 'undefined' && typeof document !== 'undefined') {
            const restoreWakeLock = () => {
                if (document.visibilityState === 'visible') {
                    this.scheduleSync();
                }
            };

            document.addEventListener('visibilitychange', restoreWakeLock);
            window.addEventListener('focus', restoreWakeLock);

            this.destroyRef.onDestroy(() => {
                document.removeEventListener('visibilitychange', restoreWakeLock);
                window.removeEventListener('focus', restoreWakeLock);
                this.scheduleSync(false);
            });
        }

        effect(() => {
            this.scheduleSync(this.forceBuilderService.hasForces());
        });
    }

    private scheduleSync(shouldHoldWakeLock: boolean = this.shouldHoldWakeLock): void {
        this.shouldHoldWakeLock = shouldHoldWakeLock;
        this.syncChain = this.syncChain
            .then(() => this.syncWakeLock())
            .catch((error) => {
                this.logger.warn(`WakeLockService: ${this.formatError(error)}`);
            });
    }

    private async syncWakeLock(): Promise<void> {
        if (this.wakeLockSentinel?.released) {
            this.wakeLockSentinel = null;
        }

        if (!this.shouldHoldWakeLock) {
            await this.releaseWakeLock();
            return;
        }

        const wakeLockApi = this.getWakeLockApi();
        if (!wakeLockApi) {
            return;
        }

        if (typeof document === 'undefined' || document.visibilityState !== 'visible') {
            return;
        }

        if (this.wakeLockSentinel) {
            return;
        }

        try {
            this.wakeLockSentinel = await wakeLockApi.request('screen');
        } catch (error) {
            if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
                this.logger.warn(`WakeLockService: failed to acquire wake lock: ${this.formatError(error)}`);
            }
        }
    }

    private async releaseWakeLock(): Promise<void> {
        const sentinel = this.wakeLockSentinel;
        this.wakeLockSentinel = null;

        if (!sentinel || sentinel.released) {
            return;
        }

        try {
            await sentinel.release();
        } catch (error) {
            this.logger.warn(`WakeLockService: failed to release wake lock: ${this.formatError(error)}`);
        }
    }

    private getWakeLockApi(): WakeLockApiLike | null {
        if (typeof navigator === 'undefined') {
            return null;
        }

        const wakeLockApi = (navigator as Navigator & { wakeLock?: WakeLockApiLike }).wakeLock ?? null;
        if (!wakeLockApi && !this.unsupportedLogged) {
            this.unsupportedLogged = true;
            this.logger.info('WakeLockService: screen wake lock API is not available in this browser.');
        }
        return wakeLockApi;
    }

    private formatError(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}