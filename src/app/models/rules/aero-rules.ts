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

import { computed, signal } from '@angular/core';
import type { CBTForceUnit } from '../cbt-force-unit.model';
import { PSRCheck } from '../turn-state.model';
import { UnitTypeRules } from './unit-type-rules';
import {
    type HeatScaleEntry,
    type HeatDissipationState,
    HeatManagement,
    getHeatEffects,
} from './heat-management';

/**
 * Author: Drake
 * 
 * Aerospace Fighter game rules
 */
export class AeroRules implements UnitTypeRules {

    private readonly heatMgmt: HeatManagement;

    constructor(private unit: CBTForceUnit) {
        this.heatMgmt = new HeatManagement(unit);
    }

    // ── Destruction ──────────────────────────────────────────────────────────

    /**
     * Aero destruction: SI reduced to 0, or crit slots with 'destroy' attribute.
     */
    evaluateDestroyed(): void {
        let destroyed = false;

        // Check critLocs with 'destroy' attribute (threshold crits: engine, fuel tank, etc.)
        for (const crit of this.unit.getCritSlots()) {
            if (crit.destroyed && crit.el?.getAttribute('destroy')) {
                destroyed = true;
                break;
            }
        }

        // Check SI (structural integrity)
        if (!destroyed && this.unit.locations?.internal?.has('SI')) {
            if (this.unit.isInternalLocCommittedDestroyed('SI')) {
                destroyed = true;
            }
        }

        if (this.unit.destroyed !== destroyed) {
            this.unit.setDestroyed(destroyed);
        }
    }

    // ── PSR / Control Rolls ──────────────────────────────────────────────────

    /** Placeholder for now. */
    readonly PSRModifiers = signal<{ modifier: number; modifiers: PSRCheck[] }>({ modifier: 0, modifiers: [] });
    readonly PSRTargetRoll = signal<number>(0);

    // ── Heat Scale ───────────────────────────────────────────────────────────

    /**
     * Aerospace Heat Scale and effects
     */
    static readonly HEAT_SCALE: readonly HeatScaleEntry[] = [
        { heat: 5,  randomMovement: 5 },
        { heat: 8,  fire: 1 },
        { heat: 10, randomMovement: 6 },
        { heat: 13, fire: 2 },
        { heat: 14, shutdown: 4 },
        { heat: 15, randomMovement: 7 },
        { heat: 17, fire: 3 },
        { heat: 18, shutdown: 6 },
        { heat: 19, ammoExp: 4 },
        { heat: 20, randomMovement: 8 },
        { heat: 21, pilotDamage: 6 },
        { heat: 22, shutdown: 8 },
        { heat: 23, ammoExp: 6 },
        { heat: 24, fire: 4 },
        { heat: 25, randomMovement: 10 },
        { heat: 26, shutdown: 10 },
        { heat: 27, pilotDamage: 9 },
        { heat: 28, ammoExp: 8 },
        { heat: 30, shutdown: 100 },
    ];

    /** Compute heat-based fire modifiers from current heat level */
    static getHeatEffects(heat: number): { moveModifier: number; fireModifier: number } {
        return getHeatEffects(AeroRules.HEAT_SCALE, heat);
    }

    // ── Heat Dissipation ─────────────────────────────────────────────────────

    /**
     * Aero heat dissipation: engine HS - turned-off.
     */
    readonly heatDissipation = computed<HeatDissipationState | null>(() => {
        return this.heatMgmt.baseDissipation();
    });
}
