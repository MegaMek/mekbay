// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { computed } from '@angular/core';
import type { CBTForceUnit } from '../cbt-force-unit.model';
import type { MountedEquipment } from '../mounted-equipment.model';
import { UnitTypeRulesBase, type UnitRuleModifier } from './unit-type-rules';
import {
    type HeatScaleEntry,
    type HeatDissipationState,
    HeatManagement,
    getHeatEffects,
} from './heat-management';

/**
 * 
 * Aerospace Fighter game rules
 */
export class AeroRules extends UnitTypeRulesBase {

    protected override supportsDroneOperatingSystem(): boolean {
        return true;
    }

    private readonly heatMgmt: HeatManagement;

    constructor(unit: CBTForceUnit) {
        super(unit);
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

    protected override buildRuleModifiers(): UnitRuleModifier[] {
        const heatFireModifier = AeroRules.getHeatEffects(this.unit.getHeat().current).fireModifier;
        return heatFireModifier === 0 ? [] : [{
            label: 'Heat - Fire Modifier',
            values: { ranged: heatFireModifier },
            weakened: true,
            kind: 'heat',
        }];
    }

    // ── Heat Dissipation ─────────────────────────────────────────────────────

    /**
     * Aero heat dissipation: engine HS - turned-off.
     */
    override readonly heatDissipation = computed<HeatDissipationState | null>(() => {
        const base = this.heatMgmt.baseDissipation();
        if (!base) return null;
        return {
            ...base,
            totalDissipation: base.totalDissipation
                + (this.unit.getEquipmentHeatDissipationBonus?.(base) ?? 0),
        };
    });
}
