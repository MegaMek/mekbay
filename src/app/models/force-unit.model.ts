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
import { UnitSvgService } from '../services/unit-svg.service';
import { UnitSvgMekService } from '../services/unit-svg-mek.service';
import { UnitSvgInfantryService } from '../services/unit-svg-infantry.service';
import { UnitInitializerService } from '../components/svg-viewer/unit-initializer.service';
import { C3NetworkUtil } from '../utils/c3-network.util';
import { generateUUID } from '../services/ws.service';
import { LoggerService } from '../services/logger.service';
import { Sanitizer } from '../utils/sanitizer.util';
import { getMotiveModesByUnit, getMotiveModesOptionsByUnit, MotiveModeOption, MotiveModes } from './motiveModes.model';
import {
    LocationData, HeatProfile, SerializedForce, SerializedGroup,
    SerializedUnit, SerializedState, SerializedInventory, CriticalSlot, CRIT_SLOT_SCHEMA, HEAT_SCHEMA, LOCATION_SCHEMA, INVENTORY_SCHEMA,
    ViewportTransform,
    MountedEquipment
} from './force-serialization';
import { Force } from './force.model';
import { CrewMember, SkillType } from './crew-member.model';
import { ForceUnitState } from './force-unit-state.model';
import { TurnState } from './turn-state.model';

/*
 * Author: Drake
 */
export class ForceUnit {
    private unit: Unit; // Original unit data
    force: Force;
    id: string;
    svg: WritableSignal<SVGSVGElement | null> = signal(null); // SVG representation of the unit
    private svgService: UnitSvgService | null = null;
    private loadingPromise: Promise<void> | null = null;
    viewState: ViewportTransform;
    initialized = false;
    locations?: {
        armor: Map<string, { loc: string; rear: boolean; points?: number }>;
        internal: Map<string, { loc: string; points?: number }>;
    };
    private state: ForceUnitState = new ForceUnitState(this);

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
        this.linkEquipmentLookups();
    }

    // this links the equipment definitions (required for unit.comp.*.eq queries)
    private linkEquipmentLookups() {
        const unit = this.unit;
        const allEquipment = this.dataService.getEquipment(unit.type);
        unit.comp.forEach(comp => {
            if (!comp.eq && comp.id) {
                if (allEquipment) {
                    comp.eq = allEquipment[comp.id];
                }
            }
        });
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

    applyHitToCritSlot(slot: CriticalSlot, damage: number = 1) {
        slot.hits = Math.max(0, (slot.hits ?? 0) + damage);
        slot.destroyed = slot.armored ? slot.hits >= 2 : slot.hits >= 1;
        this.setCritSlot(slot);
    }

    getCritLoc(id: string): CriticalSlot | null {
        return this.state.crits().find(c => c.id === id || c.name === id) || null;
    }

    setCritLoc(loc: CriticalSlot) {
        const crits = [...this.state.crits()];
        const existingIndex = crits.findIndex(c => c.id === loc.id);
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
        return `${pilot.getSkill('gunnery')}/${pilot.getSkill('piloting')}`;
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
        return getMotiveModesOptionsByUnit(this.getUnit(), this.turnState().airborne() ?? false);
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
        const destroyedFeetCount = critSlots.filter(slot => slot.loc && slot.name && !hipLocations.has(slot.loc) && slot.name.includes('Foot') && slot.destroyed).length;
        const destroyedLegsActuatorsCount = critSlots.filter(slot => slot.loc && slot.name && !hipLocations.has(slot.loc) && slot.name.includes('Leg') && slot.destroyed).length;
        const destroyedGyroCount = critSlots.filter(slot => slot.name && slot.name.includes('Gyro') && slot.destroyed).length;

        return modifier + destroyedFeetCount + destroyedLegsActuatorsCount + (destroyedGyroCount * 2);
    });

    public resetTurnState() {
        this.state.resetTurnState();
    }

    private _hasDirectInventory: boolean | null = null;
    public hasDirectInventory(): boolean {
        if (this._hasDirectInventory !== null) {
            return this._hasDirectInventory;
        }
        this._hasDirectInventory = (!this.svg()?.querySelector('.critSlot')) && (this.getUnit().type !== 'Infantry') || false;
        return this._hasDirectInventory;
    }

    public update(data: SerializedUnit) {
        if (data.alias !== this.alias()) {
            const pilot = this.getCrewMember(0);
            pilot?.setName(data.alias ?? '');
        }
        if (data.state) {
            this.state.update(data.state, this.dataService.getEquipment(this.unit.type));
        }
    }

    public serialize(): SerializedUnit {
        const stateObj: SerializedState = {
            crew: this.state.crew().map(crew => crew.serialize()),
            crits: this.state.crits().map(({ el, eq, ...rest }) => rest), // We remove UID, SVGElement and eq as they are linked at load time
            heat: this.state.heat(),
            locations: this.state.locations(),
            modified: this.state.modified(),
            destroyed: this.state.destroyed(),
            shutdown: this.state.shutdown(),
            c3Linked: this.state.c3Linked(),
            inventory: this.state.inventoryForSerialization()
        };
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
        fu.linkEquipmentLookups(); // this links the equipment definitions (required for unit.comp.*.eq queries or inventory equipment lookups)
        return fu;
    }

    private deserializeState(data: SerializedUnit) {
        this.id = data.id;
        if (data.state) {
            this.state.crits.set(Sanitizer.sanitizeArray(data.state.crits, CRIT_SLOT_SCHEMA));
            this.state.locations.set(Sanitizer.sanitizeRecord(data.state.locations, LOCATION_SCHEMA));
            this.state.heat.set(Sanitizer.sanitize(data.state.heat, HEAT_SCHEMA));
            this.state.modified.set(typeof data.state.modified === 'boolean' ? data.state.modified : false);
            this.state.destroyed.set(typeof data.state.destroyed === 'boolean' ? data.state.destroyed : false);
            this.state.shutdown.set(typeof data.state.shutdown === 'boolean' ? data.state.shutdown : false);
            this.state.c3Linked.set(typeof data.state.c3Linked === 'boolean' ? data.state.c3Linked : false);
            if (data.state.inventory) {
                const inventoryData = Sanitizer.sanitizeArray(data.state.inventory, INVENTORY_SCHEMA);
                this.state.deserializeInventory(inventoryData, this.dataService.getEquipment(this.unit.type));
            }
            const crewArr = data.state.crew.map((crewData: any) => CrewMember.deserialize(crewData, this));
            this.state.crew.set(crewArr);
            this.recalculateBv();
        }
    }
}
