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
import { ASSerializedUnit, ASSerializedForce, AS_SERIALIZED_FORCE_SCHEMA, SerializedForce } from './force-serialization';
import { GameSystem } from './common.model';
import { Force } from './force.model';
import { Sanitizer } from '../utils/sanitizer.util';
import { ASForceUnit } from './as-force-unit.model';

/*
 * Author: Drake
 */

export class ASForce extends Force<ASForceUnit> {
    override gameSystem: GameSystem = GameSystem.ALPHA_STRIKE;

    constructor(name: string,
        dataService: DataService,
        unitInitializer: UnitInitializerService,
        injector: Injector) {
        super(name, dataService, unitInitializer, injector);
    }

    protected override createForceUnit(unit: Unit): ASForceUnit {
        return new ASForceUnit(unit, this, this.dataService, this.unitInitializer, this.injector);
    }

    /**
     * Transfers pilot data (name, skill, abilities) from one AS unit to another.
     */
    protected override transferPilotData(fromUnit: ASForceUnit, toUnit: ASForceUnit): void {
        const pilotName = fromUnit.alias();
        if (pilotName) {
            toUnit.setPilotName(pilotName);
        }
        toUnit.setPilotSkill(fromUnit.pilotSkill());
        const abilities = fromUnit.pilotAbilities();
        if (abilities && abilities.length > 0) {
            toUnit.setPilotAbilities([...abilities]);
        }
    }

    protected override deserializeForceUnit(data: ASSerializedUnit): ASForceUnit {
        return ASForceUnit.deserialize(data, this, this.dataService, this.unitInitializer, this.injector);
    }

    protected override sanitizeForceData(data: SerializedForce): SerializedForce {
        return Sanitizer.sanitize(data, AS_SERIALIZED_FORCE_SCHEMA);
    }

    /** Deserialize a plain object to an ASForce instance */
    public static override deserialize(
        data: ASSerializedForce,
        dataService: DataService,
        unitInitializer: UnitInitializerService,
        injector: Injector
    ): ASForce {
        const force = new ASForce(data.name ?? 'Unnamed Force', dataService, unitInitializer, injector);
        force.populateFromSerialized(data);
        return force;
    }

    protected override deserializeFrom(serialized: SerializedForce): ASForce {
        return ASForce.deserialize(
            serialized as ASSerializedForce,
            this.dataService, this.unitInitializer, this.injector
        );
    }
}
