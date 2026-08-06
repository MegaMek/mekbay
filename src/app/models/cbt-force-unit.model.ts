// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { computed, createEnvironmentInjector, effect, type EffectRef, EnvironmentInjector, type Injector, runInInjectionContext, signal, type Signal, untracked, type WritableSignal } from '@angular/core';
import { DataService } from '../services/data.service';
import type { Unit } from "./units.model";
import type { UnitInitializerService } from '../services/unit-initializer.service';
import { MountedAmmo, MountedEquipment } from './mounted-equipment.model';
import { type CriticalSlot, type HeatProfile, type LocationData, type ViewportTransform, CRIT_SLOT_SCHEMA, HEAT_SCHEMA, LOCATION_SCHEMA, INVENTORY_SCHEMA, C3_POSITION_SCHEMA, TURN_STATE_SCHEMA, type CBTSerializedState, type CBTSerializedUnit, type RuleCheckOutcome, type SerializedCrewMember, type SerializedRuleCheck, committedConditionData, conditionsForSerialization, conditionsHasActive, conditionsHasCommittedActive, conditionsMapFromSerialization, normalizeConditionData, normalizeConditionKey } from './force-serialization';
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
import type { EquipmentFlag } from './equipment-flags.type';
import { C3Capabilities, type C3Component, C3NetworkType, C3Role } from './c3-network.model';
import { isC3DisruptingStealthActive } from './stealth-equipment.model';
import { getMotiveModesOptionsByUnit, type MotiveModeOption } from './motiveModes.model';
import type { TurnState } from './turn-state.model';
import { Sanitizer } from '../utils/sanitizer.util';
import type { UnitTypeRules } from './rules/unit-type-rules';
import { type InventoryControlRuntimeEntryState, type InventoryControlRuntimeRangeKey, type InventoryControlRuntimeSnapshot, type InventoryControlRuntimeTarget, type InventoryControlRuntimeTargetId } from './inventory-control-runtime-state.model';
import { CBTInventoryControlRuntime } from './cbt-inventory-control-runtime.model';
import { getMekLocationParent } from './entity/types';
import { EquipmentInteractionRegistry, EquipmentInteractionRegistryService } from '../services/equipment-interaction-registry.service';
import type { UnitHeatSource } from './rules/unit-type-rules';
import { getInventoryControlModeAmmoSummary, resolveInventoryControlSelectedAmmoOption, type InventoryControlDisplayData, type InventoryControlDisplayEffectOptions, type InventoryControlRules } from '../utils/inventory-control.util';
import { ToastService } from '../services/toast.service';
import { DialogsService } from '../services/dialogs.service';
import { getBattleArmorTrooperNumber, normalizeBattleArmorTrooperLocation } from './battle-armor-location.model';
import { CBTGameRulesService } from '../services/cbt-game-rules.service';
import type { C3DegradationSource, C3TargetingResolution, CBTGameRules } from './rules/game-rules';
import { OptionsService } from '../services/options.service';
import { resolveSelectedInventoryWeaponHeat } from '../utils/inventory-control-heat.util';

export class CBTForceUnit extends ForceUnit {
    override get force(): CBTForce { return super.force as CBTForce; }
    override set force(value: CBTForce) { super.force = value; }
    private loadingPromise: Promise<void> | null = null;
    svg: WritableSignal<SVGSVGElement | null> = signal(null); // SVG representation of the unit
    private _svgService: UnitSvgService | null = null;
    private svgServiceInjector: EnvironmentInjector | null = null;
    private optionalRulesEffect: EffectRef | null = null;
    private _rules!: UnitTypeRules;
    readonly gameRules: CBTGameRules;
    viewState: ViewportTransform;
    locations?: {
        armor: Map<string, { loc: string; rear: boolean; points?: number }>;
        internal: Map<string, { loc: string; points?: number }>;
    };
    protected override state: CBTForceUnitState;
    readonly inventoryControl = new CBTInventoryControlRuntime(this);
    private readonly inventoryControlRuntime = this.inventoryControl;

    readonly selectedInventoryWeaponHeat = computed(() => {
        this.inventoryControl.inventoryViewVersion();
        const inventory = this.getInventory();
        const entryStates = this.inventoryControl.entryStates();
        const hasSelectedWeapon = inventory.some(entry => entryStates.get(entry.id)?.selected);
        return resolveSelectedInventoryWeaponHeat(
            inventory,
            entryStates,
            hasSelectedWeapon ? this.getInventoryControlRules() : {}
        );
    });

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
        const gameRulesService = this.injector.get(CBTGameRulesService);
        this.gameRules = gameRulesService.gameRules();
        this._rules = gameRulesService.createUnitRules(this);
        const optionsService = this.injector.get(OptionsService, null, { optional: true });
        if (optionsService) {
            this.optionalRulesEffect = effect(() => {
                optionsService.options().CBTOptionalRules?.forcedWithdrawal;
                if (this.isLoaded()) untracked(() => this.reconcileRuleChecks());
            }, { injector: this.injector, manualCleanup: true });
        }
        this.turnState().capturePassiveHeatSourceBaseline();
    }

    /** Unit-type-specific game rules (destruction, PSR, systems status for Meks). */
    get rules(): UnitTypeRules { return this._rules; }

    useAutomations(): boolean {
        return this.injector.get(OptionsService, null, { optional: true })?.options().cbtAutomations ?? true;
    }

    allowsExtremeRangeAttacks(): boolean {
        return this.injector.get(OptionsService, null, { optional: true })?.options().CBTOptionalRules?.extremeRange ?? false;
    }

    usesForcedWithdrawal(): boolean {
        return this.injector.get(OptionsService, null, { optional: true })?.options().CBTOptionalRules?.forcedWithdrawal ?? true;
    }

    private getEquipmentInteractionRegistry(): EquipmentInteractionRegistry {
        return this.injector.get(EquipmentInteractionRegistryService).getRegistry();
    }

    getEquipmentHeatSources(turnState: TurnState): UnitHeatSource[] {
        if (this.getCondition('shutdown')) return [];
        return this.getEquipmentInteractionRegistry().getInventoryHeatSources(this.getInventory(), turnState);
    }

    getRunMovementMultiplierBonus(turnState: TurnState): number {
        if (this.getCondition('shutdown')) return 0;
        return this.getEquipmentInteractionRegistry().getRunMovementMultiplierBonus(this.getInventory(), turnState);
    }

    getInventoryControlRules(): InventoryControlRules {
        const equipmentRules = this.injector.get(EquipmentInteractionRegistryService)
            .getRegistry()
            .inventoryControlRules(this.getHandlerContext());
        return {
            ...equipmentRules,
            applyDisplayEffects: (entry, display, options) => {
                const unitDisplay = this.rules.applyInventoryControlDisplayEffects(entry, display);
                return equipmentRules.applyDisplayEffects?.(entry, unitDisplay, options) ?? unitDisplay;
            },
        };
    }

    getInventoryControlSelectedAmmo(entry: MountedEquipment, mode?: string | null): AmmoEquipmentType | null {
        if (!(entry.equipment instanceof WeaponEquipment) || entry.equipment.ammoType === 'NA') return null;
        const intrinsicAmmo = entry.linkedWith?.find(linked => linked instanceof MountedAmmo && linked.intrinsicOneShotAmmo);
        if (intrinsicAmmo) {
            // Rule evaluation needs only the selected profile. Going through the
            // ammo summary also evaluates the source's availability, which checks
            // this parent weapon's rule state and causes a reactive self-cycle.
            const selectedAmmo = intrinsicAmmo.ammo
                ? this.dataService.findEquipment(intrinsicAmmo.ammo)
                : intrinsicAmmo.equipment;
            return selectedAmmo instanceof AmmoEquipment ? selectedAmmo : null;
        }
        const summary = getInventoryControlModeAmmoSummary(entry, this.getEquipmentRegistry(), this.getInventoryControlRules(), mode);
        return resolveInventoryControlSelectedAmmoOption(
            summary.options,
            this.getInventoryControlEntryAmmoOption(entry.id)
        )?.ammo ?? null;
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
        this.turnState().reconcileHeatSources();
        this.inventoryControl.markInventoryViewChanged();
    }

    override destroy() {
        this.optionalRulesEffect?.destroy();
        this.optionalRulesEffect = null;
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
            this.reconcileRuleChecks();
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
        if (heatValue === heatData.next) {
            if (consolidateImmediately && heatData.next !== undefined) {
                this.state.consolidateHeat();
            }
            return;
        }
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

    override setCondition(condition: string, active: boolean): void {
        const wasActive = this.getCondition(condition);
        super.setCondition(condition, active);
        if (wasActive !== this.getCondition(condition)) {
            this.turnState().reconcileHeatSources();
            if (condition === 'jammed' || condition === 'immobile' || condition === 'prone' || condition === 'skidding') {
                this.force.units().forEach(unit => unit.inventoryControl.markInventoryViewChanged());
            }
        }
    }

    getRuleCheck(key: string): SerializedRuleCheck | undefined {
        return this.state.ruleChecks()[key];
    }

    setRuleCheck(key: string, check: SerializedRuleCheck | undefined, markModified = true): boolean {
        const current = this.state.ruleChecks();
        const existing = current[key];
        if (check && existing?.token === check.token && existing.trigger === check.trigger && existing.status === check.status) {
            return false;
        }
        if (!check && !existing) return false;

        const next = { ...current };
        if (check) {
            next[key] = { ...check };
        } else {
            delete next[key];
        }
        this.state.ruleChecks.set(next);
        if (markModified) this.setModified();
        return true;
    }

    reconcileRuleChecks(): void {
        this._rules.reconcileRuleChecks();
    }

    resolveRuleCheck(key: string, token: string, outcome: RuleCheckOutcome): boolean {
        return this._rules.resolveRuleCheck(key, token, outcome);
    }

    get getCritSlots() {
        return this.state.crits;
    }

    setCritSlots(critSlots: CriticalSlot[], initialization: boolean = false) {
        this.state.crits.set(critSlots);
        this.turnState().reconcileHeatSources();
        if (initialization) {
            this.turnState().capturePassiveHeatSourceBaseline();
        }
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

    getMountedEquipmentByFlag(flag: EquipmentFlag): MountedEquipment[] {
        return this.getInventory().filter(entry => entry.equipment?.hasFlag(flag));
    }

    getOperationalMountedEquipmentByFlag(flag: EquipmentFlag): MountedEquipment[] {
        return this.getMountedEquipmentByFlag(flag)
            .filter(entry => !this.isEquipmentUnavailable(entry));
    }

    setInventory(inventory: MountedEquipment[], initialization: boolean = false) {
        this.state.inventory.set(MountedEquipment.fromAll(inventory));
        this.turnState().reconcileHeatSources();
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
        return {
            entryStates: this.inventoryControlRuntime.getSnapshot().entryStates,
            targets: this.getInventoryControlTargets()
        };
    }

    getInventoryControlEntryState(entryId: string): InventoryControlRuntimeEntryState | undefined {
        return this.inventoryControlRuntime.getEntryState(entryId);
    }

    getInventoryControlTargets(): InventoryControlRuntimeTarget[] {
        return this.force.getInventoryControlTargets().map(target => this.inventoryControlRuntime.resolveTarget(target));
    }

    getInventoryControlTargetsMap(): ReadonlyMap<InventoryControlRuntimeTargetId, InventoryControlRuntimeTarget> {
        return new Map(this.getInventoryControlTargets().map(target => [target.id, target]));
    }

    getInventoryControlTarget(targetId: InventoryControlRuntimeTargetId): InventoryControlRuntimeTarget | undefined {
        const target = this.force.getInventoryControlTarget(targetId);
        return target ? this.inventoryControlRuntime.resolveTarget(target) : undefined;
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
        return this.force.createInventoryControlTarget(this);
    }

    updateInventoryControlTarget(targetId: InventoryControlRuntimeTargetId, patch: Partial<Omit<InventoryControlRuntimeTarget, 'id' | 'letter'>>): InventoryControlRuntimeTarget | null {
        const sharedTarget = this.force.updateInventoryControlTarget(targetId, patch, this);
        return sharedTarget ? this.inventoryControlRuntime.updateUnitTargetState(sharedTarget, patch) : null;
    }

    overrideInventoryControlTargetModifier(targetId: InventoryControlRuntimeTargetId, modifier: number): InventoryControlRuntimeTarget | null {
        const sharedTarget = this.force.getInventoryControlTarget(targetId);
        return sharedTarget ? this.inventoryControlRuntime.overrideTargetModifier(sharedTarget, modifier) : null;
    }

    deleteInventoryControlTarget(targetId: InventoryControlRuntimeTargetId): void {
        this.force.deleteInventoryControlTarget(targetId, this);
    }

    resetInventoryControlTargets(): void {
        this.force.resetInventoryControlTargets(this);
    }

    hasLinkedC3Network(): boolean {
        return this.force.c3Network().hasLinkedNetwork(this.id);
    }

    isC3ComponentOperational(componentIndex: number, component?: C3Component): boolean {
        if (this.destroyed || this.getCondition('shutdown') || this.hasActiveC3DisruptingStealth()) return false;
        const mount = component?.mount ?? new C3Capabilities(this).component(componentIndex)?.mount;
        return !!mount && !this.isEquipmentUnavailable(mount);
    }

    private hasActiveC3DisruptingStealth(): boolean {
        return this.getInventory().some(equipment => !this.isEquipmentUnavailable(equipment)
            && isC3DisruptingStealthActive(equipment));
    }

    override isC3EndpointOperational(componentIndex: number, component?: C3Component): boolean {
        return this.isC3ComponentOperational(componentIndex, component);
    }

    override isC3Jammed(): boolean {
        return this.getCondition('jammed');
    }

    isC3NetworkTypeUnavailable(networkType: C3NetworkType): boolean {
        const components = (this.force.c3Network().capability(this.id)?.components ?? [])
            .filter(component => component.networkType === networkType);
        if (components.length === 0) return false;
        if (components.every(component => !this.isC3ComponentOperational(component.index))) return true;

        const configured = this.force.c3Network().networksForUnit(this.id)
            .some(network => network.type === networkType);
        return configured && !this.getC3NetworkRuntimeState(networkType).linked;
    }

    readonly c3DegradationSource = computed<C3DegradationSource>(() => this.getC3DegradationSource());

    getC3DegradationSource(): C3DegradationSource {
        const linkedStates = this.force.c3Network().statesFor(this.id)
            .filter(state => state.linked);
        if (linkedStates.length === 0) return 'none';
        if (this.getCondition('jammed')) return 'unit';
        return linkedStates.every(state => state.degraded) ? 'network-member' : 'none';
    }

    getC3NetworkRuntimeState(networkType: C3NetworkType) {
        return this.force.c3Network().stateFor(this.id, networkType);
    }

    resolveC3Targeting(target: InventoryControlRuntimeTarget): C3TargetingResolution {
        if (!this.hasLinkedC3Network()) {
            return { target: this.withoutC3Distance(target), degradationSource: 'none' };
        }
        return this.gameRules.resolveC3Targeting(target, this.c3DegradationSource());
    }

    private withoutC3Distance(target: InventoryControlRuntimeTarget): InventoryControlRuntimeTarget {
        if (target.c3Distance === undefined) return target;
        return { ...target, c3Distance: undefined };
    }

    clearInventoryControlSelection(): void {
        this.inventoryControlRuntime.clearSelection();
    }

    private reconcileInventoryControlSelection(): void {
        this.inventoryControlRuntime.reconcile(new Set(this.getInventoryControlTargetsMap().keys()));
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

        const parent = getMekLocationParent(this.locations.internal.keys(), loc);
        return parent !== null && this.isInternalLocPhysicallyDestroyed(parent);
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

        const parent = getMekLocationParent(this.locations.internal.keys(), loc);
        return parent !== null && this.isInternalLocCommittedDestroyed(parent);
    }

    isInternalLocCommittedDestroyed(loc: string): boolean {
        if (!this.locations?.internal.has(loc)) return false;
        if (this.isLocationCommittedDestroyedByCondition(loc)) return true;
        const hits = this.getCommittedInternalHits(loc);
        if (hits >= this.getInternalPoints(loc)) return true;

        const parent = getMekLocationParent(this.locations.internal.keys(), loc);
        return parent !== null && this.isInternalLocCommittedDestroyed(parent);
    }

    isInternalLocCommittedPhysicallyDestroyed(loc: string): boolean {
        if (!this.locations?.internal.has(loc)) return false;
        if (this.isLocationConditionCommittedActive(loc, 'blown-off')) return true;
        const hits = this.getCommittedInternalHits(loc);
        if (hits >= this.getInternalPoints(loc)) return true;

        const parent = getMekLocationParent(this.locations.internal.keys(), loc);
        return parent !== null && this.isInternalLocCommittedPhysicallyDestroyed(parent);
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

    /** Whether equipment is temporarily unusable for an action, without implying damage. */
    isEquipmentActionUnavailable(source: MountedEquipment | CriticalSlot, loc?: string): boolean {
        return this.destroyed
            || this.getCondition('shutdown')
            || (source instanceof MountedEquipment && this.isPhysicalActionUnavailable(source))
            || this.isEquipmentUnavailable(source, loc);
    }

    private isPhysicalActionUnavailable(entry: MountedEquipment): boolean {
        if (!entry.isPhysicalWeapon()) return false;
        if (this.getCondition('prone')) return true;
        const moveMode = this.turnState().moveMode();
        if (moveMode === null) return false; // unknown!

        const attack = entry.name.trim().toLocaleLowerCase();
        if (attack === 'death from above' || attack === 'dfa [talons]') {
            return moveMode !== 'jump';
        }
        if (moveMode === 'jump' && attack === 'charge') {
            return true;
        }
        return moveMode === 'stationary'
            && (attack === 'charge' || attack === 'airmek ram' || attack === 'airmech ram');
    }

    private isEquipmentLocationUnavailable(loc: string | undefined): boolean {
        if (!loc) return false;
        const battleArmorLoc = this.battleArmorTrooperLocation(loc);
        if (battleArmorLoc) return this.isArmorLocCommittedDestroyed(battleArmorLoc, false);
        return this.isInternalLocCommittedDestroyed(loc);
    }

    private battleArmorTrooperLocation(loc: string): string | null {
        if (this.getUnit().subtype !== 'Battle Armor') return null;
        return getBattleArmorTrooperNumber(loc) === null
            ? null
            : normalizeBattleArmorTrooperLocation(loc);
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

    public customAmmoBvVariation = computed<number>(() => {
        if (!this.isLoaded()) return 0; // Ensure unit is loaded so that inventory and crits are available
        let bvVariation = 0;
        if (this.getUnit().type === 'Mek') {
            const crits = this.getCritSlots();
            for (const crit of crits) {
                if (crit.eq instanceof AmmoEquipment && crit.originalName && crit.originalName !== crit.name) {
                    const originalAmmo = this.dataService.findEquipment(crit.originalName) as AmmoEquipment | undefined;
                    if (originalAmmo) {
                        if (!originalAmmo.hasFixedBV() || !crit.eq.hasFixedBV()) {
                            continue; // Skip variable BV. TODO: need to be handle when we have BaseEntity
                        }
                        bvVariation += crit.eq.bv - originalAmmo.bv;
                    }
                }
            }
        } else {
            const inventory = this.getInventory();
            for (const item of inventory) {
                if (item.equipment instanceof AmmoEquipment && item.ammo && item.ammo !== item.name) {
                    const customAmmo = this.dataService.findEquipment(item.ammo) as AmmoEquipment | undefined;
                    if (customAmmo) {
                        if (!item.equipment.hasFixedBV() || !customAmmo.hasFixedBV()) {
                            continue; // Skip variable BV. TODO: need to be handle when we have BaseEntity
                        }
                        bvVariation += customAmmo.bv - item.equipment.bv;
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

    public tagBV = computed<number>(() => {
        return this.gameRules.calculateTagBVCost(this);
    });

    public c3Tax = computed<number>(() => {
        const c3Networks = this.force.c3Networks();
        const c3Tax = this.rules.calculateC3Tax(
            c3Networks,
            this.force.units(),
            this.force.c3TaxCalculator(),
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

    public getPreSkillBv = computed<number>(() => {
        return this.getBaseBv() + this.tagBV() + this.c3Tax() + this.externalStoresBv();
    });

    public pilotBV = computed<number>(() => {
        return this.getBv() - this.getPreSkillBv();
    });

    getBv = computed<number>(() => {
        return BVCalculatorUtil.calculateAdjustedBV(
            this.getUnit(),
            this.getPreSkillBv(),
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
            if (item instanceof MountedAmmo) {
                item.setAmmoState({ ammo: undefined, totalAmmo: item.originalTotalAmmo, consumed: 0 });
            } else if (item.consumed) {
                item.setAmmoState({ consumed: 0 });
            }
            if (item.states.size > 0) item.clearStateValues();
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
        this.reconcileRuleChecks();
        this.turnState().reconcileHeatSources();
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
        const heat = this.getHeat();
        const projection = this.turnState().heatProjection();
        if (heat.next === undefined) {
            if (!this.useAutomations()) return;
            this.setHeat(projection.projected);
        }
        this.state.consolidateHeat();
        if (this.useAutomations()) {
            this.turnState().acknowledgeHeatSources(projection.consumedDissipation);
        } else {
            this.turnState().settleHeatDissipationDeficit();
        }
    }
    
    public endTurn() {
        if (this.useAutomations() && (this.getHeat().next !== undefined || this.turnState().hasPendingHeatResolution())) {
            this.applyHeat();
        }
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
            if (this.isLoaded()) this.reconcileRuleChecks();
            this.reconcileInventoryControlSelection();
            this.syncInventoryControlSelectionSvg();
        }
    }

    public override serialize(): CBTSerializedUnit {
        const stateObj: CBTSerializedState = {
            crew: this.state.crew().map(crew => crew.serialize()),
            crits: this.state.critsForSerialization(),
            heat: { ...this.state.heat() },
            locations: this.state.locationsForSerialization(),
            modified: this.state.modified(),
            destroyed: this.state.destroyed(),
            conditions: this.state.conditionsForSerialization(),
            c3Position: this.state.c3Position() ?? undefined,
            inventory: this.state.inventoryForSerialization(),
            ruleChecks: Object.keys(this.state.ruleChecks()).length > 0
                ? structuredClone(this.state.ruleChecks())
                : undefined,
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
        this.state.ruleChecks.set(structuredClone(state.ruleChecks ?? {}));
        this.state.inventory.update(inventory => inventory.map(item => item.clone({ destroying: undefined })));
        
        if (state.inventory) {
            const inventoryData = Sanitizer.sanitizeArray(state.inventory, INVENTORY_SCHEMA);
            this.state.deserializeInventory(inventoryData);
        }
        const crewArr = (state.crew || []).map((crewData: SerializedCrewMember) => CrewMember.deserialize(crewData, this));
        this.state.crew.set(crewArr);
        if (state.c3Position) {
            this.state.c3Position.set(Sanitizer.sanitize(state.c3Position, C3_POSITION_SCHEMA));
        }
        const turnState = state.turnState
            ? Sanitizer.sanitize(state.turnState, TURN_STATE_SCHEMA)
            : undefined;
        this.state.turnState().update(turnState);
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
