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

import { signal, computed, WritableSignal, Injector } from '@angular/core';
import { Subject } from 'rxjs';
import { DataService } from '../services/data.service';
import { Unit } from "./units.model";
import { UnitInitializerService } from '../services/unit-initializer.service';
import { generateUUID } from '../services/ws.service';
import { SerializedForce, SerializedUnit, SerializedC3NetworkGroup, C3_NETWORK_GROUP_SCHEMA } from './force-serialization';
import { ForceUnit } from './force-unit.model';
import { GameSystem } from './common.model';
import { C3NetworkUtil } from '../utils/c3-network.util';

/*
 * Author: Drake
 */
const DEFAULT_GROUP_NAME = 'Main';
const MAX_GROUPS = 50;
const MAX_UNITS = 100;

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
    gameSystem: GameSystem = GameSystem.CLASSIC;
    instanceId: WritableSignal<string | null> = signal(null);
    _name: WritableSignal<string>;
    nameLock: boolean = false; // If true, the force name cannot be changed by the random generator
    timestamp: string | null = null;
    groups: WritableSignal<UnitGroup<TUnit>[]> = signal([]);
    _c3Networks: WritableSignal<SerializedC3NetworkGroup[]> = signal([]); // C3 network configurations
    loading: boolean = false;
    cloud?: boolean = false; // Indicates if this force is stored in the cloud
    owned = signal<boolean>(true); // Indicates if the user owns this force (false if it's a shared force)
    c3Networks = this._c3Networks.asReadonly(); 
    /** Emits after each debounced mutation — subscribe to react to force changes. */
    public readonly changed = new Subject<void>();
    private _debounceTimer: ReturnType<typeof setTimeout> | null = null;

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

    readOnly = computed<boolean>(() => {
        return !this.owned();
    });

    units = computed<TUnit[]>(() => {
        return this.groups().flatMap(g => g.units());
    });

    /** Total BV (C3 tax is applied at unit level via adjustedBv, not here) */
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

    public addUnit(unit: Unit, targetGroup?: UnitGroup<TUnit>): TUnit {
        if (this.units().length >= MAX_UNITS) {
            throw new Error(`Cannot add more than ${MAX_UNITS} units to a single force`);
        }
        const forceUnit = this.createForceUnit(unit);
        if (this.groups().length === 0) {
            this.addGroup(DEFAULT_GROUP_NAME);
        }

        // Use provided target group or pick the last group
        const groups = this.groups();
        const group = targetGroup && groups.includes(targetGroup) ? targetGroup : groups[groups.length - 1];

        const units = group.units();
        group.units.set([...units, forceUnit]);
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

        // Clean up C3 networks - remove the unit from all networks it participates in
        const currentNetworks = this._c3Networks();
        if (currentNetworks.length > 0 && C3NetworkUtil.isUnitConnected(unitToRemove.id, currentNetworks)) {
            const result = C3NetworkUtil.removeUnitFromAllNetworks(currentNetworks, unitToRemove.id);
            this._c3Networks.set(result.networks);
        }

        unitToRemove.destroy();
        this.removeEmptyGroups();
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

    public setNetwork(networks: SerializedC3NetworkGroup[]) {
        this._c3Networks.set(networks);
        this.emitChanged();
    }

    public loadAll() {
        this.units().forEach(unit => unit.load());
    }

    /**
     * Replaces a unit in the force with a new one, preserving pilot data and position.
     * This is the core logic for unit replacement - dialogs and notifications should be handled by the caller.
     * 
     * @param originalUnit The ForceUnit to replace
     * @param newUnitData The new Unit data to create the replacement from
     * @returns Object containing the new ForceUnit and the group it was placed in, or null if failed
     */
    public replaceUnit(originalUnit: TUnit, newUnitData: Unit): { newUnit: TUnit; group: UnitGroup<TUnit> } | null {
        // Find the group containing the original unit
        const groups = this.groups();
        let originalGroup: UnitGroup<TUnit> | null = null;
        let originalIndex = -1;

        for (const group of groups) {
            const groupUnits = group.units();
            const idx = groupUnits.findIndex(u => u.id === originalUnit.id);
            if (idx !== -1) {
                originalGroup = group;
                originalIndex = idx;
                break;
            }
        }

        if (!originalGroup || originalIndex === -1) {
            return null; // Unit not found in any group
        }

        // Create the new force unit
        const newForceUnit = this.createForceUnit(newUnitData);

        // Disable saving during transfer to avoid triggering saves prematurely
        newForceUnit.disabledSaving = true;
        try {
            // Transfer pilot data from original to new unit
            this.transferPilotData(originalUnit, newForceUnit);
        } finally {
            newForceUnit.disabledSaving = false;
        }

        // Remove old unit from C3 networks
        const currentNetworks = this._c3Networks();
        if (currentNetworks.length > 0 && C3NetworkUtil.isUnitConnected(originalUnit.id, currentNetworks)) {
            const result = C3NetworkUtil.removeUnitFromAllNetworks(currentNetworks, originalUnit.id);
            this._c3Networks.set(result.networks);
        }

        // Remove old unit from the group (without calling removeUnit which would also clean up empty groups)
        const groupUnits = originalGroup.units();
        const filteredUnits = groupUnits.filter(u => u.id !== originalUnit.id);

        // Insert new unit at the original position
        filteredUnits.splice(originalIndex, 0, newForceUnit);
        originalGroup.units.set(filteredUnits);

        // Destroy the old unit
        originalUnit.destroy();

        // Emit changed event
        if (this.instanceId()) {
            this.emitChanged();
        }

        return { newUnit: newForceUnit, group: originalGroup };
    }

    /**
     * Transfers pilot data (name, skills, abilities) from one unit to another.
     * Must be implemented by subclasses to handle game-system-specific pilot data.
     */
    protected abstract transferPilotData(fromUnit: TUnit, toUnit: TUnit): void;

    /** Serialize this Force instance to a plain object */
    public serialize(): SerializedForce {
        throw new Error('Force.serialize must be implemented by subclass');
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
            this.changed.next();
            this._debounceTimer = null;
        }, 300); // debounce
    }

    /**
     * Cancels any pending debounced save.
     * Call this before deleting a force to prevent stale saves.
     */
    public cancelPendingChanges() {
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
            this._debounceTimer = null;
        }
    }

    public abstract update(data: SerializedForce): void;

}
