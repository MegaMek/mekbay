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

import { Injectable, isDevMode, signal, inject, NgZone } from '@angular/core';
import { LoggerService } from './logger.service';

/**
 * Service that manages the Workbox-powered service worker lifecycle.
 *
 * Responsibilities:
 *  - Registers the service worker (production only)
 *  - Detects waiting updates and exposes an `updateAvailable` signal
 *  - Provides `checkForUpdate()` (manual SW update check)
 *  - Provides `activateUpdate()` to tell the waiting SW to skip-waiting
 *  - Listens for messages from the service worker (e.g. NAVIGATE from link capture)
 *  - Exposes `navigateRequest` signal for the app to react to in-app link captures
 */
@Injectable({ providedIn: 'root' })
export class PwaService {
    private readonly logger = inject(LoggerService);
    private readonly zone = inject(NgZone);

    /** Whether a new service worker version is waiting to activate. */
    readonly updateAvailable = signal(false);

    /** Whether the service worker is registered and active. */
    readonly isEnabled = signal(false);

    /**
     * Fired when the SW relays a NAVIGATE message (e.g. from a captured link
     * or notification click). The value is the URL path + query string.
     * Consumers should read & reset this signal.
     */
    readonly navigateRequest = signal<string | null>(null);

    private registration: ServiceWorkerRegistration | null = null;

    constructor() {
        if (!('serviceWorker' in navigator) || isDevMode()) {
            this.logger.info('[PWA] Service worker not available or dev mode — skipping registration.');
            return;
        }

        // Register after the page is interactive (similar to registerWhenStable:30000)
        this.registerWhenStable();
    }

    // ─── Registration ────────────────────────────────────────

    private registerWhenStable(): void {
        // Wait for window load + a short delay to avoid competing with initial data fetches
        if (document.readyState === 'complete') {
            setTimeout(() => this.register(), 5_000);
        } else {
            window.addEventListener('load', () => {
                setTimeout(() => this.register(), 5_000);
            }, { once: true });
        }
    }

    private async register(): Promise<void> {
        try {
            const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
            this.registration = reg;
            this.isEnabled.set(true);
            this.logger.info('[PWA] Service worker registered.');

            // If there's already a waiting worker (e.g. update happened while tab was closed)
            if (reg.waiting) {
                this.zone.run(() => this.updateAvailable.set(true));
            }

            // Detect future updates
            reg.addEventListener('updatefound', () => {
                const installing = reg.installing;
                if (!installing) return;

                installing.addEventListener('statechange', () => {
                    if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                        // New version installed and a previous version was controlling -> update ready
                        this.zone.run(() => this.updateAvailable.set(true));
                        this.logger.info('[PWA] New service worker version is waiting to activate.');
                    }
                });
            });

            // Listen for messages from the service worker
            navigator.serviceWorker.addEventListener('message', (event) => {
                this.handleSwMessage(event.data);
            });

            // If the controller changes (another tab called skipWaiting), reload.
            let refreshing = false;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (refreshing) return;
                refreshing = true;
                window.location.reload();
            });
        } catch (err) {
            this.logger.error('[PWA] Service worker registration failed: ' + err);
        }
    }

    // ─── Update API ──────────────────────────────────────────

    /**
     * Manually check for a service worker update.
     * @returns `true` if an update was found.
     */
    async checkForUpdate(): Promise<boolean> {
        if (!this.registration) return false;
        try {
            await this.registration.update();
            // After update(), if a new SW is waiting, updatefound listener will set the signal.
            return this.updateAvailable();
        } catch (err) {
            this.logger.error('[PWA] Update check failed: ' + err);
            return false;
        }
    }

    /**
     * Tell the waiting service worker to activate (skipWaiting).
     * The `controllerchange` listener will reload the page automatically.
     */
    activateUpdate(): void {
        const waiting = this.registration?.waiting;
        if (waiting) {
            waiting.postMessage({ type: 'SKIP_WAITING' });
        }
    }

    // ─── SW Message Handling ─────────────────────────────────

    private handleSwMessage(data: unknown): void {
        if (!data || typeof data !== 'object') return;

        const msg = data as Record<string, unknown>;

        switch (msg['type']) {
            case 'NAVIGATE': {
                // The SW captured a link and wants us to handle it in-app
                const url = msg['url'] as string | undefined;
                if (url) {
                    this.logger.info('[PWA] Received NAVIGATE message: ' + url);
                    this.zone.run(() => this.navigateRequest.set(url));
                }
                break;
            }
            default:
                break;
        }
    }
}
