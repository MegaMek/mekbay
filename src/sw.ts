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

/// <reference lib="webworker" />

// Workbox injects the precache manifest at build time
declare const self: ServiceWorkerGlobalScope & {
    __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { NetworkFirst, StaleWhileRevalidate, CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { clientsClaim } from 'workbox-core';

// ─── Lifecycle ──────────────────────────────────────────────

// Listen for SKIP_WAITING from the app (user-triggered update).
self.addEventListener('message', (event) => {
    if (event.data?.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

// On first install (or migration from old NGSW), auto-skipWaiting so the
// new SW takes over immediately.  On normal Workbox-to-Workbox updates we
// wait for the user to confirm via the SKIP_WAITING message so their work
// isn't interrupted by a surprise reload.
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            const hasWorkboxCache = keys.some((k) => k.includes('workbox-precache'));
            if (!hasWorkboxCache) {
                // No Workbox precache → first install or migrating from NGSW.
                return self.skipWaiting();
            }
            // Normal Workbox update — wait for SKIP_WAITING message.
            return;
        }),
    );
});

// Claim clients immediately after activation so existing tabs use the new SW.
clientsClaim();

// On activation, clean up caches left behind by Angular's @angular/service-worker.
// NGSW uses cache names prefixed with "ngsw:".
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys
                    .filter((key) => key.startsWith('ngsw:'))
                    .map((key) => {
                        console.log('[SW] Cleaning up old NGSW cache:', key);
                        return caches.delete(key);
                    })
            );
        })
    );
});

// ─── Precaching ─────────────────────────────────────────────
// workbox-build injects the manifest here during the build step.
// The injected entries include content hashes for cache-busting.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// ─── Navigation (SPA) ──────────────────────────────────────
// All navigation requests (HTML pages) are served from the precached /index.html.
// This makes the SPA work offline and keeps URL handling in the Angular app.
const navigationHandler = new NetworkFirst({
    cacheName: 'navigations',
    networkTimeoutSeconds: 3,
    plugins: [
        new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
});

registerRoute(new NavigationRoute(navigationHandler, {
    // Don't intercept requests to well-known or API paths
    denylist: [
        /^\/__/,
        /\/api\//,
    ],
}));

// ─── Static assets (images, fonts, etc.) ────────────────────
registerRoute(
    ({ request }) =>
        request.destination === 'image' ||
        request.destination === 'font',
    new CacheFirst({
        cacheName: 'assets',
        plugins: [
            new CacheableResponsePlugin({ statuses: [0, 200] }),
            new ExpirationPlugin({
                maxEntries: 500,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
            }),
        ],
    }),
);

// ─── Data files (JSON, etc.) ────────────────────────────────
registerRoute(
    ({ url }) => url.pathname.endsWith('.json') && !url.pathname.endsWith('manifest.webmanifest'),
    new StaleWhileRevalidate({
        cacheName: 'data',
        plugins: [
            new CacheableResponsePlugin({ statuses: [0, 200] }),
            new ExpirationPlugin({
                maxEntries: 50,
                maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
            }),
        ],
    }),
);

// ─── Launch handling (URL interception) ─────────────────────
// When the PWA is launched via a captured link, the launch_handler in the
// manifest already directs the browser to the existing client window when
// possible (client_mode: "focus-existing" / "auto").
//
// For deeper control we listen for the 'fetch' of navigation requests that
// arrive from link captures: the NavigationRoute above serves index.html and
// preserves the full URL (including query string) so the Angular app's
// UrlStateService can parse it.
//
// If the Launch Handler API fires a `launch` event on the SW (currently behind
// a flag), we relay it to the client so the Angular app can react without
// a full-page reload.
self.addEventListener('notificationclick', (event) => {
    // If notifications are ever added, open the URL inside the PWA window.
    const url = (event.notification.data as { url?: string })?.url ?? '/';
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            // Focus an existing window if available, otherwise open a new one.
            for (const client of windowClients) {
                if (new URL(client.url).origin === self.location.origin) {
                    client.focus();
                    client.postMessage({ type: 'NAVIGATE', url });
                    return;
                }
            }
            return self.clients.openWindow(url);
        }),
    );
});
