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
import { ASSerializedUnit, C3_NETWORK_GROUP_SCHEMA, ASSerializedForce, AS_SERIALIZED_FORCE_SCHEMA, ASSerializedGroup } from './force-serialization';
import { GameSystem } from './common.model';
import { Force, UnitGroup } from './force.model';
import { Sanitizer } from '../utils/sanitizer.util';
import { ASForceUnit } from './as-force-unit.model';
import { C3NetworkUtil } from '../utils/c3-network.util';
import { generateUUID } from '../services/ws.service';

/*
 * Author: Drake
 */

const DEFAULT_GROUP_NAME = 'Main';

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
        // Sanitize the input data using the schema
        const sanitizedData = Sanitizer.sanitize(data, AS_SERIALIZED_FORCE_SCHEMA);
        
        if (!sanitizedData.groups || !Array.isArray(sanitizedData.groups)) {
            throw new Error('Invalid serialized ASForce: missing or invalid groups array');
        }
        const force = new ASForce(sanitizedData.name, dataService, unitInitializer, injector);
        force.loading = true;
        try {
            force.instanceId.set(sanitizedData.instanceId);
            force.nameLock = sanitizedData.nameLock || false;
            force.owned.set(sanitizedData.owned !== false);
            // Deserialize groups
            const parsedGroups: UnitGroup<ASForceUnit>[] = [];
            for (const g of sanitizedData.groups) {
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
            force.timestamp = sanitizedData.timestamp ?? null;
            if (sanitizedData.c3Networks) {
                // Build unit map for validation
                const unitMap = new Map<string, Unit>();
                for (const group of parsedGroups) {
                    for (const forceUnit of group.units()) {
                        unitMap.set(forceUnit.id, forceUnit.getUnit());
                    }
                }
                force.setNetwork(C3NetworkUtil.validateAndCleanNetworks(sanitizedData.c3Networks, unitMap));
            }
        } finally {
            force.loading = false;
        }
        return force;
    }

    public override serialize(): ASSerializedForce {
        let instanceId = this.instanceId();
        if (!instanceId) {
            instanceId = generateUUID();
            this.instanceId.set(instanceId);
        }
        const serializedGroups: ASSerializedGroup[] = this.groups().filter(g => g.units().length > 0).map(g => ({
            id: g.id,
            name: g.name(),
            nameLock: g.nameLock,
            color: g.color,
            units: g.units().map(u => u.serialize())
        })) as ASSerializedGroup[];
        return {
            version: 1,
            timestamp: this.timestamp ?? new Date().toISOString(),
            instanceId: instanceId,
            type: GameSystem.ALPHA_STRIKE,
            name: this.name,
            pv: this.totalBv(),
            nameLock: this.nameLock || false,
            groups: serializedGroups,
            c3Networks: this.c3Networks().length > 0 ? this.c3Networks() : undefined,
        } as ASSerializedForce & { groups?: any[] };
    }

    /**
     * Updates the force in-place from serialized data.
     */
    public override update(data: ASSerializedForce) {
        // Sanitize the input data using the schema
        const sanitizedData = Sanitizer.sanitize(data, AS_SERIALIZED_FORCE_SCHEMA);
        
        this.loading = true;
        try {
            if (this.name !== sanitizedData.name) this.setName(sanitizedData.name, false);
            this.nameLock = sanitizedData.nameLock || false;
            this.timestamp = sanitizedData.timestamp ?? null;

            const incomingGroupsData = sanitizedData.groups || [];
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
            const updatedGroups: UnitGroup<ASForceUnit>[] = incomingGroupsData.map(groupData => {
                let group = currentGroupMap.get(groupData.id);
                if (group) {
                    // Update existing group
                    if (group.name() !== groupData.name) group.setName(groupData.name, false);
                    group.nameLock = groupData.nameLock;
                    group.color = groupData.color;
                } else {
                    // Add new group
                    group = new UnitGroup<ASForceUnit>(this, groupData.name);
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
            
            // Update C3 networks with validation
            if (sanitizedData.c3Networks) {
                // Build unit map for validation from current groups
                const unitMap = new Map<string, Unit>();
                for (const group of this.groups()) {
                    for (const forceUnit of group.units()) {
                        unitMap.set(forceUnit.id, forceUnit.getUnit());
                    }
                }
                this.setNetwork(C3NetworkUtil.validateAndCleanNetworks(sanitizedData.c3Networks, unitMap));
            } else {
                this.setNetwork([]);
            }
        } finally {
            this.loading = false;
        }
    }
}
