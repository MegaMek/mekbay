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

import { computed, createEnvironmentInjector, EnvironmentInjector, type Injector, runInInjectionContext, signal, type Signal, untracked, type WritableSignal } from '@angular/core';
import { DataService } from '../services/data.service';
import type { Unit } from "./units.model";
import type { UnitInitializerService } from '../services/unit-initializer.service';
import { MountedEquipment, type CriticalSlot, type HeatProfile, type LocationData, type ViewportTransform, CRIT_SLOT_SCHEMA, HEAT_SCHEMA, LOCATION_SCHEMA, INVENTORY_SCHEMA, C3_POSITION_SCHEMA, type CBTSerializedState, type CBTSerializedUnit, type SerializedCrewMember, committedConditionData, conditionsForSerialization, conditionsHasActive, conditionsHasCommittedActive, conditionsMapFromSerialization, normalizeConditionData, normalizeConditionKey } from './force-serialization';
import { ForceUnit } from './force-unit.model';
import type { ConditionData } from './force-unit-state.model';
import type { CBTForce } from './cbt-force.model';
import { UnitSvgService } from '../services/unit-svg.service';
import { CrewMember, DEFAULT_GUNNERY_SKILL, DEFAULT_PILOTING_SKILL, type SkillType } from './crew-member.model';
import { CBTForceUnitState } from './cbt-force-unit-state.model';
import { UnitSvgMekService } from '../services/unit-svg-mek.service';
import { UnitSvgAeroService } from '../services/unit-svg-aero.service';
import { UnitSvgInfantryService } from '../services/unit-svg-infantry.service';
import { UnitSvgVehicleService } from '../services/unit-svg-vehicle.service';
import { BVCalculatorUtil } from '../utils/bv-calculator.util';
import { AmmoEquipment, WeaponEquipment } from './equipment.model';
import type { AmmoEquipment as AmmoEquipmentType } from './equipment.model';
import { C3NetworkUtil } from '../utils/c3-network.util';
import { getMotiveModesOptionsByUnit, type MotiveModeOption } from './motiveModes.model';
import type { TurnState } from './turn-state.model';
import { Sanitizer } from '../utils/sanitizer.util';
import type { UnitTypeRules } from './rules/unit-type-rules';
import { MekRules } from './rules/mek-rules';
import { AeroRules } from './rules/aero-rules';
import { InfantryRules } from './rules/infantry-rules';
import { ProtoMekRules } from './rules/protomek-rules';
import { VehicleRules } from './rules/vehicle-rules';
import { type InventoryControlRuntimeEntryState, type InventoryControlRuntimeRangeKey, type InventoryControlRuntimeSnapshot, type InventoryControlRuntimeTarget, type InventoryControlRuntimeTargetId } from './inventory-control-runtime-state.model';
import { CBTInventoryControlRuntime } from './cbt-inventory-control-runtime.model';
import { LINKED_LOCATIONS } from '../models/rules/mek-rules';
import { EquipmentInteractionRegistryService } from '../services/equipment-interaction-registry.service';
import type { UnitHeatSource } from './rules/unit-type-rules';
import type { InventoryControlDisplayData, InventoryControlDisplayEffectOptions, InventoryControlRules } from '../utils/inventory-control.util';
import { ToastService } from '../services/toast.service';
import { DialogsService } from '../services/dialogs.service';

export class CBTForceUnit extends ForceUnit {
    override get force(): CBTForce { return super.force as CBTForce; }
    override set force(value: CBTForce) { super.force = value; }
    private loadingPromise: Promise<void> | null = null;
    svg: WritableSignal<SVGSVGElement | null> = signal(null); // SVG representation of the unit
    private _svgService: UnitSvgService | null = null;
    private svgServiceInjector: EnvironmentInjector | null = null;
    private _rules!: UnitTypeRules;
    viewState: ViewportTransform;
    locations?: {
        armor: Map<string, { loc: string; rear: boolean; points?: number }>;
        internal: Map<string, { loc: string; points?: number }>;
    };
    protected override state: CBTForceUnitState;
    readonly inventoryControl = new CBTInventoryControlRuntime(this);
    private readonly inventoryControlRuntime = this.inventoryControl;

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
        this._rules = this.createRules();
    }

    /** Unit-type-specific game rules (destruction, PSR, systems status for Meks). */
    get rules(): UnitTypeRules { return this._rules; }

    getEquipmentHeatSources(turnState: TurnState): UnitHeatSource[] {
        return this.injector.get(EquipmentInteractionRegistryService)
            .getRegistry()
            .getInventoryHeatSources(this.getInventory(), turnState);
    }

    getRunMovementMultiplierBonus(turnState: TurnState): number {
        return this.injector.get(EquipmentInteractionRegistryService)
            .getRegistry()
            .getRunMovementMultiplierBonus(this.getInventory(), turnState);
    }

    getLinkedEquipmentHitModifier(entry: MountedEquipment, selectedAmmo?: AmmoEquipmentType | null): number {
        return this.injector.get(EquipmentInteractionRegistryService)
            .getRegistry()
            .getLinkedEquipmentHitModifier(entry, selectedAmmo);
    }

    getInventoryControlBaseHitModifier(entry: MountedEquipment, range?: InventoryControlRuntimeRangeKey | null): number | null {
        return this.getInventoryControlRules().resolveBaseHitModifier?.(entry, range) ?? null;
    }

    getInventoryControlRules(): InventoryControlRules {
        return this.injector.get(EquipmentInteractionRegistryService)
            .getRegistry()
            .inventoryControlRules(this.getHandlerContext());
    }

    private getHandlerContext() {
        return {
            toastService: this.injector.get(ToastService),
            dialogsService: this.injector.get(DialogsService),
            dataService: this.injector.get(DataService)
        };
    }

    applyInventoryControlDisplayEffects(
        entry: MountedEquipment,
        display: InventoryControlDisplayData,
        options: InventoryControlDisplayEffectOptions
    ): InventoryControlDisplayData {
        return this.getInventoryControlRules().applyDisplayEffects?.(entry, display, options) ?? display;
    }

    override isComputedCondition(condition: string): boolean {
        return this._rules?.isComputedCondition(condition) ?? false;
    }

    override hasComputedCondition(condition: string): boolean {
        return this._rules?.hasComputedCondition(condition) ?? false;
    }

    override getConditions(): ReadonlyMap<string, ConditionData | undefined> {
        const conditions = new Map(this.conditions);
        for (const condition of this._rules.computedConditions()) {
            if (this.getCondition(condition)) conditions.set(condition, undefined);
        }
        return conditions;
    }

    /** 
     * Direct write to crits signal, bypassing evaluateDestroyed/setModified. For rules evaluators. 
     * USE IT CAREFULLY!!!
     */
    writeCrits(crits: CriticalSlot[]): void {
        this.state.crits.set(crits);
        this.inventoryControl.markInventoryViewChanged();
    }

    private createRules(): UnitTypeRules {
        switch (this.unit.type) {
            case 'Mek': return new MekRules(this);
            case 'Aero': return new AeroRules(this);
            case 'Infantry': return new InfantryRules(this);
            case 'ProtoMek': return new ProtoMekRules(this);
            default: return new VehicleRules(this);
        }
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

    public async load() {
        if (this.isLoaded()) return;
        if (this.loadingPromise) {
            return this.loadingPromise;
        }
        this.loadingPromise = this.performLoad();
        try {
            await this.loadingPromise;
            if (!this.svg()) {
                throw new Error(`Unit "${this.unit.name}" loaded but SVG is missing`);
            }
            this.isLoaded.set(true);
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
                        this._svgService = new UnitSvgMekService(this, this.unitInitializer);
                        break;
                    case 'Aero':
                        this._svgService = new UnitSvgAeroService(this, this.unitInitializer);
                        break;
                    case 'Infantry':
                        this._svgService = new UnitSvgInfantryService(this, this.unitInitializer);
                        break;
                    case 'Tank':
                    case 'VTOL':
                    case 'Naval':
                        this._svgService = new UnitSvgVehicleService(this, this.unitInitializer);
                        break;
                    default:
                        this._svgService = new UnitSvgService(this, this.unitInitializer);
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
        this.inventoryControl.markInventoryViewChanged();
        if (!initialization) {
            this.evaluateDestroyed();
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
        this._rules.evaluateCritSlotHit(slot);
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
        this.state.inventory.set(inventory.map(entry => MountedEquipment.from(entry)));
        if (!initialization) {
            this.turnState().clampMoveDistanceToCurrentModeRange();
        }
        this.inventoryControl.markInventoryViewChanged();
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

    getInventoryControlSnapshot(): InventoryControlRuntimeSnapshot {
        return this.inventoryControlRuntime.getSnapshot();
    }

    getInventoryControlEntryState(entryId: string): InventoryControlRuntimeEntryState | undefined {
        return this.inventoryControlRuntime.getEntryState(entryId);
    }

    getInventoryControlTargets(): InventoryControlRuntimeTarget[] {
        return this.inventoryControlRuntime.getTargets();
    }

    getInventoryControlTarget(targetId: InventoryControlRuntimeTargetId): InventoryControlRuntimeTarget | undefined {
        return this.inventoryControlRuntime.getTarget(targetId);
    }

    getInventoryControlEntryTargetId(entryId: string): InventoryControlRuntimeTargetId | undefined {
        return this.inventoryControlRuntime.getEntryTargetId(entryId);
    }

    isInventoryControlEntrySelected(entryId: string): boolean {
        return this.inventoryControlRuntime.isEntrySelected(entryId);
    }

    getInventoryControlEntryRange(entryId: string): InventoryControlRuntimeRangeKey | undefined {
        return this.inventoryControlRuntime.getEntryRange(entryId);
    }

    getInventoryControlEntryAmmoOption(entryId: string): string | undefined {
        return this.inventoryControlRuntime.getEntryAmmoOption(entryId);
    }

    setInventoryControlEntrySelected(entry: MountedEquipment, selected: boolean): void {
        this.inventoryControlRuntime.setEntrySelected(entry, selected);
    }

    setInventoryControlEntryRange(entry: MountedEquipment, range: InventoryControlRuntimeRangeKey | null): void {
        this.inventoryControlRuntime.setEntryRange(entry, range);
    }

    toggleInventoryControlEntryRange(entry: MountedEquipment, range: InventoryControlRuntimeRangeKey, forceSelected = false): void {
        this.inventoryControlRuntime.toggleEntryRange(entry, range, forceSelected);
    }

    setInventoryControlEntryAmmoOption(entryId: string, optionId: string): void {
        this.inventoryControlRuntime.setEntryAmmoOption(entryId, optionId);
    }

    setInventoryControlEntryTarget(entry: MountedEquipment, targetId: InventoryControlRuntimeTargetId | null): void {
        this.inventoryControlRuntime.setEntryTarget(entry, targetId);
    }

    createInventoryControlTarget(): InventoryControlRuntimeTarget | null {
        return this.inventoryControlRuntime.createTarget();
    }

    updateInventoryControlTarget(targetId: InventoryControlRuntimeTargetId, patch: Partial<Omit<InventoryControlRuntimeTarget, 'id' | 'letter'>>): InventoryControlRuntimeTarget | null {
        return this.inventoryControlRuntime.updateTarget(targetId, patch);
    }

    deleteInventoryControlTarget(targetId: InventoryControlRuntimeTargetId): void {
        this.inventoryControlRuntime.deleteTarget(targetId);
    }

    resetInventoryControlTargets(): void {
        this.inventoryControlRuntime.resetTargets();
    }

    hasLinkedC3Network(): boolean {
        return C3NetworkUtil.hasC3(this.getUnit())
            && C3NetworkUtil.isUnitConnected(this.id, this.force.c3Networks());
    }

    clearInventoryControlSelection(): void {
        this.inventoryControlRuntime.clearSelection();
    }

    clearInventoryControlTargets(): void {
        this.inventoryControlRuntime.resetTargets();
    }

    private reconcileInventoryControlSelection(): void {
        this.inventoryControlRuntime.reconcile();
    }

    syncInventoryControlSelectionSvg(): void {
        this.inventoryControlRuntime.syncSelectionSvg();
    }

    get getLocations() {
        return this.state.locations;
    }

    setLocations(locations: Record<string, LocationData>, initialization: boolean = false) {
        this.state.locations.set(locations);
        if (!initialization) {
            this.evaluateDestroyed();
            this.setModified();
        }
    }

    getArmorPoints(loc: string, rear?: boolean): number {
        const locKey = rear ? `${loc}-rear` : loc;
        return this.locations?.armor.get(locKey)?.points || 0;
    }

    getArmorHits(loc: string, rear?: boolean): number {
        const locKey = rear ? `${loc}-rear` : loc;
        const locData = this.state.locations()[locKey];
        return (locData?.armor ?? 0) + (locData?.pendingArmor ?? 0);
    }

    addArmorHits(loc: string, hits: number, rear?: boolean, consolidateImmediately: boolean = false) {
        const locKey = rear ? `${loc}-rear` : loc;
        const locations = { ...this.state.locations() };

        if (locations[locKey] === undefined) {
            locations[locKey] = {};
        }
        if (consolidateImmediately) {
            locations[locKey].armor = (locations[locKey].armor ?? 0) + (locations[locKey].pendingArmor ?? 0) + hits;
            locations[locKey].pendingArmor = undefined;
        } else {
            if (typeof locations[locKey].pendingArmor !== 'number') {
                locations[locKey].pendingArmor = 0;
            }
            locations[locKey].pendingArmor += hits;
        }
        this.state.locations.set({ ...this.state.locations(), [locKey]: locations[locKey] });
        let hitsForPsr = hits;
        if (this.getUnit().armorType === 'Hardened') {
            hitsForPsr = Math.ceil(hitsForPsr / 2);
        }
        this.state.turnState().addDmgReceived(hitsForPsr);
        this.evaluateDestroyed();
        this.setModified();
    }

    setArmorHits(loc: string, hits: number, rear?: boolean) {
        const locKey = rear ? `${loc}-rear` : loc;
        const locations = { ...this.state.locations() };
        if (locations[locKey] === undefined) {
            locations[locKey] = {};
        }
        locations[locKey].armor = hits;
        locations[locKey].pendingArmor = undefined;
        this.state.locations.set({ ...this.state.locations(), [locKey]: locations[locKey] });
        this.evaluateDestroyed();
        this.setModified();
    }

    getInternalPoints(loc: string): number {
        return this.locations?.internal.get(loc)?.points || 0;
    }

    getInternalHits(loc: string): number {
        const locData = this.state.locations()[loc];
        return (locData?.internal ?? 0) + (locData?.pendingInternal ?? 0);
    }

    addInternalHits(loc: string, hits: number, consolidateImmediately: boolean = false) {
        const locations = { ...this.state.locations() };
        if (locations[loc] === undefined) {
            locations[loc] = {};
        }
        if (consolidateImmediately) {
            locations[loc].internal = (locations[loc].internal ?? 0) + (locations[loc].pendingInternal ?? 0) + hits;
            locations[loc].pendingInternal = undefined;
        } else {
            if (typeof locations[loc].pendingInternal !== 'number') {
                locations[loc].pendingInternal = 0;
            }
            locations[loc].pendingInternal += hits;
        }
        this.state.locations.set({ ...this.state.locations(), [loc]: locations[loc] });
        this.state.turnState().addDmgReceived(hits);
        this._rules.evaluateLegDestroyed(loc, hits);
        this.clearNarcFromCommittedPhysicallyDestroyedLocations();
        this.evaluateDestroyed();
        this.setModified();
    }

    setInternalHits(loc: string, hits: number) {
        const locations = { ...this.state.locations() };
        if (locations[loc] === undefined) {
            locations[loc] = {};
        }
        locations[loc].internal = hits;
        locations[loc].pendingInternal = undefined;
        this.state.locations.set({ ...this.state.locations(), [loc]: locations[loc] });
        this.clearNarcFromCommittedPhysicallyDestroyedLocations();
        this.evaluateDestroyed();
        this.setModified();
    }

    getLocationConditions(loc: string): ReadonlyMap<string, ConditionData | undefined> {
        return conditionsMapFromSerialization(this.state.locations()[loc]?.conditions);
    }

    getLocationCondition(loc: string, condition: string): boolean {
        const normalizedCondition = this.normalizeLocationCondition(condition);
        const conditions = this.getLocationConditions(loc);
        return conditionsHasActive(conditions, normalizedCondition);
    }

    getLocationConditionValue(loc: string, condition: string): number | undefined {
        return this.getLocationConditions(loc).get(this.normalizeLocationCondition(condition))?.value;
    }

    setLocationCondition(loc: string, condition: string, active: boolean): void {
        const normalizedCondition = this.normalizeLocationCondition(condition);
        if (!loc || !normalizedCondition) return;
        const conditions = conditionsMapFromSerialization(this.state.locations()[loc]?.conditions);
        const currentActive = conditionsHasActive(conditions, normalizedCondition);
        if (currentActive === active) return;
        const existing = conditions.get(normalizedCondition);
        if (active) {
            conditions.set(normalizedCondition, conditions.has(normalizedCondition)
                ? committedConditionData(existing)
                : { pending: true });
        } else {
            conditions.delete(normalizedCondition);
        }
        this.writeLocationConditions(loc, conditions);
    }

    setLocationConditionValue(loc: string, condition: string, value: number | undefined): void {
        const normalizedCondition = this.normalizeLocationCondition(condition);
        if (!loc || !normalizedCondition) return;
        if (value === undefined || !Number.isFinite(value) || value <= 0) {
            this.setLocationCondition(loc, normalizedCondition, false);
            return;
        }

        const conditions = conditionsMapFromSerialization(this.state.locations()[loc]?.conditions);
        if (conditions.get(normalizedCondition)?.value === value) return;
        conditions.set(normalizedCondition, normalizeConditionData({ value }));
        this.writeLocationConditions(loc, conditions);
    }

    isArmorLocDestroyed(loc: string, rear: boolean = false): boolean {
        const locKey = rear ? `${loc}-rear` : loc;
        if (!this.locations?.armor.has(locKey)) return false;
        if (this.isLocationDestroyedByCondition(loc)) return true;
        const hits = this.getArmorHits(loc, rear);
        return hits >= this.getArmorPoints(loc, rear);
    }

    isInternalLocDestroyed(loc: string): boolean {
        if (!this.locations?.internal.has(loc)) return false;
        if (this.isLocationDestroyedByCondition(loc)) return true;
        const hits = this.getInternalHits(loc);
        return hits >= this.getInternalPoints(loc);
    }

    isInternalLocPhysicallyDestroyed(loc: string): boolean {
        if (!this.locations?.internal.has(loc)) return false;
        if (this.getLocationCondition(loc, 'blown-off')) return true;
        if (this.getInternalHits(loc) >= this.getInternalPoints(loc)) return true;

        return Object.entries(LINKED_LOCATIONS).some(([sourceLoc, linkedLocations]) => {
            if (!linkedLocations.includes(loc)) return false;
            if (!this.locations?.internal.has(sourceLoc)) return false;
            return this.isInternalLocPhysicallyDestroyed(sourceLoc);
        });
    }

    getCommittedArmorHits(loc: string, rear?: boolean): number {
        const locKey = rear ? `${loc}-rear` : loc;
        return this.state.locations()[locKey]?.armor ?? 0;
    }

    getCommittedInternalHits(loc: string): number {
        return this.state.locations()[loc]?.internal ?? 0;
    }

    isArmorLocCommittedDestroyed(loc: string, rear: boolean = false): boolean {
        const locKey = rear ? `${loc}-rear` : loc;
        if (!this.locations?.armor.has(locKey)) return false;
        if (this.isLocationCommittedDestroyedByCondition(loc)) return true;
        const hits = this.getCommittedArmorHits(loc, rear);
        if (hits >= this.getArmorPoints(loc, rear)) return true;

        return Object.entries(LINKED_LOCATIONS).some(([sourceLoc, linkedLocations]) => {
            if (!linkedLocations.includes(loc)) return false;
            if (!this.locations?.internal.has(sourceLoc)) return false;
            return this.isInternalLocCommittedDestroyed(sourceLoc);
        });
    }

    isInternalLocCommittedDestroyed(loc: string): boolean {
        if (!this.locations?.internal.has(loc)) return false;
        if (this.isLocationCommittedDestroyedByCondition(loc)) return true;
        const hits = this.getCommittedInternalHits(loc);
        if (hits >= this.getInternalPoints(loc)) return true;

        return Object.entries(LINKED_LOCATIONS).some(([sourceLoc, linkedLocations]) => {
            if (!linkedLocations.includes(loc)) return false;
            if (!this.locations?.internal.has(sourceLoc)) return false;
            return this.isInternalLocCommittedDestroyed(sourceLoc);
        });
    }

    isInternalLocCommittedPhysicallyDestroyed(loc: string): boolean {
        if (!this.locations?.internal.has(loc)) return false;
        if (this.isLocationConditionCommittedActive(loc, 'blown-off')) return true;
        const hits = this.getCommittedInternalHits(loc);
        if (hits >= this.getInternalPoints(loc)) return true;

        return Object.entries(LINKED_LOCATIONS).some(([sourceLoc, linkedLocations]) => {
            if (!linkedLocations.includes(loc)) return false;
            if (!this.locations?.internal.has(sourceLoc)) return false;
            return this.isInternalLocCommittedPhysicallyDestroyed(sourceLoc);
        });
    }

    isInternalLocStructurallyDestroyed(loc: string): boolean {
        if (!this.locations?.internal.has(loc)) return false;
        const hits = this.getInternalHits(loc);
        return hits >= this.getInternalPoints(loc);
    }

    isInternalLocCommittedStructurallyDestroyed(loc: string): boolean {
        if (!this.locations?.internal.has(loc)) return false;
        const hits = this.getCommittedInternalHits(loc);
        return hits >= this.getInternalPoints(loc);
    }

    isEquipmentUnavailable(source: MountedEquipment | CriticalSlot, loc?: string): boolean {
        if (source instanceof MountedEquipment) {
            if (source.isUnavailable()) return true;
            return loc ? this.isEquipmentLocationUnavailable(loc) : Array.from(source.locations ?? []).some(loc => this.isEquipmentLocationUnavailable(loc));
        }
        return !!source.destroyed || this.isEquipmentLocationUnavailable(source.loc);
    }

    private isEquipmentLocationUnavailable(loc: string | undefined): boolean {
        if (!loc) return false;
        const battleArmorLoc = this.battleArmorTrooperLocation(loc);
        if (battleArmorLoc) return this.isArmorLocCommittedDestroyed(battleArmorLoc, false);
        return this.isInternalLocCommittedDestroyed(loc);
    }

    private battleArmorTrooperLocation(loc: string): string | null {
        if (this.getUnit().subtype !== 'Battle Armor') return null;
        const match = loc.trim().match(/^(?:Trooper\s+|T)(\d+)$/i);
        if (!match) return null;
        const trooperNumber = Number(match[1]);
        return Number.isInteger(trooperNumber) && trooperNumber > 0 ? `T${trooperNumber}` : null;
    }

    private isLocationDestroyedByCondition(loc: string): boolean {
        return this.getLocationCondition(loc, 'flooded') || this.getLocationCondition(loc, 'blown-off');
    }

    private isLocationCommittedDestroyedByCondition(loc: string): boolean {
        return this.isLocationConditionCommittedActive(loc, 'flooded')
            || this.isLocationConditionCommittedActive(loc, 'blown-off');
    }

    private isLocationConditionCommittedActive(loc: string, condition: string): boolean {
        const conditions = this.getLocationConditions(loc);
        return conditionsHasCommittedActive(conditions, condition);
    }

    private writeLocationConditions(loc: string, conditions: ReadonlyMap<string, ConditionData | undefined>): void {
        const locations = { ...this.state.locations() };
        const current = locations[loc] ?? {};
        const serializedConditions = conditionsForSerialization(conditions);
        const next: LocationData = { ...current };
        if (serializedConditions.length > 0) {
            next.conditions = serializedConditions;
        } else {
            delete next.conditions;
        }

        if ((next.armor ?? 0) === 0 && (next.internal ?? 0) === 0
            && (next.pendingArmor ?? 0) === 0 && (next.pendingInternal ?? 0) === 0
            && (next.conditions?.length ?? 0) === 0) {
            delete locations[loc];
        } else {
            locations[loc] = next;
        }

        this.state.locations.set(locations);
        this.evaluateDestroyed();
        this.inventoryControl.markInventoryViewChanged();
        this.setModified();
    }

    clearNarcFromCommittedPhysicallyDestroyedLocations(): boolean {
        const locations = { ...this.state.locations() };
        let changed = false;
        for (const [loc, locData] of Object.entries(locations)) {
            if (!this.isInternalLocCommittedPhysicallyDestroyed(loc)) continue;
            const conditions = conditionsMapFromSerialization(locData.conditions);
            if (!conditions.delete('narc')) continue;

            const serializedConditions = conditionsForSerialization(conditions);
            const next: LocationData = { ...locData };
            if (serializedConditions.length > 0) {
                next.conditions = serializedConditions;
            } else {
                delete next.conditions;
            }
            locations[loc] = next;
            changed = true;
        }
        if (!changed) return false;

        this.state.locations.set(locations);
        this.inventoryControl.markInventoryViewChanged();
        this.setModified();
        return true;
    }

    private normalizeLocationCondition(condition: string): string {
        return normalizeConditionKey(condition) ?? '';
    }

    getCrewMembers = computed<CrewMember[]>(() => {
        return this.state.crew();
    });

    public getPilotStats = computed<string>(() => {
        const crew = this.getCrewMembers();
        if (crew.length === 0) return 'N/A';
        if (this.unit.type === 'ProtoMek') {
            const gunnery = crew[0].getSkill('gunnery');
            return `${gunnery}`;
        }
        return `${this.gunnerySkill()}/${this.pilotingSkill()}`;
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

    public gunnerySkill = computed<number>(() => {
        return this.getBestCrewSkill('gunnery', DEFAULT_GUNNERY_SKILL);
    });

    public pilotingSkill = computed<number>(() => {
        return this.getBestCrewSkill('piloting', DEFAULT_PILOTING_SKILL);
    });

    private getBestCrewSkill(skillType: SkillType, defaultSkill: number): number {
        const crewMembers = this.getCrewMembers();
        const isLAM = this.getUnit().subtype === 'Land-Air BattleMek';
        const skills: number[] = [];
        for (const crewMember of crewMembers) {
            skills.push(crewMember.getSkill(skillType));
            if (isLAM) {
                skills.push(crewMember.getSkill(skillType, true));
            }
        }
        if (skills.length === 0) {
            return defaultSkill;
        }
        return Math.min(...skills);
    }

    public gunneryModifier = computed<number>(() => {
        return this.rules.gunneryModifier();
    });

    public pilotingModifier = computed<number>(() => {
        return this.rules.pilotingModifier();
    });

    public effectiveGunnerySkill = computed<number>(() => this.gunnerySkill() + this.gunneryModifier());

    public effectivePilotingSkill = computed<number>(() => this.pilotingSkill() + this.pilotingModifier());

    public customAmmoBvVariation = computed<number>(() => {
        if (!this.isLoaded()) return 0; // Ensure unit is loaded so that inventory and crits are available
        const equipmentList = this.getAvailableEquipment();
        let bvVariation = 0;
        if (this.getUnit().type === 'Mek') {
            const crits = this.getCritSlots();
            for (const crit of crits) {
                if (crit.eq instanceof AmmoEquipment && crit.originalName && crit.originalName !== crit.name) {
                    const originalAmmo = equipmentList[crit.originalName] as AmmoEquipment | undefined;
                    if (originalAmmo) {
                        const originalBv = originalAmmo.bv;
                        const currentBv = crit.eq.bv;
                        bvVariation += currentBv - originalBv;
                    }
                }
            }
        } else {
            const inventory = this.getInventory();
            for (const item of inventory) {
                if (item.equipment instanceof AmmoEquipment && item.ammo && item.ammo !== item.name) {
                    const customAmmo = equipmentList[item.ammo] as AmmoEquipment | undefined;
                    if (customAmmo) {
                        const originalBv = item.equipment.bv;
                        const currentBv = customAmmo.bv;
                        bvVariation += currentBv - originalBv;
                    }
                }
            }
        }
        const offSpeedFactor = this.getUnit().offSpeedFactor || 1;
        return Math.round(bvVariation * offSpeedFactor);
    });

    public getBaseBv = computed<number>(() => {
        const baseBv = this.unit.bv;
        return Math.round(baseBv + this.customAmmoBvVariation());
    });

    /* TARGET ACQUISITION GEAR (TAG)
    Any unit in the battle force equipped with TAG, Light TAG or a
    C3 Master Computer (flag F_TAG)
    adds BV equal to the BV of each ton of semi-
    guided (flag M_SEMIGUIDED) LRM ammunition carried in the force (use the ammo BV
    for the appropriate-size LRM launcher). Units whose only such
    piece of equipment is rear-mounted add half the BV instead. */
    public tagBV = computed<number>(() => {
        const components = this.getUnit().comp;
        const hasTag = components.some(c => c.eq?.hasFlag('F_TAG'));
        if (!hasTag) return 0; // No TAG, no BV
        // Calculate total BV of semi-guided LRM ammo across all units in the force.
        // We must scan inventory/crits (not unit blueprints) because custom ammo may be loaded.
        const allUnits = this.force.units();
        let totalSemiGuidedBV = 0;
        for (const forceUnit of allUnits) {
            if (!forceUnit.isLoaded()) continue; // Ensure unit is loaded so that inventory and crits are available
            if (forceUnit.getUnit().type === 'Mek') {
                // Check crit slots (Mek-type units where ammo swapping happens on crits)
                const crits = forceUnit.getCritSlots();
                for (const crit of crits) {
                    if (crit.eq instanceof AmmoEquipment && crit.eq.hasMunitionType('M_SEMIGUIDED')) {
                        const ammo = crit.eq;
                        const forceUnitComps = forceUnit.getUnit().comp;
                        // Check if the unit carrying this ammo has any weapon that can use it (matching ammoType and rackSize)
                        const hasMatchingWeapon = forceUnitComps.some(c =>
                            c.eq instanceof WeaponEquipment &&
                            c.eq.ammoType === ammo.ammoType &&
                            c.eq.rackSize === ammo.rackSize
                        );
                        if (!hasMatchingWeapon) continue; // No weapon can use this ammo, skip
                        // Determine if at least one matching weapon is front-mounted
                        const hasNonRearWeapon = forceUnitComps.some(c =>
                            c.eq instanceof WeaponEquipment &&
                            c.eq.ammoType === ammo.ammoType &&
                            c.eq.rackSize === ammo.rackSize &&
                            !c.rear
                        );
                        const multiplier = hasNonRearWeapon ? 1 : 0.5;
                        totalSemiGuidedBV += Math.round(multiplier * crit.eq.bv);
                    }
                }
            } else {
                // Check direct inventory entries (vehicles, ProtoMeks, etc.)
                const inventory = forceUnit.getInventory();
                for (const item of inventory) {
                    if (item.equipment instanceof AmmoEquipment && item.equipment.hasMunitionType('M_SEMIGUIDED')) {
                        totalSemiGuidedBV += item.equipment.bv;
                    }
                }
            }
        }
        return Math.round(totalSemiGuidedBV);
    });

    public c3Tax = computed<number>(() => {
        const c3Networks = this.force.c3Networks();
        const c3Tax = C3NetworkUtil.calculateUnitC3Tax(
            this,
            c3Networks,
            this.force.units()
        );
        return c3Tax;
    });

    // TODO: To be completed
    /* EXTERNAL STORES
    Aerospace fighters, conventional aircraft and some Sup-
    port Vehicles may carry additional weapons and equipment
    on external hard points (see the Aerospace Weapons and
    Equipment BV Table, p. 318). The BV of any external stores is
    added to the base BV of a unit before the base BV is modified
    for skill rating.
    Aerospace fighters can carry a maximum of one bomb per 5
    tons of mass. Support Vehicles can carry one bomb per hard-
    point added during design. */
    public externalStoresBv = computed<number>(() => {
        return 0;
    });

    public pilotBV = computed<number>(() => {
        const finalBv = this.getBv();
        return finalBv - this.getBaseBv() - this.tagBV() - this.c3Tax() - this.externalStoresBv();
    });

    getBv = computed<number>(() => {
        const preSkillRatingBv = this.getBaseBv() + this.tagBV() + this.c3Tax() + this.externalStoresBv();
        return BVCalculatorUtil.calculateAdjustedBV(
            this.getUnit(),
            preSkillRatingBv,
            this.gunnerySkill(),
            this.pilotingSkill()
        );
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
            if (crit.pendingHits) {
                crit.pendingHits = undefined;
            }
            if (crit.hitTimestamps) {
                crit.hitTimestamps = undefined;
            }
            if (crit.pendingHitTimestamps) {
                crit.pendingHitTimestamps = undefined;
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
        this.state.setConditions([]);
        // Clear inventory destroyed items
        const inventory = this.state.inventory().map(item => {
            if (item.committedDestroyed()) {
                item.setCommittedDestroyed(false);
            }
            if (item.consumed) {
                item.consumed = 0;
            }
            if (item.equipment instanceof AmmoEquipment) {
                item.ammo = undefined;
                const componentIndexText = item.id.split('#').pop();
                const [componentIndexRaw, binIndexRaw] = (componentIndexText ?? '').split('.');
                const componentIndex = Number(componentIndexRaw);
                const binIndex = Number(binIndexRaw ?? 0);
                const component = Number.isInteger(componentIndex) ? this.unit.comp[componentIndex] : undefined;
                const binCount = Math.max(1, component?.q ?? 1);
                const originalTotalAmmo = component?.q2 || (item.equipment.shots * binCount) || 0;
                const baseBinAmmo = Math.floor(originalTotalAmmo / binCount);
                const extraBinAmmo = originalTotalAmmo % binCount;
                item.totalAmmo = baseBinAmmo + (binIndex < extraBinAmmo ? 1 : 0) || undefined;
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
        this.evaluateDestroyed();
        this.setModified();
    }

    /**
     * Evaluates whether the unit should be marked destroyed. Delegates to unit-type rules.
     */
    public evaluateDestroyed(): void {
        if (!this.isLoaded()) return;
        this._rules.evaluateDestroyed();
    }

    public getAvailableMotiveModes(airborne: boolean): MotiveModeOption[] {
        return getMotiveModesOptionsByUnit(this.getUnit(), airborne)
            .filter(option => this._rules.isMotiveModeAvailable(option.mode))
            .map(option => ({
                ...option,
                psr: this._rules.getCommittedDamageMovementModePSRCheck(option.mode) !== null,
            }));
    }

    /** Delegates to unit-type rules. Non-Mek types return { modifier: 0, modifiers: [] }. */
    PSRModifiers = computed(() => this._rules.PSRModifiers());

    /** Delegates to unit-type rules. Non-Mek types return 0. */
    PSRTargetRoll = computed(() => this._rules.PSRTargetRoll());

    endPhase() {
        this.state.endPhase();
        this.phaseTrigger.update(v => v + 1); // Trigger change detection
    }

    applyHeat() {
        this.state.consolidateHeat();
    }
    
    public endTurn() {
        this.clearInventoryControlSelection();
        // deselect all inventory items
        this.getInventory().forEach(entry => {
            if (!entry.el) return;
            entry.el.classList.remove('selected');
            entry.el.querySelectorAll('.alternativeMode').forEach(optionEl => {
                optionEl.classList.remove('selected');
            });
        });
        const equipmentRegistry = this.injector.get(EquipmentInteractionRegistryService).getRegistry();
        const handlerContext = this.getHandlerContext();
        this.getInventory().forEach(entry => equipmentRegistry.onEndTurn(entry, handlerContext));
        this.state.endTurn();
        this.phaseTrigger.update(v => v + 1); // Trigger change detection
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
        if (data.updatedTs !== undefined) {
            this.updatedTs = data.updatedTs;
        }
        if (data.alias !== this.alias()) {
            const pilot = this.getCrewMember(0);
            pilot?.setName(data.alias ?? '');
        }
        this._formationCommander.set(data.commander ?? false);
        if (data.state) {
            this.state.update(data.state);
            this.reconcileInventoryControlSelection();
            this.syncInventoryControlSelectionSvg();
        }
    }

    public override serialize(): CBTSerializedUnit {
        const stateObj: CBTSerializedState = {
            crew: this.state.crew().map(crew => crew.serialize()),
            crits: this.state.critsForSerialization(),
            heat: this.state.heat(),
            locations: this.state.locationsForSerialization(),
            modified: this.state.modified(),
            destroyed: this.state.destroyed(),
            conditions: this.state.conditionsForSerialization(),
            c3Position: this.state.c3Position() ?? undefined,
            inventory: this.state.inventoryForSerialization(),
            turnState: this.state.turnState().serialize()
        };
        const data: CBTSerializedUnit = {
            id: this.id,
            state: stateObj,
            alias: this.alias(),
            commander: this._formationCommander() || undefined,
            updatedTs: this.updatedTs || undefined,
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
        this.state.setConditions(state.conditions ?? []);
        this.state.inventory.update(inventory => inventory.map(item => item.clone({ destroying: undefined })));
        this.state.turnState().update(state.turnState);
        
        if (state.inventory) {
            const inventoryData = Sanitizer.sanitizeArray(state.inventory, INVENTORY_SCHEMA);
            this.state.deserializeInventory(inventoryData);
        }
        const crewArr = (state.crew || []).map((crewData: SerializedCrewMember) => CrewMember.deserialize(crewData, this));
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
        if (data.updatedTs !== undefined) {
            fu.updatedTs = data.updatedTs;
        }
        fu._formationCommander.set(data.commander ?? false);
        fu.deserializeState(data.state);
        return fu;
    }
}
