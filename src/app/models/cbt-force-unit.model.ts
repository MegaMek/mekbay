// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { computed, createEnvironmentInjector, effect, type EffectRef, EnvironmentInjector, type Injector, isDevMode, runInInjectionContext, signal, type Signal, untracked, type WritableSignal } from '@angular/core';
import { Subject } from 'rxjs';
import { DataService } from '../services/data.service';
import { getUnitHeight, type UnitSummary, type UnitHeight } from "./unit-summary.model";
import type { UnitInitializerService } from '../services/unit-initializer.service';
import { MountedAmmo, MountedEquipment, MountedWeapon } from './mounted-equipment.model';
import { type CriticalSlot, type HeatProfile, type LocationData, type MekHitArc, type ViewportTransform, CRIT_SLOT_SCHEMA, HEAT_SCHEMA, LOCATION_SCHEMA, INVENTORY_SCHEMA, C3_POSITION_SCHEMA, TURN_STATE_SCHEMA, type CBTSerializedState, type CBTSerializedUnit, type CBTMekFallSource, type PendingEventInput, type RuleCheckOutcome, type SerializedCrewMember, type SerializedMekFallDamageRoll, type SerializedPendingMekFall, type SerializedPendingUnitCheck, type SerializedRuleCheck, committedConditionData, conditionsForSerialization, conditionsHasActive, conditionsHasCommittedActive, conditionsMapFromSerialization, normalizeConditionData, normalizeConditionKey } from './force-serialization';
import { ForceUnit } from './force-unit.model';
import type { ConditionData } from './force-unit-state.model';
import type { CBTForce } from './cbt-force.model';
import { UnitSvgService } from '../services/unit-svg.service';
import { CrewMember, DEAD_CREW_HIT_THRESHOLD, DEFAULT_GUNNERY_SKILL, DEFAULT_PILOTING_SKILL, getConsciousnessTarget, isCrewMemberAboard, isCrewMemberAvailable, type CrewMemberState, type SkillType } from './crew-member.model';
import { CBTForceUnitState } from './cbt-force-unit-state.model';
import { UnitSvgMekService } from '../services/unit-svg-mek.service';
import { UnitSvgAeroService } from '../services/unit-svg-aero.service';
import { UnitSvgInfantryService } from '../services/unit-svg-infantry.service';
import { UnitSvgVehicleService } from '../services/unit-svg-vehicle.service';
import { BVCalculatorUtil } from '../utils/bv-calculator.util';
import { AmmoEquipment, ArmorEquipment, isTorpedoAmmo, StructureEquipment } from './equipment.model';
import type { AmmoEquipment as AmmoEquipmentType } from './equipment.model';
import type { EquipmentFlag } from './equipment-flags.type';
import type { WeaponType } from './weapon-types.model';
import { C3Capabilities, type C3Component, C3NetworkType, C3Role } from './c3-network.model';
import { unitHasActiveC3DisruptingStealth } from './stealth-equipment.model';
import { getMotiveModeLabel, getMotiveModesOptionsByUnit, type MotiveModeOption, type MotiveModes } from './motiveModes.model';
import type { TurnState } from './turn-state.model';
import { Sanitizer } from '../utils/sanitizer.util';
import type { PSRCheck, UnitTypeRules } from './rules/unit-type-rules';
import { type InventoryControlRuntimeAmmoSelection, type InventoryControlRuntimeEntryState, type InventoryControlRuntimeRangeKey, type InventoryControlRuntimeSnapshot, type InventoryControlRuntimeTarget, type InventoryControlRuntimeTargetId } from './inventory-control-runtime-state.model';
import { CBTInventoryControlRuntime } from './cbt-inventory-control-runtime.model';
import { getMekLegLocations, getMekLocationParent, inferMekConfigFromLocations, MEK_REAR_ARMOR_LOCATIONS, type ArmorType } from './entity/types';
import { mekStructureDamageReceived, MEK_STRUCTURE_TYPE, type MekStructureKind } from '../utils/mek-structure-damage.util';
import { resolveMekFallArmorDamage, type MekFallArmorDamageResolution } from '../utils/mek-falling.util';
import { ARMOR_TYPE_FROM_BLK_CODE } from './entity/parsers/blk-codec';
import {
    createHandlerQueryContext,
    EquipmentInteractionRegistry,
    EquipmentInteractionRegistryService,
    type CriticalDelayedExplosionContext,
    type CriticalDelayedExplosionHandling,
} from '../services/equipment-interaction-registry.service';
import type { UnitHeatSource } from './rules/unit-type-rules';
import { resolveInventoryControlSelectedAmmoType, type InventoryControlDisplayData, type InventoryControlDisplayEffectOptions, type InventoryControlRules } from '../utils/inventory-control.util';
import { ToastService } from '../services/toast.service';
import { CBTAutomationToastService } from '../services/cbt-automation-toast.service';
import { getBattleArmorTrooperNumber, normalizeBattleArmorTrooperLocation } from './battle-armor-location.model';
import { CBTGameRulesService } from '../services/cbt-game-rules.service';
import type { C3DegradationSource, C3TargetingResolution, CBTGameRules, MekExplosionProtection } from './rules/game-rules';
import { OptionsService } from '../services/options.service';
import type { AutomationMode, CBTAutomationKey } from './options.model';
import { resolveSelectedInventoryWeaponHeat } from '../utils/inventory-control-heat.util';
import { parseInventoryComponentReference } from './inventory-component-reference.model';
import type { InventoryControlPhysicalDamageEffect } from '../utils/inventory-control-physical-damage.util';
import { uuidv7 } from '../utils/uuid.util';
import {
    createPilotDamageGroup,
    isHeatPilotDamageGroup,
    isImmediatePilotDamageGroup,
} from '../utils/pilot-damage-group.util';
import {
    combineEquipmentStatuses,
    type CriticalSlotStatusFacts,
    type EquipmentStatus,
    type EquipmentStatusFacts,
} from './equipment-status.model';
import { ENTRY_DISABLED_STATE_KEY, ENTRY_DISABLED_STATE_VALUE } from './rules/unit-type-rules';
import type { HeatDissipationState } from './rules/heat-management';
import { getMekLocationLabel } from './entity/types/mek';
import { UNIT_CHECK_KIND } from './unit-check.model';
import {
    isConsciousnessCheck,
    isConsciousnessRecoveryCheck,
    isConsciousnessSequenceCheck,
} from '../utils/unit-check.util';

export type EquipmentStatusSource = MountedEquipment | CriticalSlot;
export type EquipmentAction =
    | 'fire'
    | 'physical-attack'
    | 'activate'
    | 'change-mode'
    | 'provide-passive-effect'
    | 'configure-network';
export type EquipmentStateEdit = 'enable' | 'disable' | 'repair' | 'apply-damage';

export interface CBTEndTurnAutomationDecisions {
    heatAndDissipationResolution?: boolean;
    /** The end-turn coordinator has already completed this unit's phase. */
    phaseAlreadyEnded?: boolean;
}

export interface CBTInternalDamageContext {
    /** Present only for internal-explosion damage; records the protection used to resolve it. */
    readonly explosionProtection?: MekExplosionProtection;
    /** Whether Hardened Armor remained in the exact facing/location when this hit reached structure. */
    readonly hardenedArmorApplies?: boolean;
    /** Critical explosions retain the pilot-damage event that produced the internal hit. */
    readonly pilotDamageGroup?: string;
    /** The first composite pip shares a damage point already counted in the previous location. */
    readonly sharedCompositePip?: boolean;
    /** This hit already damaged armor in the same location and initiated its hull-breach resolution. */
    readonly armorDamagedBySameHit?: boolean;
    /** Hit-table arc for a possible through-armor critical. */
    readonly throughArmorHitArc?: MekHitArc;
}

export interface CBTModularArmorState {
    readonly hits: number;
    readonly points: number;
    readonly remaining: number;
}

export interface CBTMekFallDamageRoll {
    readonly hitLocationDice: readonly [number, number] | null;
    readonly tripodLegRoll: number | null;
}

export interface CBTHullBreachCheckResolution {
    readonly dice: readonly [number, number];
    readonly total: number;
    readonly breached: boolean;
}

/** Serialized event facts exposed to the dialog with explicit unrolled values. */
export type CBTPendingMekFall = Omit<
    SerializedPendingMekFall,
    'orientationRoll' | 'damageRolls'
> & {
    readonly orientationRoll: number | null;
    readonly damageRolls: readonly CBTMekFallDamageRoll[];
};

function fallDamageRollForDialog(roll: SerializedMekFallDamageRoll): CBTMekFallDamageRoll {
    return {
        hitLocationDice: roll.hitLocationDice ?? null,
        tripodLegRoll: roll.tripodLegRoll ?? null,
    };
}

function rollD6(random: () => number): number {
    return Math.floor(random() * 6) + 1;
}

export type CBTUnitAutomationTrigger =
    | {
        readonly kind: 'critical-hit-chance';
        readonly id: string;
    }
    | {
        readonly kind: 'pending-unit-check';
    }
    | {
        readonly kind: 'falling';
        readonly id: string;
        readonly source: CBTMekFallSource;
        readonly levelsFallen: number;
    }
    | {
        readonly kind: 'breach-and-flood';
        readonly id: string;
        readonly locations: readonly string[];
        readonly commit: boolean;
    }
    | {
        readonly kind: 'hull-breach-check';
        readonly id: string;
        readonly location: string;
        readonly commit: boolean;
    };

export class CBTForceUnit extends ForceUnit {
    override get force(): CBTForce { return super.force as CBTForce; }
    override set force(value: CBTForce) { super.force = value; }
    private loadingPromise: Promise<void> | null = null;
    svg: WritableSignal<SVGSVGElement | null> = signal(null); // SVG representation of the unit
    private _svgService: UnitSvgService | null = null;
    private svgServiceInjector: EnvironmentInjector | null = null;
    private optionalRulesEffect: EffectRef | null = null;
    private readonly unknownEquipmentInstallationLocationIds = new Set<string>();
    private readonly reviewedFloodLocations = new Set<string>();
    private _rules!: UnitTypeRules;
    readonly automationTriggers = new Subject<CBTUnitAutomationTrigger>();
    /** Provisional PSR choices retained across dialog instances; intentionally not serialized. */
    readonly psrOutcomeSelections = signal<Readonly<Record<string, RuleCheckOutcome>>>({});
    /** Exact virtual PSR dice retained alongside provisional outcomes. */
    readonly psrDiceSelections = signal<Readonly<Record<string, readonly [number, number]>>>({});
    readonly pendingFallCount = computed(() => this.turnState().pendingFallCount());
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
    
    constructor(unit: UnitSummary,
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

    getHeight(): UnitHeight {
        return getUnitHeight(this.getUnit(), this.getCondition('prone'));
    }

    automationMode(key: CBTAutomationKey): AutomationMode {
        return this.injector.get(OptionsService).cbtAutomationMode(key);
    }

    tracksPhaseAndTurn(): boolean {
        return this.injector.get(OptionsService).options().trackPhaseAndTurn;
    }

    allowsExtremeRangeAttacks(): boolean {
        return this.injector.get(OptionsService, null, { optional: true })?.options().CBTOptionalRules?.extremeRange ?? false;
    }

    usesForcedWithdrawal(): boolean {
        return this.injector.get(OptionsService, null, { optional: true })?.options().CBTOptionalRules?.forcedWithdrawal ?? true;
    }

    usesFloatingCriticals(): boolean {
        return this.injector.get(OptionsService, null, { optional: true })?.options().CBTOptionalRules?.floatingCriticals ?? false;
    }

    private getEquipmentInteractionRegistry(): EquipmentInteractionRegistry {
        return this.injector.get(EquipmentInteractionRegistryService).getRegistry();
    }

    getEquipmentHeatSources(turnState: TurnState): UnitHeatSource[] {
        if (this.getCondition('shutdown')) return [];
        return this.getEquipmentInteractionRegistry().getInventoryHeatSources(
            this.getInventory(),
            turnState,
            this.getHandlerQueryContext(),
        );
    }

    getRunMovementMultiplierBonus(turnState: TurnState): number {
        if (this.getCondition('shutdown')) return 0;
        return this.getEquipmentInteractionRegistry().getRunMovementMultiplierBonus(
            this.getInventory(),
            turnState,
            this.getHandlerQueryContext(),
        );
    }

    getEquipmentHeatDissipationBonus(dissipation: HeatDissipationState): number {
        return this.getEquipmentInteractionRegistry().getHeatDissipationBonus(
            this.getInventory(),
            dissipation,
            this.getHandlerQueryContext(),
        );
    }

    getInventoryControlRules(): InventoryControlRules {
        const equipmentRules = this.injector.get(EquipmentInteractionRegistryService)
            .getRegistry()
            .inventoryControlRules(this.getHandlerQueryContext());
        return {
            ...equipmentRules,
            applyDisplayEffects: (entry, display, options) => {
                const unitDisplay = this.rules.applyInventoryControlDisplayEffects(entry, display);
                return equipmentRules.applyDisplayEffects?.(entry, unitDisplay, options) ?? unitDisplay;
            },
        };
    }

    isInventoryWeaponUsableInWater(entry: MountedEquipment, selectedAmmo?: AmmoEquipment | null): boolean {
        if (!(entry instanceof MountedWeapon) || entry.isPhysicalWeapon() || !this.isEquipmentSubmerged(entry)) return true;
        return entry.equipment?.hasFlag('F_ENERGY') === true
            || isTorpedoAmmo(selectedAmmo);
    }

    /** Canonical status/profile-aware weapon types for domain rule evaluation. */
    getEffectiveWeaponTypes(entry: MountedWeapon): ReadonlySet<WeaponType> {
        const baseTypes = new Set(entry.getWeaponTypes(this.getInventoryControlSelectedAmmo(entry)));
        return this.getEquipmentInteractionRegistry().applyWeaponTypes(
            entry,
            baseTypes,
            this.getHandlerQueryContext(),
        );
    }

    getCriticalDelayedExplosion(
        hitEntry: MountedEquipment,
        context: CriticalDelayedExplosionContext,
    ): CriticalDelayedExplosionHandling | null {
        return this.getEquipmentInteractionRegistry().getCriticalDelayedExplosion(
            hitEntry,
            context,
            this.getHandlerQueryContext(),
        );
    }

    /** Canonical equipment-aware physical damage inputs for domain rule evaluation. */
    getEffectivePhysicalDamageEffect(
        entry: MountedEquipment,
        effect: InventoryControlPhysicalDamageEffect
    ): InventoryControlPhysicalDamageEffect {
        return this.getEquipmentInteractionRegistry().applyInventoryControlPhysicalDamageEffects(
            entry,
            effect,
            this.getHandlerQueryContext(),
        );
    }

    getInventoryControlSelectedAmmo(entry: MountedEquipment, mode?: string | null): AmmoEquipmentType | null {
        const selection = this.getInventoryControlEntryAmmoSelection(entry.id);
        return resolveInventoryControlSelectedAmmoType(
            entry,
            this.getEquipmentRegistry(),
            (weapon, ammo, selectedMode) => this.matchesInventoryControlAmmo(weapon, ammo, selectedMode),
            selection,
            mode,
        );
    }

    matchesInventoryControlAmmo(entry: MountedEquipment, ammo: AmmoEquipmentType, mode: string | null): boolean | null {
        return this.getEquipmentInteractionRegistry().matchesInventoryAmmo(
            entry,
            ammo,
            mode,
            this.getHandlerQueryContext(),
        );
    }

    private getHandlerQueryContext() {
        return createHandlerQueryContext(this.getEquipmentRegistry());
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
        this.inventoryControl.markAmmoSourcesChanged();
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
            if (isDevMode()) this.reportUnknownDirectInventoryInstallationLocations();
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
            if (condition === 'prone') this.applyUnderwaterBreachAndFlooding();
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
        this.inventoryControl.markAmmoSourcesChanged();
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
        if (slot.destroyed !== undefined && !destroying) {
            slot.destroyed = undefined; // Reset destroyed immediately
            slot.destroyedTurn = undefined;
        }
        this.setCritSlot(slot);
        if (consolidateImmediately) {
            this.dispatchBeforeEquipmentStateCommit();
            this.state.consolidateCrits(); // Consolidate immediately in case we have pending hits to apply
            this.inventoryControl.markAmmoSourcesChanged();
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
            .filter(entry => this.isEquipmentOperational(entry));
    }

    setInventory(inventory: MountedEquipment[], initialization: boolean = false) {
        this.state.inventory.set(MountedEquipment.fromAll(inventory));
        if (this.isLoaded() && isDevMode()) this.reportUnknownDirectInventoryInstallationLocations();
        this.turnState().reconcileHeatSources();
        if (!initialization) {
            this.turnState().clampMoveDistanceToCurrentModeRange();
        }
        this.inventoryControl.markAmmoSourcesChanged();
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

    getInventoryControlEntryAmmoSelection(entryId: string): InventoryControlRuntimeAmmoSelection | undefined {
        return this.inventoryControlRuntime.getEntryAmmoSelection(entryId);
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

    setInventoryControlEntryAmmoSelection(entryId: string, selection: InventoryControlRuntimeAmmoSelection): void {
        this.inventoryControlRuntime.setEntryAmmoSelection(entryId, selection);
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
        return !!mount && this.isEquipmentOperational(mount);
    }

    private hasActiveC3DisruptingStealth(): boolean {
        return unitHasActiveC3DisruptingStealth(this);
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
            this.markEquipmentLocationsChanged();
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

    addArmorHits(
        loc: string,
        hits: number,
        rear?: boolean,
        consolidateImmediately: boolean = false,
    ): number {
        const armorPoints = this.getArmorPoints(loc, rear);
        const previousHits = Math.min(armorPoints, Math.max(0, this.getArmorHits(loc, rear)));
        const currentHits = Math.min(armorPoints, Math.max(0, previousHits + hits));
        const damageReceived = this.getArmorTypeAt(loc) === 'HARDENED'
            ? Math.floor(currentHits / 2) - Math.floor(previousHits / 2)
            : currentHits - previousHits;
        this.recordArmorHits(
            loc,
            hits,
            rear,
            consolidateImmediately,
            damageReceived,
            damageReceived > 0,
        );
        return damageReceived;
    }

    /** Applies one physical non-attack hit using the selected ruleset and records its exact phase damage. */
    applyMekFallArmorDamage(
        loc: string,
        damage: number,
        rear: boolean,
        consolidateImmediately: boolean,
    ): MekFallArmorDamageResolution {
        const remainingArmor = Math.max(0, this.getArmorPoints(loc, rear) - this.getArmorHits(loc, rear));
        const resolution = resolveMekFallArmorDamage(
            this.gameRules.id,
            damage,
            remainingArmor,
            this.getArmorTypeAt(loc),
        );
        if (resolution.armorDamage > 0) {
            this.recordArmorHits(
                loc,
                resolution.armorDamage,
                rear,
                consolidateImmediately,
                resolution.appliedDamage,
                resolution.appliedDamage > 0,
            );
        }
        return resolution;
    }

    private recordArmorHits(
        loc: string,
        hits: number,
        rear: boolean | undefined,
        consolidateImmediately: boolean,
        damageReceived: number,
        armorDamageApplied: boolean,
    ): void {
        const locKey = rear ? `${loc}-rear` : loc;
        const locations = { ...this.state.locations() };

        if (locations[locKey] === undefined) {
            locations[locKey] = {};
        }
        if (typeof locations[locKey].pendingArmor !== 'number') {
            locations[locKey].pendingArmor = 0;
        }
        locations[locKey].pendingArmor += hits;
        this.state.locations.set({ ...this.state.locations(), [locKey]: locations[locKey] });
        this.markEquipmentLocationsChanged();
        this.state.turnState().addDmgReceived(damageReceived);
        if (consolidateImmediately) this.state.consolidateLocations();
        else this.applyUnderwaterBreachAndFlooding();
        if (armorDamageApplied) this.applyUnderwaterHullBreachCheck(loc, consolidateImmediately);
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
        this.markEquipmentLocationsChanged();
        this.applyUnderwaterBreachAndFlooding(true);
        this.evaluateDestroyed();
        this.setModified();
    }

    getModularArmorState(loc: string): CBTModularArmorState {
        let hits = 0;
        let points = 0;
        for (const slot of this.getCritSlots()) {
            if (slot.loc !== loc || slot.destroyed || !slot.eq?.flags?.has('F_MODULAR_ARMOR')) continue;
            points += 10;
            hits += Math.min(10, Math.max(0, slot.consumed ?? 0));
        }
        return { hits, points, remaining: points - hits };
    }

    /** Applies or repairs modular armor and returns the signed record change actually made. */
    addModularArmorHits(loc: string, hits: number): number {
        if (!Number.isFinite(hits)) return 0;
        let remaining = Math.abs(Math.trunc(hits));
        if (remaining === 0) return 0;
        const applyingDamage = hits > 0;
        const crits = [...this.getCritSlots()];

        for (let index = 0; index < crits.length && remaining > 0; index++) {
            const slot = crits[index];
            if (slot.loc !== loc || slot.destroyed || !slot.eq?.flags?.has('F_MODULAR_ARMOR')) continue;
            const consumed = Math.min(10, Math.max(0, slot.consumed ?? 0));
            const change = Math.min(remaining, applyingDamage ? 10 - consumed : consumed);
            if (change === 0) continue;
            crits[index] = { ...slot, consumed: consumed + (applyingDamage ? change : -change) };
            remaining -= change;
        }

        const applied = Math.abs(Math.trunc(hits)) - remaining;
        if (applied === 0) return 0;
        const signedApplied = applyingDamage ? applied : -applied;
        this.setCritSlots(crits);
        this.state.turnState().addDmgReceived(signedApplied);
        return signedApplied;
    }

    getInternalPoints(loc: string): number {
        return this.locations?.internal.get(loc)?.points || 0;
    }

    getInternalHits(loc: string): number {
        const locData = this.state.locations()[loc];
        return (locData?.internal ?? 0) + (locData?.pendingInternal ?? 0);
    }

    /** Queues one rules-generated critical chance unless that automation is disabled. */
    queueMekCriticalChance(
        location: string,
        options: CBTInternalDamageContext & {
            readonly locationDestroyed?: boolean;
            readonly consolidateImmediately?: boolean;
        } = {},
    ): boolean {
        if (this.getUnit().type !== 'Mek'
            || !location
            || this.automationMode('criticalHitChanceCheck') === 'no') return false;
        const id = uuidv7();
        const queued = this.turnState().queuePendingCriticalChance({
            id,
            location,
            ...(options.locationDestroyed ? { locationDestroyed: true } : {}),
            ...(options.consolidateImmediately ? { consolidateImmediately: true } : {}),
            ...(options.explosionProtection !== undefined
                ? { explosionProtection: options.explosionProtection }
                : {}),
            ...(options.hardenedArmorApplies !== undefined
                ? { hardenedArmorApplies: options.hardenedArmorApplies }
                : {}),
            ...(options.throughArmorHitArc !== undefined
                ? { throughArmorHitArc: options.throughArmorHitArc }
                : {}),
            pilotDamageGroup: options.pilotDamageGroup
                ?? this.turnState().currentPilotDamageGroup(),
        });
        if (queued) this.automationTriggers.next({ kind: 'critical-hit-chance', id });
        return queued;
    }

    addInternalHits(
        loc: string,
        hits: number,
        consolidateImmediately: boolean = false,
        context: CBTInternalDamageContext = {},
    ): number {
        const previousHits = this.getInternalHits(loc);
        const internalPoints = this.getInternalPoints(loc);
        const structureKind = this.getStructureKindAt(loc);
        const previousDamageReceived = mekStructureDamageReceived(
            internalPoints,
            Math.min(internalPoints, Math.max(0, previousHits)),
            structureKind,
        );
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
        this.markEquipmentLocationsChanged();
        this._rules.evaluateLegDestroyed(loc, hits);
        this.clearNarcFromCommittedPhysicallyDestroyedLocations();
        this.evaluateDestroyed();
        this.setModified();
        const boundedPreviousHits = Math.min(internalPoints, Math.max(0, previousHits));
        const boundedCurrentHits = Math.min(internalPoints, Math.max(0, this.getInternalHits(loc)));
        const appliedDamage = boundedCurrentHits - boundedPreviousHits;
        // Core counts every Composite structure pip destroyed by an internal explosion toward the damage PSR.
        const countsExplosionPips = this.gameRules.id === 'core2026'
            && context.explosionProtection !== undefined
            && structureKind === 'composite';
        let phaseDamage = countsExplosionPips
            ? appliedDamage
            : mekStructureDamageReceived(internalPoints, boundedCurrentHits, structureKind) - previousDamageReceived;
        if (!countsExplosionPips
            && context.sharedCompositePip
            && structureKind === 'composite'
            && appliedDamage > 0) {
            phaseDamage -= mekStructureDamageReceived(
                internalPoints,
                Math.min(boundedCurrentHits, boundedPreviousHits + 1),
                structureKind,
            ) - previousDamageReceived;
        }
        this.state.turnState().addDmgReceived(phaseDamage);
        // A single assignment is one hit/event, regardless of how many structure pips it marks.
        if (appliedDamage > 0) {
            if (!context.armorDamagedBySameHit) {
                this.applyUnderwaterBreachAndFlooding(consolidateImmediately);
                this.applyUnderwaterHullBreachCheck(loc, consolidateImmediately);
            }
            this.queueMekCriticalChance(loc, {
                ...context,
                locationDestroyed: boundedCurrentHits >= internalPoints,
                consolidateImmediately,
            });
        }
        return phaseDamage;
    }

    setInternalHits(loc: string, hits: number) {
        const locations = { ...this.state.locations() };
        if (locations[loc] === undefined) {
            locations[loc] = {};
        }
        locations[loc].internal = hits;
        locations[loc].pendingInternal = undefined;
        this.state.locations.set({ ...this.state.locations(), [loc]: locations[loc] });
        this.markEquipmentLocationsChanged();
        this.clearNarcFromCommittedPhysicallyDestroyedLocations();
        this.evaluateDestroyed();
        this.setModified();
    }

    private markEquipmentLocationsChanged(): void {
        this.inventoryControl.markAmmoSourcesChanged();
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

    setLocationCondition(loc: string, condition: string, active: boolean, commit = false): void {
        const normalizedCondition = this.normalizeLocationCondition(condition);
        if (!loc || !normalizedCondition) return;
        const conditions = conditionsMapFromSerialization(this.state.locations()[loc]?.conditions);
        const currentActive = conditionsHasActive(conditions, normalizedCondition);
        if (currentActive === active) return;
        const existing = conditions.get(normalizedCondition);
        if (active) {
            conditions.set(normalizedCondition, commit || conditions.has(normalizedCondition)
                ? committedConditionData(existing)
                : { pending: true });
        } else {
            conditions.delete(normalizedCondition);
        }
        this.writeLocationConditions(loc, conditions);
        if (normalizedCondition === 'blown-off') {
            this._rules.evaluateLegDestroyed(loc, active ? 1 : -1);
        } else if (normalizedCondition === 'flooded') {
            this._rules.evaluateLocationFlooded(loc, active);
        }
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

    getActiveNarcWaterLayers(): { aboveWater: boolean; underwater: boolean } {
        let aboveWater = false;
        let underwater = false;
        for (const loc of Object.keys(this.state.locations())) {
            if (!this.getLocationCondition(loc, 'narc') || this.isInternalLocCommittedPhysicallyDestroyed(loc)) continue;
            if (this.isLocationSubmerged(loc)) underwater = true;
            else aboveWater = true;
        }
        return { aboveWater, underwater };
    }

    isEquipmentSubmerged(entry: MountedEquipment): boolean {
        if (this.getUnit().type !== 'Mek') return false;
        if (this.turnState().submerged()) return true;
        if (!this.turnState().partiallyUnderwater()) return false;

        const location = parseInventoryComponentReference(entry.id)?.location
            ?? entry.locations?.values().next().value;
        return location !== undefined && this.isLocationSubmerged(location);
    }

    private isLocationSubmerged(location: string): boolean {
        if (this.getUnit().type !== 'Mek') return false;
        if (this.turnState().submerged()) return true;
        if (!this.turnState().partiallyUnderwater()) return false;

        const legLocations = new Set<string>(getMekLegLocations(
            inferMekConfigFromLocations(this.locations?.internal.keys() ?? []),
        ));
        return location.split('/').some(loc => legLocations.has(loc.trim()));
    }

    private isFloodableLocation(location: string): boolean {
        const internalLocations = this.locations?.internal;
        if (!internalLocations?.has(location) || this.getLocationCondition(location, 'blown-off')) return false;
        const structurallyDestroyed = this.isInternalLocStructurallyDestroyed(location);
        // A location destroyed only through its parent is detached. A location whose own
        // structure is destroyed remains eligible when its armor also satisfies the rule.
        return structurallyDestroyed || !this.isInternalLocPhysicallyDestroyed(location);
    }

    private isLocationArmorDepletedForFlooding(location: string, commit: boolean): boolean {
        const armorLocations = this.locations?.armor;
        if (!armorLocations) return false;
        const armorByFacing = new Map(
            Array.from(armorLocations.values())
                .filter(armor => armor.loc === location)
                .map(armor => [armor.rear, armor] as const),
        );
        const armorFacings = MEK_REAR_ARMOR_LOCATIONS.has(location) ? [false, true] : [false];
        return armorFacings.some(rear => {
            const armor = armorByFacing.get(rear);
            const armorHits = commit
                ? this.getCommittedArmorHits(location, rear)
                : this.getArmorHits(location, rear);
            return !armor || armorHits >= this.getArmorPoints(location, rear);
        });
    }

    /** Initiates the per-damaging-hit hull-breach check for an armored submerged location. */
    applyUnderwaterHullBreachCheck(location: string, commit = false): void {
        const mode = this.automationMode('breachAndFloodCheck');
        if (mode === 'no'
            || this.getUnit().type !== 'Mek'
            || !this.isLocationSubmerged(location)
            || !this.isFloodableLocation(location)
            || this.getLocationCondition(location, 'flooded')
            || this.isLocationArmorDepletedForFlooding(location, commit)) return;

        if (mode === 'yes') {
            this.resolveUnderwaterHullBreachCheck(location, commit);
            return;
        }
        if (!this.automationTriggers.observed) return;
        this.automationTriggers.next({
            kind: 'hull-breach-check',
            id: uuidv7(),
            location,
            commit,
        });
    }

    /** Rolls and applies one previously established hull-breach check. */
    resolveUnderwaterHullBreachCheck(
        location: string,
        commit = false,
        random: () => number = Math.random,
    ): CBTHullBreachCheckResolution | null {
        if (this.getUnit().type !== 'Mek'
            || !this.isFloodableLocation(location)
            || this.getLocationCondition(location, 'flooded')) return null;

        const dice = [rollD6(random), rollD6(random)] as const;
        const total = dice[0] + dice[1];
        const breached = this.gameRules.hullBreachCheckSucceeds(total);
        if (breached) this.setLocationCondition(location, 'flooded', true, commit);

        const locationLabel = getMekLocationLabel(location) ?? location;
        const breachRange = this.gameRules.getHullBreachCheckRangeLabel();
        this.injector.get(CBTAutomationToastService).show(
            this,
            `Hull breach check: ${locationLabel} ${breached ? 'breached and flooded' : 'held'} (${total} on 2D6; breach on ${breachRange})`,
            breached ? 'error' : 'success',
        );
        return { dice, total, breached };
    }

    applyUnderwaterBreachAndFlooding(commit = false): void {
        const internalLocations = this.locations?.internal;
        const armorLocations = this.locations?.armor;
        const submerged = this.turnState().submerged();
        const partiallyUnderwater = this.turnState().partiallyUnderwater();
        if (this.getUnit().type !== 'Mek' || !internalLocations || !armorLocations) {
            this.reviewedFloodLocations.clear();
            return;
        }
        if (!submerged && !partiallyUnderwater) {
            this.reviewedFloodLocations.clear();
            return;
        }

        const submergedLocations = submerged
            ? Array.from(internalLocations.keys())
            : getMekLegLocations(inferMekConfigFromLocations(internalLocations.keys()));
        const eligibleLocations: string[] = [];
        for (const loc of submergedLocations) {
            if (!this.isFloodableLocation(loc)) continue;
            if (this.isLocationArmorDepletedForFlooding(loc, commit)
                && !this.getLocationCondition(loc, 'flooded')) eligibleLocations.push(loc);
        }

        const eligible = new Set(eligibleLocations);
        for (const loc of this.reviewedFloodLocations) {
            if (!eligible.has(loc)) this.reviewedFloodLocations.delete(loc);
        }

        const mode = this.automationMode('breachAndFloodCheck');
        if (mode !== 'ask') this.reviewedFloodLocations.clear();
        if (mode === 'yes') {
            for (const loc of eligibleLocations) this.setLocationCondition(loc, 'flooded', true, commit);
            if (eligibleLocations.length > 0) {
                const locations = eligibleLocations
                    .map(loc => getMekLocationLabel(loc) ?? loc)
                    .join(', ');
                this.injector.get(CBTAutomationToastService).show(
                    this,
                    `Breach and flooding: ${locations} flooded`,
                    'error',
                );
            }
            return;
        }
        if (mode === 'no') return;

        const reviewLocations = eligibleLocations.filter(loc => !this.reviewedFloodLocations.has(loc));
        if (reviewLocations.length === 0) return;
        // A review is not pending until a viewer can actually receive it. This keeps
        // an unvisited unit retryable when its sheet is opened later.
        if (!this.automationTriggers.observed) return;
        reviewLocations.forEach(loc => this.reviewedFloodLocations.add(loc));
        this.automationTriggers.next({
            kind: 'breach-and-flood',
            id: uuidv7(),
            locations: reviewLocations,
            commit,
        });
    }

    deferUnderwaterBreachAndFloodingReview(locations: readonly string[]): void {
        for (const location of locations) this.reviewedFloodLocations.delete(location);
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

    getEquipmentStatus(source: EquipmentStatusSource): EquipmentStatus {
        if (!(source instanceof MountedEquipment)) return this.getCriticalSlotStatus(source);

        const facts = this.buildCurrentEquipmentStatusFacts(source);
        return combineEquipmentStatuses([
            facts.mountState,
            ...facts.locationStates.values(),
            this.rules.getMountedCriticalStatusContribution(facts),
            this.rules.getEquipmentStatusContribution(facts),
        ]);
    }

    getEquipmentInstallationLocationStatus(entry: MountedEquipment): EquipmentStatus {
        const criticalSlots = this.getCurrentCriticalSlots(entry);
        const locations = this.getEquipmentInstallationLocations(entry, criticalSlots);
        return combineEquipmentStatuses(locations.map(location => this.getEquipmentLocationStatus(location)));
    }

    getEquipmentStatusAtLocation(entry: MountedEquipment, location: string): EquipmentStatus {
        const criticalSlots = this.getCurrentCriticalSlots(entry)
            .filter(slot => slot.loc === location);
        const facts = this.buildEquipmentStatusFacts(entry, criticalSlots, [location]);
        return combineEquipmentStatuses([
            facts.mountState,
            ...facts.locationStates.values(),
            this.rules.getMountedCriticalStatusContribution(facts),
            this.rules.getEquipmentStatusContributionAtLocation(facts, location),
        ]);
    }

    getEquipmentLocationStatus(location: string): EquipmentStatus {
        if (!location) return 'available';
        const battleArmorLoc = this.battleArmorTrooperLocation(location);
        if (battleArmorLoc) {
            return this.isArmorLocCommittedDestroyed(battleArmorLoc, false) ? 'destroyed' : 'available';
        }
        if (this.isInternalLocCommittedPhysicallyDestroyed(location)) return 'destroyed';
        if (this.isInternalLocCommittedDestroyed(location)) return 'disabled';
        return 'available';
    }

    isEquipmentOperational(source: EquipmentStatusSource): boolean {
        return this.getEquipmentStatus(source) === 'available';
    }

    isEquipmentOperationalAtLocation(entry: MountedEquipment, location: string): boolean {
        return this.getEquipmentStatusAtLocation(entry, location) === 'available';
    }

    isEquipmentResolvedDestroyed(entry: MountedEquipment): boolean {
        if (this.getEquipmentInstallationLocationStatus(entry) === 'destroyed') return true;
        if (entry.isRepairing()) return false;
        return entry.isDestroying() || this.getEquipmentStatus(entry) === 'destroyed';
    }

    isEquipmentResolvedCommittedDestroyed(entry: MountedEquipment): boolean {
        return this.getEquipmentInstallationLocationStatus(entry) === 'destroyed'
            || (!entry.isRepairing() && this.getEquipmentStatus(entry) === 'destroyed');
    }

    canTakeActiveActions(): boolean {
        return !this.destroyed
            && !this.getCondition('shutdown')
            && (this.rules.isRemoteDrone() || this.rules.getActivePilotCrewId() !== null);
    }

    canPerformEquipmentAction(entry: MountedEquipment, action: EquipmentAction): boolean {
        if (this.hasActiveC3DisruptingStealth()
            && (entry.equipment?.flags.has('F_BAP') || entry.equipment?.flags.has('F_BLOODHOUND'))
            && (action === 'activate' || action === 'change-mode' || action === 'provide-passive-effect')) {
            return false;
        }
        if (action === 'configure-network') {
            const component = new C3Capabilities(this).components.find(candidate => candidate.mount === entry);
            if (!component || !this.isC3ComponentOperational(component.index, component)) return false;
        } else if (!this.isEquipmentOperational(entry) || this.destroyed || this.getCondition('shutdown')) {
            return false;
        }
        if (action !== 'provide-passive-effect' && !this.canTakeActiveActions()) return false;
        if (action === 'physical-attack' && this.isPhysicalActionUnavailable(entry)) return false;
        if (action === 'fire' && !this.isInventoryWeaponUsableInWater(entry, this.getInventoryControlSelectedAmmo(entry))) return false;
        return this.rules.canPerformEquipmentAction(entry, action);
    }

    canEditEquipmentState(entry: MountedEquipment, edit: EquipmentStateEdit): boolean {
        if (this.readOnly()) return false;
        const status = this.getEquipmentStatus(entry);
        switch (edit) {
            case 'enable':
                return status === 'disabled';
            case 'disable':
                return status === 'available';
            case 'repair':
                return this.getEquipmentInstallationLocationStatus(entry) !== 'destroyed'
                    && (entry.isDestroying() || (entry.committedDestroyed() && !entry.isRepairing()));
            case 'apply-damage':
                return !this.isEquipmentResolvedDestroyed(entry);
        }
    }

    applyEquipmentDamage(entry: MountedEquipment): boolean {
        if (!this.canEditEquipmentState(entry, 'apply-damage')) return false;
        if (!entry.setPendingDestroyed(true)) return false;
        this.setInventoryEntry(entry);
        return true;
    }

    repairEquipment(entry: MountedEquipment): boolean {
        if (!this.canEditEquipmentState(entry, 'repair')) return false;
        if (!entry.setPendingDestroyed(false)) return false;
        this.setInventoryEntry(entry);
        return true;
    }

    findCurrentCriticalSlot(slot: CriticalSlot): CriticalSlot | null {
        const matches = this.getCritSlots().filter(candidate => {
            if (slot.loc && slot.slot !== undefined) return candidate.loc === slot.loc && candidate.slot === slot.slot;
            return !!slot.id && candidate.id === slot.id;
        });
        if (matches.length > 1) {
            throw new Error(`Duplicate critical-slot identity: ${slot.loc ?? slot.id}:${slot.slot ?? ''}`);
        }
        return matches[0] ?? null;
    }

    private getCriticalSlotStatus(snapshot: CriticalSlot): EquipmentStatus {
        const slot = this.findCurrentCriticalSlot(snapshot);
        if (!slot) return 'available';
        const locationState = this.getEquipmentLocationStatus(slot.loc ?? '');
        const slotState: EquipmentStatus = slot.destroyed ? 'destroyed' : 'available';
        const facts: CriticalSlotStatusFacts = {
            equipment: slot.eq ?? null,
            equipmentId: slot.id ?? slot.name ?? '',
            slotState,
            locationState,
            unitSystemFacts: this.rules.getUnitSystemStatusFacts(),
        };
        return combineEquipmentStatuses([
            slotState,
            locationState,
            this.rules.getCriticalSlotStatusContribution(facts),
        ]);
    }

    private getCurrentCriticalSlots(entry: MountedEquipment): CriticalSlot[] {
        return entry.critSlots?.flatMap(slot => this.findCurrentCriticalSlot(slot) ?? []) ?? [];
    }

    private getEquipmentInstallationLocations(entry: MountedEquipment, criticalSlots: readonly CriticalSlot[]): string[] {
        const componentRef = parseInventoryComponentReference(entry.id);
        const referenceLocation = componentRef && this.isKnownEquipmentInstallationLocation(componentRef.location)
            ? componentRef.location
            : undefined;
        const indexedComponent = componentRef === null ? undefined : this.getUnit().comp[componentRef.componentIndex];
        const componentLocation = referenceLocation === undefined
            && indexedComponent
            && this.isInventoryComponentForEntry(indexedComponent, entry)
            ? indexedComponent.l
            : undefined;
        const rawLocations = [
            ...criticalSlots.flatMap(slot => slot.loc ? [slot.loc] : []),
            ...(entry.locations ?? []),
            ...(referenceLocation ? [referenceLocation] : []),
            ...(componentLocation ? [componentLocation] : []),
        ];
        const locations = [...new Set(rawLocations
            .flatMap(location => location.split('/'))
            .map(location => this.normalizeEquipmentInstallationLocation(location))
            .filter((location): location is string => location !== null))];
        if (locations.length > 0) return locations;

        if (entry.parent) {
            const parentLocations = this.getEquipmentInstallationLocations(
                entry.parent,
                this.getCurrentCriticalSlots(entry.parent),
            );
            if (parentLocations.length > 0) return parentLocations;
        }

        return locations;
    }

    private isInventoryComponentForEntry(component: UnitSummary['comp'][number], entry: MountedEquipment): boolean {
        return component.eq === entry.equipment
            || component.id === entry.equipment?.internalName
            || component.id === entry.name
            || component.n === entry.name;
    }

    private isKnownEquipmentInstallationLocation(location: string): boolean {
        const normalizedLocations = location.split('/')
            .map(candidate => this.normalizeEquipmentInstallationLocation(candidate))
            .filter((candidate): candidate is string => candidate !== null);
        if (normalizedLocations.length === 0) return false;

        const metadataLocations = new Set(this.getUnit().comp
            .flatMap(component => component.l?.split('/') ?? [])
            .map(candidate => this.normalizeEquipmentInstallationLocation(candidate))
            .filter((candidate): candidate is string => candidate !== null));
        const structuralLocations = new Set([
            ...(this.locations?.internal.keys() ?? []),
            ...Array.from(this.locations?.armor.values() ?? []).map(candidate => candidate.loc),
        ]);
        return normalizedLocations.every(candidate =>
            metadataLocations.has(candidate) || structuralLocations.has(candidate));
    }

    private normalizeEquipmentInstallationLocation(location: string): string | null {
        const normalized = location.trim();
        if (!normalized || normalized === '—') return null;
        return this.battleArmorTrooperLocation(normalized) ?? normalized;
    }

    private reportUnknownDirectInventoryInstallationLocations(): void {
        if (!this.hasDirectInventory()) return;
        for (const entry of this.getInventory()) {
            const componentRef = parseInventoryComponentReference(entry.id);
            const locations = this.getEquipmentInstallationLocations(entry, this.getCurrentCriticalSlots(entry));
            if (locations.length === 0) {
                this.reportUnknownDirectInventoryInstallationLocation(entry, componentRef);
            }
        }
    }

    private reportUnknownDirectInventoryInstallationLocation(
        entry: MountedEquipment,
        componentRef: ReturnType<typeof parseInventoryComponentReference>,
    ): void {
        if (entry.isIntrinsicPhysicalAttack() || !entry.equipment
            || this.unknownEquipmentInstallationLocationIds.has(entry.id)) return;
        this.unknownEquipmentInstallationLocationIds.add(entry.id);
        const componentLabel = componentRef === null ? '' : ` (component ${componentRef.componentIndex})`;
        console.warn(
            `Unable to resolve installation location for direct inventory equipment "${entry.id}"`
            + `${componentLabel} on ${this.getUnit().name}.`
        );
    }

    private buildEquipmentStatusFacts(
        entry: MountedEquipment,
        criticalSlots: readonly CriticalSlot[],
        locations: readonly string[],
    ): EquipmentStatusFacts {
        const mountState: EquipmentStatus = entry.committedDestroyed()
            ? 'destroyed'
            : entry.states.get(ENTRY_DISABLED_STATE_KEY) === ENTRY_DISABLED_STATE_VALUE
                ? 'disabled'
                : 'available';
        return {
            equipment: entry.equipment ?? null,
            equipmentId: entry.equipment?.id ?? entry.id,
            equipmentFlags: entry.equipment?.flags ?? new Set(),
            mountState,
            criticals: criticalSlots.map(slot => ({
                id: slot.id ?? `${slot.loc ?? ''}:${slot.slot ?? ''}`,
                location: slot.loc ?? null,
                slot: slot.slot ?? null,
                status: slot.destroyed ? 'destroyed' : 'available',
                committedHits: slot.hits ?? (slot.destroyed ? 1 : 0),
                armored: slot.armored === true,
            })),
            locationStates: new Map(locations.map(location => [location, this.getEquipmentLocationStatus(location)])),
            unitSystemFacts: this.rules.getUnitSystemStatusFacts(),
        };
    }

    private buildCurrentEquipmentStatusFacts(entry: MountedEquipment): EquipmentStatusFacts {
        const criticalSlots = this.getCurrentCriticalSlots(entry);
        const locations = this.getEquipmentInstallationLocations(entry, criticalSlots);
        return this.buildEquipmentStatusFacts(entry, criticalSlots, locations);
    }

    private isPhysicalActionUnavailable(entry: MountedEquipment): boolean {
        if (!entry.isPhysicalWeapon()) return false;
        if (this.getCondition('prone')) return true;
        const moveMode = this.turnState().effectiveMoveMode();
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

    private battleArmorTrooperLocation(loc: string): string | null {
        if (this.getUnit().subtype !== 'Battle Armor') return null;
        if (loc.trim().toUpperCase() === 'SSW') return 'T1';
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
        const equipmentRegistry = this.getEquipmentRegistry();
        let bvVariation = 0;
        if (this.getUnit().type === 'Mek') {
            const crits = this.getCritSlots();
            for (const crit of crits) {
                if (crit.eq instanceof AmmoEquipment && crit.originalName && crit.originalName !== crit.name) {
                    const originalAmmo = this.dataService.findEquipment(crit.originalName) as AmmoEquipment | undefined;
                    if (originalAmmo) {
                        const originalBv = this.gameRules.getAmmoBV(originalAmmo, equipmentRegistry);
                        const customBv = this.gameRules.getAmmoBV(crit.eq, equipmentRegistry);
                        if (typeof originalBv !== 'number' || typeof customBv !== 'number') {
                            continue; // Skip variable BV. TODO: need to be handle when we have BaseEntity
                        }
                        bvVariation += customBv - originalBv;
                    }
                }
            }
        } else {
            const inventory = this.getInventory();
            for (const item of inventory) {
                if (item.equipment instanceof AmmoEquipment && item.ammo && item.ammo !== item.name) {
                    const customAmmo = this.dataService.findEquipment(item.ammo) as AmmoEquipment | undefined;
                    if (customAmmo) {
                        const originalBv = this.gameRules.getAmmoBV(item.equipment, equipmentRegistry);
                        const customBv = this.gameRules.getAmmoBV(customAmmo, equipmentRegistry);
                        if (typeof originalBv !== 'number' || typeof customBv !== 'number') {
                            continue; // Skip variable BV. TODO: need to be handle when we have BaseEntity
                        }
                        bvVariation += customBv - originalBv;
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
            if (crit.destroyed !== undefined || crit.destroyedTurn !== undefined) {
                crit.destroyed = undefined;
                crit.destroyedTurn = undefined;
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
        this.inventoryControl.markAmmoSourcesChanged();
        this.psrOutcomeSelections.set({});
        this.psrDiceSelections.set({});
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
        const turnState = this.turnState();
        const unit = this.getUnit();
        const options = getMotiveModesOptionsByUnit(unit, airborne);
        for (const mode of ['jump', 'UMU'] satisfies MotiveModes[]) {
            if ((mode !== 'jump' || !airborne)
                && !options.some(option => option.mode === mode)
                && (this._rules.getMaxDistanceForMoveMode(mode) ?? 0) > 0) {
                options.push({ mode, label: getMotiveModeLabel(mode, unit, airborne) });
            }
        }
        const cannotMove = this.getCondition('immobile') || !this.canTakeActiveActions();
        return options
            .filter(option => option.mode === 'stationary' || !cannotMove)
            .filter(option => this._rules.isMotiveModeAvailable(option.mode))
            .map(option => ({
                ...option,
                psr: this._rules.getCommittedDamageMovementModePSRCheck(
                    option.mode,
                    option.mode === turnState.moveMode() ? turnState.moveDistance() : 0,
                ) !== null,
            }));
    }

    /** Delegates to unit-type rules. Non-Mek types return { modifier: 0, modifiers: [] }. */
    PSRModifiers = computed(() => this._rules.PSRModifiers());

    /** Delegates to unit-type rules. Non-Mek types return 0. */
    PSRTargetRoll = computed(() => this._rules.PSRTargetRoll());

    endPhase() {
        this.dispatchBeforeEquipmentStateCommit();
        this.resolvePendingCrewDeaths();
        this.state.endPhase();
        this.psrOutcomeSelections.set({});
        this.psrDiceSelections.set({});
        this.inventoryControl.markAmmoSourcesChanged();
        this.phaseTrigger.update(v => v + 1); // Trigger change detection
    }

    private dispatchBeforeEquipmentStateCommit(): void {
        const equipmentRegistry = this.injector.get(EquipmentInteractionRegistryService).getRegistry();
        this.forEachCurrentInventoryEntry(entry =>
            equipmentRegistry.beforeEquipmentStateCommit(entry));
    }

    private forEachCurrentInventoryEntry(callback: (entry: MountedEquipment) => void): void {
        // A lifecycle hook may rebuild the inventory, so reacquire each mount by stable ID.
        const inventoryIds = this.getInventory().map(entry => entry.id);
        for (const id of inventoryIds) {
            const entry = this.getInventory().find(candidate => candidate.id === id);
            if (entry) callback(entry);
        }
    }

    /** Commits only a pending manual heat correction. Automated heat resolves at end of turn. */
    applyHeat(): void {
        const heat = this.getHeat();
        if (heat.next === undefined) return;
        this.state.consolidateHeat();
        if (this.automationMode('heatAndDissipationResolution') === 'no') {
            this.turnState().settleHeatDissipationDeficit();
        }
    }

    /** Applies projected end-turn heat without committing or resetting the turn. */
    resolveEndTurnHeat(): void {
        const projection = this.turnState().heatProjection();
        this.setHeat(projection.projected);
        this.state.consolidateHeat();
        this.turnState().acknowledgeHeatSources(projection.consumedDissipation);
    }

    hasPendingEndTurnHeat(): boolean {
        return this.turnState().hasPendingHeatResolution();
    }

    /**
     * Sets the crew-damage track from the record sheet. Increasing an eligible
     * warrior's damage is still a real pilot hit; decreasing it is a tabletop
     * correction and only reconciles already-pending work.
     */
    setCrewHits(crewId: number, hits: number): boolean {
        const crew = this.getCrewMember(crewId);
        if (!crew || !Number.isFinite(hits)) return false;
        const nextHits = Math.min(DEAD_CREW_HIT_THRESHOLD, Math.max(0, Math.trunc(hits)));
        const currentHits = crew.getHits();
        if (nextHits === currentHits) return false;

        const unitType = this.getUnit().type;
        const usesConsciousness = unitType === 'Mek' || unitType === 'ProtoMek' || unitType === 'Aero';
        if (usesConsciousness && nextHits > currentHits) {
            return this.applyPilotHits(nextHits - currentHits, undefined, crewId) > 0;
        }

        crew.setHits(nextHits);
        this.turnState().markPhaseStateChanged();
        this.turnState().refreshPendingUnitCheckTargets();
        return true;
    }

    applyPilotHits(hits: number, group?: string, crewId = 0): number {
        return this.applyPilotHitsForGroup(hits, group ?? this.turnState().currentPilotDamageGroup(), crewId);
    }

    applyLifeSupportDrowningCrewHits(hits: number, group?: string): number {
        const immediateGroup = isImmediatePilotDamageGroup(group)
            ? group!
            : createPilotDamageGroup('immediate', group);
        return this.applyCrewHits(hits, immediateGroup);
    }

    private applyPilotHitsForGroup(
        hits: number,
        group: string,
        crewId: number,
    ): number {
        const requestedHits = Number.isFinite(hits) ? Math.max(0, Math.trunc(hits)) : 0;
        const crew = this.getCrewMember(crewId);
        if (!crew || requestedHits === 0 || !isCrewMemberAboard(crew.getState())) return 0;

        const previousHits = crew.getHits();
        const count = Math.min(requestedHits, DEAD_CREW_HIT_THRESHOLD - previousHits);
        if (count === 0) return 0;
        const fatal = previousHits + count >= DEAD_CREW_HIT_THRESHOLD;
        crew.setHits(previousHits + count);
        this.turnState().markPhaseStateChanged();
        if (fatal) {
            this.turnState().discardPendingUnitChecks(check =>
                isConsciousnessSequenceCheck(check) && check.crewId === crewId);
            return count;
        }
        if (crew.getState() !== 'healthy') return count;
        if (this.automationMode('pilotHitsAndConsciousnessCheck') === 'no') return count;

        if (this.gameRules.aggregatedEndPhaseConsciousRolls) {
            // Core makes one roll for all pilot damage in the phase. Replace
            // the pending roll so its target reflects the highest number
            // reached by actual damage.
            const existing = this.turnState().getPendingUnitChecks().find(check =>
                isConsciousnessCheck(check)
                && check.pilotDamageGroup === group
                && check.crewId === crewId);
            if (existing) this.turnState().discardPendingUnitCheck(existing.id);
            if (this.queueConsciousnessCheck(group, crewId, existing?.id)) {
                const actionable = this.turnState().actionablePendingUnitChecks().some(check =>
                    isConsciousnessCheck(check)
                    && check.pilotDamageGroup === group
                    && check.crewId === crewId);
                if (actionable) this.automationTriggers.next({ kind: 'pending-unit-check' });
            }
            return count;
        }

        let queued = false;
        for (let offset = 1; offset <= count; offset++) {
            const target = getConsciousnessTarget(previousHits + offset);
            if (target === null) break;
            queued = this.turnState().queuePendingUnitCheck({
                id: uuidv7(),
                kind: UNIT_CHECK_KIND.CONSCIOUSNESS,
                pilotDamageGroup: group,
                crewId,
                target,
            }) || queued;
        }
        if (queued) this.automationTriggers.next({ kind: 'pending-unit-check' });
        return count;
    }

    getArmorTypeAt(location: string): ArmorType | null {
        const patchworkType = this.getUnit().patchworkLayout?.[location]?.type;
        if (patchworkType !== undefined) return ARMOR_TYPE_FROM_BLK_CODE[patchworkType] ?? null;
        const armor = this.materialAtLocation(location, (equipment): equipment is ArmorEquipment =>
            equipment instanceof ArmorEquipment && equipment.armorType !== 'PATCHWORK');
        return armor ? armor.armorType as ArmorType : null;
    }

    hasArmorType(type: ArmorType): boolean {
        return Object.values(this.getUnit().patchworkLayout ?? {})
            .some(entry => ARMOR_TYPE_FROM_BLK_CODE[entry.type] === type)
            || this.getUnit().comp.some(component =>
                component.eq instanceof ArmorEquipment && component.eq.armorType === type);
    }

    getStructureKindAt(location: string): MekStructureKind {
        const hybridType = this.getUnit().hybridLayout?.[location]?.type;
        if (hybridType === MEK_STRUCTURE_TYPE.COMPOSITE) return 'composite';
        if (hybridType === MEK_STRUCTURE_TYPE.REINFORCED) return 'reinforced';
        const structure = this.materialAtLocation(location, (equipment): equipment is StructureEquipment =>
            equipment instanceof StructureEquipment);
        if (structure?.hasFlag('F_COMPOSITE')) return 'composite';
        if (structure?.hasFlag('F_REINFORCED')) return 'reinforced';
        return 'standard';
    }

    private materialAtLocation<T extends ArmorEquipment | StructureEquipment>(
        location: string,
        isMaterial: (equipment: unknown) => equipment is T,
    ): T | null {
        const materials = this.getUnit().comp.filter(component => isMaterial(component.eq));
        const located = materials.find(component => component.l?.split('/').includes(location));
        const material = located?.eq ?? (materials.length === 1 ? materials[0].eq : undefined);
        return (material as T | undefined) ?? null;
    }

    resolvePendingCrewDeaths(): void {
        const pending = this.getCrewMembers().filter(crew =>
            crew.getHits() >= DEAD_CREW_HIT_THRESHOLD && crew.getState() !== 'dead');
        if (pending.length === 0) return;
        pending.forEach(crew => crew.setState('dead'));
        if (this.rules.getActivePilotCrewId() === null
            && this.getUnit().type === 'Aero'
            && this.turnState().airborne() !== false) {
            this.setCondition('out-of-control', true);
        }
    }

    private queueConsciousnessCheck(
        group: string,
        crewId: number,
        id = uuidv7(),
    ): boolean {
        if (this.automationMode('pilotHitsAndConsciousnessCheck') === 'no') return false;
        const target = this.getCrewMember(crewId)?.getConsciousnessTarget();
        if (target === null || target === undefined) return false;
        return this.turnState().queuePendingUnitCheck({
            id,
            kind: UNIT_CHECK_KIND.CONSCIOUSNESS,
            pilotDamageGroup: group,
            crewId,
            target,
        });
    }

    setCrewState(
        crewId: number,
        state: Exclude<CrewMemberState, 'dead'>,
        recoveryDelay = 1,
    ): boolean {
        const crew = this.getCrewMember(crewId);
        if (!crew || crew.getState() === 'dead' || crew.getState() === state) return false;

        crew.setState(state);
        this.turnState().markPhaseStateChanged();
        if (state === 'unconscious') {
            this.turnState().discardPendingUnitChecks(check =>
                isConsciousnessCheck(check) && check.crewId === crewId);
            this.queueConsciousnessRecovery(crewId, recoveryDelay);
        } else {
            this.turnState().discardPendingUnitChecks(check =>
                isConsciousnessSequenceCheck(check) && check.crewId === crewId);
        }
        return true;
    }

    queueConsciousnessRecovery(
        crewId: number,
        delay: number,
        replacingCheckId?: string,
    ): boolean {
        if (this.automationMode('pilotHitsAndConsciousnessCheck') === 'no') return false;
        const crew = this.getCrewMember(crewId);
        const target = crew?.getConsciousnessTarget();
        if (!crew || crew.getState() !== 'unconscious' || target === null) return false;
        if (this.turnState().getPendingUnitChecks().some(check =>
            check.id !== replacingCheckId
            && isConsciousnessRecoveryCheck(check)
            && check.crewId === crewId)) return false;

        return this.turnState().queuePendingUnitCheck({
            id: uuidv7(),
            kind: UNIT_CHECK_KIND.CONSCIOUSNESS_RECOVERY,
            crewId,
            target,
            readyTurn: this.turnState().getTurnCounter() + Math.max(1, Math.trunc(delay)),
        });
    }

    applyHeatCrewHits(hits: number, group?: string): number {
        const heatGroup = isHeatPilotDamageGroup(group)
            ? group!
            : createPilotDamageGroup('heat', group);
        return this.applyCrewHits(hits, heatGroup);
    }

    /** One damaging head hit injures every crew member still aboard the unit. */
    applyHeadHitCrewHits(group?: string): number {
        return this.applyCrewHits(this.rules.headHitPilotHits(), group);
    }

    /** Internal explosions injure every crew member still aboard the unit. */
    applyInternalExplosionCrewHits(hits: number, group?: string): number {
        return this.applyCrewHits(hits, group);
    }

    private applyCrewHits(hits: number, group?: string): number {
        return this.getCrewMembers().reduce(
            (total, crew) => total + this.applyPilotHits(hits, group, crew.getId()),
            0,
        );
    }

    private createFallSeatbeltChecks(levelsFallen: number): PendingEventInput<SerializedPendingUnitCheck>[] {
        if (this.automationMode('pilotHitsAndConsciousnessCheck') === 'no') return [];
        const normalizedLevels = Number.isFinite(levelsFallen)
            ? Math.max(0, Math.trunc(levelsFallen))
            : 0;
        const levelModifier = this.gameRules.id === 'core2026'
            ? normalizedLevels
            : Math.max(0, normalizedLevels - 1);
        const psr = this.PSRModifiers();
        const modifierTotal = levelModifier + (this.gameRules.id === 'core2026'
            ? 0
            : psr.modifiers.reduce((total, modifier) => total + (modifier.pilotCheck ?? 0), 0));
        const group = this.turnState().currentPilotDamageGroup();
        const checks: PendingEventInput<SerializedPendingUnitCheck>[] = [];
        for (const crew of this.getCrewMembers()) {
            const crewState = crew.getState();
            if (!isCrewMemberAboard(crewState)) continue;

            const target = crew.getSkill('piloting') + modifierTotal;
            const automaticFailure = !isCrewMemberAvailable(crewState)
                || this.getCondition('shutdown')
                || this.getCondition('immobile')
                || target > 12;
            checks.push({
                id: uuidv7(),
                kind: UNIT_CHECK_KIND.SEATBELT,
                pilotDamageGroup: group,
                crewId: crew.getId(),
                ...(automaticFailure
                    ? { result: { kind: 'automatic' as const, outcome: 'failed' as const } }
                    : { target }),
            });
        }
        return checks;
    }

    getPendingFalls(): readonly CBTPendingMekFall[] {
        return this.turnState().getPendingFalls().map(pending => ({
            ...pending,
            orientationRoll: pending.orientationRoll ?? null,
            damageRolls: (pending.damageRolls ?? []).map(fallDamageRollForDialog),
        }));
    }

    getPendingFall(id?: string): CBTPendingMekFall | undefined {
        const pending = this.turnState().getPendingFall(id);
        if (!pending) return undefined;
        return {
            ...pending,
            orientationRoll: pending.orientationRoll ?? null,
            damageRolls: (pending.damageRolls ?? []).map(fallDamageRollForDialog),
        };
    }

    setPendingFallRolls(
        id: string,
        orientationRoll: number | null,
        damageRolls: readonly CBTMekFallDamageRoll[],
    ): boolean {
        const pending = this.getPendingFall(id);
        if (!pending) return false;
        const normalizedOrientation = orientationRoll !== null
            && Number.isInteger(orientationRoll)
            && orientationRoll >= 1
            && orientationRoll <= 6
            ? orientationRoll
            : null;
        const normalizedDamageRolls = damageRolls.map<SerializedMekFallDamageRoll>(roll => {
            const hitLocationDice = roll.hitLocationDice?.length === 2
                && roll.hitLocationDice.every(die => Number.isInteger(die) && die >= 1 && die <= 6)
                ? [...roll.hitLocationDice] as [number, number]
                : null;
            const tripodLegRoll = roll.tripodLegRoll !== null
                && Number.isInteger(roll.tripodLegRoll)
                && roll.tripodLegRoll >= 1
                && roll.tripodLegRoll <= 6
                ? roll.tripodLegRoll
                : null;
            return {
                ...(hitLocationDice ? { hitLocationDice } : {}),
                ...(tripodLegRoll !== null ? { tripodLegRoll } : {}),
            };
        });
        return this.turnState().setPendingFallRolls(id, {
            ...(normalizedOrientation !== null ? { orientationRoll: normalizedOrientation } : {}),
            damageRolls: normalizedDamageRolls,
        });
    }

    /**
     * Completes one actual fall and only then releases its seatbelt check.
     * Closing the fall dialog deliberately does not call this method.
     */
    completePendingFall(id: string): boolean {
        const pending = this.getPendingFall(id);
        if (!pending) return false;
        const checks = this.createFallSeatbeltChecks(pending.levelsFallen);
        const completed = this.turnState().replacePendingFallWithUnitChecks(id, checks);
        if (!completed) return false;
        if (checks.length > 0) this.automationTriggers.next({ kind: 'pending-unit-check' });
        return true;
    }

    /** Removes automation work without treating the fall as resolved. */
    skipPendingFall(id: string): boolean {
        return this.turnState().discardPendingFall(id);
    }

    /**
     * Starts a pending falling workflow. A prone Mek cannot fall from
     * another PSR, while a failed stand attempt is still a fall. Manually
     * toggling prone remains a state-only override.
     */
    queueFall(source: CBTMekFallSource, levelsFallen = 0): boolean {
        if (source === 'psr' && this.getCondition('prone')) return false;
        if (this.automationMode('fallingCheck') === 'no') return false;
        const normalizedLevels = Number.isFinite(levelsFallen)
            ? Math.max(0, Math.trunc(levelsFallen))
            : 0;
        const pending: PendingEventInput<SerializedPendingMekFall> = {
            id: uuidv7(),
            source,
            levelsFallen: normalizedLevels,
        };
        if (!this.turnState().queuePendingFall(pending)) return false;
        this.automationTriggers.next({
            kind: 'falling',
            id: pending.id,
            source: pending.source,
            levelsFallen: pending.levelsFallen,
        });
        return true;
    }

    public endTurn(automationDecisions: CBTEndTurnAutomationDecisions = {}) {
        const endsForceTurn = !this.force.units().some(unit => unit !== this && unit.turnState().dirty());
        const heatAutomationMode = this.automationMode('heatAndDissipationResolution');
        const resolveHeat = heatAutomationMode === 'yes'
            ? automationDecisions.heatAndDissipationResolution !== false
            : heatAutomationMode === 'ask' && automationDecisions.heatAndDissipationResolution === true;
        if (resolveHeat && this.hasPendingEndTurnHeat()) {
            const previousHeat = this.getHeat().current;
            this.resolveEndTurnHeat();
            if (heatAutomationMode === 'yes') {
                this.injector.get(CBTAutomationToastService).show(
                    this,
                    `Heat and dissipation: Heat ${previousHeat} → ${this.getHeat().current}`,
                    'info',
                );
            }
        } else if (heatAutomationMode !== 'no' && this.getHeat().next !== undefined) {
            // A manual arrow is only committed by APPLY HEAT while automation is active.
            this.setHeatData({ ...this.getHeat(), next: undefined });
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
        this.dispatchBeforeEquipmentStateCommit();
        const equipmentRegistry = this.injector.get(EquipmentInteractionRegistryService).getRegistry();
        const notifications = this.injector.get(ToastService);
        this.forEachCurrentInventoryEntry(entry => equipmentRegistry.onEndTurn(entry, notifications));
        this.resolvePendingCrewDeaths();
        this.state.endTurn(automationDecisions.phaseAlreadyEnded === true);
        if (endsForceTurn) this.force.clearExpiredManualTargetTags(this);
        this.inventoryControl.markAmmoSourcesChanged();
        this.phaseTrigger.update(v => v + 1); // Trigger change detection
        this.psrOutcomeSelections.set({});
        this.psrDiceSelections.set({});
        this.state.resetTurnState(this.turnState().getTurnCounter() + 1, true);
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
