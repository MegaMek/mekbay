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

import { computed, Injector, signal, Signal } from '@angular/core';
import { DataService } from '../services/data.service';
import { Unit } from "./units.model";
import { UnitInitializerService } from '../services/unit-initializer.service';
import { ASSerializedState, ASSerializedUnit, C3_POSITION_SCHEMA } from './force-serialization';
import { ASForce } from './as-force.model';
import { ForceUnit } from './force-unit.model';
import { Sanitizer } from '../utils/sanitizer.util';
import { ASForceUnitState } from './as-force-unit-state.model';
import { CrewMember } from './crew-member.model';
import { ASCustomPilotAbility } from './as-abilities.model';

/** Represents either a standard ability (by ID) or a custom ability (object) */
export type AbilitySelection = string | ASCustomPilotAbility;

/*
 * Author: Drake
 */
export class ASForceUnit extends ForceUnit {
    declare force: ASForce;
    protected override state: ASForceUnitState;

    private readonly _pilotName = signal<string | undefined>(undefined);
    private readonly _pilotSkill = signal<number>(4);
    private readonly _pilotAbilities = signal<AbilitySelection[]>([]);
    public adjustedPv = signal<number | null>(null);

    readonly alias = this._pilotName.asReadonly();
    readonly pilotSkill = this._pilotSkill.asReadonly();
    readonly pilotAbilities = this._pilotAbilities.asReadonly();

    constructor(unit: Unit,
        force: ASForce,
        dataService: DataService,
        unitInitializer: UnitInitializerService,
        injector: Injector
    ) {
        super(unit, force, dataService, unitInitializer, injector);
        this.state = new ASForceUnitState(this);
    }

    override destroy() {
        super.destroy();
    }

    public async load() {
        if (this.isLoaded) return;
        try {
            this.isLoaded = true;
        } finally {
        }
    }

    override getBv = computed<number>(() => {
        const adjustedPv = this.adjustedPv();
        if (adjustedPv !== null) {
            return adjustedPv;
        }
        return this.unit.bv;
    })

    /** Alpha Strike units don't have detailed crew management - return empty signal */
    getCrewMembers = computed<CrewMember[]>(() => {
        return [];
    });

    getHeat = computed<number>(() => {
        return this.state.heat();
    });

    private calculateAdjustedPV(basePV: number, skill: number): number {
        // PV adjustment based on skill (skill 4 is baseline)
        const skillModifiers: Record<number, number> = {
            0: 2.4,
            1: 1.9,
            2: 1.5,
            3: 1.2,
            4: 1.0,
            5: 0.9,
            6: 0.8,
            7: 0.7,
            8: 0.6
        };
        const modifier = skillModifiers[skill] ?? 1.0;
        return Math.round(basePV * modifier);
    }
    
    recalculatePv() {
        const skillLevel = this._pilotSkill();
        let bv = this.unit.as.PV;
        const adjustedPv = this.calculateAdjustedPV(bv, skillLevel);
        
        if (adjustedPv !== this.unit.bv) {
            if (adjustedPv !== this.adjustedPv()) {
                this.adjustedPv.set(adjustedPv);
            }
        } else {
            this.adjustedPv.set(null);
        }
    };
    
    repairAll(): void {
        this.state.destroyed.set(false);
        this.state.shutdown.set(false);
        this.setModified();
    }

    setPilotName(name: string | undefined): void {
        this._pilotName.set(name);
        this.setModified();
        this.force.emitChanged();
    }

    setPilotSkill(skill: number): void {
        this._pilotSkill.set(skill);
        this.recalculatePv();
        this.setModified();
        this.force.emitChanged();
    }

    setPilotAbilities(abilities: AbilitySelection[]): void {
        this._pilotAbilities.set(abilities);
        this.setModified();
        this.force.emitChanged();
    }

    public getPilotSkill = computed<number>(() => {
        return this._pilotSkill();
    });

    public getPilotStats = computed<number>(() => {
        return this._pilotSkill();
    });

    public override update(data: ASSerializedUnit) {
        if (data.alias !== this.alias()) {
        }
        if (data.state) {
            this.state.update(data.state);
        }
    }

    public override serialize(): ASSerializedUnit {
        const stateObj: ASSerializedState = {
            modified: this.state.modified(),
            destroyed: this.state.destroyed(),
            shutdown: this.state.shutdown(),
            c3Position: this.state.c3Position() ?? undefined,
            heat: this.state.heat(),
            armor: this.state.armor(),
            internal: this.state.internal()
        };
        const data = {
            id: this.id,
            state: stateObj,
            unit: this.getUnit().name, // Serialize only the name,
            alias: this.alias(),
            skill: this._pilotSkill(),
            abilities: this._pilotAbilities()
        };
        return data;
    }

    protected deserializeState(state: ASSerializedState) {
        this.state.modified.set(typeof state.modified === 'boolean' ? state.modified : false);
        this.state.destroyed.set(typeof state.destroyed === 'boolean' ? state.destroyed : false);
        this.state.shutdown.set(typeof state.shutdown === 'boolean' ? state.shutdown : false);
        this.state.heat.set(typeof state.heat === 'number' ? state.heat : 0);
        this.state.armor.set(typeof state.armor === 'number' ? state.armor : 0);
        this.state.internal.set(typeof state.internal === 'number' ? state.internal : 0);
        if (state.c3Position) {
            this.state.c3Position.set(Sanitizer.sanitize(state.c3Position, C3_POSITION_SCHEMA));
        }
        this.recalculatePv();
    }

    public static override deserialize(
        data: ASSerializedUnit,
        force: ASForce,
        dataService: DataService,
        unitInitializer: UnitInitializerService,
        injector: Injector
    ): ASForceUnit {
        const unit = dataService.getUnitByName(data.unit);
        if (!unit) {
            throw new Error(`Unit with name "${data.unit}" not found in dataService`);
        }
        const fu = new ASForceUnit(unit, force, dataService, unitInitializer, injector);
        fu.id = data.id;
        
        if (data.alias !== undefined) {
            fu._pilotName.set(data.alias);
        }
        if (data.skill !== undefined) {
            fu._pilotSkill.set(data.skill);
        }
        if (data.abilities !== undefined) {
            fu._pilotAbilities.set(data.abilities);
        }
        fu.deserializeState(data.state);
        fu.recalculatePv();
        return fu;
    }


}
