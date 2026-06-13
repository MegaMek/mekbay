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
 */

import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SwUpdate } from '@angular/service-worker';
import { LoggerService } from './logger.service';
import {
    createServiceWorkerUpdateScreen,
    getLatestServiceWorkerHash,
    recordUpdateReloadHash,
} from '../utils/service-worker-update-bootstrap.util';

export interface UpdateCheckOptions {
    force?: boolean;
}

@Injectable({ providedIn: 'root' })
export class AppUpdateService {
    readonly updateCheckIntervalMs = 60 * 60 * 1000; // 1 hour
    readonly updatePending = signal(false);
    readonly updateCheckInProgress = signal(false);
    readonly reloadingForUpdate = signal(false);

    private swUpdate = inject(SwUpdate);
    private logger = inject(LoggerService);
    private currentCheck: Promise<boolean> | null = null;
    private pendingUpdateHash: string | null = null;
    private lastUpdateCheck = Date.now();

    constructor() {
        const destroyRef = inject(DestroyRef);

        if (!this.swUpdate.isEnabled) {
            return;
        }

        this.swUpdate.versionUpdates
            .pipe(takeUntilDestroyed(destroyRef))
            .subscribe((event) => {
                switch (event.type) {
                    case 'VERSION_DETECTED':
                        this.logger.info('Service worker update detected, downloading...');
                        break;
                    case 'VERSION_READY':
                        this.handleReadyUpdate(event);
                        break;
                    case 'VERSION_INSTALLATION_FAILED':
                        this.logger.error('Service worker update installation failed: ' + event.error);
                        break;
                    case 'NO_NEW_VERSION_DETECTED':
                        break;
                }
            });
    }

    async checkForUpdate(options: UpdateCheckOptions = {}): Promise<boolean> {
        const force = options.force ?? false;

        if (!this.swUpdate.isEnabled) {
            return false;
        }

        const now = Date.now();
        if (!force && (now - this.lastUpdateCheck) < this.updateCheckIntervalMs) {
            return false;
        }

        if (this.currentCheck) {
            return this.currentCheck;
        }

        this.lastUpdateCheck = now;
        this.updateCheckInProgress.set(true);
        this.logger.info('Checking for updates...');

        this.currentCheck = this.swUpdate.checkForUpdate()
            .then((updateFound) => {
                if (updateFound) {
                    this.updatePending.set(true);
                }
                return true;
            })
            .catch((err) => {
                this.logger.error('Error checking for updates:' + err);
                return true;
            })
            .finally(() => {
                this.updateCheckInProgress.set(false);
                this.currentCheck = null;
            });

        return this.currentCheck;
    }

    async restartForUpdate(): Promise<void> {
        this.reloadingForUpdate.set(true);
        const updateScreen = createServiceWorkerUpdateScreen();
        updateScreen?.show('Activating update...', 90);

        if (this.swUpdate.isEnabled) {
            recordUpdateReloadHash(this.pendingUpdateHash);
            try {
                const activated = await this.swUpdate.activateUpdate();
                if (activated) {
                    this.logger.info('Activated service worker update; reloading app.');
                } else {
                    this.logger.warn('Service worker activation returned false; reloading app anyway.');
                }
            } catch (err) {
                this.logger.error('Error activating service worker update: ' + err);
            }
        }

        updateScreen?.update('Restarting...', 100);
        window.location.reload();
    }

    private handleReadyUpdate(event: { latestVersion?: { hash?: string } }): void {
        const latestHash = getLatestServiceWorkerHash(event);
        this.pendingUpdateHash = latestHash;
        this.updatePending.set(true);
        this.logger.info('Service worker update is ready');
    }
}