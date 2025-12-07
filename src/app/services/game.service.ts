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
import { ActivatedRoute, Router } from '@angular/router';

/*
 * Author: Drake
 * This service manages the current game system selection (Alpha Strike or Classic BattleTech).
 * 
 * Priority order for determining the active game system:
 * 1. Current force's game system (if a force is loaded)
 * 2. Temporary override
 * 3. Options
 * 
 * The override allows viewing game-specific filters from shared links
 * without permanently changing the user's preferred game system.
 */
@Injectable({
    providedIn: 'root'
})
export class GameService {
    private router = inject(Router);
    private route = inject(ActivatedRoute);
    private readonly optionsService = inject(OptionsService);
    private readonly forceBuilderService = inject(ForceBuilderService);


    public readonly currentGameSystem = signal<GameSystem>(this.optionsService.options().gameSystem);

    /**
     * Temporary game system override. Used when URL parameters specify a game system
     * but no force is loaded. This does NOT persist to user options.
     */
    private readonly gameSystemOverride = signal<GameSystem | null>(null);

    constructor() {
        // Auto-clear override when a force is loaded, since the force's game system takes precedence
        effect(() => {
            const currentForce = this.forceBuilderService.currentForce();
            if (currentForce && this.gameSystemOverride()) {
                this.setOverride(null);
            }
        });
        /**
         * Computes the effective game system based on priority:
         * 1. Force game system (highest priority - explicit user action)
         * 2. Override (from URL filters when no force exists)
         * 3. User options (default fallback)
         */
        effect(() => {
            const currentForce = this.forceBuilderService.currentForce();
            let gameSystem: GameSystem;
            if (currentForce) {
                gameSystem = currentForce.gameSystem;
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
        effect(() => {
            this.router.navigate([], {
                relativeTo: this.route,
                queryParams: {
                    gs: this.currentGameSystem()
                },
                queryParamsHandling: 'merge',
                replaceUrl: true
            });
        });
    }

    /**
     * Sets a temporary game system override without affecting user options.
     * The override is automatically cleared when a force is loaded.
     */
    setOverride(gameSystem: GameSystem | null): void {
        this.gameSystemOverride.set(gameSystem);
    }

    /**
     * Clears the temporary game system override.
     */
    clearOverride(): void {
        this.setOverride(null);
    }

    isAlphaStrike = computed(() => {
        return this.currentGameSystem() === GameSystem.AS;
    });

}
