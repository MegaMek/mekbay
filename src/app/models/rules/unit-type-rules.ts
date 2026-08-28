// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { computed, signal, type Signal } from '@angular/core';
import { MountedWeapon, type MountedEquipment } from '../mounted-equipment.model';
import { ATTACK_MOVEMENT_MODIFIER_BREAKDOWN_PRIORITY, type ToHitModifierBreakdownEntry } from './game-rules';
import { WeaponEquipment, type Equipment } from '../equipment.model';
import type { CriticalSlot, RuleCheckOutcome, SerializedC3NetworkGroup } from '../force-serialization';
import { getMotiveModeLabel, type MotiveModes } from '../motiveModes.model';
import type { TurnState } from '../turn-state.model';
import { isCrewMemberAvailable, type CrewMember, type CrewMemberState } from '../crew-member.model';
import {
    getTargetMovementBracketForDistance,
    getTargetMovementDistanceModifier,
    TN_AIRBORNE_MOVE_TYPE_MODIFIER,
    TN_IMMOBILE,
    TN_SKIDDING_ATTACKER,
    TN_SKIDDING_MODIFIER,
} from '../target-number-calculator.model';
import { getActiveStealthTnModifiers } from '../stealth-equipment.model';
import type { CBTForceUnit, EquipmentAction } from '../cbt-force-unit.model';
import type { HeatDissipationState, HeatScaleEntry } from './heat-management';
import type { InventoryControlDisplayData } from '../../utils/inventory-control.util';
import { C3TaxCalculator } from '../c3-network.model';
import type {
    CriticalSlotStatusFacts,
    EquipmentStatus,
    EquipmentStatusFacts,
    UnitSystemStatusFacts,
} from '../equipment-status.model';

export const PSR_CHECK_KIND = {
    TORSO_DESTROYED: 'torso-destroyed',
    SHUTDOWN: 'shutdown',
    DAMAGE_THRESHOLD: 'damage-threshold',
    LEG_DESTROYED: 'leg-destroyed',
    LEG_DAMAGE: 'leg-damage',
    LEG_ACTUATOR_HIT: 'leg-actuator-hit',
    HIP_HIT: 'hip-hit',
    GYRO_HIT: 'gyro-hit',
    GYRO_DESTROYED: 'gyro-destroyed',
    DAMAGED_GYRO_MOVEMENT: 'damaged-gyro-movement',
    DAMAGED_LEG_MOVEMENT: 'damaged-leg-movement',
    QUAD_TWO_DESTROYED_LEGS_MOVEMENT: 'quad-two-destroyed-legs-movement',
    DAMAGED_LEG_ACTUATOR_MOVEMENT: 'damaged-leg-actuator-movement',
    DAMAGED_HIP_MOVEMENT: 'damaged-hip-movement',
    SPRINTING_WITH_MOVEMENT_ENHANCER: 'sprinting-with-movement-enhancer',
} as const;

export type PSRCheckKind = typeof PSR_CHECK_KIND[keyof typeof PSR_CHECK_KIND];

export const PSR_FAILURE_KIND = {
    FALL: 'fall',
    RULE_RESOLUTION: 'rule-resolution',
} as const;

export type PSRFailure =
    | { readonly kind: typeof PSR_FAILURE_KIND.FALL }
    | {
        readonly kind: typeof PSR_FAILURE_KIND.RULE_RESOLUTION;
        /** Presentation only. Rule behavior is owned by `resolution`. */
        readonly label: string;
    };

export const FALL_PSR_FAILURE: { readonly kind: typeof PSR_FAILURE_KIND.FALL } = Object.freeze({
    kind: PSR_FAILURE_KIND.FALL,
});

/** Presentation-only modifier contributing to a PSR target. */
export interface PSRModifier {
    pilotCheck?: number;
    reason: string;
    modifierReason?: string;
    loc?: string;
}

interface PSRCheckBase extends PSRModifier {
    id?: string;
    fallCheck?: number;
    /** Stable rules identity. Never derive this from `reason`. */
    kind: PSRCheckKind;
    /** Typed consequence. Presentation text must never drive resolution. */
    failure: PSRFailure;
    movementMode?: 'run' | 'sprint' | 'jump';
    legFilter?: string;
    ignorePreExistingGyro?: boolean;
}

export interface FallingPSRCheck extends PSRCheckBase {
    failure: { readonly kind: typeof PSR_FAILURE_KIND.FALL };
    resolution?: never;
}

export interface RuleResolutionPSRCheck extends PSRCheckBase {
    failure: {
        readonly kind: typeof PSR_FAILURE_KIND.RULE_RESOLUTION;
        readonly label: string;
    };
    resolution: {
        key: string;
        token: string;
    };
}

export type PSRCheck = FallingPSRCheck | RuleResolutionPSRCheck;

export function isFallPSRCheck(check: PSRCheck): check is FallingPSRCheck {
    return check.failure.kind === PSR_FAILURE_KIND.FALL;
}

export function psrFailureLabel(check: PSRCheck): string {
    switch (check.failure.kind) {
        case PSR_FAILURE_KIND.FALL:
            return 'Fall';
        case PSR_FAILURE_KIND.RULE_RESOLUTION:
            return check.failure.label;
    }
}

export function sortPSRModifiers(modifiers: readonly PSRModifier[]): PSRModifier[] {
    return [...modifiers].sort((left, right) => {
        const leftIsNegative = (left.pilotCheck ?? 0) < 0;
        const rightIsNegative = (right.pilotCheck ?? 0) < 0;
        if (leftIsNegative !== rightIsNegative) return leftIsNegative ? -1 : 1;
        return (left.modifierReason ?? left.reason).localeCompare(right.modifierReason ?? right.reason);
    });
}

export interface UnitHeatSource {
    id: string;
    label: string;
    value: number;
    /** Source is transient firing heat derived from selected inventory weapons. */
    inventorySelection?: boolean;
    /** Source state that must reactivate heat even when its aggregate value is unchanged. */
    signature?: string;
    /** 
     * Inventory entry whose selected firing heat replaces this passive source.
     * It goes in priority order (handlers) so the highest priority that replaces will
     * prevent other handlers to replace it 
     * TODO: find a solution more elegant...
     */
    replacedByFiringEntryId?: string;
}

export interface ChargeDamage {
    damage: number | null;
    maxDamage: number | null;
    bonusDamage: number;
    maxBonusDamage: number;
    /** Ruleset-specific symbolic damage shown until Walk or Run is selected, including current bonuses. */
    displayFormula?: string;
}

export const ENTRY_DISABLED_STATE_KEY = 'disabled';
export const ENTRY_DISABLED_STATE_VALUE = 'true';
export const NARC_CONDITION_COLOR = '#f00';

export interface LocationConditionControl {
    key: string;
    label: string;
    color: string;
    counted?: boolean;
}

export interface UnitModifierBreakdownEntry extends ToHitModifierBreakdownEntry {
    alternateModifier?: number;
    alternateModifierLabel?: string;
}

export interface UnitRuleModifier {
    readonly label: string;
    readonly values: Partial<Record<UnitRuleModifierDomain, number>>;
    readonly weakened?: boolean;
    readonly kind?: ToHitModifierBreakdownEntry['kind'];
}

export type UnitRuleModifierDomain = 'ranged' | 'physical' | 'psr';

export function projectRuleModifiers(
    modifiers: readonly UnitRuleModifier[],
    domain: UnitRuleModifierDomain,
): ToHitModifierBreakdownEntry[] {
    const result: ToHitModifierBreakdownEntry[] = [];
    for (const modifier of modifiers) {
        const value = modifier.values[domain];
        if (value === undefined) continue;
        result.push({
            label: modifier.label,
            modifier: value,
            ...(modifier.weakened !== undefined && { weakened: modifier.weakened }),
            ...(modifier.kind !== undefined && { kind: modifier.kind }),
        });
    }
    return result;
}

export interface UnitModifierTotal {
    modifier: number;
    alternateModifier?: number;
    alternateModifierLabel?: string;
}

export function calculateModifierTotal(entries: readonly UnitModifierBreakdownEntry[]): UnitModifierTotal {
    let min = 0;
    let max = 0;

    for (const entry of entries) {
        const entryMin = Math.min(entry.modifier, entry.alternateModifier ?? entry.modifier);
        const entryMax = Math.max(entry.modifier, entry.alternateModifier ?? entry.modifier);
        min += entryMin;
        max += entryMax;
    }

    return min === max
        ? { modifier: max }
        : { modifier: max, alternateModifier: min };
}

export type UnitConditionControlPlacement = 'button' | 'menu';

export interface UnitConditionDefinition {
    key: string;
    label: string;
    bannerLabel?: string;
    bannerFontScaling?: number;
    bannerTextColor?: string;
    color: string;
    placement?: UnitConditionControlPlacement;
    important?: boolean;
    computed?: 'derived-only' | 'derived-or-stored';
}

export type UnitConditionControl = UnitConditionDefinition & { placement: UnitConditionControlPlacement };

export interface CrewStateDefinition {
    key: CrewMemberState;
    label: string;
    bannerLabel: string;
    color: string;
}

export type CrewStateControlKey = Exclude<CrewMemberState, 'healthy' | 'dead'>;
export type CrewStateControlDefinition = CrewStateDefinition & { key: CrewStateControlKey };

export const UNIT_CONDITION_DEFINITIONS: readonly UnitConditionDefinition[] = [
    { key: 'shutdown', important: true, label: 'SHUTDOWN', color: '#840000', placement: 'button' },
    { key: 'abandoned', important: true, label: 'ABANDONED', color: '#222', computed: 'derived-only' },
    { key: 'disconnected', important: true, label: 'UNLINK', bannerLabel: "DISCONNECTED", bannerFontScaling: 0.8, color: '#455a64', placement: 'button', computed: 'derived-or-stored' },
    { key: 'immobile', label: 'IMMOBILE', color: '#ff8800', computed: 'derived-only' },
    { key: 'prone', label: 'PRONE', color: '#666', placement: 'button' },
    { key: 'crippled', label: 'CRIPPLED', color: '#b70000', computed: 'derived-only' },
    { key: 'swarmed', label: 'SWARMED', color: '#46b48e', placement: 'menu' },
    { key: 'tagged', label: 'TAGGED', color: '#3385d7', placement: 'menu' },
    { key: 'ecm-shielded', label: 'ECM SHIELDED', color: '#008f7a', placement: 'menu' },
    { key: 'skidding', label: 'SKIDDING', color: '#bfb300', placement: 'menu' },
    { key: 'jammed', label: 'JAMMED', color: '#ff6be6', placement: 'menu' },
    { key: 'out-of-control', important: true, label: 'OUT OF CONTROL', color: '#d46b00', placement: 'menu' },
    { key: 'random-movement', important: true, label: 'RANDOM MOVEMENT', color: '#b56bdb', placement: 'menu' },
    { key: 'spotting', label: 'SPOTTING', color: '#471fad', computed: 'derived-only' },
    { key: 'stealth', label: 'STEALTH', color: '#226', computed: 'derived-only' },
];

const UNIT_CONDITION_BY_KEY = new Map<string, UnitConditionDefinition>(UNIT_CONDITION_DEFINITIONS.map(condition => [condition.key, condition]));
const UNIT_CONDITION_SORT_INDEX = new Map<string, number>(UNIT_CONDITION_DEFINITIONS.map((condition, index) => [condition.key, index]));
const COMPUTED_UNIT_CONDITION_KEYS = UNIT_CONDITION_DEFINITIONS
    .filter(condition => condition.computed !== undefined)
    .map(condition => condition.key);

export function unitConditionControls(keys: readonly string[]): readonly UnitConditionControl[] {
    return keys.map(key => {
        const condition = UNIT_CONDITION_BY_KEY.get(key);
        if (!condition?.placement) throw new Error(`Unknown controllable unit condition: ${key}`);
        return condition as UnitConditionControl;
    });
}

export function getUnitConditionDefinition(key: string): UnitConditionDefinition {
    return UNIT_CONDITION_BY_KEY.get(key) ?? { key, label: key, color: '#666'};
}

export function unitConditionSortIndex(key: string): number {
    return UNIT_CONDITION_SORT_INDEX.get(key) ?? UNIT_CONDITION_DEFINITIONS.length;
}

const CREW_STATE_DEFINITIONS: readonly CrewStateDefinition[] = [
    { key: 'unconscious', label: 'Unconscious', bannerLabel: 'UNCONSCIOUS', color: '#ff9a1f' },
    { key: 'ejected', label: 'Eject', bannerLabel: 'EJECTED', color: '#2f8f46' },
    { key: 'dead', label: 'Dead', bannerLabel: 'DEAD', color: '#c62828' },
    { key: 'killed', label: 'Crew Killed', bannerLabel: 'CREW KILLED', color: '#c62828' },
    { key: 'stunned', label: 'Stunned', bannerLabel: 'STUNNED', color: '#ff5ce6' },
];

const CREW_STATE_BY_KEY = new Map<CrewMemberState, CrewStateDefinition>(CREW_STATE_DEFINITIONS.map(state => [state.key, state]));

export function crewStateDefinitions(keys: readonly CrewMemberState[]): readonly CrewStateDefinition[] {
    return keys.map(key => {
        const state = CREW_STATE_BY_KEY.get(key);
        if (!state) throw new Error(`Unknown crew state: ${key}`);
        return state;
    });
}

/**
 * 
 * Strategy interface for unit-type-specific game rules.
 * Each CBTForceUnit holds a `rules` instance matching its unit type.
 */
export interface UnitTypeRules {
    /** Evaluate whether the unit should be marked destroyed based on current state. Idempotent. */
    evaluateDestroyed(): void;

    /** BV cost allocated to this unit for its active C3 network. */
    calculateC3Tax(
        networks: SerializedC3NetworkGroup[],
        allUnits: CBTForceUnit[],
        calculator?: C3TaxCalculator,
    ): number;

    /** Short label for required control rolls (PSR, DSR, etc.). */
    readonly controlRollShortLabel: string;

    /** Full label for required control rolls. */
    readonly controlRollFullLabel: string;

    /** Piloting Skill Roll modifiers. Non-Mek types return { modifier: 0, modifiers: [] }. */
    readonly PSRModifiers: Signal<{ modifier: number; modifiers: PSRModifier[] }>;

    /** PSR target roll number (piloting skill + modifiers). Non-Mek types return 0. */
    readonly PSRTargetRoll: Signal<number>;

    /** Modifier applied specifically when this unit attempts to stand up. */
    readonly standingUpPSRModifier: number;

    /** Whether this unit can stand up in its current turn state. */
    canStandUp(turnState: TurnState): boolean;

    /** Whether this unit's current configuration lets it stand without a control roll. */
    canStandWithoutPSR(turnState: TurnState): boolean;

    /** Whether this rules implementation supports the optional Careful Stand rule. */
    readonly supportsCarefulStand: boolean;

    /** Whether this unit has at least 3 available Walking MP for a careful stand attempt. */
    canCarefulStand(turnState: TurnState): boolean;

    /** Movement mode used to classify a stand attempt in the current turn state. */
    getStandAttemptMovementMode(turnState: TurnState): MotiveModes | null;

    /** Maximum stand attempts permitted this turn, or null when no special limit applies. */
    getStandAttemptLimit(turnState: TurnState): number | null;

    /** Whether current phase damage causes automatic falling or equivalent unit-type failure. */
    readonly autoFall: Signal<boolean>;

    /** Heat dissipation state for heat-tracking units. Non-heat units return null. */
    readonly heatDissipation: Signal<HeatDissipationState | null>;

    /** Heat scale used by this unit type. Empty for units without heat-scale effects. */
    readonly heatScale: readonly HeatScaleEntry[];

    /** Manual condition controls available for this unit type. */
    readonly conditionControls: readonly UnitConditionControl[];

    /** Manual crew-state controls available for this unit type. */
    readonly crewStateControls: readonly CrewStateControlDefinition[];

    /** Manual location-state controls available for this unit type. */
    readonly locationConditionControls: readonly LocationConditionControl[];

    /** Display definition for a crew state supported by this unit type. */
    crewStateDefinition(state: CrewMemberState): CrewStateDefinition | undefined;

    /** Whether rules derive that the cockpit of this crew member has been destroyed. */
    isCrewCockpitDestroyed(crewId: number): boolean;

    /** Whether this unit type allows swapping two crew seats right now. */
    canSwapCrewMembers(leftCrewId?: number, rightCrewId?: number): boolean;

    /** Swap two crew seats if allowed by this unit type. */
    swapCrewMembers(leftCrewId?: number, rightCrewId?: number): boolean;

    /** Whether this unit currently has crew for gameplay/UI purposes. */
    hasCrew(): boolean;

    /** Whether this unit is controlled by a remote drone operating system. */
    isRemoteDrone(): boolean;

    /** Whether a condition key is derived from rules instead of persisted unit state. */
    isComputedCondition(condition: string): boolean;

    /** Get a rule-derived condition value. Returns false for non-computed condition keys. */
    hasComputedCondition(condition: string): boolean;

    /** Rule-derived condition keys exposed through ForceUnit.getCondition/getConditions. */
    computedConditions(): readonly string[];

    /** Unit-type-specific status contribution from status-only facts. */
    getEquipmentStatusContribution(facts: EquipmentStatusFacts): EquipmentStatus;

    /** Aggregate current critical facts into mount-level status. */
    getMountedCriticalStatusContribution(facts: EquipmentStatusFacts): EquipmentStatus;

    /** Number of damaging critical hits required to destroy a mounted component. */
    mountedCriticalDamageDestructionThreshold(equipment: Equipment | null): number;

    /** Location-scoped unit-type-specific status contribution. */
    getEquipmentStatusContributionAtLocation(facts: EquipmentStatusFacts, location: string): EquipmentStatus;

    /** Unit-type-specific critical-slot status contribution. */
    getCriticalSlotStatusContribution(facts: CriticalSlotStatusFacts): EquipmentStatus;

    /** Status-only system facts exposed to canonical composition. */
    getUnitSystemStatusFacts(): UnitSystemStatusFacts;

    /** Unit-type-specific permission for an otherwise operational equipment action. */
    canPerformEquipmentAction(entry: MountedEquipment, action: EquipmentAction): boolean;

    /** Whether an inventory entry represents an independent action that can be selected and performed. */
    hasIndependentInventoryControlAction(entry: MountedEquipment): boolean;

    /** Resolve rule-derived to-hit modifiers for one inventory entry. */
    getEquipmentToHitModifiers(entry: MountedEquipment): readonly ToHitModifierBreakdownEntry[];

    /** Required control-roll checks for the current phase. */
    getPSRChecks(turnState: TurnState): PSRCheck[];

    /** Reconcile persistent outcome checks with the unit's current rule state. */
    reconcileRuleChecks(): void;

    /** Resolve a pending outcome check if its token still identifies the current instance. */
    resolveRuleCheck(key: string, token: string, outcome: RuleCheckOutcome): boolean;

    /** Movement-mode warning roll caused by committed damage. */
    getCommittedDamageMovementModePSRCheck(moveMode: MotiveModes | null, moveDistance?: number | null): PSRCheck | null;

    /** Evaluate whether internal damage creates unit-type-specific control-roll checks. */
    evaluateLegDestroyed(location: string, hits: number): void;

    /** Apply the ruleset-specific consequences of flooding a location. */
    evaluateLocationFlooded(location: string, active: boolean): void;

    /** Evaluate whether critical damage creates unit-type-specific control-roll checks. */
    evaluateCritSlotHit(crit: CriticalSlot): void;

    /** Heat sources produced by current phase choices and damage state. */
    heatSources(turnState: TurnState): UnitHeatSource[];

    /** Whether the unit's life support has suffered a critical hit. */
    hasDamagedLifeSupport(): boolean;

    /** Potential pilot hits from damaged life support at the given heat level. */
    heatLifeSupportPilotHits(heat: number): number;

    /** End Phase pilot hits caused by damaged life support while fully submerged. */
    submergedLifeSupportPilotHits(): number;

    /** Pilot hits caused by one damaging hit to the head. */
    headHitPilotHits(): number;

    /** Crew member currently able to make piloting checks, if any. */
    getActivePilotCrewId(): number | null;

    /** Unit-type-specific movement distance override. Return null to use base unit data. */
    getMaxDistanceForMoveMode(moveMode: MotiveModes): number | null;

    /** Unit-type-specific effective movement distance for turn-state choices. */
    getEffectiveMaxDistanceForMoveMode(moveMode: MotiveModes, turnState: TurnState): number | null;

    /** Movement points already spent on non-translational movement actions. */
    getMovementPointsSpent(turnState: TurnState): number;

    /** Unit-type-specific minimum movement distance override. Return null to use 0. */
    getMinDistanceForMoveMode(moveMode: MotiveModes): number | null;

    /** Unit-type-specific movement mode availability. */
    isMotiveModeAvailable(moveMode: MotiveModes): boolean;

    /** Unit-type-specific attack movement modifier. */
    getAttackMovementModifier(moveMode: MotiveModes | null | undefined, airborne?: boolean): number;

    /** Unit-type-specific attack modifier for spotting. */
    getSpottingModifier(): number;

    /** Unit-type-specific gunnery skill for runtime target-number calculations. */
    getBaseGunnerySkill(): number;

    /** Unit-type-specific piloting skill for runtime target-number calculations. */
    getBasePilotingSkill(): number;

    /** Standard control-roll target using the unit's currently represented damage modifiers. */
    getStandardControlRollTarget(): number;

    /** Attack modifier breakdown for turn summary UI. */
    getAttackModifierBreakdown(turnState: TurnState): UnitModifierBreakdownEntry[];

    /** Target movement modifier breakdown for turn summary UI. */
    getDefenseModifierBreakdown(turnState: TurnState): UnitModifierBreakdownEntry[];

    /** Charge damage for the current movement, including unit-specific bonuses. */
    chargeDamage(): ChargeDamage;

    /** Apply unit-rule-derived values to inventory display data. */
    applyInventoryControlDisplayEffects(entry: MountedEquipment, display: InventoryControlDisplayData): InventoryControlDisplayData;
}

export abstract class UnitTypeRulesBase implements UnitTypeRules {
    readonly controlRollShortLabel: string;
    readonly controlRollFullLabel: string;
    readonly PSRModifiers: Signal<{ modifier: number; modifiers: PSRModifier[] }> = signal({ modifier: 0, modifiers: [] });
    readonly PSRTargetRoll: Signal<number> = signal(0);
    readonly standingUpPSRModifier: number = 0;
    protected readonly ruleModifiers: Signal<UnitRuleModifier[]> = computed(() => [
        ...this.buildRuleModifiers(),
        ...this.buildTurnStateRuleModifiers(this.unit.turnState?.()),
    ]);
    protected readonly rangedHitModifiers: Signal<ToHitModifierBreakdownEntry[]> = computed(() =>
        projectRuleModifiers(this.ruleModifiers(), 'ranged'));
    protected readonly physicalHitModifiers: Signal<ToHitModifierBreakdownEntry[]> = computed(() =>
        projectRuleModifiers(this.ruleModifiers(), 'physical'));
    protected readonly psrModifiers: Signal<ToHitModifierBreakdownEntry[]> = computed(() =>
        projectRuleModifiers(this.ruleModifiers(), 'psr'));
    readonly autoFall: Signal<boolean> = signal(false);
    readonly heatDissipation: Signal<HeatDissipationState | null> = signal(null);
    readonly heatScale: readonly HeatScaleEntry[] = [];
    protected readonly baseConditionControls: readonly UnitConditionControl[] = [];
    protected readonly baseCrewStateControls: readonly CrewStateControlDefinition[] = [];
    readonly locationConditionControls: readonly LocationConditionControl[] = [];
    protected readonly crewStateDisplayDefinitions: readonly CrewStateDefinition[] = [];
    protected readonly abandoned = computed<boolean>(() => {
        return false;
    });
    protected readonly crippled = computed<boolean>(() => {
        return false;
    });
    protected readonly immobile = computed<boolean>(() => {
        return false;
    });

    protected buildRuleModifiers(): UnitRuleModifier[] {
        return [];
    }

    protected buildTurnStateRuleModifiers(turnState: TurnState | undefined): UnitRuleModifier[] {
        if (!turnState) return [];

        const modifiers: UnitRuleModifier[] = [];
        if (this.unit.gameRules.supportsSkidding && turnState.unitState.hasCondition('skidding')) {
            modifiers.push({
                label: 'Skidding',
                values: { ranged: TN_SKIDDING_ATTACKER, physical: TN_SKIDDING_ATTACKER },
            });
        }
        const spottingModifier = turnState.spotting() ? this.getSpottingModifier() : 0;
        if (spottingModifier !== 0) {
            modifiers.push({
                label: 'Spotting',
                values: { ranged: spottingModifier, physical: spottingModifier },
            });
        }
        return modifiers;
    }

    get conditionControls(): readonly UnitConditionControl[] {
        const controls = this.unit.gameRules.supportsSkidding
            ? this.baseConditionControls
            : this.baseConditionControls.filter(control => control.key !== 'skidding');
        if (!this.hasDroneOperatingSystem()) return controls;
        if (controls.some(control => control.key === 'disconnected')) return controls;
        return [...controls, unitConditionControls(['disconnected'])[0]];
    }

    get crewStateControls(): readonly CrewStateControlDefinition[] {
        return this.hasDroneOperatingSystem() ? [] : this.baseCrewStateControls;
    }

    abstract evaluateDestroyed(): void;

    isCrewCockpitDestroyed(_crewId: number): boolean {
        return false;
    }

    canSwapCrewMembers(_leftCrewId = 0, _rightCrewId = 1): boolean {
        return false;
    }

    swapCrewMembers(_leftCrewId = 0, _rightCrewId = 1): boolean {
        return false;
    }

    constructor(
        protected unit: CBTForceUnit,
        controlRollShortLabel: string = 'PSR',
        controlRollFullLabel: string = 'Piloting Skill Rolls'
    ) {
        this.controlRollShortLabel = controlRollShortLabel;
        this.controlRollFullLabel = controlRollFullLabel;
    }

    calculateC3Tax(
        networks: SerializedC3NetworkGroup[],
        allUnits: CBTForceUnit[],
        calculator = new C3TaxCalculator(networks, allUnits),
    ): number {
        return calculator.core2026(this.unit);
    }

    isComputedCondition(condition: string): boolean {
        return UNIT_CONDITION_BY_KEY.get(condition)?.computed === 'derived-only';
    }

    hasComputedCondition(condition: string): boolean {
        if (condition === 'abandoned' && this.hasDroneOperatingSystem()) return false;
        if (condition === 'disconnected') return this.isDroneOperatingSystemUnavailable();
        if (condition === 'spotting') return this.unit.turnState().spotting();
        if (condition === 'abandoned') return this.abandoned();
        if (condition === 'immobile') {
            const disconnectedDroneImmobile = this.hasDroneOperatingSystem() && this.unit.getCondition('disconnected');
            return this.immobile() || disconnectedDroneImmobile;
        }
        if (condition === 'crippled') return this.crippled();
        if (condition === 'stealth') return getActiveStealthTnModifiers(this.unit) !== undefined;
        return false;
    }

    computedConditions(): readonly string[] {
        return COMPUTED_UNIT_CONDITION_KEYS;
    }

    getEquipmentStatusContribution(facts: EquipmentStatusFacts): EquipmentStatus {
        return 'available';
    }

    getMountedCriticalStatusContribution(facts: EquipmentStatusFacts): EquipmentStatus {
        return facts.criticals.some(critical => critical.status === 'destroyed') ? 'destroyed' : 'available';
    }

    mountedCriticalDamageDestructionThreshold(_equipment: Equipment | null): number {
        return 1;
    }

    getEquipmentStatusContributionAtLocation(facts: EquipmentStatusFacts, _location: string): EquipmentStatus {
        return this.getEquipmentStatusContribution(facts);
    }

    getCriticalSlotStatusContribution(_facts: CriticalSlotStatusFacts): EquipmentStatus {
        return 'available';
    }

    getUnitSystemStatusFacts(): UnitSystemStatusFacts {
        return { engineHit: false };
    }

    canPerformEquipmentAction(_entry: MountedEquipment, _action: EquipmentAction): boolean {
        return true;
    }

    hasIndependentInventoryControlAction(_entry: MountedEquipment): boolean {
        return true;
    }

    getEquipmentToHitModifiers(entry: MountedEquipment): readonly ToHitModifierBreakdownEntry[] {
        return [
            ...this.getMountedTargetingComputerModifiers(entry),
            ...this.getUnitEquipmentToHitModifiers(entry),
        ];
    }

    protected getUnitEquipmentToHitModifiers(entry: MountedEquipment): readonly ToHitModifierBreakdownEntry[] {
        const unitModifiers = entry.isPhysicalWeapon()
            ? this.physicalHitModifiers()
            : entry.equipment instanceof WeaponEquipment
                ? this.rangedHitModifiers()
                : [];
        return unitModifiers;
    }

    protected getMountedTargetingComputerModifiers(entry: MountedEquipment): ToHitModifierBreakdownEntry[] {
        const targetingComputer = this.getMountedTargetingComputer();
        if (!targetingComputer) return [];
        if (!this.isTargetingComputerEligible(entry)) return [];

        const label = targetingComputer.getDisplayName();
        const status = this.unit.getEquipmentStatus(targetingComputer);
        return status === 'available'
            ? [{ label, modifier: -1 }]
            : [{
                label: `${label} ${status === 'destroyed' ? 'Destroyed' : 'Disabled'}`,
                modifier: 0,
                weakened: true,
            }];
    }

    private getMountedTargetingComputer(): MountedEquipment | undefined {
        // There can be at most only 1 targeting computer so, we pick the first!
        return this.unit.getInventory()
            .find(candidate => candidate.equipment?.flags.has('F_TARGETING_COMPUTER'));
    }

    protected isTargetingComputerEligible(entry: MountedEquipment): boolean {
        if (!(entry instanceof MountedWeapon)) return false;
        const effectiveTypes = this.unit.getEffectiveWeaponTypes(entry);
        return entry.equipment.hasFlag('F_DIRECT_FIRE') === true
            && !entry.equipment.hasAnyFlag(['F_TASER', 'F_FLAMER', 'F_MG', 'F_MGA'])
            && (effectiveTypes.has('DB') || effectiveTypes.has('DE') || effectiveTypes.has('P'))
            && !effectiveTypes.has('F')
            && (!effectiveTypes.has('C') || entry.equipment.hasFlag('F_HAG'));
    }

    protected entryCriticalSlots(entry: MountedEquipment): CriticalSlot[] {
        return entry.critSlots?.flatMap(slot => this.currentCriticalSlot(slot) ?? []) ?? [];
    }

    protected currentCriticalSlot(slot: CriticalSlot): CriticalSlot | null {
        return this.unit.findCurrentCriticalSlot(slot);
    }

    crewStateDefinition(state: CrewMemberState): CrewStateDefinition | undefined {
        if (this.hasDroneOperatingSystem()) return undefined;
        return this.crewStateDisplayDefinitions.find(definition => definition.key === state);
    }

    hasCrew(): boolean {
        return !this.hasDroneOperatingSystem() && this.unit.getCrewMembers().length > 0;
    }

    isRemoteDrone(): boolean {
        return this.hasDroneOperatingSystem();
    }

    protected supportsDroneOperatingSystem(): boolean {
        return false;
    }

    protected hasDroneOperatingSystem(): boolean {
        return this.droneOperatingSystem() !== undefined;
    }

    private droneOperatingSystem(): MountedEquipment | CriticalSlot | undefined {
        if (!this.supportsDroneOperatingSystem()) return undefined;
        const inventory = this.unit.getInventory();
        const entry = inventory.find(candidate => candidate.equipment?.hasFlag('F_DRONE_OPERATING_SYSTEM'));
        return entry;
    }

    protected isDroneOperatingSystemUnavailable(): boolean {
        const droneOperatingSystem = this.droneOperatingSystem();
        return droneOperatingSystem !== undefined && !this.unit.isEquipmentOperational(droneOperatingSystem);
    }

    getPSRChecks(_turnState: TurnState): PSRCheck[] {
        return [];
    }

    canStandUp(_turnState: TurnState): boolean {
        return false;
    }

    canStandWithoutPSR(_turnState: TurnState): boolean {
        return false;
    }

    readonly supportsCarefulStand: boolean = false;

    canCarefulStand(_turnState: TurnState): boolean {
        return false;
    }

    getStandAttemptMovementMode(turnState: TurnState): MotiveModes | null {
        return turnState.moveMode();
    }

    getStandAttemptLimit(_turnState: TurnState): number | null {
        return null;
    }

    reconcileRuleChecks(): void {
    }

    resolveRuleCheck(_key: string, _token: string, _outcome: RuleCheckOutcome): boolean {
        return false;
    }

    getCommittedDamageMovementModePSRCheck(_moveMode: MotiveModes | null, _moveDistance?: number | null): PSRCheck | null {
        return null;
    }

    evaluateLegDestroyed(_location: string, _hits: number): void {
    }

    evaluateLocationFlooded(_location: string, _active: boolean): void {
    }

    evaluateCritSlotHit(_crit: CriticalSlot): void {
    }

    heatSources(turnState: TurnState): UnitHeatSource[] {
        if (this.unit.getUnit().heat < 0) return []; // Does not track heat
        const sources: UnitHeatSource[] = [];
        const weaponsHeat = turnState.weaponsHeat();
        if (weaponsHeat > 0) {
            sources.push({ id: 'weapons', label: 'Weapons', value: weaponsHeat });
        }
        sources.push(...(this.unit.getEquipmentHeatSources?.(turnState) ?? []));
        return sources;
    }

    hasDamagedLifeSupport(): boolean {
        return false;
    }

    heatLifeSupportPilotHits(_heat: number): number {
        return 0;
    }

    submergedLifeSupportPilotHits(): number {
        return 0;
    }

    headHitPilotHits(): number {
        return 0;
    }

    getActivePilotCrewId(): number | null {
        const primaryPilot = this.unit.getCrewMember(0);
        if (primaryPilot && isCrewMemberAvailable(primaryPilot.getState())) return 0;

        return this.unit.getCrewMembers().reduce<CrewMember | null>((best, crew) => {
            if (crew.getId() === 0 || !isCrewMemberAvailable(crew.getState())) return best;
            if (!best || crew.getSkill('piloting') < best.getSkill('piloting')) return crew;
            if (crew.getSkill('piloting') === best.getSkill('piloting') && crew.getId() < best.getId()) return crew;
            return best;
        }, null)?.getId() ?? null;
    }

    getMaxDistanceForMoveMode(_moveMode: MotiveModes): number | null {
        return null;
    }

    getEffectiveMaxDistanceForMoveMode(moveMode: MotiveModes, _turnState: TurnState): number | null {
        return this.getMaxDistanceForMoveMode(moveMode);
    }

    getMovementPointsSpent(_turnState: TurnState): number {
        return 0;
    }

    getMinDistanceForMoveMode(_moveMode: MotiveModes): number | null {
        return null;
    }

    isMotiveModeAvailable(_moveMode: MotiveModes): boolean {
        return true;
    }

    getAttackMovementModifier(_moveMode: MotiveModes | null | undefined, _airborne: boolean = false): number {
        return 0;
    }

    getSpottingModifier(): number {
        return 1;
    }

    getBaseGunnerySkill(): number {
        return this.unit.getCrewMember(0)?.getSkill('gunnery') ?? this.unit.gunnerySkill();
    }

    getBasePilotingSkill(): number {
        const crewId = this.getActivePilotCrewId();
        return (crewId === null ? null : this.unit.getCrewMember(crewId)?.getSkill('piloting'))
            ?? this.unit.pilotingSkill();
    }

    getStandardControlRollTarget(): number {
        return this.getBasePilotingSkill() + this.PSRModifiers().modifier;
    }

    getAttackModifierBreakdown(turnState: TurnState): UnitModifierBreakdownEntry[] {
        const entries: UnitModifierBreakdownEntry[] = [];
        const moveMode = turnState.effectiveMoveMode();
        const movementModifier = this.getAttackMovementModifier(moveMode, turnState.airborne() ?? false);
        if (movementModifier !== 0 && moveMode !== null) {
            entries.push({
                label: getMotiveModeLabel(moveMode, this.unit.getUnit(), turnState.airborne() ?? false),
                modifier: movementModifier,
                priority: ATTACK_MOVEMENT_MODIFIER_BREAKDOWN_PRIORITY
            });
        }
        return entries;
    }

    getDefenseModifierBreakdown(turnState: TurnState): UnitModifierBreakdownEntry[] {
        const entries: UnitModifierBreakdownEntry[] = [];
        if (turnState.unitState.hasCondition('immobile')) {
            entries.push({ label: 'Immobile', modifier: TN_IMMOBILE });
        }
        if (this.unit.gameRules.supportsSkidding && turnState.unitState.hasCondition('skidding')) {
            entries.push({ label: 'Skidding', modifier: TN_SKIDDING_MODIFIER });
        }
        const moveMode = turnState.effectiveMoveMode();
        if (moveMode === 'jump') {
            entries.push({ label: 'Jumped', modifier: TN_AIRBORNE_MOVE_TYPE_MODIFIER });
        } else if (turnState.airborne() === true) {
            entries.push({ label: 'Airborne', modifier: TN_AIRBORNE_MOVE_TYPE_MODIFIER });
        }
        if (moveMode !== 'stationary' && moveMode !== null) {
            const moveDistance = turnState.moveDistance() || 0;
            const movementBracket = getTargetMovementBracketForDistance(moveDistance);
            entries.push({
                label: `Moved ${movementBracket?.label ?? moveDistance} hexes`,
                modifier: movementBracket?.modifier ?? 0,
            });
        }
        entries.push(...this.getTargetUnitTypeModifierBreakdown(turnState));
        return entries;
    }

    chargeDamage(): ChargeDamage {
        return this.computeChargeDamage();
    }

    applyInventoryControlDisplayEffects(entry: MountedEquipment, display: InventoryControlDisplayData): InventoryControlDisplayData {
        if (!entry.isIntrinsicPhysicalAttack() || entry.name.toLowerCase() !== 'charge') return display;
        const chargeDamage = this.chargeDamage();
        if (chargeDamage.displayFormula) {
            return {
                ...display,
                damage: chargeDamage.displayFormula,
            };
        }
        if (chargeDamage.damage === null || chargeDamage.maxDamage === null) {
            return chargeDamage.bonusDamage > 0
                ? { ...display, damage: `${display.damage}+${chargeDamage.bonusDamage}` }
                : display;
        }
        return {
            ...display,
            damage: chargeDamage.damage === chargeDamage.maxDamage
                ? `${chargeDamage.damage}`
                : `${chargeDamage.damage} [${chargeDamage.maxDamage}]`,
        };
    }

    protected computeChargeDamage(bonusDamage = 0, maxBonusDamage = bonusDamage): ChargeDamage {
        const damagePerTMM = this.unit.getUnit().tons / 5;
        const moveMode = this.unit.turnState().effectiveMoveMode();
        const ramPlates = this.unit.getInventory().filter(entry => entry.equipment?.hasFlag('F_RAM_PLATE'));
        const hasRamPlate = ramPlates.length > 0;
        const hasWorkingRamPlate = ramPlates.some(entry => this.unit.isEquipmentOperational(entry));
        const damageFor = (movementModifier: number, hasRamPlate: boolean): number => {
            const baseDamage = Math.ceil(damagePerTMM * (movementModifier + 1));
            return hasRamPlate ? Math.ceil(baseDamage * 1.5) : baseDamage;
        };
        const movementModifier = getTargetMovementDistanceModifier(this.unit.turnState().moveDistance());
        const maxRunDistance = this.unit.getUnit().run;
        const maxMovementModifier = getTargetMovementDistanceModifier(maxRunDistance);
        const formulaDamagePerTMM = Math.round(
            damagePerTMM * (hasWorkingRamPlate ? 1.5 : 1) * 100,
        ) / 100;
        return {
            damage: damageFor(movementModifier, hasWorkingRamPlate) + bonusDamage,
            maxDamage: damageFor(maxMovementModifier, hasRamPlate) + maxBonusDamage,
            bonusDamage,
            maxBonusDamage,
            ...(moveMode !== 'walk' && moveMode !== 'run' && {
                displayFormula: `${formulaDamagePerTMM}×(TMM+1)${bonusDamage > 0 ? `+${bonusDamage}` : ''}`,
            }),
        };
    }

    protected getTargetUnitTypeModifierBreakdown(_turnState: TurnState): UnitModifierBreakdownEntry[] {
        return [];
    }

    protected hasFunctionalCrew(): boolean {
        if (this.hasDroneOperatingSystem()) return false;
        const crew = this.unit.getCrewMembers();
        return crew.length > 0 && crew.some(crewMember => crewMember.getState() === 'healthy');
    }

    protected allCrewUnconscious(): boolean {
        const crew = this.unit.getCrewMembers();
        return crew.length > 0 && crew.every(crewMember => crewMember.getState() === 'unconscious');
    }

    protected allCrewCrippled(): boolean {
        if (this.hasDroneOperatingSystem()) return false;
        const crew = this.unit.getCrewMembers();
        return crew.length > 0 && crew.every(crewMember => crewMember.isCrippled());
    }
}

/** Format a piloting skill value for display with its control-roll modifier. */
export function formatPilotingDisplay(pilotingSkill: number, controlRollModifier: number, controlRollLabel = 'PSR'): string {
    if (!controlRollModifier) return pilotingSkill.toString();
    const sign = controlRollModifier > 0 ? '+' : '';
    return `${pilotingSkill} ${sign}${controlRollModifier}${controlRollLabel}`;
}

/** Format a gunnery skill value for display, applying the unit's own attack modifier. */
export function formatGunneryDisplay(gunnerySkill: number, attackerModifier: number): string {
    if (!attackerModifier) return gunnerySkill.toString();
    const sign = attackerModifier > 0 ? '+' : '';
    return `${gunnerySkill}${sign}${attackerModifier}`;
}
