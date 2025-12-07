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

import { Injectable, signal } from '@angular/core';
import { GameSystem } from '../models/common.model';

/**
 * URL parameter keys that indicate a "meaningful" link that should override
 * the user's default game system preference.
 * 
 * This is designed to be extensible - add new keys here as new features
 * require game system override from URL.
 */
export const MEANINGFUL_URL_PARAMS = [
    'units',       // Force units
    'instance',    // Cloud force instance ID
    'shareUnit',   // Shared single unit
    'q',           // Search query
    'filters',     // Search filters
] as const;

export type MeaningfulUrlParam = typeof MEANINGFUL_URL_PARAMS[number];

/**
 * Captured initial URL state from page load.
 * This is captured synchronously before Angular routing can modify the URL.
 */
export interface InitialUrlState {
    /** Game system from URL (gs parameter) */
    gameSystem: GameSystem | null;
    /** Whether the URL contains meaningful parameters that warrant a game system override */
    hasMeaningfulParams: boolean;
    /** All query parameters captured at startup */
    params: URLSearchParams;
}

/**
 * Service that captures and manages URL state.
 * 
 * This service captures URL parameters synchronously at service creation time,
 * BEFORE Angular's router effects can modify the URL. This ensures we have
 * access to the original URL parameters from shared links.
 * 
 * The service also provides a mechanism for coordinating when URL updates
 * are safe to perform (after initial state has been consumed).
 */
@Injectable({
    providedIn: 'root'
})
export class UrlStateService {
    /**
     * The initial URL state captured at app startup.
     * This is populated synchronously in the constructor.
     */
    public readonly initialState: InitialUrlState;

    /**
     * Signal indicating whether the initial URL state has been consumed.
     * Services should wait for this before updating the URL.
     */
    public readonly initialStateConsumed = signal(false);

    /**
     * Tracks which consumers have marked their initial URL reading as complete.
     * All registered consumers must complete before `initialStateConsumed` is set to true.
     */
    private pendingConsumers = new Set<string>();

    constructor() {
        // Capture URL state synchronously - this happens before any effects run
        const params = new URLSearchParams(window.location.search);
        
        // Parse game system
        const gsParam = params.get('gs');
        let gameSystem: GameSystem | null = null;
        if (gsParam === GameSystem.AS || gsParam === GameSystem.CBT) {
            gameSystem = gsParam;
        }

        // Check if URL has meaningful parameters
        const hasMeaningfulParams = MEANINGFUL_URL_PARAMS.some(key => params.has(key));

        this.initialState = {
            gameSystem,
            hasMeaningfulParams,
            params
        };
    }

    /**
     * Register a consumer that needs to read the initial URL state.
     * The consumer should call `markConsumerReady` when done reading.
     * 
     * @param consumerId Unique identifier for the consumer
     */
    registerConsumer(consumerId: string): void {
        this.pendingConsumers.add(consumerId);
    }

    /**
     * Mark a consumer as having finished reading the initial URL state.
     * When all registered consumers are ready, `initialStateConsumed` becomes true.
     * 
     * @param consumerId The consumer that has finished reading
     */
    markConsumerReady(consumerId: string): void {
        this.pendingConsumers.delete(consumerId);
        if (this.pendingConsumers.size === 0) {
            this.initialStateConsumed.set(true);
        }
    }

    /**
     * Get a specific parameter from the initial URL state.
     * Use this instead of route.snapshot.queryParamMap for initial reads.
     */
    getInitialParam(key: string): string | null {
        return this.initialState.params.get(key);
    }

    /**
     * Check if the initial URL had a specific parameter.
     */
    hasInitialParam(key: string): boolean {
        return this.initialState.params.has(key);
    }

    /**
     * Determines if the URL indicates a game system override should be applied.
     * 
     * Override should only happen when:
     * 1. URL has a game system parameter (gs)
     * 2. URL has meaningful content (units, search, shared unit, etc.)
     * 
     * This prevents the override from being set when the URL only has `gs`
     * (which could be from a previous session's URL update).
     */
    shouldOverrideGameSystem(): boolean {
        return this.initialState.gameSystem !== null && this.initialState.hasMeaningfulParams;
    }

    /**
     * Get the game system from URL if an override should be applied.
     * Returns null if no override should be applied.
     */
    getGameSystemOverride(): GameSystem | null {
        if (this.shouldOverrideGameSystem()) {
            return this.initialState.gameSystem;
        }
        return null;
    }
}
