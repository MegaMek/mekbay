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
import { BVCalculatorUtil } from "../utils/bv-calculator.util";
import { DataService } from '../services/data.service';
import { Unit } from "./units.model";
import { Equipment } from './equipment.model';
import { UnitSvgService } from '../services/unit-svg.service';
import { UnitSvgMekService } from '../services/unit-svg-mek.service';
import { UnitSvgInfantryService } from '../services/unit-svg-infantry.service';
import { UnitInitializerService } from '../components/svg-viewer/unit-initializer.service';
import { C3NetworkUtil } from '../utils/c3-network.util';
import { generateUUID } from '../services/ws.service';
import { LoggerService } from '../services/logger.service';
import { getMotiveModesByUnit, getMotiveModesOptionsByUnit, MotiveModeOption, MotiveModes } from './motiveModes.model';
/*
 * Author: Drake
 */

const DEFAULT_GROUP_NAME = 'Main';
const MAX_GROUPS = 12;
const MAX_UNITS = 50;

export interface SerializedForce {
    version: number;
    timestamp: string;
    instanceId: string;
    type?: 'cbt' | 'as';
    name: string;
    nameLock?: boolean;
    bv: number;
    owned?: boolean;
    groups?: SerializedGroup[];
    units?: SerializedUnit[]; // Deprecated, use groups instead
}

export interface SerializedGroup {
    id: string;
    name: string;
    nameLock?: boolean;
    color?: string;
    units: SerializedUnit[];
}

export interface SerializedUnit {
    id: string;
    unit: string; // Unit name
    model?: string;
    chassis?: string;
    alias?: string;
    state: SerializedState; // Serialized ForceUnitState object
}

export interface SerializedState {
    modified: boolean;
    destroyed: boolean;
    shutdown: boolean;
    c3Linked: boolean;
    crew: any[]; // Serialized CrewMember objects
    crits: CriticalSlot[];
    locations: Record<string, LocationData>;
    heat: { current: number, previous: number, heatsinksOff?: number };
    inventory?: MountedEquipment[];
}

export interface CriticalSlot {
    uid?: string; // Unique identifier for the critical slot on the sheet (this value changes at each SVG update)
    name?: string; // Name, if loc/slot are null, this is the name of the critical point (example: engine)
    loc?: string; // Location of the critical slot (HD, LT, RT, ...)
    slot?: number; // Slot number of the critical slot
    hits?: number; // How many hits did this location receive. If is an armored location, this is the number of hits it has taken
    totalAmmo?: number; // If is an ammo slot: how much total ammo is in this slot.
    consumed?: number; // If is an ammo slot: how much ammo have been consumed. If is a F_MODULAR_ARMOR, is the armor points used
    destroyed?: boolean; // If this location is destroyed (can be from 0 hits if the structure is completely destroyed)
    originalName?: string; // saved original name in case we override the current name
    armored?: boolean; // If this critical slot is armored (for locations that can be armored)
    el?: SVGElement;
    eq?: Equipment;
}
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

export interface MountedEquipment {
    owner: ForceUnit;
    id: string;
    name: string;
    locations: Set<string>;
    equipment: null | Equipment;
    baseHitMod: string;
    hitModVariation?: null | number; // Temporary variable to calculate delta hit modifier
    physical: boolean;
    linkedWith: null | MountedEquipment[];
    parent: null | MountedEquipment;
    destroyed: boolean;
    critSlots: CriticalSlot[];
    el: SVGElement;
    // only for Bays
    totalAmmo?: number;
    consumed?: number;
}

export interface IViewState {
    scale: number;
    translateX: number;
    translateY: number;
}

export class ForceUnit {
    private unit: Unit; // Original unit data
    force: Force;
    id: string;
    svg: WritableSignal<SVGSVGElement | null> = signal(null); // SVG representation of the unit
    private svgService: UnitSvgService | null = null;
    private loadingPromise: Promise<void> | null = null;
    viewState: IViewState;
    initialized = false;
    locations?: {
        armor: Map<string, { loc: string; rear: boolean; points?: number }>;
        internal: Map<string, { loc: string; points?: number }>;
    };
    private state: ForceUnitState = new ForceUnitState( this );

    // Dependencies for deferred loading
    private dataService: DataService;
    private unitInitializer: UnitInitializerService;
    private injector: Injector;
    private isLoaded: boolean = false;
    public disabledSaving: boolean = false;

    readOnly = computed(() => this.force.owned() === false);
    alias = computed<string | undefined>(() => {
        const pilot = this.getCrewMember(0);
        return pilot?.getName() ?? undefined;
    });

    constructor(unit: Unit,
        force: Force,
        dataService: DataService,
        unitInitializer: UnitInitializerService,
        injector: Injector
    ) {
        this.id = generateUUID();
        this.force = force;
        this.unit = structuredClone(unit);
        this.viewState = {
            scale: 0,
            translateX: 0,
            translateY: 0
        };

        this.dataService = dataService;
        this.unitInitializer = unitInitializer;
        this.injector = injector;

        const crew: CrewMember[] = [];
        for (let i = 0; i < this.unit.crewSize; i++) {
            crew[i] = new CrewMember(i, this);
        }
        this.state.crew.set(crew);
    }
    public async load() {
        if (this.isLoaded) return;
        if (this.loadingPromise) {
            return this.loadingPromise;
        }
        this.loadingPromise = this.performLoad();
        try {
            await this.loadingPromise;
            this.isLoaded = true;
        } finally {
            // Clear the loading promise when done (success or failure)
            this.loadingPromise = null;
        }
    }
    private async performLoad() {
        switch (this.unit.type) {
            case 'Mek':
                this.svgService = new UnitSvgMekService(this, this.dataService, this.unitInitializer, this.injector);
                break;
            case 'Infantry':
                this.svgService = new UnitSvgInfantryService(this, this.dataService, this.unitInitializer, this.injector);
                break;
            default:
                this.svgService = new UnitSvgService(this, this.dataService, this.unitInitializer, this.injector);
        }
        await this.svgService.loadAndInitialize();
    }
    destroy() {
        if (this.svgService) {
            this.svgService.ngOnDestroy();
            this.svgService = null;
        }
        this.svg.set(null);
        this.loadingPromise = null;
    }
    get modified(): boolean {
        return this.state.modified();
    }
    setModified() {
        if (this.disabledSaving) return;
        this.state.modified.set(true);
        this.force.emitChanged();
    }
    get destroyed(): boolean {
        return this.state.destroyed();
    }
    setDestroyed(destroyed: boolean) {
        this.state.destroyed.set(destroyed);
    }
    get shutdown(): boolean {
        return this.state.shutdown();
    }
    setShutdown(shutdown: boolean) {
        this.state.shutdown.set(shutdown);
    }
    get c3Linked(): boolean {
        return this.state.c3Linked();
    }
    setC3Linked(linked: boolean) {
        this.state.c3Linked.set(linked);
        this.setModified();
        this.force.refreshUnits();
    }
    getUnit(): Unit {
        return this.unit;
    }
    turnState: WritableSignal<TurnState> = this.state.turnState;
    getHeat = this.state.heat;
    setHeat(heat: number) {
        const storedHeat = this.state.heat();
        if (heat === storedHeat.current) return; // No change
        const newHeatData: HeatProfile = { current: heat, previous: storedHeat.current };
        if (storedHeat.heatsinksOff !== undefined) {
            newHeatData.heatsinksOff = storedHeat.heatsinksOff;
        }
        this.state.heat.set(newHeatData);
        this.setModified();
    }
    setHeatsinksOff(heatsinksOff: number) {
        const storedHeat = this.state.heat();
        if (heatsinksOff === storedHeat.heatsinksOff) return; // No change
        const newHeatData: HeatProfile = { current: storedHeat.current, previous: storedHeat.previous, heatsinksOff: heatsinksOff };
        this.state.heat.set(newHeatData);
        this.setModified();
    }
    getCritSlots = this.state.crits;
    setCritSlots(critSlots: CriticalSlot[], initialization: boolean = false) {
        this.state.crits.set(critSlots);
        if (!initialization) {
            this.setModified();
        }
    }
    getCritSlotsAsMatrix(): Record<string, CriticalSlot[]> {
        const critSlotMatrix: Record<string, CriticalSlot[]> = {};
        this.getCritSlots().forEach(value => {
            if (!value.loc || value.slot === undefined) return;
            if (critSlotMatrix[value.loc] === undefined) {
                critSlotMatrix[value.loc] = [];
            }
            critSlotMatrix[value.loc][value.slot] = value;
        });
        return critSlotMatrix;
    }
    getCritSlot(loc: string, slot: number): CriticalSlot | null {
        return this.state.crits().find(c => c.loc === loc && c.slot === slot) || null;
    }
    setCritSlot(slot: CriticalSlot) {
        const destroyed = (slot.hits || 0) > (slot.armored ? 1 : 0);
        if (slot.destroyed != destroyed) {
            slot.destroyed = destroyed;
        }
        const crits = [...this.state.crits()];
        const existingIndex = crits.findIndex(c => c.loc === slot.loc && c.slot === slot.slot);
        if (existingIndex !== -1) {
            crits[existingIndex] = slot; // Update existing crit
        } else {
            crits.push(slot); // Add new crit
        }
        this.setCritSlots(crits);
        this.turnState().evaluateCritSlot(slot);
    }
    getCritLoc(name: string): CriticalSlot | null {
        return this.state.crits().find(c => c.name === name) || null;
    }
    setCritLoc(loc: CriticalSlot) {
        const crits = [...this.state.crits()];
        const existingIndex = crits.findIndex(c => c.name === loc.name);
        if (existingIndex !== -1) {
            crits[existingIndex] = loc; // Update existing crit
        } else {
            crits.push(loc); // Add new crit
        }
        this.setCritSlots(crits);
    }
    getInventory = this.state.inventory;
    setInventory(inventory: MountedEquipment[], initialization: boolean = false) {
        this.state.inventory.set(inventory);
        if (!initialization) {
            this.setModified();
        }
    }
    setInventoryEntry(inventoryEntry: MountedEquipment) {
        const inventory = [...this.state.inventory()];
        const existingIndex = inventory.findIndex(item => item.id === inventoryEntry.id);
        if (existingIndex !== -1) {
            inventory[existingIndex] = inventoryEntry;
        } else {
            inventory.push(inventoryEntry);
        }
        this.setInventory(inventory);
    }
    getLocations = this.state.locations;
    setLocations(locations: Record<string, LocationData>, initialization: boolean = false) {
        this.state.locations.set(locations);
        if (!initialization) {
            this.setModified();
        }
    }

    getArmorPoints(loc: string, rear?: boolean): number {
        const locKey = rear ? `${loc}-rear` : loc;
        return this.locations?.armor.get(locKey)?.points || 0;
    }

    getArmorHits(loc: string, rear?: boolean): number {
        const locKey = rear ? `${loc}-rear` : loc;
        return this.state.locations()[locKey]?.armor || 0;
    }

    addArmorHits(loc: string, hits: number, rear?: boolean) {
        const locKey = rear ? `${loc}-rear` : loc;
        const locations = { ...this.state.locations() };

        if (locations[locKey] === undefined) {
            locations[locKey] = {};
        }
        if (typeof locations[locKey].armor !== 'number') {
            locations[locKey].armor = 0;
        }
        locations[locKey].armor += hits;
        this.state.locations.set({ ...this.state.locations(), [locKey]: locations[locKey] });
        let hitsForPsr = hits;
        if (this.getUnit().armorType === 'Hardened') {
            hitsForPsr = Math.ceil(hitsForPsr / 2);
        }
        this.state.turnState().addDmgReceived(hitsForPsr);
        this.setModified();
    }

    setArmorHits(loc: string, hits: number, rear?: boolean) {
        const locKey = rear ? `${loc}-rear` : loc;
        const locations = { ...this.state.locations() };
        if (locations[locKey] === undefined) {
            locations[locKey] = {};
        }
        locations[locKey].armor = hits;
        this.state.locations.set({ ...this.state.locations(), [locKey]: locations[locKey] });
        this.setModified();
    }

    getInternalPoints(loc: string): number {
        return this.locations?.internal.get(loc)?.points || 0;
    }

    getInternalHits(loc: string): number {
        return this.state.locations()[loc]?.internal || 0;
    }

    addInternalHits(loc: string, hits: number) {
        const locations = { ...this.state.locations() };
        if (locations[loc] === undefined) {
            locations[loc] = {};
        }
        if (typeof locations[loc].internal !== 'number') {
            locations[loc].internal = 0;
        }
        locations[loc].internal += hits;
        this.state.locations.set({ ...this.state.locations(), [loc]: locations[loc] });
        this.state.turnState().addDmgReceived(hits);
        this.setModified();
    }

    setInternalHits(loc: string, hits: number) {
        const locations = { ...this.state.locations() };
        if (locations[loc] === undefined) {
            locations[loc] = {};
        }
        locations[loc].internal = hits;
        this.state.locations.set({ ...this.state.locations(), [loc]: locations[loc] });
        this.setModified();
    }

    isArmorLocDestroyed(loc: string, rear: boolean = false): boolean {
        const locKey = rear ? `${loc}-rear` : loc;
        if (!this.locations?.armor.has(locKey)) return false;
        const hits = this.getArmorHits(loc, rear);
        return hits >= this.getArmorPoints(loc, rear);
    }

    isInternalLocDestroyed(loc: string): boolean {
        if (!this.locations?.internal.has(loc)) return false;
        const hits = this.getInternalHits(loc);
        return hits >= this.getInternalPoints(loc);
    }

    getBv = computed<number>(() => {
        const adjustedBv = this.state.adjustedBv();
        if (adjustedBv !== null) {
            return adjustedBv;
        }
        return this.unit.bv;
    })

    getCrewMembers = this.state.crew;

    public getPilotStats = computed<string>(() => {
        const crew = this.state.crew();
        if (crew.length === 0) return 'N/A';
        const pilot = crew[0];
        if (!pilot) return 'N/A';
        return `${pilot.getSkill('gunnery')} / ${pilot.getSkill('piloting')}`;
    });

    getCrewMember(crewId: number): CrewMember {
        return this.state.crew()[crewId];
    }

    setCrewMember(crewId: number, crewMember: CrewMember) {
        this.state.crew.update(crew => {
            const newCrew = [...crew];
            newCrew[crewId] = crewMember;
            return newCrew;
        });
        this.recalculateBv();
        this.setModified();
    }

    recalculateBv() {
        const pilot = this.getCrewMember(0);
        let gunnery = pilot.getSkill('gunnery');
        let piloting = pilot.getSkill('piloting');
        let bv = this.unit.bv;
        if (this.c3Linked) {
            const c3Tax = C3NetworkUtil.calculateC3Tax(this, this.force.groups().flatMap(g => g.units()));
            if (c3Tax > 0) {
                bv += c3Tax;
            }
        }
        if (this.unit.crewSize > 1) {
            gunnery = this.getCrewMember(1).getSkill('gunnery');
        }
        const adjustedBv = BVCalculatorUtil.calculateAdjustedBV(
            bv,
            gunnery,
            piloting
        );
        if (adjustedBv !== this.unit.bv) {
            if (adjustedBv !== this.state.adjustedBv()) {
                this.state.adjustedBv.set(adjustedBv);
            }
        } else {
            this.state.adjustedBv.set(null);
        }
    };

    public repairAll() {
        // Set crew members hits to 0
        const crew = this.state.crew().map(crewMember => {
            if (crewMember.getHits() > 0) {
                crewMember.setHits(0);
            }
            return crewMember;
        });
        this.state.crew.set(crew);
        // Clear all crits
        const crits = this.state.crits().map(crit => {
            if (crit.destroyed) {
                crit.destroyed = false;
            }
            if (crit.hits) {
                crit.hits = 0;
            }
            if (crit.consumed) {
                crit.consumed = 0;
            }
            return { ...crit };
        });
        this.state.crits.set(crits);
        // Clear all damage
        this.state.locations.set({});
        // Clear heat
        this.state.heat.set({ current: 0, previous: 0 });
        // Clear destroyed state
        this.state.destroyed.set(false);
        this.state.shutdown.set(false);
        // Clear inventory destroyed items
        const inventory = this.state.inventory().map(item => {
            if (item.destroyed) {
                item.destroyed = false;
            }
            if (item.consumed) {
                item.consumed = 0;
            }
            return { ...item };
        });
        this.state.inventory.set(inventory);
        this.resetTurnState();
        this.setModified();
    }

    public getAvailableMotiveModes(): MotiveModeOption[] {
        return getMotiveModesOptionsByUnit(this.getUnit(), this.turnState().airborne());
    }

    // TODO: must be reworded, create an history list of modifiers applied so that we can apply the proper sequence for Hip/Foot/Leg
    PSRModifiers = computed<number>(() => {
        let modifier = 0;
        const critSlots = this.getCritSlots();
        const destroyedHips = critSlots.filter(slot => slot.name && slot.name.includes('Hip') && slot.destroyed);
        const hipLocations = new Set<string>();
        for (const hip of destroyedHips) {
            modifier += 2;
            if (hip.loc) {
                hipLocations.add(hip.loc);
            }
        }
        const destroyedFeetCount = critSlots.filter(slot => slot.loc && slot.name  && !hipLocations.has(slot.loc) && slot.name.includes('Foot') && slot.destroyed).length;
        const destroyedLegsActuatorsCount = critSlots.filter(slot => slot.loc && slot.name  && !hipLocations.has(slot.loc) && slot.name.includes('Leg') && slot.destroyed).length;
        const destroyedGyroCount = critSlots.filter(slot => slot.name && slot.name.includes('Gyro') && slot.destroyed).length;

        return modifier + destroyedFeetCount + destroyedLegsActuatorsCount + (destroyedGyroCount * 2);
    });

    public resetTurnState() {
        this.state.resetTurnState();
    }

    public hasDirectInventory(): boolean {
        return (!this.svg()?.querySelector('.critSlot')) && (this.getUnit().type !== 'Infantry') || false;
    }

    public serialize(): SerializedUnit {
        const stateObj: SerializedState = {
            crew: this.state.crew().map(crew => crew.serialize()),
            crits: this.state.crits().map(({ uid, el, eq, ...rest }) => rest), // We remove UID and the SVGElement as they are linked at load time
            heat: this.state.heat(),
            locations: this.state.locations(),
            modified: this.state.modified(),
            destroyed: this.state.destroyed(),
            shutdown: this.state.shutdown(),
            c3Linked: this.state.c3Linked(),
        };
        if (this.hasDirectInventory()) {
            // stateObj.inventory = [];
        }
        const data = {
            id: this.id,
            state: stateObj,
            alias: this.alias(),
            unit: this.getUnit().name // Serialize only the name
        };
        return data;
    }

    /** Deserialize a plain object to a ForceUnit instance */
    public static deserialize(
        data: SerializedUnit,
        force: Force,
        dataService: DataService,
        unitInitializer: UnitInitializerService,
        injector: Injector
    ): ForceUnit {
        const unit = dataService.getUnitByName(data.unit);
        if (!unit) {
            throw new Error(`Unit with name "${data.unit}" not found in dataService`);
        }
        const fu = new ForceUnit(unit, force, dataService, unitInitializer, injector);
        fu.deserializeState(data);
        return fu;
    }

    private deserializeState(data: SerializedUnit) {
        this.id = data.id;
        if (data.state) {
            this.state.crits.set(data.state.crits);
            this.state.locations.set(data.state.locations || {});
            this.state.heat.set(data.state.heat);
            this.state.modified.set(data.state.modified ?? false);
            this.state.destroyed.set(data.state.destroyed ?? false);
            this.state.shutdown.set(data.state.shutdown ?? false);
            this.state.c3Linked.set(data.state.c3Linked ?? false);
            if (data.state.inventory) {
                this.state.inventory.set(data.state.inventory);
            }
            const crewArr = data.state.crew.map((crewData: any) => CrewMember.deserialize(crewData, this));
            this.state.crew.set(crewArr);
            this.recalculateBv();
        }
    }
}

export interface LocationData {
    armor?: number;
    internal?: number;
}

export interface HeatProfile {
    current: number;
    previous: number;
    heatsinksOff?: number;
}

export interface PSRCheck {
    difficulty: number;
    reason: string;
}

interface PSRChecks {
    legsFeetHit?: number;
    hipsHit?: number;
    gyrosHit?: number;
    gyrosDestroyed?: boolean;
    legsDestroyed?: number;
    shutdown?: boolean;
}

export class TurnState {
    unitState: ForceUnitState;
    airborne = signal<boolean>(false);
    moveMode = signal<MotiveModes | null>(null);
    moveDistance = signal<number | null>(null);
    dmgReceived = signal<number>(0);
    psrChecks = signal<PSRChecks>({});

    autoFall = computed<boolean>(() => {
        return (this.psrChecks().legsDestroyed || 0) > 0 
        || this.psrChecks().gyrosDestroyed === true;
    });

    getPSRChecks = computed<PSRCheck[]>(() => {
        const checks: PSRCheck[] = [];
        if (this.dmgReceived() >= 20) {
            checks.push({
                difficulty: 1,
                reason: 'Received 20 or more damage this turn'
            });
        }
        if (this.psrChecks().shutdown) {
            checks.push({
                difficulty: 3,
                reason: 'Shutdown this turn'
            });
        }
        const psr = this.psrChecks();
        for (let i = 0; i < (psr.legsFeetHit || 0); i++) {
            checks.push({
                difficulty: 1,
                reason: 'Legs/Feet hit this turn'
            });
        }
        for (let i = 0; i < (psr.hipsHit || 0); i++) {
            checks.push({
                difficulty: 2,
                reason: 'Hips hit this turn'
            });
        }
        for (let i = 0; i < (psr.gyrosHit || 0); i++) {
            checks.push({
                difficulty: 3,
                reason: 'Gyros hit this turn'
            });
        }
        // if ((psr.legsDestroyedThisTurn || 0) > 0) {
        //     checks.push({
        //         difficulty: 5,
        //         reason: 'Legs destroyed this turn'
        //     });
        // }
        console.log(checks);
        return checks;
    });

    getTargetModifierAsAttacker = computed<number>(() => {
        let mod = 0;
        const moveMode = this.moveMode();
        if (moveMode === 'walk') {
            mod += 1;
        } else if (moveMode === 'run') {
            mod += 2;
        } else if (moveMode === 'jump') {
            mod += 3;
        }
        return mod;
    });

    getTargetModifierAsDefender = computed<number>(() => {
        let mod = 0;
        if (this.unitState.prone()) { mod += 1; }
        if (this.unitState.immobile()) { mod -= 4; }
        if (this.unitState.skidding()) { mod += 2; }
        const moveMode = this.moveMode();
        if (moveMode !== 'stationary' && moveMode !== null) {
            if (moveMode === 'jump') { mod += 1; }
            const moveDistance = this.moveDistance() || 0;
            if (moveDistance >= 3 && moveDistance <= 4) {
                mod += 1;
            } else if (moveDistance >= 5 && moveDistance <= 6) {
                mod += 2;
            } else if (moveDistance >= 7 && moveDistance <= 9) {
                mod += 3;
            } else if (moveDistance >= 10 && moveDistance <= 17) {
                mod += 4;
            } else if (moveDistance >= 18 && moveDistance <= 24) {
                mod += 5;
            } else if (moveDistance >= 25) {
                mod += 6;
            }
        }
        const baseUnit = this.unitState.unit.getUnit();
        if (baseUnit.subtype === 'Battle Armor') {
            mod += 1;
        }
        if (baseUnit.moveType === 'VTOL' || baseUnit.moveType === 'WiGE') {
            mod += 1;
        }
        return mod;
    });

    hasPSRCheck = computed<boolean>(() => {
        return this.getPSRChecks().length > 0;
    });

    currentPhase = computed<'I' | 'M' | 'W' | 'P' | 'H'>(() => {
        if (this.moveMode() === null || (this.moveMode() !== 'stationary' && this.moveDistance() === null)) {
            return 'M';
        } else {
            return 'W';
        }
    });

    heatGenerated = computed(() => {
        let heat = 0;
        const moveMode = this.moveMode();
        const critSlots = this.unitState.unit.getCritSlots();
        if (moveMode === 'walk') {
            heat += 1;
        } else if (moveMode === 'run') {
            heat += 2;
        } else if (moveMode === 'jump') {
            const distance = this.moveDistance() || 0;
            const hasImprovedJumpJet = critSlots.some(slot => slot.name && slot.name.includes('Improved Jump Jet') && slot.destroyed);
            heat += Math.max(3, hasImprovedJumpJet ? Math.ceil(distance / 2) : distance);
        }
        const engineHits = critSlots.filter(slot => slot.name && slot.name.includes('Engine') && slot.destroyed).length;
        heat += engineHits * 5;
        return heat;
    });

    heatDissipated = computed(() => {
        return 0;
    });

    totalHeatDelta = computed(() => {
        return 0;
    });

    constructor(unitState: ForceUnitState) {
        this.unitState = unitState;
    }

    addDmgReceived(amount: number) {
        this.dmgReceived.set(this.dmgReceived() + amount);
    }

    evaluateCritSlot(crit: CriticalSlot) {
        let isPsrRelevant = false;
        const delta = (crit.hits && crit.hits > 0) ? 1 : -1;
        const psr = this.psrChecks();
        if (crit.name?.includes('Foot') || crit.name?.includes('Leg')) {
            psr.legsFeetHit = Math.max(0, (psr.legsFeetHit || 0) + delta);
            isPsrRelevant = true;
        } else if (crit.name?.includes('Hip')) {
            psr.hipsHit = Math.max(0, (psr.hipsHit || 0) + delta);
            isPsrRelevant = true;
        } else if (crit.name?.includes('Gyro')) {
            psr.gyrosHit = Math.max(0, (psr.gyrosHit || 0) + delta);
            isPsrRelevant = true;
            if (delta > 0 && !psr.gyrosDestroyed) {
                // This is an Hit. Check if gyros are destroyed
                const critSlots = this.unitState.unit.getCritSlots();
                const gyroHits = critSlots.filter(slot => slot.name && slot.name.includes('Gyro') && slot.destroyed).length;
                if (gyroHits === 2 && (gyroHits-delta < 2) && !psr.gyrosDestroyed) { // It's destroyed this turn
                    psr.gyrosDestroyed = true;
                } else if (gyroHits < 2) {
                    psr.gyrosDestroyed = false;
                }
            }
        }
        if (isPsrRelevant) {
            this.psrChecks.set({ ...psr });
        }
    }
}

export class ForceUnitState {
    public unit: ForceUnit ;
    public modified = signal(false);
    public immobile = signal(false);
    public prone = signal(false);
    public skidding  = signal(false);
    public destroyed = signal(false);
    public shutdown = signal(false);
    public c3Linked = signal(false);
    /** Adjusted Battle Value, if any */
    public adjustedBv = signal<number | null>(null);
    /** Crew members assigned to this unit */
    public crew = signal<CrewMember[]>([]);
    /** Critical hits on this unit */
    public crits = signal<CriticalSlot[]>([]);
    /** Locations and their armor/structure and other properties */
    public locations = signal<Record<string, LocationData>>({});
    /** Heat state of the unit */
    public heat = signal<HeatProfile>({ current: 0, previous: 0 });
    /** Inventory of the unit */
    public inventory = signal<MountedEquipment[]>([]);
    public readonly turnState = signal(new TurnState(this));

    constructor(unit: ForceUnit) {
        this.unit = unit;
    }
    
    resetTurnState() {
        this.turnState.set(new TurnState(this));
    }
}

const DEFAULT_GUNNERY_SKILL = 4;
const DEFAULT_PILOTING_SKILL = 5;

export type SkillType = 'gunnery' | 'piloting';

export class CrewMember {
    private unit: ForceUnit;
    private id: number;
    private name: string;
    private gunnerySkill: number;
    private pilotingSkill: number;
    private asfGunnerySkill?: number; // Optional ASF gunnery skill for ASF
    private asfPilotingSkill?: number; // Optional ASF piloting skill for ASF units
    private hits: number;

    constructor(id: number, unit: ForceUnit) {
        this.unit = unit;
        this.id = id;
        this.name = '';
        this.gunnerySkill = 4;
        this.pilotingSkill = 5;
        this.hits = 0;
    }

    getId(): number {
        return this.id;
    }

    setSkill(skillType: SkillType, skillValue: number, asf: boolean = false) {
        if (asf) {
            if (skillType === 'piloting') {
                this.asfPilotingSkill = skillValue;
            } else {
                this.asfGunnerySkill = skillValue;
            }
        } else {
            if (skillType === 'piloting') {
                this.pilotingSkill = skillValue;
            } else {
                this.gunnerySkill = skillValue;
            }
        }
        this.unit.setCrewMember(this.id, this);
        this.unit.setModified();
    }

    getSkill(skillType: SkillType, asf: boolean = false): number {
        if (skillType === 'gunnery') {
            const value = asf ? this.asfGunnerySkill : this.gunnerySkill;
            if (value === undefined || value === null) {
                return DEFAULT_GUNNERY_SKILL;
            }
            return value;
        }
        const value = asf ? this.asfPilotingSkill : this.pilotingSkill;
        if (value === undefined || value === null) {
            return DEFAULT_PILOTING_SKILL;
        }
        return value;
    }

    getName(): string {
        return this.name || '';
    }

    setName(name: string) {
        if (name === this.name) return;
        this.name = name;
        this.unit.setCrewMember(this.id, this);
        this.unit.setModified();
    }

    getHits(): number {
        return this.hits;
    }

    setHits(hits: number) {
        if (hits === this.hits) return;
        this.hits = hits;
        this.unit.setCrewMember(this.id, this);
        this.unit.setModified();
    }

    /** Serialize this CrewMember instance to a plain object */
    public serialize(): any {
        return {
            id: this.getId(),
            name: this.getName(),
            gunnerySkill: this.getSkill('gunnery'),
            pilotingSkill: this.getSkill('piloting'),
            asfGunnerySkill: this.getSkill('gunnery', true),
            asfPilotingSkill: this.getSkill('piloting', true),
            hits: this.getHits()
        };
    }

    /** Deserialize a plain object to a CrewMember instance */
    public static deserialize(data: any, unit: ForceUnit): CrewMember {
        const crew = new CrewMember(data.id, unit);
        crew.setName(data.name);
        crew.setSkill('gunnery', data.gunnerySkill);
        crew.setSkill('piloting', data.pilotingSkill);
        if (data.asfGunnerySkill !== undefined)
            crew.setSkill('gunnery', data.asfGunnerySkill, true);
        if (data.asfPilotingSkill !== undefined)
            crew.setSkill('piloting', data.asfPilotingSkill, true);
        crew.setHits(data.hits);
        return crew;
    }
}
