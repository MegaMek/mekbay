// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { DestroyRef, Injectable, effect, inject } from '@angular/core';
import { ForceBuilderService } from './force-builder.service';
import { LobbyService } from './lobby.service';
import { LoggerService } from './logger.service';

interface WakeLockSentinelLike {
    released: boolean;
    release(): Promise<void>;
}

interface WakeLockApiLike {
    request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

/**
 * 
 * Service to manage a screen wake lock while the force builder has any forces in it or the user is in a lobby.
 * The wake lock is released only when there are no loaded forces and the user is not in a lobby.
 * It is also released when the document becomes hidden and re-acquired when it becomes visible again.
 * This prevents the screen from sleeping while actively building/using a force or participating in a lobby,
 * but allows normal sleep behavior otherwise.
 */
@Injectable({ providedIn: 'root' })
export class WakeLockService {
    private forceBuilderService = inject(ForceBuilderService);
    private lobbyService = inject(LobbyService);
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
            this.scheduleSync(this.forceBuilderService.hasForces() || this.lobbyService.hasLobby());
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
