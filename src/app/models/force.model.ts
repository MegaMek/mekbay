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
import { SerializedForce, SerializedUnit, SerializedGroup, SerializedC3NetworkGroup, C3_NETWORK_GROUP_SCHEMA } from './force-serialization';
import { ForceUnit } from './force-unit.model';
import { GameSystem } from './common.model';
import { C3NetworkUtil } from '../utils/c3-network.util';
import { Sanitizer } from '../utils/sanitizer.util';
import { LoggerService } from '../services/logger.service';

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

    /**
     * Ensures no duplicate group or unit IDs exist within this force.
     * If duplicates are found, regenerates them with fresh UUIDs.
     */
    public deduplicateIds(): void {
        const seenGroupIds = new Set<string>();
        const seenUnitIds = new Set<string>();
        for (const group of this.groups()) {
            if (seenGroupIds.has(group.id)) {
                group.id = generateUUID();
            }
            seenGroupIds.add(group.id);
            for (const unit of group.units()) {
                if (seenUnitIds.has(unit.id)) {
                    unit.id = generateUUID();
                }
                seenUnitIds.add(unit.id);
            }
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
        let instanceId = this.instanceId();
        if (!instanceId) {
            instanceId = generateUUID();
            this.instanceId.set(instanceId);
        }
        const serializedGroups: SerializedGroup[] = this.groups().filter(g => g.units().length > 0).map(g => ({
            id: g.id,
            name: g.name(),
            nameLock: g.nameLock,
            color: g.color,
            units: g.units().map(u => u.serialize())
        }));
        const result: SerializedForce = {
            version: 1,
            timestamp: this.timestamp ?? new Date().toISOString(),
            instanceId: instanceId,
            type: this.gameSystem,
            name: this.name,
            nameLock: this.nameLock || false,
            groups: serializedGroups,
            c3Networks: this.c3Networks().length > 0 ? this.c3Networks() : undefined,
        };
        if (this.gameSystem === GameSystem.ALPHA_STRIKE) {
            result.pv = this.totalBv();
        } else {
            result.bv = this.totalBv();
        }
        return result;
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
     * Flushes any pending debounced save, executing it immediately.
     * Call this before tearing down a force slot so the save fires
     * while the subscription is still active.
     */
    public flushPendingChanges() {
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
            this._debounceTimer = null;
            this.timestamp = new Date().toISOString();
            this.changed.next();
        }
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

    /**
     * Sanitize incoming serialized data using a schema.
     * Must be implemented by subclasses to apply the appropriate schema.
     */
    protected abstract sanitizeForceData(data: SerializedForce): SerializedForce;

    /**
     * Populates this force instance from serialized data.
     * Called by subclass static deserialize() methods after creating the instance.
     */
    protected populateFromSerialized(data: SerializedForce): void {
        const sanitizedData = this.sanitizeForceData(data);
        if (!sanitizedData.groups || !Array.isArray(sanitizedData.groups)) {
            throw new Error('Invalid serialized Force: missing or invalid groups array');
        }
        this.loading = true;
        try {
            this.instanceId.set(sanitizedData.instanceId);
            this.nameLock = sanitizedData.nameLock || false;
            this.owned.set(sanitizedData.owned !== false);

            const logger = this.injector.get(LoggerService);
            const parsedGroups: UnitGroup<TUnit>[] = [];
            for (const g of sanitizedData.groups) {
                const groupUnits: TUnit[] = [];
                for (const unitData of g.units) {
                    try {
                        groupUnits.push(this.deserializeForceUnit(unitData));
                    } catch (err) {
                        logger.error(`Force.deserialize error on unit "${unitData.unit}": ${err}`);
                        continue;
                    }
                }
                const group = new UnitGroup<TUnit>(this, g.name || DEFAULT_GROUP_NAME);
                if (g.id) {
                    group.id = g.id;
                }
                group.nameLock = g.nameLock || false;
                group.color = g.color || '';
                group.units.set(groupUnits);
                parsedGroups.push(group);
            }
            this.groups.set(parsedGroups);
            this.timestamp = sanitizedData.timestamp ?? null;
            if (sanitizedData.c3Networks) {
                const sanitizedNetworks = Sanitizer.sanitizeArray(sanitizedData.c3Networks, C3_NETWORK_GROUP_SCHEMA);
                const unitMap = new Map<string, Unit>();
                for (const group of parsedGroups) {
                    for (const forceUnit of group.units()) {
                        unitMap.set(forceUnit.id, forceUnit.getUnit());
                    }
                }
                this.setNetwork(C3NetworkUtil.validateAndCleanNetworks(sanitizedNetworks, unitMap));
            }
        } finally {
            this.loading = false;
        }
    }

    /** Updates the force in-place from serialized data. */
    public update(data: SerializedForce): void {
        const sanitizedData = this.sanitizeForceData(data);
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

            // Update C3 networks with sanitization and validation
            if (sanitizedData.c3Networks) {
                const sanitizedNetworks = Sanitizer.sanitizeArray(sanitizedData.c3Networks, C3_NETWORK_GROUP_SCHEMA);
                const unitMap = new Map<string, Unit>();
                for (const group of this.groups()) {
                    for (const forceUnit of group.units()) {
                        unitMap.set(forceUnit.id, forceUnit.getUnit());
                    }
                }
                this.setNetwork(C3NetworkUtil.validateAndCleanNetworks(sanitizedNetworks, unitMap));
            } else {
                this.setNetwork([]);
            }
        } finally {
            this.loading = false;
        }
    }

    /**
     * Subclass factory: deserialize a SerializedForce into a new Force instance
     * using this instance's injected services.
     */
    protected abstract deserializeFrom(serialized: SerializedForce): Force;

    /**
     * Clone this force (uses serialize + deserialize)
     * Returns a brand-new owned Force with fresh instanceId, group ids,
     * unit ids, and remapped C3 network references.
     */
    public clone(): Force {
        const serialized = this.serialize();

        // Build old→new unit ID map
        const unitIdMap = new Map<string, string>();
        serialized.instanceId = generateUUID();
        if (serialized.groups) {
            for (const group of serialized.groups) {
                group.id = generateUUID();
                for (const unit of group.units) {
                    const newId = generateUUID();
                    unitIdMap.set(unit.id, newId);
                    unit.id = newId;
                }
            }
        }

        // Remap C3 network references
        if (serialized.c3Networks) {
            const remapId = (id: string): string => {
                const parts = id.split(':');
                const mapped = unitIdMap.get(parts[0]);
                if (mapped) {
                    parts[0] = mapped;
                    return parts.join(':');
                }
                return id;
            };
            for (const network of serialized.c3Networks) {
                network.id = generateUUID();
                if (network.peerIds) {
                    network.peerIds = network.peerIds.map(remapId);
                }
                if (network.masterId) {
                    network.masterId = remapId(network.masterId);
                }
                if (network.members) {
                    network.members = network.members.map(remapId);
                }
            }
        }

        serialized.timestamp = new Date().toISOString();
        serialized.owned = true;

        return this.deserializeFrom(serialized);
    }

}
