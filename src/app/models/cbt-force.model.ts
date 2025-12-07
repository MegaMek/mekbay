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
import { UnitInitializerService } from '../components/svg-viewer/unit-initializer.service';
import { LoggerService } from '../services/logger.service';
import { CBTSerializedUnit, SerializedForce, SerializedUnit } from './force-serialization';
import { GameSystem } from './common.model';
import { Force, UnitGroup } from './force.model';
import { CBTForceUnit } from './cbt-force-unit.model';

/*
 * Author: Drake
 */

const DEFAULT_GROUP_NAME = 'Main';

export class CBTForce extends Force<CBTForceUnit> {
    override gameSystem: GameSystem = GameSystem.CBT;

    constructor(name: string,
        dataService: DataService,
        unitInitializer: UnitInitializerService,
        injector: Injector) {
        super(name, dataService, unitInitializer, injector);
    }

    protected override createForceUnit(unit: Unit): CBTForceUnit {
        return new CBTForceUnit(unit, this, this.dataService, this.unitInitializer, this.injector);
    }

    protected override deserializeForceUnit(data: CBTSerializedUnit): CBTForceUnit {
        return CBTForceUnit.deserialize(data, this, this.dataService, this.unitInitializer, this.injector);
    }

    public static override deserialize(
        data: SerializedForce,
        dataService: DataService,
        unitInitializer: UnitInitializerService,
        injector: Injector
    ): CBTForce {
        if (!data.groups || !Array.isArray(data.groups)) {
            throw new Error('Invalid CBTForce data: missing or invalid groups array');
        }
        const force = new CBTForce(data.name, dataService, unitInitializer, injector);
        force.loading = true;
        try {
            force.instanceId.set(data.instanceId);
            force.nameLock = data.nameLock || false;
            force.owned.set(data.owned !== false);
            // Deserialize groups
            const parsedGroups: UnitGroup<CBTForceUnit>[] = [];
            for (const g of data.groups) {
                const groupUnits: CBTForceUnit[] = [];
                for (const unitData of g.units) {
                    try {
                        groupUnits.push(force.deserializeForceUnit(unitData as CBTSerializedUnit));
                    } catch (err) {
                        const logger = injector.get(LoggerService);
                        logger.error(`CBTForce.deserialize error on unit "${unitData.unit}": ${err}`);
                        continue;
                    }
                }
                const group = new UnitGroup<CBTForceUnit>(force, g.name || DEFAULT_GROUP_NAME);
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
            force.refreshUnits();
        } finally {
            force.loading = false;
        }
        return force;
    }
}
