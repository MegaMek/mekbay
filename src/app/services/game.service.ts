// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable, signal, inject, computed, effect, untracked } from '@angular/core';
import { OptionsService } from './options.service';
import { ForceWorkspaceStateService } from './force-workspace-state.service';
import { GameSystem } from '../models/common.model';
import { UrlService } from './url.service';

/*
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
    private readonly forceWorkspace = inject(ForceWorkspaceStateService);
    private readonly urlService = inject(UrlService);

    public readonly currentGameSystem = signal<GameSystem>(this.optionsService.options().gameSystem);

    /**
     * Temporary game system override. Used when URL parameters specify a game system
     * AND the URL contains meaningful content (units, search, etc.).
     * This does NOT persist to user options.
     */
    private readonly gameSystemOverride = signal<GameSystem | null>(null);

    constructor() {
        // Read initial game system from the URL captured at startup.
        // Only apply override if the URL has meaningful content, not just `gs`
        const initialOverride = this.urlService.getGameSystemOverride();
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
            const forceGameSystem = this.forceWorkspace.forceGameSystem();
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

        // Update URL with current game system, but only when no force is loaded
        // (ForceBuilderService handles URL when a force exists)
        effect(() => {
            const gs = this.currentGameSystem();
            // Skip URL update if forces are loaded - ForceBuilderService handles all URL params
            // including `gs` when forces exist, avoiding race conditions between the two services
            const hasForces = this.forceWorkspace.hasForces();
            if (hasForces) {
                return;
            }
            this.urlService.setQueryParams({ gs });
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
