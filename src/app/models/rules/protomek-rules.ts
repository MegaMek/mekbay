// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { MotiveModes } from '../motiveModes.model';
import type { CBTForceUnit } from '../cbt-force-unit.model';
import { getDefaultAttackerMovementModifier } from '../target-number-calculator.model';
import { CrewStateControlDefinition, CrewStateDefinition, crewStateDefinitions, UnitConditionControl, unitConditionControls, UnitTypeRulesBase } from './unit-type-rules';
import { computed } from '@angular/core';

/**
 *
 * ProtoMek game rules.
 */
export const PROTOMEK_UNIT_CONDITION_CONTROLS: readonly UnitConditionControl[] = unitConditionControls(['swarmed', 'tagged', 'skidding', 'jammed']);
export const PROTOMEK_CREW_STATE_CONTROLS: readonly CrewStateControlDefinition[] = crewStateDefinitions(['unconscious']) as readonly CrewStateControlDefinition[];
export const PROTOMEK_CREW_STATE_DISPLAYS: readonly CrewStateDefinition[] = crewStateDefinitions(['unconscious', 'dead']);

export class ProtoMekRules extends UnitTypeRulesBase {

    protected override readonly baseConditionControls = PROTOMEK_UNIT_CONDITION_CONTROLS;
    protected override readonly baseCrewStateControls = PROTOMEK_CREW_STATE_CONTROLS;
    protected override readonly crewStateDisplayDefinitions = PROTOMEK_CREW_STATE_DISPLAYS;

    constructor(unit: CBTForceUnit) {
        super(unit);
    }
    
    protected override readonly abandoned = computed<boolean>(() => {
        const crew = this.unit.getCrewMembers();
        return crew.length > 0 && crew.every(crewMember => {
            const state = crewMember.getState();
            return state === 'dead';
        });
    });

    protected override readonly immobile = computed<boolean>(() => {
        if (!this.unit.isLoaded()) return false;
        if (this.allLimbsDestroyedOrMissing()) return true;
        if (this.hasFunctionalCrew()) return false;
        return true;
    });

    protected override readonly crippled = computed<boolean>(() => {
        if (!this.unit.isLoaded()) return false;
        return this.allCrewCrippled();
    });
    
    private allLimbsDestroyedOrMissing(): boolean {
        const internalLocations = this.unit.locations?.internal;
        if (!internalLocations) return false;

        const limbLocations = ['LA', 'RA', 'L'];
        return limbLocations.every(loc => !internalLocations.has(loc) || this.unit.isInternalLocCommittedDestroyed(loc));
    }

    evaluateDestroyed(): void {
        let destroyed = false;

        const critSlots = this.unit.getCritSlots();
        
        const criticalHitTorsoDestroyed = critSlots.some((crit) => crit.id === 'torso_hit_3' && crit.destroyed);
        if (criticalHitTorsoDestroyed) {
            destroyed = true;
        }

        if (!destroyed && this.unit.locations?.internal?.has('T')) {
            destroyed = this.unit.isInternalLocCommittedDestroyed('T');
        }

        if (this.unit.destroyed !== destroyed) {
            this.unit.setDestroyed(destroyed);
        }
    }

    override getAttackMovementModifier(moveMode: MotiveModes | null | undefined): number {
        return getDefaultAttackerMovementModifier(moveMode);
    }
}
