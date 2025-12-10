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
import { UnitInitializerService } from '../services/unit-initializer.service';
import { generateUUID } from '../services/ws.service';
import { LoggerService } from '../services/logger.service';
import { SerializedForce, SerializedGroup, SerializedUnit, SerializedC3NetworkGroup } from './force-serialization';
import { ForceUnit } from './force-unit.model';
import { GameSystem } from './common.model';
import { C3NetworkUtil } from '../utils/c3-network.util';

/*
 * Author: Drake
 */
const DEFAULT_GROUP_NAME = 'Main';
const MAX_GROUPS = 12;
const MAX_UNITS = 50;

export class UnitGroup<TUnit extends ForceUnit = ForceUnit> {
    force: Force;
    id: string = generateUUID();
    name = signal<string>('Group');
    nameLock?: boolean; // If true, the group name cannot be changed by the random generator
    color?: string;
    units: WritableSignal<TUnit[]> = signal([]);

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

export abstract class Force<TUnit extends ForceUnit = ForceUnit> {
    gameSystem: GameSystem = GameSystem.CBT;
    instanceId: WritableSignal<string | null> = signal(null);
    _name: WritableSignal<string>;
    nameLock: boolean = false; // If true, the force name cannot be changed by the random generator
    timestamp: string | null = null;
    groups: WritableSignal<UnitGroup<TUnit>[]> = signal([]);
    c3Networks: WritableSignal<SerializedC3NetworkGroup[]> = signal([]); // C3 network configurations
    loading: boolean = false;
    cloud?: boolean = false; // Indicates if this force is stored in the cloud
    owned = signal<boolean>(true); // Indicates if the user owns this force (false if it's a shared force)
    public changed = new EventEmitter<void>();
    private _debounceTimer: any = null;

    protected dataService: DataService;
    protected unitInitializer: UnitInitializerService;
    protected injector: Injector;

    constructor(name: string,
        dataService: DataService,
        unitInitializer: UnitInitializerService,
        injector: Injector) {
        this._name = signal(name);
        this.dataService = dataService;
        this.unitInitializer = unitInitializer;
        this.injector = injector;
    }

    units = computed<TUnit[]>(() => {
        return this.groups().flatMap(g => g.units());
    });

    /** Total BV of units without C3 tax */
    baseBv = computed(() => {
        return this.units().reduce((sum, unit) => sum + (unit.getBv()), 0);
    });

    /** C3 network tax based on configured networks */
    c3Tax = computed(() => {
        return C3NetworkUtil.calculateForceC3Tax(this.units(), this.c3Networks());
    });

    /** Total BV including C3 tax */
    totalBv = computed(() => {
        return this.baseBv() + this.c3Tax();
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

    /**
     * Factory method to create the appropriate ForceUnit subclass.
     * Must be implemented by subclasses to create CBTForceUnit, ASForceUnit, etc.
     */
    protected abstract createForceUnit(unit: Unit): TUnit;

    /**
     * Factory method to deserialize the appropriate ForceUnit subclass.
     * Must be implemented by subclasses to deserialize CBTForceUnit, ASForceUnit, etc.
     */
    protected abstract deserializeForceUnit(data: SerializedUnit): TUnit;

    public addUnit(unit: Unit): TUnit {
        if (this.units().length >= MAX_UNITS) {
            throw new Error(`Cannot add more than ${MAX_UNITS} units to a single force`);
        }
        const forceUnit = this.createForceUnit(unit);
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

    public addGroup(name: string = 'Group'): UnitGroup<TUnit> {
        if (this.hasMaxGroups()) {
            throw new Error(`Cannot add more than ${MAX_GROUPS} groups`);
        }
        const newGroup = new UnitGroup<TUnit>(this, name);
        this.groups.update(groups => [...groups, newGroup]);
        if (this.instanceId()) this.emitChanged();
        return newGroup;
    }

    public removeGroup(group: UnitGroup<TUnit>) {
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

    public removeUnit(unitToRemove: TUnit) {
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

    public setUnits(newUnits: TUnit[]) {
        this.groups.set([]);
        const defaultGroup = this.addGroup(DEFAULT_GROUP_NAME);
        defaultGroup.units.set(newUnits);
        if (this.instanceId()) {
            this.emitChanged();
        }
    }

    public refreshUnits() {
        this.units().forEach(unit => {
            if ('recalculateBv' in unit && typeof (unit as any).recalculateBv === 'function') {
                (unit as any).recalculateBv();
            }
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
            timestamp: this.timestamp ?? new Date().toISOString(),
            instanceId: instanceId,
            name: this.name,
            bv: this.totalBv(),
            nameLock: this.nameLock || false,
            groups: serializedGroups,
            c3Networks: this.c3Networks().length > 0 ? this.c3Networks() : undefined,
        } as SerializedForce & { groups?: any[] };
    }

    /** Deserialize a plain object to a Force instance - must be implemented by subclass */
    public static deserialize(data: SerializedForce, dataService: DataService, unitInitializer: UnitInitializerService, injector: Injector): Force<ForceUnit> {
        throw new Error('Force.deserialize must be implemented by subclass');
    }

    emitChanged() {
        if (this.loading) return;
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
        }
        this._debounceTimer = setTimeout(() => {
            this.timestamp = new Date().toISOString();
            this.changed.emit();
            this._debounceTimer = null;
        }, 300); // debounce
    }

    /**
     * Updates the force in-place from serialized data.
     */
    public update(data: SerializedForce) {
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
            const updatedGroups: UnitGroup<TUnit>[] = incomingGroupsData.map(groupData => {
                let group = currentGroupMap.get(groupData.id);
                if (group) {
                    // Update existing group
                    if (group.name() !== groupData.name) group.setName(groupData.name, false);
                    group.nameLock = groupData.nameLock;
                    group.color = groupData.color;
                } else {
                    // Add new group
                    group = new UnitGroup<TUnit>(this, groupData.name);
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
            
            // Update C3 networks
            this.c3Networks.set(data.c3Networks || []);
        } finally {
            this.loading = false;
        }
    }
}
