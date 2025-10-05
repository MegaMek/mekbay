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

import { signal, computed, WritableSignal, EventEmitter, Injector, inject } from '@angular/core';
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
/*
 * Author: Drake
 */
export class Force {
    instanceId: string | null;
    _name: WritableSignal<string>;
    timestamp: string | null = null;
    units: WritableSignal<ForceUnit[]> = signal([]);
    loading: boolean = false;
    cloud?: boolean = false; // Indicates if this force is stored in the cloud
    owned = true; // Indicates if the user owns this force (false if it's a shared force)
    public changed = new EventEmitter<void>();
    private _debounceTimer: any = null;

    private dataService: DataService;
    private unitInitializer: UnitInitializerService;
    private injector: Injector;

    constructor(name: string,
        dataService: DataService,
        unitInitializer: UnitInitializerService,
        injector: Injector) {
        this.instanceId = null;
        this._name = signal(name);
        this.dataService = dataService;
        this.unitInitializer = unitInitializer;
        this.injector = injector;
    }

    get name(): string {
        return this._name();
    }

    public setName(name: string, emitChange: boolean = true) {
        if (name === this._name()) return; // No change
        this._name.set(name);
        if (this.instanceId || emitChange) {
            this.emitChanged();
        }
    }

    public addUnit(unit: Unit): ForceUnit {    
        const forceUnit = new ForceUnit(unit, this, this.dataService, this.unitInitializer, this.injector);
        this.units.update(units => [...units, forceUnit]);
        if (this.instanceId) {
            this.emitChanged();
        }
        return forceUnit;
    }

    public removeUnit(unitToRemove: ForceUnit) {
        unitToRemove.destroy();
        this.units.update(units => units.filter(u => u.id !== unitToRemove.id));
        this.refreshUnits();
        if (this.instanceId) {
            this.emitChanged();
        }
    }

    public setUnits(newUnits: ForceUnit[]) {
        this.units.set(newUnits);
        if (this.instanceId) {
            this.emitChanged();
        }
    }

    public refreshUnits() {
        this.units().forEach(unit => {
            unit.recalculateBv();
        });
    }

    public reorderUnit(previousIndex: number, currentIndex: number) {
        if (previousIndex === currentIndex) {
            return; // No change needed
        }
        const units = [...this.units()];
        if (
            previousIndex < 0 ||
            previousIndex >= units.length ||
            currentIndex < 0 ||
            currentIndex >= units.length
        ) {
            return;
        }
        const [moved] = units.splice(previousIndex, 1);
        units.splice(currentIndex, 0, moved);
        this.units.set(units);
        if (this.instanceId) {
            this.emitChanged();
        }
    }
    
    public loadAll() {
        this.units().forEach(unit => unit.load());
    }

    /** Serialize this Force instance to a plain object */
    public serialize(): any {
        return {
            version: 1,
            timestamp: new Date().toISOString(),
            instanceId: this.instanceId,
            name: this.name,
            units: this.units().map(unit => unit.serialize())
        };
    }

    /** Deserialize a plain object to a Force instance */
    public static deserialize(data: any, dataService: DataService, unitInitializer: UnitInitializerService, injector: Injector): Force {
        const force = new Force(data.name, dataService, unitInitializer, injector);
        force.loading = true;
        try {
            force.instanceId = data.instanceId;
            force.owned = (data.owned !== false);
            const units: ForceUnit[] = [];
            for (const unitData of data.units) {
                try {
                    units.push(ForceUnit.deserialize(unitData, force, dataService, unitInitializer, injector));
                } catch (err) {
                    console.error(`Force.deserialize error on unit "${unitData.unit}":`, err);
                    continue; // Ignore this unit
                }
            }
            force.units.set(units);
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
        }, 10); // debounce
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

export class ForceUnit {
    private unit: Unit; // Original unit data
    force: Force;
    id: string;
    svg: WritableSignal<SVGSVGElement | null> = signal(null); // SVG representation of the unit
    private svgService: UnitSvgService | null = null;
    private loadingPromise: Promise<void> | null = null;
    viewState: {
        scale: number;
        translateX: number;
        translateY: number;
    };
    initialized = false;
    locations?: {
        armor: Map<string, { loc: string; rear: boolean; points?: number }>;
        internal: Map<string, { loc: string; points?: number }>;
    };
    private state: ForceUnitState = new ForceUnitState();

    // Dependencies for deferred loading
    private dataService: DataService;
    private unitInitializer: UnitInitializerService;
    private injector: Injector;
    private isLoaded: boolean = false;
    public disabledSaving: boolean = false;

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
    getHeat = this.state.heat;
    setHeat(heat: number) {
        const storedHeat = this.state.heat();
        if (heat === storedHeat.current) return; // No change
        this.state.heat.set({ current: heat, previous: storedHeat.current });
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
        const crits = [...this.state.crits()];
        const existingIndex = crits.findIndex(c => c.loc === slot.loc && c.slot === slot.slot);
        if (existingIndex !== -1) {
            crits[existingIndex] = slot; // Update existing crit
        } else {
            crits.push(slot); // Add new crit
        }
        this.setCritSlots(crits);
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
    getCrewMember(crewId: number): CrewMember {
        return this.state.crew()[crewId];
    }
    setCrewMember(crewId: number, crewMember: CrewMember) {
        const crew = [...this.state.crew()];
        crew[crewId] = crewMember;
        this.state.crew.set(crew);
        this.recalculateBv();
        this.setModified();
    }
    recalculateBv() {
        const pilot = this.getCrewMember(0);
        let gunnery = pilot.getSkill('gunnery');
        let piloting = pilot.getSkill('piloting');
        let bv = this.unit.bv;
        if (this.c3Linked) {
            const c3Tax = C3NetworkUtil.calculateC3Tax(this, this.force.units());
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

    public hasDirectInventory(): boolean {
        return (!this.svg()?.querySelector('.critSlot')) && (this.getUnit().type !== 'Infantry') || false;
    }

    public serialize(): any {
        const stateObj: any = {
                crew: this.state.crew().map(crew => crew.serialize()),
                crits: this.state.crits().map(({ uid, el, eq, ...rest }) => rest), // We remove UID and the SVGElement as they are linked at load time
                heat: this.state.heat(),
                locations: this.state.locations(),
                modified: this.state.modified(),
                destroyed: this.state.destroyed(),
                c3Linked: this.state.c3Linked(),
            };
        if (this.hasDirectInventory()) {
            // stateObj.inventory = [];
        }
        const data = {
            id: this.id,
            state: stateObj,
            unit: this.getUnit().name // Serialize only the name
        };
        return data;
    }

    /** Deserialize a plain object to a ForceUnit instance */
    public static deserialize(
        data: any,
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

    private deserializeState(data: any) {
        this.id = data.id;
        if (data.state) {
            this.state.crits.set(data.state.crits);
            this.state.locations.set(data.state.locations || {});
            this.state.heat.set(data.state.heat);
            this.state.modified.set(data.state.modified ?? false);
            this.state.destroyed.set(data.state.destroyed ?? false);
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

export class ForceUnitState {
    public modified: WritableSignal<boolean>;
    public destroyed: WritableSignal<boolean>;
    public c3Linked: WritableSignal<boolean>;
    /** Adjusted Battle Value, if any */
    public adjustedBv: WritableSignal<number | null>;
    /** Crew members assigned to this unit */
    public crew: WritableSignal<CrewMember[]>;
    /** Critical hits on this unit */
    public crits: WritableSignal<CriticalSlot[]>;
    /** Locations and their armor/structure and other properties */
    public locations: WritableSignal<Record<string, LocationData>> = signal({});
    /** Heat state of the unit */
    public heat: WritableSignal<{ current: number, previous: number }>;
    /** Inventory of the unit */
    public inventory: WritableSignal<MountedEquipment[]>;

    constructor() {
        this.modified = signal(false);
        this.destroyed = signal(false);
        this.c3Linked = signal(false);
        this.adjustedBv = signal(null);
        this.crew = signal([]);
        this.crits = signal([]);
        this.locations = signal({});
        this.heat = signal({ current: 0, previous: 0 });
        this.inventory = signal([]);
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
    el?: SVGElement;
    eq?: Equipment;
}
