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
import { LoggerService } from '../services/logger.service';
import { ASSerializedUnit, C3_NETWORK_GROUP_SCHEMA, ASSerializedForce } from './force-serialization';
import { GameSystem } from './common.model';
import { Force, UnitGroup } from './force.model';
import { Sanitizer } from '../utils/sanitizer.util';
import { ASForceUnit } from './as-force-unit.model';

/*
 * Author: Drake
 */

const DEFAULT_GROUP_NAME = 'Main';

export class ASForce extends Force<ASForceUnit> {
    override gameSystem: GameSystem = GameSystem.AS;

    constructor(name: string,
        dataService: DataService,
        unitInitializer: UnitInitializerService,
        injector: Injector) {
        super(name, dataService, unitInitializer, injector);
    }

    protected override createForceUnit(unit: Unit): ASForceUnit {
        return new ASForceUnit(unit, this, this.dataService, this.unitInitializer, this.injector);
    }

    protected override deserializeForceUnit(data: ASSerializedUnit): ASForceUnit {
        return ASForceUnit.deserialize(data, this, this.dataService, this.unitInitializer, this.injector);
    }

    /** Deserialize a plain object to an ASForce instance */
    public static override deserialize(
        data: ASSerializedForce,
        dataService: DataService,
        unitInitializer: UnitInitializerService,
        injector: Injector
    ): ASForce {
        if (!data.groups || !Array.isArray(data.groups)) {
            throw new Error('Invalid serialized ASForce: missing or invalid groups array');
        }
        const force = new ASForce(data.name, dataService, unitInitializer, injector);
        force.loading = true;
        try {
            force.instanceId.set(data.instanceId);
            force.nameLock = data.nameLock || false;
            force.owned.set(data.owned !== false);
            // Deserialize groups
            const parsedGroups: UnitGroup<ASForceUnit>[] = [];
            for (const g of data.groups) {
                const groupUnits: ASForceUnit[] = [];
                for (const unitData of g.units) {
                    try {
                        groupUnits.push(force.deserializeForceUnit(unitData as ASSerializedUnit));
                    } catch (err) {
                        const logger = injector.get(LoggerService);
                        logger.error(`ASForce.deserialize error on unit "${unitData.unit}": ${err}`);
                        continue;
                    }
                }
                const group = new UnitGroup<ASForceUnit>(force, g.name || DEFAULT_GROUP_NAME);
                if (g.id) {
                    group.id = g.id;
                }
                group.nameLock = g.nameLock || false;
                group.color = g.color || '';
                group.units.set(groupUnits);
                parsedGroups.push(group);
            }
            force.groups.set(parsedGroups);
            force.timestamp = data.timestamp ?? null;
            if (data.c3Networks) {
                force.c3Networks.set(Sanitizer.sanitizeArray(data.c3Networks, C3_NETWORK_GROUP_SCHEMA));
            }
            force.refreshUnits();
        } finally {
            force.loading = false;
        }
        return force;
    }

    public override update(data: ASSerializedForce) {
    }
}
