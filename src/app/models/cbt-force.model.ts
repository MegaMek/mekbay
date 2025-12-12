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
import { CBTSerializedUnit, C3_NETWORK_GROUP_SCHEMA, CBTSerializedForce } from './force-serialization';
import { GameSystem } from './common.model';
import { Force, UnitGroup } from './force.model';
import { Sanitizer } from '../utils/sanitizer.util';
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
        data: CBTSerializedForce,
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
            if (data.c3Networks) {
                force.c3Networks.set(Sanitizer.sanitizeArray(data.c3Networks, C3_NETWORK_GROUP_SCHEMA));
            }
            force.refreshUnits();
        } finally {
            force.loading = false;
        }
        return force;
    }

    
    /**
     * Updates the force in-place from serialized data.
     */
    public override update(data: CBTSerializedForce) {
        this.loading = true;
        try {
            if (this.name !== data.name) this.setName(data.name, false);
            this.nameLock = data.nameLock || false;
            this.timestamp = data.timestamp ?? null;

            const incomingGroupsData = data.groups || [];
            const currentGroups = this.groups();
            const currentGroupMap = new Map(currentGroups.map(g => [g.id, g]));
            const allCurrentUnitsMap = new Map(this.units().map(u => [u.id, u]));
            const allIncomingUnitIds = new Set(incomingGroupsData.flatMap(g => g.units.map(u => u.id)));

            // Destroy units that are no longer in the force at all
            for (const [unitId, unit] of allCurrentUnitsMap.entries()) {
                if (!allIncomingUnitIds.has(unitId)) {
                    unit.destroy();
                    allCurrentUnitsMap.delete(unitId);
                }
            }

            // Update existing groups and add new ones, and update/move units
            const updatedGroups: UnitGroup<CBTForceUnit>[] = incomingGroupsData.map(groupData => {
                let group = currentGroupMap.get(groupData.id);
                if (group) {
                    // Update existing group
                    if (group.name() !== groupData.name) group.setName(groupData.name, false);
                    group.nameLock = groupData.nameLock;
                    group.color = groupData.color;
                } else {
                    // Add new group
                    group = new UnitGroup<CBTForceUnit>(this, groupData.name);
                    group.id = groupData.id;
                    group.nameLock = groupData.nameLock;
                    group.color = groupData.color;
                }

                const groupUnits = groupData.units.map(unitData => {
                    let unit = allCurrentUnitsMap.get(unitData.id);
                    if (unit) {
                        // Unit exists, update it
                        unit.update(unitData);
                    } else {
                        // Unit is new to the force, create it
                        unit = this.deserializeForceUnit(unitData);
                    }
                    return unit;
                });
                group.units.set(groupUnits);
                return group;
            });

            this.groups.set(updatedGroups);
            this.removeEmptyGroups();
            this.refreshUnits();
            
            // Update C3 networks with sanitization
            if (data.c3Networks) {
                this.c3Networks.set(Sanitizer.sanitizeArray(data.c3Networks, C3_NETWORK_GROUP_SCHEMA));
            } else {
                this.c3Networks.set([]);
            }
        } finally {
            this.loading = false;
        }
    }
}
