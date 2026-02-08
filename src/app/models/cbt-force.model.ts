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

import { Injector } from '@angular/core';
import { DataService } from '../services/data.service';
import { Unit } from "./units.model";
import { UnitInitializerService } from '../services/unit-initializer.service';
import { CBTSerializedUnit, CBTSerializedForce, SerializedForce } from './force-serialization';
import { GameSystem } from './common.model';
import { Force } from './force.model';
import { CBTForceUnit } from './cbt-force-unit.model';

/*
 * Author: Drake
 */

export class CBTForce extends Force<CBTForceUnit> {
    override gameSystem: GameSystem = GameSystem.CLASSIC;

    constructor(name: string,
        dataService: DataService,
        unitInitializer: UnitInitializerService,
        injector: Injector) {
        super(name, dataService, unitInitializer, injector);
    }

    protected override createForceUnit(unit: Unit): CBTForceUnit {
        return new CBTForceUnit(unit, this, this.dataService, this.unitInitializer, this.injector);
    }

    /**
     * Transfers pilot data (name, gunnery, piloting skills) from one CBT unit to another.
     */
    protected override transferPilotData(fromUnit: CBTForceUnit, toUnit: CBTForceUnit): void {
        const fromCrew = fromUnit.getCrewMembers();
        const toCrew = toUnit.getCrewMembers();

        // Transfer data for each crew member that exists in both units
        const crewCount = Math.min(fromCrew.length, toCrew.length);
        for (let i = 0; i < crewCount; i++) {
            const fromMember = fromCrew[i];
            const toMember = toCrew[i];
            if (fromMember && toMember) {
                const name = fromMember.getName();
                if (name) {
                    toMember.setName(name);
                }
                toMember.setSkill('gunnery', fromMember.getSkill('gunnery'));
                toMember.setSkill('piloting', fromMember.getSkill('piloting'));
            }
        }
    }

    protected override deserializeForceUnit(data: CBTSerializedUnit): CBTForceUnit {
        return CBTForceUnit.deserialize(data, this, this.dataService, this.unitInitializer, this.injector);
    }

    public static override deserialize(
        data: CBTSerializedForce,
        dataService: DataService,
        unitInitializer: UnitInitializerService,
        injector: Injector
    ): CBTForce {
        const force = new CBTForce(data.name, dataService, unitInitializer, injector);
        force.populateFromSerialized(data);
        return force;
    }

    protected override deserializeFrom(serialized: SerializedForce): CBTForce {
        return CBTForce.deserialize(
            serialized as CBTSerializedForce,
            this.dataService, this.unitInitializer, this.injector
        );
    }
}
