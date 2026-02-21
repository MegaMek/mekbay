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

import { Injectable, signal, inject, computed, effect, untracked } from '@angular/core';
import { OptionsService } from './options.service';
import { ForceBuilderService } from './force-builder.service';
import { GameSystem } from '../models/common.model';
import { UrlStateService } from './url-state.service';

/*
 * Author: Drake
 * This service manages the current game system selection (Alpha Strike or Classic BattleTech).
 * 
 * Priority order for determining the active game system:
 * 1. Current force's game system (if a force is loaded)
 * 2. Temporary override (only set when URL has meaningful content)
 * 3. Options (user's default preference)
 * 
 * The override allows viewing game-specific filters from shared links
 * without permanently changing the user's preferred game system.
 * 
 * IMPORTANT: The override is only set when the URL contains meaningful parameters
 * (units, search filters, shared unit, etc.) - not just a bare `gs` parameter.
 * This prevents the override from being incorrectly applied when navigating
 * to a URL that only has `gs` from a previous session's URL update.
 */
@Injectable({
    providedIn: 'root'
})
export class GameService {
    private readonly optionsService = inject(OptionsService);
    private readonly forceBuilderService = inject(ForceBuilderService);
    private readonly urlStateService = inject(UrlStateService);

    public readonly currentGameSystem = signal<GameSystem>(this.optionsService.options().gameSystem);

    /**
     * Temporary game system override. Used when URL parameters specify a game system
     * AND the URL contains meaningful content (units, search, etc.).
     * This does NOT persist to user options.
     */
    private readonly gameSystemOverride = signal<GameSystem | null>(null);

    constructor() {
        // Read initial game system from URL state service (captured before routing)
        // Only apply override if the URL has meaningful content, not just `gs`
        const initialOverride = this.urlStateService.getGameSystemOverride();
        if (initialOverride) {
            this.gameSystemOverride.set(initialOverride);
        }

        /**
         * Computes the effective game system based on priority:
         * 1. Force game system (highest priority - explicit user action)
         * 2. Override (from URL when it has meaningful content)
         * 3. User options (default fallback)
         */
        effect(() => {
            const forceGameSystem = this.forceBuilderService.forceGameSystem();
            let gameSystem: GameSystem;
            if (forceGameSystem) {
                gameSystem = forceGameSystem;
            } else {
                const override = this.gameSystemOverride();
                const optionsGameSystem = this.optionsService.options().gameSystem;
                if (override) {
                    gameSystem = override;
                } else {
                    gameSystem = optionsGameSystem;
                }
            }
            const currentGameSystem = untracked(() => { return this.currentGameSystem(); });
            if (currentGameSystem === gameSystem) {
                return;
            }
            this.currentGameSystem.set(gameSystem);
        });

        // Update URL with current game system, but only after initial URL state is consumed
        // and only when no force is loaded (ForceBuilderService handles URL when a force exists)
        effect(() => {
            const gs = this.currentGameSystem();
            const canUpdate = this.urlStateService.initialStateConsumed();
            if (!canUpdate) {
                return; // Don't update URL until initial state is read by all consumers
            }
            // Skip URL update if forces are loaded - ForceBuilderService handles all URL params
            // including `gs` when forces exist, avoiding race conditions between the two services
            const hasForces = this.forceBuilderService.hasForces();
            if (hasForces) {
                return;
            }
            // Use centralized URL state service
            this.urlStateService.setParams({ gs });
        });
    }

    setOverride(gameSystem: GameSystem | null): void {
        this.gameSystemOverride.set(gameSystem);
    }

    setMode(gameSystem: GameSystem): void {
        this.gameSystemOverride.set(null); // Clear any temporary override
        this.optionsService.setOption('gameSystem', gameSystem);
    }

    isAlphaStrike = computed(() => {
        return this.currentGameSystem() === GameSystem.ALPHA_STRIKE;
    });

}
