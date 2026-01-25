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

import { computed, createEnvironmentInjector, EnvironmentInjector, Injector, runInInjectionContext, signal, Signal, untracked, WritableSignal } from '@angular/core';
import { DataService } from '../services/data.service';
import { Unit } from "./units.model";
import { UnitInitializerService } from '../services/unit-initializer.service';
import { CriticalSlot, HeatProfile, LocationData, MountedEquipment, ViewportTransform, CRIT_SLOT_SCHEMA, HEAT_SCHEMA, LOCATION_SCHEMA, INVENTORY_SCHEMA, C3_POSITION_SCHEMA, CBTSerializedState, CBTSerializedUnit } from './force-serialization';
import { ForceUnit } from './force-unit.model';
import { CBTForce } from './cbt-force.model';
import { UnitSvgService } from '../services/unit-svg.service';
import { CrewMember } from './crew-member.model';
import { CBTForceUnitState } from './cbt-force-unit-state.model';
import { UnitSvgMekService } from '../services/unit-svg-mek.service';
import { UnitSvgInfantryService } from '../services/unit-svg-infantry.service';
import { BVCalculatorUtil } from '../utils/bv-calculator.util';
import { C3NetworkUtil } from '../utils/c3-network.util';
import { getMotiveModesOptionsByUnit, MotiveModeOption } from './motiveModes.model';
import { PSRCheck, TurnState } from './turn-state.model';
import { FOUR_LEGGED_LOCATIONS, LEG_LOCATIONS } from "../models/common.model";
import { Sanitizer } from '../utils/sanitizer.util';

/*
 * Author: Drake
 */
export class CBTForceUnit extends ForceUnit {
    declare force: CBTForce;
    private loadingPromise: Promise<void> | null = null;
    svg: WritableSignal<SVGSVGElement | null> = signal(null); // SVG representation of the unit
    private _svgService: UnitSvgService | null = null;
    private svgServiceInjector: EnvironmentInjector | null = null;
    viewState: ViewportTransform;
    locations?: {
        armor: Map<string, { loc: string; rear: boolean; points?: number }>;
        internal: Map<string, { loc: string; points?: number }>;
    };
    protected override state: CBTForceUnitState;

    readonly alias = computed<string | undefined>(() => {
        const pilot = this.getCrewMember(0);
        return pilot?.getName() ?? undefined;
    });
    
    constructor(unit: Unit,
        force: CBTForce,
        dataService: DataService,
        unitInitializer: UnitInitializerService,
        injector: Injector
    ) {
        super(unit, force, dataService, unitInitializer, injector);
        this.state = new CBTForceUnitState(this);
        this.viewState = {
            scale: 0,
            translateX: 0,
            translateY: 0
        };

        const crew: CrewMember[] = [];
        // Safeguard: ensure at least 1 crew member for all units except Handheld Weapons
        const crewSize = (this.unit.crewSize === 0 && this.unit.type !== 'Handheld Weapon') ? 1 : this.unit.crewSize;
        for (let i = 0; i < crewSize; i++) {
            crew[i] = new CrewMember(i, this);
        }
        this.state.crew.set(crew);
    }

    override destroy() {
        if (this.svgServiceInjector) {
            this.svgServiceInjector.destroy();
            this.svgServiceInjector = null;
        }
        this._svgService = null;
        this.loadingPromise = null;
        this.unitInitializer.deinitializeUnit(this);
        super.destroy();
    }

    get svgService(): UnitSvgService | null {
        return this._svgService;
    }

    override setModified() {
        this.svgService?.evaluateDestroyed();
        if (this.disabledSaving) return;
        this.state.modified.set(true);
        this.force.emitChanged();
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
        const parentEnvInjector = this.injector.get(EnvironmentInjector);
        this.svgServiceInjector = createEnvironmentInjector([], parentEnvInjector);

        await untracked(async () => {
            await runInInjectionContext(this.svgServiceInjector!, async () => {
                switch (this.unit.type) {
                    case 'Mek':
                        this._svgService = new UnitSvgMekService(this, this.dataService, this.unitInitializer);
                        break;
                    case 'Infantry':
                        this._svgService = new UnitSvgInfantryService(this, this.dataService, this.unitInitializer);
                        break;
                    default:
                        this._svgService = new UnitSvgService(this, this.dataService, this.unitInitializer);
                }
                await this._svgService.loadAndInitialize();
            });
        }); 
    }

    turnState = computed<TurnState>(() => {
        return this.state.turnState();
    });

    get getHeat() {
        return this.state.heat;
    }

    setHeat(heatValue: number, consolidateImmediately: boolean = false) {
        const heatData = this.state.heat();
        if (heatValue === heatData.next) return; // No change
        heatData.next = heatValue;
        this.state.heat.set({ ...heatData });
        if (consolidateImmediately) {
            this.state.consolidateHeat();
        }
        this.setModified();
    }

    setHeatData(heatData: HeatProfile) {
        this.state.heat.set({ ...heatData });
        this.setModified();
    }

    setHeatsinksOff(heatsinksOff: number) {
        const storedHeat = this.state.heat();
        if (heatsinksOff === storedHeat.heatsinksOff) return; // No change
        const newHeatData: HeatProfile = { current: storedHeat.current, previous: storedHeat.previous, next: storedHeat.next, heatsinksOff: heatsinksOff };
        this.state.heat.set(newHeatData);
        this.setModified();
    }

    get getCritSlots() {
        return this.state.crits;
    }

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

    applyHitToCritSlot(slot: CriticalSlot, damage: number = 1, consolidateImmediately: boolean = false) {
        slot.hits = Math.max(0, (slot.hits ?? 0) + damage);
        const destroying = slot.armored ? slot.hits >= 2 : slot.hits >= 1;
        slot.destroying = destroying ? Date.now() : undefined;
        if (slot.destroyed && !destroying) {
            slot.destroyed = undefined; // Reset destroyed immediately
        }
        if (consolidateImmediately) {
            slot.destroyed = slot.destroying;
        }
        this.setCritSlot(slot);
        if (consolidateImmediately) {
            this.state.consolidateCrits(); // Consolidate immediately in case we have pending hits to apply
        }
        this.turnState().evaluateCritSlotHit(slot);
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

    get getInventory() {
        return this.state.inventory;
    }

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

    get getLocations() {
        return this.state.locations;
    }

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
        this.state.turnState().evaluateLegDestroyed(loc, hits);
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

    getCrewMembers = computed<CrewMember[]>(() => {
        return this.state.crew();
    });

    public getPilotStats = computed<string>(() => {
        const crew = this.state.crew();
        if (crew.length === 0) return 'N/A';
        const pilot = crew[0];
        const gunnery = pilot.getSkill('gunnery');
        if (this.unit.type === 'ProtoMek') {
            return `${gunnery}`;
        }
        const piloting = pilot.getSkill('piloting');
        if (crew.length > 1) {
            const gunner = crew[1];
            const gunnery2 = gunner.getSkill('gunnery');
            return `${gunnery2}/${piloting}`;
        }
        return `${gunnery}/${piloting}`;
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
        this.setModified();
    }

    public baseBvPilotAdjusted = computed<number>(() => {
        this.state.crew(); // Track crew changes
        const pilot = this.getCrewMember(0);
        if (!pilot) return this.unit.bv; // Return base BV if no pilot
        let gunnery = pilot.getSkill('gunnery');
        let piloting = pilot.getSkill('piloting');
        let bv = this.unit.bv;
        if (this.unit.crewSize > 1) {
            const gunner = this.getCrewMember(1);
            if (gunner) {
                gunnery = gunner.getSkill('gunnery');
            }
        }
        let adjustedBv = BVCalculatorUtil.calculateAdjustedBV(
            this.getUnit(),
            gunnery,
            piloting
        );
        return adjustedBv;
    });

    public c3Tax = computed<number>(() => {
        const c3Networks = this.force.c3Networks();
        let adjustedBv = this.baseBvPilotAdjusted();
        const c3Tax = C3NetworkUtil.calculateUnitC3Tax(
            this,
            adjustedBv,
            c3Networks,
            this.force.units()
        );
        return c3Tax;
    });

    getBv = computed<number>(() => {
        return this.baseBvPilotAdjusted() + this.c3Tax();
    });

    public repairAll() {
        // Set crew members hits to 0
        const crew = this.state.crew().map(crewMember => {
            if (crewMember.getHits() > 0) {
                crewMember.setHits(0);
            }
            crewMember.setState('healthy');
            return crewMember;
        });
        this.state.crew.set(crew);
        // Clear all crits
        const crits = this.state.crits().map(crit => {
            if (crit.destroyed) {
                crit.destroyed = undefined;
            }
            if (crit.destroying) {
                crit.destroying = undefined;
            }
            if (crit.hits) {
                crit.hits = 0;
            }
            if (crit.consumed) {
                crit.consumed = 0;
            }
            return crit;
        });
        this.state.crits.set([...crits]);
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
            if (item.states && item.states.size > 0) {
                item.states.forEach((value, key) => {
                    item.states!.set(key, ''); // Clear all states, assuming empty string will fallback to default
                });
            }
            return item;
        });
        this.state.inventory.set([...inventory]);
        this.state.resetTurnState();
        this.setModified();
    }

    public getAvailableMotiveModes(): MotiveModeOption[] {
        return getMotiveModesOptionsByUnit(this.getUnit(), this.turnState().airborne() ?? false);
    }

    PSRModifiers = computed<{modifier: number, modifiers: PSRCheck[]}>(() => {
        const ignoreLeg = new Set<string>();
        let preExisting = 0;
        const modifiers: PSRCheck[] = [];

        let isFourLegged = false;
        let undamagedLegs = true;
        // Calculate pre-existing leg destruction modifiers. If a leg is gone, is gone.
        this.locations?.internal?.forEach((_value, loc) => {
            if (!LEG_LOCATIONS.has(loc)) return; // Only consider leg locations
            if (!isFourLegged && FOUR_LEGGED_LOCATIONS.has(loc)) {
                isFourLegged = true;
            }
            if (this.isInternalLocDestroyed(loc)) {
                undamagedLegs = false;
                ignoreLeg.add(loc); // Track destroyed legs, we ignore further modifiers on that leg
                preExisting += 5;
                modifiers.push({
                    pilotCheck: 5,
                    reason: 'Leg Destroyed'
                });
            }
        });
        if (isFourLegged && undamagedLegs) {
            preExisting -= 2; // Four-legged unit with all legs intact gets -2 modifier
            modifiers.push({
                pilotCheck: -2  ,
                reason: "Four-legged 'Mech with all legs"
            });
        }
        // Calculate current turn modifiers
        let ignorePreExistingGyro = false;
        let currentModifiers = 0;
        const turnState = this.turnState();
        const phasePSRs = turnState.getPSRChecks();
        phasePSRs.forEach((check) => {
            if (check.pilotCheck === undefined) return; // No fall check, skip
            if (check.loc) {
                if (ignoreLeg.has(check.loc)) {
                    return; // Ignore this leg for further calculations
                }
            }
            currentModifiers += check.pilotCheck;
            if (check.legFilter) {
                ignoreLeg.add(check.legFilter); // Ignore this leg for further calculations
            }
            if (check.ignorePreExistingGyro) {
                ignorePreExistingGyro = true;
            }
            modifiers.push(check);
        });

        // Calculate pre-existing modifiers for hips and leg actuators destroyed the previous turns
        const critSlots = this.getCritSlots();
        const hasAESinLegs = critSlots.some(slot => slot.name && slot.loc && !slot.destroyed && LEG_LOCATIONS.has(slot.loc) && slot.name.includes('AES'));
        const hasAESinLegsDestroyed = critSlots.some(slot => slot.name && slot.loc && slot.destroyed && LEG_LOCATIONS.has(slot.loc) && slot.name.includes('AES'));
        if (hasAESinLegs && !hasAESinLegsDestroyed) {
            preExisting -= 1; // AES in legs intact gives -1 modifier
            modifiers.push({
                pilotCheck: -1,
                reason: "'Mech mounts AES in its legs"
            });
        }
        const hardenedArmor = this.getUnit().armorType === 'Hardened';
        if (hardenedArmor) {
            preExisting += 1; // Hardened armor gives +1 modifier
            modifiers.push({
                pilotCheck: 1,
                reason: "'Mech mounts Hardened Armor"
            });
        }
        const modularArmorPanelsCount = critSlots.filter(slot => slot.name && slot.name.includes('Modular Armor')).length;
        if (modularArmorPanelsCount > 0) {
            const destroyedModularArmorPanelsCount = critSlots.filter(slot => slot.name && slot.name.includes('Modular Armor') && (slot.destroyed || ((slot.consumed ?? 0) >= 10))).length;
            if (destroyedModularArmorPanelsCount < modularArmorPanelsCount) {
                preExisting += 1; // Modular armor gives +1 modifier (until destroyed or fully consumed)
                modifiers.push({
                    pilotCheck: 1,
                    reason: "'Mech mounts Modular Armor"
                });
            }
        }
        const hasSmallOrTorsoCockpit = critSlots.some(slot => slot.name && slot.loc 
            && ((slot.name.includes('Cockpit') && slot.name.includes('Small'))
                || (slot.name.includes('Command') && slot.name.includes('Small'))) ) 
            || critSlots.some(slot => slot.name && slot.loc && slot.loc === 'CT' && slot.name.includes('Cockpit'));
        if (hasSmallOrTorsoCockpit) {
            preExisting += 1; // Small or Torso cockpit gives +1 modifier
            modifiers.push({
                pilotCheck: +1,
                reason: "'Mech mounts small or torso-mounted cockpit"
            });
        }
        const destroyedHips = critSlots.filter(slot => slot.name && slot.loc && slot.destroyed && LEG_LOCATIONS.has(slot.loc) && !ignoreLeg.has(slot.loc) && slot.name.includes('Hip'));
        for (const hip of destroyedHips) {
            if (!hip.loc) continue;
            preExisting += 2;
            modifiers.push({
                pilotCheck: 2,
                reason: 'Hip Destroyed'
            });
            ignoreLeg.add(hip.loc); // Track destroyed hip locations, we ignore further modifiers on that leg
        }
        const relevantDestroyedLegActuatorsCount = critSlots.filter(slot => {
            if (!slot.loc || !slot.name || !slot.destroyed) return false;
            if (!LEG_LOCATIONS.has(slot.loc)) return false;
            if (ignoreLeg.has(slot.loc)) return false;
            if (!slot.name.includes('Foot') && !slot.name.includes('Leg')) return false;
            return true;
        }).length;
        preExisting += relevantDestroyedLegActuatorsCount;
        if (relevantDestroyedLegActuatorsCount > 0) {
            modifiers.push({
                pilotCheck: relevantDestroyedLegActuatorsCount,
                reason: 'Leg Actuator(s) Destroyed'
            });
        }
        if (!ignorePreExistingGyro) {
            const hasHeavyDutyGyro = critSlots.some(slot => slot.name && slot.name.includes('Heavy Duty') && slot.name.includes('Gyro'));
            const previouslyDestroyedGyroCount = critSlots.filter(slot => {
                if (!slot.name || !slot.destroyed) return false;
                if (!slot.name.includes('Gyro')) return false;
                return true;
            }).length;
            if (hasHeavyDutyGyro && (previouslyDestroyedGyroCount === 1)) {
                modifiers.push({
                    pilotCheck: 1,
                    reason: 'Heavy Duty Gyro first damage'
                });
                preExisting += 1;
            } else if (previouslyDestroyedGyroCount > 0) {
                preExisting += 3;
                modifiers.push({
                    pilotCheck: 3,
                    reason: 'Gyro damaged'
                });
            }
        }
        const finalModifier = preExisting + currentModifiers;
        return {modifier: finalModifier, modifiers: modifiers};
    });

    PSRTargetRoll = computed<number>(() => {
        const pilot = this.getCrewMember(0);
        const piloting = pilot?.getSkill('piloting') ?? 5; // Default to 5 if no pilot
        const modifiers = this.PSRModifiers();
        return piloting + modifiers.modifier;
    });

    endPhase() {
        this.state.endPhase();
        this.phaseTrigger.set(this.phaseTrigger() + 1); // Trigger change detection
    }

    applyHeat() {
        this.state.consolidateHeat();
    }
    
    public endTurn() {
        // deselect all inventory items
        this.getInventory().forEach(entry => {
            if (!entry.el) return;
            entry.el.classList.remove('selected');
            entry.el.querySelectorAll('.alternativeMode').forEach(optionEl => {
                optionEl.classList.remove('selected');
            });
        });
        this.state.endTurn();
        this.phaseTrigger.set(this.phaseTrigger() + 1); // Trigger change detection
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

    public override update(data: CBTSerializedUnit) {
        if (data.alias !== this.alias()) {
            const pilot = this.getCrewMember(0);
            pilot?.setName(data.alias ?? '');
        }
        if (data.state) {
            this.state.update(data.state);
        }
    }

    public override serialize(): CBTSerializedUnit {
        const stateObj: CBTSerializedState = {
            crew: this.state.crew().map(crew => crew.serialize()),
            crits: this.state.crits().map(({ el, eq, ...rest }) => rest), // We remove UID, SVGElement and eq as they are linked at load time
            heat: this.state.heat(),
            locations: this.state.locations(),
            modified: this.state.modified(),
            destroyed: this.state.destroyed(),
            shutdown: this.state.shutdown(),
            c3Position: this.state.c3Position() ?? undefined,
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

    protected deserializeState(state: CBTSerializedState) {
        this.state.crits.set(Sanitizer.sanitizeArray(state.crits, CRIT_SLOT_SCHEMA));
        this.state.locations.set(Sanitizer.sanitizeRecord(state.locations, LOCATION_SCHEMA));
        this.state.heat.set(Sanitizer.sanitize(state.heat, HEAT_SCHEMA));
        this.state.modified.set(typeof state.modified === 'boolean' ? state.modified : false);
        this.state.destroyed.set(typeof state.destroyed === 'boolean' ? state.destroyed : false);
        this.state.shutdown.set(typeof state.shutdown === 'boolean' ? state.shutdown : false);
        
        if (state.inventory) {
            const inventoryData = Sanitizer.sanitizeArray(state.inventory, INVENTORY_SCHEMA);
            this.state.deserializeInventory(inventoryData);
        }
        const crewArr = state.crew.map((crewData: any) => CrewMember.deserialize(crewData, this));
        this.state.crew.set(crewArr);
        if (state.c3Position) {
            this.state.c3Position.set(Sanitizer.sanitize(state.c3Position, C3_POSITION_SCHEMA));
        }
    }

    /** Deserialize a plain object to a CBTForceUnit instance */
    public static override deserialize(
        data: CBTSerializedUnit,
        force: CBTForce,
        dataService: DataService,
        unitInitializer: UnitInitializerService,
        injector: Injector
    ): CBTForceUnit {
        const unit = dataService.getUnitByName(data.unit);
        if (!unit) {
            throw new Error(`Unit with name "${data.unit}" not found in dataService`);
        }
        const fu = new CBTForceUnit(unit, force, dataService, unitInitializer, injector);
        fu.id = data.id;
        fu.deserializeState(data.state);
        return fu;
    }
}
