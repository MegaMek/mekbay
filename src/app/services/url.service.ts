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

import { Injectable, inject } from '@angular/core';
import { NavigationCancel, NavigationEnd, NavigationError, Router } from '@angular/router';
import { filter, take } from 'rxjs';
import { GameSystem } from '../models/common.model';

/*
 * Author: Drake
 */

/**
 * Type for URL parameter values.
 * - string | number: The parameter value
 * - null: Remove this parameter from the URL
 * - undefined: Don't touch this parameter
 */
export type UrlParamValue = string | number | null | undefined;

/**
 * URL parameter keys that indicate a "meaningful" link that should override
 * the user's default game system preference.
 */
export const MEANINGFUL_URL_PARAMS = [
    'units',       // Force units
    'instance',    // Cloud force instance ID
    'toe',         // TO&E organization ID
    'shareUnit',   // Shared single unit
    'q',           // Search query
    'filters',     // Search filters
] as const;

/**
 * Computes the game system override from the initial URL.
 * The `gs` parameter only overrides the user's preference when the link
 * carries meaningful content (units, search, a routed page, ...).
 */
export function computeGameSystemOverride(params: URLSearchParams, pathname: string): GameSystem | null {
    const gsParam = params.get('gs');
    if (gsParam !== GameSystem.ALPHA_STRIKE && gsParam !== GameSystem.CLASSIC) {
        return null;
    }
    const isPagePath = pathname.replace(/\/+$/, '') !== '';
    const hasMeaningfulParams = MEANINGFUL_URL_PARAMS.some(key => params.has(key)) || isPagePath;
    return hasMeaningfulParams ? gsParam : null;
}

/**
 * Thin facade over the Angular Router for query-parameter state.
 *
 * - Captures the initial URL (path + query) synchronously at startup, before
 *   the router's initial navigation, so services can read shared-link state.
 * - Writes query params natively via `Router.navigate` with
 *   `queryParamsHandling: 'merge'` + `replaceUrl: true`. Writes are coalesced
 *   per tick and deferred while a navigation is in flight, so concurrent
 *   writers never clobber each other's keys.
 *
 * URL *paths* are owned by the router itself (see `app.routes.ts`).
 */
@Injectable({ providedIn: 'root' })
export class UrlService {
    private readonly router = inject(Router);

    /** Query parameters captured synchronously at app startup. */
    public readonly initialParams = new URLSearchParams(window.location.search);

    /** URL pathname captured synchronously at app startup. */
    public readonly initialPathname = window.location.pathname;

    private pendingParams: Record<string, string | number | null> | null = null;
    private flushScheduled = false;

    /** Get a query parameter from the initial (startup) URL. */
    getInitialParam(key: string): string | null {
        return this.initialParams.get(key);
    }

    /** Check whether the initial (startup) URL had a query parameter. */
    hasInitialParam(key: string): boolean {
        return this.initialParams.has(key);
    }

    /**
     * Game system override from the initial URL, or null when the link has
     * no meaningful content. Does NOT persist to user options.
     */
    getGameSystemOverride(): GameSystem | null {
        return computeGameSystemOverride(this.initialParams, this.initialPathname);
    }

    /**
     * Merge query parameters into the current URL (history is replaced).
     * `null` removes a parameter; `undefined` values are ignored.
     */
    setQueryParams(params: Record<string, UrlParamValue>): void {
        for (const [key, value] of Object.entries(params)) {
            if (value === undefined) continue;
            this.pendingParams ??= {};
            this.pendingParams[key] = value;
        }
        if (this.pendingParams && !this.flushScheduled) {
            this.flushScheduled = true;
            setTimeout(() => {
                this.flushScheduled = false;
                this.flush();
            }, 0);
        }
    }

    private flush(): void {
        if (!this.pendingParams) return;
        if (this.router.currentNavigation()) {
            // A navigation is in flight (e.g. the initial navigation or a page
            // change): merging now would target a stale URL tree. Retry once
            // the navigation settles.
            this.router.events.pipe(
                filter(e => e instanceof NavigationEnd || e instanceof NavigationCancel || e instanceof NavigationError),
                take(1)
            ).subscribe(() => this.flush());
            return;
        }
        const queryParams = this.pendingParams;
        this.pendingParams = null;
        void this.router.navigate([], {
            queryParams,
            queryParamsHandling: 'merge',
            replaceUrl: true,
        });
    }
}
