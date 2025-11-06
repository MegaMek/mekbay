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

import { signal, computed, WritableSignal, EventEmitter, Injector } from '@angular/core';
import { DataService } from '../services/data.service';
import { Unit } from "./units.model";
import { UnitInitializerService } from '../components/svg-viewer/unit-initializer.service';
import { generateUUID } from '../services/ws.service';
import { LoggerService } from '../services/logger.service';
import { SerializedForce, SerializedGroup } from './force-serialization';
import { ForceUnit } from './force-unit.model';

/*
 * Author: Drake
 */
const DEFAULT_GROUP_NAME = 'Main';
const MAX_GROUPS = 12;
const MAX_UNITS = 50;

export class UnitGroup {
    force: Force;
    id: string = generateUUID();
    name = signal<string>('Group');
    nameLock?: boolean; // If true, the group name cannot be changed by the random generator
    color?: string;
    units: WritableSignal<ForceUnit[]> = signal([]);

    totalBV = computed(() => {
        return this.units().reduce((sum, unit) => sum + (unit.getBv()), 0);
    });

    constructor(force: Force, name?: string) {
        this.force = force;
        this.id = generateUUID();
        if (name !== undefined) {
            this.name.set(name);
        }
    }

    setName(name: string, emitChange: boolean = true) {
        if (name === this.name()) return; // No change
        this.name.set(name);
        if (emitChange) {
            this.force?.emitChanged();
        }
    }

}

export class Force {
    instanceId: WritableSignal<string | null> = signal(null);
    _name: WritableSignal<string>;
    nameLock: boolean = false; // If true, the force name cannot be changed by the random generator
    timestamp: string | null = null;
    groups: WritableSignal<UnitGroup[]> = signal([]);
    loading: boolean = false;
    cloud?: boolean = false; // Indicates if this force is stored in the cloud
    owned = signal<boolean>(true); // Indicates if the user owns this force (false if it's a shared force)
    public changed = new EventEmitter<void>();
    private _debounceTimer: any = null;

    private dataService: DataService;
    private unitInitializer: UnitInitializerService;
    private injector: Injector;

    constructor(name: string,
        dataService: DataService,
        unitInitializer: UnitInitializerService,
        injector: Injector) {
        this._name = signal(name);
        this.dataService = dataService;
        this.unitInitializer = unitInitializer;
        this.injector = injector;
    }

    units = computed<ForceUnit[]>(() => {
        return this.groups().flatMap(g => g.units());
    });

    totalBv = computed(() => {
        return this.units().reduce((sum, unit) => sum + (unit.getBv()), 0);
    });

    get name(): string {
        return this._name();
    }

    public setName(name: string, emitChange: boolean = true) {
        if (name === this._name()) return; // No change
        this._name.set(name);
        if (this.instanceId() || emitChange) {
            this.emitChanged();
        }
    }

    public addUnit(unit: Unit): ForceUnit {
        if (this.units().length >= MAX_UNITS) {
            throw new Error(`Cannot add more than ${MAX_UNITS} units to a single force`);
        }
        const forceUnit = new ForceUnit(unit, this, this.dataService, this.unitInitializer, this.injector);
        if (this.groups().length === 0) {
            this.addGroup(DEFAULT_GROUP_NAME);
        }

        // Pick the last group
        const groups = this.groups();
        const targetGroup = groups[groups.length - 1];

        const units = targetGroup.units();
        targetGroup.units.set([...units, forceUnit]);
        if (this.instanceId()) {
            this.emitChanged();
        }
        return forceUnit;
    }

    public hasMaxGroups = computed<boolean>(() => {
        return this.groups().length >= MAX_GROUPS;
    });

    public addGroup(name: string = 'Group'): UnitGroup {
        if (this.hasMaxGroups()) {
            throw new Error(`Cannot add more than ${MAX_GROUPS} groups`);
        }
        const newGroup = new UnitGroup(this, name);
        this.groups.update(gs => [...gs, newGroup]);
        if (this.instanceId()) this.emitChanged();
        return newGroup;
    }

    public removeGroup(group: UnitGroup) {
        const groups = [...this.groups()];
        const idx = groups.findIndex(g => g.id === group.id);
        if (idx === -1) return;
        const removed = groups.splice(idx, 1)[0];
        // Move removed units into previous group or create default
        if (groups.length === 0) {
            const defaultGroup = this.addGroup(DEFAULT_GROUP_NAME);
            defaultGroup.units.set(removed.units());
        } else {
            const targetIdx = Math.max(0, idx - 1);
            const group = groups[targetIdx];
            group.units.set([...group.units(), ...removed.units()]);
        }
        this.groups.set(groups);
        if (this.instanceId()) this.emitChanged();
    }

    public removeUnit(unitToRemove: ForceUnit) {
        const groups = this.groups();
        for (const g of groups) {
            const originalCount = g.units().length;
            const filtered = g.units().filter(u => u.id !== unitToRemove.id);
            if (filtered.length !== originalCount) {
                g.units.set(filtered);
            }
        }
        unitToRemove.destroy();
        this.removeEmptyGroups();
        this.refreshUnits();
        if (this.instanceId()) {
            this.emitChanged();
        }
    }

    public removeEmptyGroups() {
        const groups = this.groups();
        const nonEmptyGroups = groups.filter(g => g.units().length > 0);
        if (nonEmptyGroups.length === groups.length) return; // No change
        this.groups.set(nonEmptyGroups);
        if (this.instanceId()) {
            this.emitChanged();
        }
    }

    public setUnits(newUnits: ForceUnit[]) {
        this.groups.set([]);
        const defaultGroup = this.addGroup(DEFAULT_GROUP_NAME);
        defaultGroup.units.set(newUnits);
        if (this.instanceId()) {
            this.emitChanged();
        }
    }

    public refreshUnits() {
        this.units().forEach(unit => {
            unit.recalculateBv();
        });
    }

    public loadAll() {
        this.units().forEach(unit => unit.load());
    }

    /** Serialize this Force instance to a plain object */
    public serialize(): SerializedForce {
        let instanceId = this.instanceId();
        if (!instanceId) {
            instanceId = generateUUID();
            this.instanceId.set(instanceId);
        }
        // Serialize groups (preserve per-group structure)
        const serializedGroups: SerializedGroup[] = this.groups().filter(g => g.units().length > 0).map(g => ({
            id: g.id,
            name: g.name(),
            nameLock: g.nameLock,
            color: g.color,
            units: g.units().map(u => u.serialize())
        })) as SerializedGroup[];
        return {
            version: 1,
            timestamp: new Date().toISOString(),
            instanceId: instanceId,
            name: this.name,
            bv: this.totalBv(),
            nameLock: this.nameLock || false,
            groups: serializedGroups,
            // units: this.units().map(unit => unit.serialize()) // Deprecated: use groups instead
        } as SerializedForce & { groups?: any[] };
    }

    /** Deserialize a plain object to a Force instance */
    public static deserialize(data: SerializedForce, dataService: DataService, unitInitializer: UnitInitializerService, injector: Injector): Force {
        const force = new Force(data.name, dataService, unitInitializer, injector);
        force.loading = true;
        try {
            force.instanceId.set(data.instanceId);
            force.nameLock = data.nameLock || false;
            force.owned.set(data.owned !== false);
            const units: ForceUnit[] = [];
            // If the serialized payload has groups support, use it (backwards compatibility)
            if (data.groups && Array.isArray(data.groups)) {
                const groupsIn = data.groups;
                const parsedGroups: UnitGroup[] = [];
                for (const g of groupsIn) {
                    const groupUnits: ForceUnit[] = [];
                    for (const unitData of g.units) {
                        try {
                            groupUnits.push(ForceUnit.deserialize(unitData, force, dataService, unitInitializer, injector));
                        } catch (err) {
                            const logger = injector.get(LoggerService);
                            logger.error(`Force.deserialize error on unit "${unitData.unit}": ${err}`);
                            continue;
                        }
                    }
                    const group = new UnitGroup(force, g.name || DEFAULT_GROUP_NAME);
                    if (g.id) {
                        group.id = g.id;
                    }
                    group.nameLock = g.nameLock || false;
                    group.color = g.color || '';
                    group.units.set(groupUnits);
                    parsedGroups.push(group);
                }
                force.groups.set(parsedGroups);
            } else if (data.units) {
                for (const unitData of data.units) {
                    try {
                        units.push(ForceUnit.deserialize(unitData, force, dataService, unitInitializer, injector));
                    } catch (err) {
                        const logger = injector.get(LoggerService);
                        logger.error(`Force.deserialize error on unit "${unitData.unit}": ${err}`);
                        continue; // Ignore this unit
                    }
                }
                // Put existing units into a default group for compatibility
                const defaultGroup = force.addGroup(DEFAULT_GROUP_NAME);
                if (force.nameLock) {
                    defaultGroup.nameLock = true; // Propagate name lock to default group, fallback behavior
                }
                defaultGroup.units.set(units);
            }
            force.timestamp = data.timestamp ?? null;
            force.refreshUnits();
        } finally {
            force.loading = false;
        }
        return force;
    }

    emitChanged() {
        if (this.loading) return;
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
        }
        this._debounceTimer = setTimeout(() => {
            this.changed.emit();
            this._debounceTimer = null;
        }, 300); // debounce
    }
}
