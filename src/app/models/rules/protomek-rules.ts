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

import type { MotiveModes } from '../motiveModes.model';
import type { CBTForceUnit } from '../cbt-force-unit.model';
import { getDefaultAttackerMovementModifier } from '../target-number-calculator.model';
import { CrewStateControlDefinition, CrewStateDefinition, crewStateDefinitions, UnitConditionControl, unitConditionControls, UnitTypeRulesBase } from './unit-type-rules';
import { computed } from '@angular/core';

/**
 * Author: Drake
 *
 * ProtoMek game rules.
 */
export const PROTOMEK_UNIT_CONDITION_CONTROLS: readonly UnitConditionControl[] = unitConditionControls(['swarmed', 'tagged', 'skidding', 'jammed']);
export const PROTOMEK_CREW_STATE_CONTROLS: readonly CrewStateControlDefinition[] = crewStateDefinitions(['unconscious']) as readonly CrewStateControlDefinition[];
export const PROTOMEK_CREW_STATE_DISPLAYS: readonly CrewStateDefinition[] = crewStateDefinitions(['unconscious', 'dead']);

export class ProtoMekRules extends UnitTypeRulesBase {

    override readonly conditionControls = PROTOMEK_UNIT_CONDITION_CONTROLS;
    override readonly crewStateControls = PROTOMEK_CREW_STATE_CONTROLS;
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
