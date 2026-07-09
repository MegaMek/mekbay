/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
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

import { computed, signal, type Signal } from '@angular/core';
import type { CriticalSlot, MountedEquipment } from '../force-serialization';
import { getMotiveModeLabel, type MotiveModes } from '../motiveModes.model';
import type { TurnState } from '../turn-state.model';
import type { CrewMemberState } from '../crew-member.model';
import {
    getTargetMovementBracketForDistance,
    TN_AIRBORNE_MOVE_TYPE_MODIFIER,
    TN_IMMOBILE,
    TN_SKIDDING_ATTACKER,
    TN_SKIDDING_MODIFIER,
} from '../target-number-calculator.model';
import type { CBTForceUnit } from '../cbt-force-unit.model';
import type { HeatDissipationState } from './heat-management';

export interface PSRCheck {
    fallCheck?: number;
    pilotCheck?: number;
    reason: string;
    loc?: string;
    legFilter?: string;
    ignorePreExistingGyro?: boolean;
}

export interface UnitSkillModifier {
    modifier: number;
    reason: string;
}

export interface UnitHeatSource {
    id: string;
    label: string;
    value: number;
}

export interface MountedEquipmentRuleState {
    isDamaged: boolean;
    isDisabled: boolean;
    hitMod: number;
}

export const ENTRY_DISABLED_STATE_KEY = 'disabled';
export const ENTRY_DISABLED_STATE_VALUE = 'true';

export interface LocationConditionControl {
    key: string;
    label: string;
    color: string;
    counted?: boolean;
}

export interface UnitModifierBreakdownEntry {
    label: string;
    modifier: number;
    alternateModifier?: number;
    alternateModifierLabel?: string;
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
    color: string;
    placement?: UnitConditionControlPlacement;
    important?: boolean;
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
    { key: 'abandoned', important: true, label: 'ABANDONED', color: '#222' },
    { key: 'disconnected', important: true, label: 'UNLINK', bannerLabel: "DISCONNECTED", bannerFontScaling: 0.8, color: '#455a64', placement: 'button' },
    { key: 'immobile', label: 'IMMOBILE', color: '#ff8800' },
    { key: 'prone', label: 'PRONE', color: '#666', placement: 'button' },
    { key: 'crippled', label: 'CRIPPLED', color: '#b70000' },
    { key: 'swarmed', label: 'SWARMED', color: '#56ddae', placement: 'menu' },
    { key: 'tagged', label: 'TAGGED', color: '#3385d7', placement: 'menu' },
    { key: 'skidding', label: 'SKIDDING', color: '#dccd00', placement: 'menu' },
    { key: 'jammed', label: 'JAMMED', color: '#ff6be6', placement: 'menu' },
];

const UNIT_CONDITION_BY_KEY = new Map<string, UnitConditionDefinition>(UNIT_CONDITION_DEFINITIONS.map(condition => [condition.key, condition]));
const UNIT_CONDITION_SORT_INDEX = new Map<string, number>(UNIT_CONDITION_DEFINITIONS.map((condition, index) => [condition.key, index]));

export function unitConditionControls(keys: readonly string[]): readonly UnitConditionControl[] {
    return keys.map(key => {
        const condition = UNIT_CONDITION_BY_KEY.get(key);
        if (!condition?.placement) throw new Error(`Unknown controllable unit condition: ${key}`);
        return condition as UnitConditionControl;
    });
}

export function getUnitConditionDefinition(key: string): UnitConditionDefinition | undefined {
    return UNIT_CONDITION_BY_KEY.get(key);
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
 * Author: Drake
 * 
 * Strategy interface for unit-type-specific game rules.
 * Each CBTForceUnit holds a `rules` instance matching its unit type.
 */
export interface UnitTypeRules {
    /** Evaluate whether the unit should be marked destroyed based on current state. Idempotent. */
    evaluateDestroyed(): void;

    /** Short label for required control rolls (PSR, DSR, etc.). */
    readonly controlRollShortLabel: string;

    /** Full label for required control rolls. */
    readonly controlRollFullLabel: string;

    /** Piloting Skill Roll modifiers. Non-Mek types return { modifier: 0, modifiers: [] }. */
    readonly PSRModifiers: Signal<{ modifier: number; modifiers: PSRCheck[] }>;

    /** PSR target roll number (piloting skill + modifiers). Non-Mek types return 0. */
    readonly PSRTargetRoll: Signal<number>;

    /** Gunnery modifier breakdown for UI display. */
    readonly gunneryModifiers: Signal<UnitSkillModifier[]>;

    /** Gunnery skill modifier total from unit-type-specific rules. */
    readonly gunneryModifier: Signal<number>;

    /** Piloting modifier breakdown from unit-type-specific rules. */
    readonly pilotingModifiers: Signal<UnitSkillModifier[]>;

    /** Piloting skill modifier total from unit-type-specific rules. */
    readonly pilotingModifier: Signal<number>;

    /** Whether current phase damage causes automatic falling or equivalent unit-type failure. */
    readonly autoFall: Signal<boolean>;

    /** Heat dissipation state for heat-tracking units. Non-heat units return null. */
    readonly heatDissipation: Signal<HeatDissipationState | null>;

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

    /** Compute rule-derived availability and hit modifiers for all inventory entries. */
    computeAllEntryStates(): Map<MountedEquipment, MountedEquipmentRuleState>;

    /** Compute rule-derived availability and hit modifiers for a single inventory entry. */
    computeEntryState(entry: MountedEquipment): MountedEquipmentRuleState;

    /** Required control-roll checks for the current phase. */
    getPSRChecks(turnState: TurnState): PSRCheck[];

    /** Movement-mode warning roll caused by committed damage. */
    getCommittedDamageMovementModePSRCheck(moveMode: MotiveModes | null): PSRCheck | null;

    /** Evaluate whether internal damage creates unit-type-specific control-roll checks. */
    evaluateLegDestroyed(location: string, hits: number): void;

    /** Evaluate whether critical damage creates unit-type-specific control-roll checks. */
    evaluateCritSlotHit(crit: CriticalSlot): void;

    /** Heat sources produced by current phase choices and damage state. */
    heatSources(turnState: TurnState): UnitHeatSource[];

    /** Unit-type-specific movement distance override. Return null to use base unit data. */
    getMaxDistanceForMoveMode(moveMode: MotiveModes): number | null;

    /** Unit-type-specific effective movement distance for turn-state choices. */
    getEffectiveMaxDistanceForMoveMode(moveMode: MotiveModes, turnState: TurnState): number | null;

    /** Unit-type-specific minimum movement distance override. Return null to use 0. */
    getMinDistanceForMoveMode(moveMode: MotiveModes): number | null;

    /** Unit-type-specific movement mode availability. */
    isMotiveModeAvailable(moveMode: MotiveModes): boolean;

    /** Unit-type-specific attack movement modifier. */
    getAttackMovementModifier(moveMode: MotiveModes | null | undefined, airborne?: boolean): number;

    /** Unit-type-specific attack modifier for spotting. */
    getSpottingModifier(): number;

    /** Unit-type-specific attack modifier for indirect fire. */
    getIndirectFireModifier(): number;

    /** Unit-type-specific gunnery skill for runtime target-number calculations. */
    getTargetNumberGunnerySkill(): number;

    /** Unit-type-specific piloting skill for runtime target-number calculations. */
    getTargetNumberPilotingSkill(): number;

    /** Gunnery-specific runtime target-number modifier breakdown. */
    getTargetNumberGunneryModifierBreakdown(): UnitModifierBreakdownEntry[];

    /** Piloting-specific runtime target-number modifier breakdown. */
    getTargetNumberPilotingModifierBreakdown(): UnitModifierBreakdownEntry[];

    /** Attack modifier breakdown for turn summary UI. */
    getAttackModifierBreakdown(turnState: TurnState): UnitModifierBreakdownEntry[];

    /** Target movement modifier breakdown for turn summary UI. */
    getDefenseModifierBreakdown(turnState: TurnState): UnitModifierBreakdownEntry[];
}

export abstract class UnitTypeRulesBase implements UnitTypeRules {
    readonly controlRollShortLabel: string;
    readonly controlRollFullLabel: string;
    readonly PSRModifiers: Signal<{ modifier: number; modifiers: PSRCheck[] }> = signal({ modifier: 0, modifiers: [] });
    readonly PSRTargetRoll: Signal<number> = signal(0);
    readonly gunneryModifiers: Signal<UnitSkillModifier[]> = computed(() => this.droneOperatingSystemSkillModifiers());
    readonly gunneryModifier: Signal<number> = computed(() => this.gunneryModifiers().reduce((total, modifier) => total + modifier.modifier, 0));
    readonly pilotingModifiers: Signal<UnitSkillModifier[]> = computed(() => this.droneOperatingSystemSkillModifiers());
    readonly pilotingModifier: Signal<number> = computed(() => this.pilotingModifiers().reduce((total, modifier) => total + modifier.modifier, 0));
    readonly autoFall: Signal<boolean> = signal(false);
    readonly heatDissipation: Signal<HeatDissipationState | null> = signal(null);
    protected readonly baseConditionControls: readonly UnitConditionControl[] = [];
    protected readonly baseCrewStateControls: readonly CrewStateControlDefinition[] = [];
    readonly locationConditionControls: readonly LocationConditionControl[] = [];
    protected readonly crewStateDisplayDefinitions: readonly CrewStateDefinition[] = [];
    protected readonly abandoned: Signal<boolean> = signal(false);
    protected readonly immobile: Signal<boolean> = signal(false);
    protected readonly crippled: Signal<boolean> = signal(false);

    get conditionControls(): readonly UnitConditionControl[] {
        if (!this.hasDroneOperatingSystem()) return this.baseConditionControls;
        if (this.baseConditionControls.some(control => control.key === 'disconnected')) return this.baseConditionControls;
        return [...this.baseConditionControls, unitConditionControls(['disconnected'])[0]];
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

    isComputedCondition(condition: string): boolean {
        return condition === 'abandoned' || condition === 'immobile' || condition === 'crippled';
    }

    hasComputedCondition(condition: string): boolean {
        if (condition === 'abandoned' && this.hasDroneOperatingSystem()) return false;
        if (condition === 'disconnected') return this.isDroneOperatingSystemUnavailable();
        if (condition === 'abandoned') return this.abandoned();
        if (condition === 'immobile') return this.immobile() || (this.hasDroneOperatingSystem() && this.unit.getCondition('disconnected'));
        if (condition === 'crippled') return this.crippled();
        return false;
    }

    computedConditions(): readonly string[] {
        return ['abandoned', 'immobile', 'crippled', 'disconnected'];
    }

    computeAllEntryStates(): Map<MountedEquipment, MountedEquipmentRuleState> {
        const result = new Map<MountedEquipment, MountedEquipmentRuleState>();
        for (const entry of this.unit.getInventory()) {
            result.set(entry, this.computeEntryState(entry));
        }
        return result;
    }

    computeEntryState(entry: MountedEquipment): MountedEquipmentRuleState {
        return {
            isDamaged: entry.committedDestroyed() || this.entryCriticalSlots(entry).some(slot => !!slot.destroyed),
            isDisabled: this.isEntryStateDisabled(entry),
            hitMod: 0
        };
    }

    protected isEntryStateDisabled(entry: MountedEquipment): boolean {
        return entry.states.get(ENTRY_DISABLED_STATE_KEY) === ENTRY_DISABLED_STATE_VALUE;
    }

    protected entryCriticalSlots(entry: MountedEquipment): CriticalSlot[] {
        return entry.critSlots?.map(slot => this.currentCriticalSlot(slot)) ?? [];
    }

    protected currentCriticalSlot(slot: CriticalSlot): CriticalSlot {
        return this.unit.getCritSlots().find(candidate => {
            if (slot.loc && slot.slot !== undefined) return candidate.loc === slot.loc && candidate.slot === slot.slot;
            return !!slot.id && candidate.id === slot.id;
        }) ?? slot;
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
        return droneOperatingSystem !== undefined && this.unit.isEquipmentUnavailable(droneOperatingSystem);
    }

    protected droneOperatingSystemSkillModifiers(): UnitSkillModifier[] {
        return this.hasDroneOperatingSystem()
            ? [{ modifier: 1, reason: 'Drone operating system' }]
            : [];
    }

    getPSRChecks(_turnState: TurnState): PSRCheck[] {
        return [];
    }

    getCommittedDamageMovementModePSRCheck(_moveMode: MotiveModes | null): PSRCheck | null {
        return null;
    }

    evaluateLegDestroyed(_location: string, _hits: number): void {
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

    getMaxDistanceForMoveMode(_moveMode: MotiveModes): number | null {
        return null;
    }

    getEffectiveMaxDistanceForMoveMode(moveMode: MotiveModes, _turnState: TurnState): number | null {
        return this.getMaxDistanceForMoveMode(moveMode);
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

    getIndirectFireModifier(): number {
        return 1;
    }

    getTargetNumberGunnerySkill(): number {
        return this.unit.getCrewMember(0)?.getSkill('gunnery') ?? this.unit.gunnerySkill();
    }

    getTargetNumberPilotingSkill(): number {
        return this.unit.getCrewMember(0)?.getSkill('piloting') ?? this.unit.pilotingSkill();
    }

    getTargetNumberGunneryModifierBreakdown(): UnitModifierBreakdownEntry[] {
        return [];
    }

    getTargetNumberPilotingModifierBreakdown(): UnitModifierBreakdownEntry[] {
        return [];
    }

    getAttackModifierBreakdown(turnState: TurnState): UnitModifierBreakdownEntry[] {
        const entries = this.gunneryModifiers()
            .filter(modifier => modifier.modifier !== 0)
            .map(modifier => ({ label: modifier.reason, modifier: modifier.modifier }));
        const moveMode = turnState.moveMode();
        const movementModifier = this.getAttackMovementModifier(turnState.moveMode(), turnState.airborne() ?? false);
        if (movementModifier !== 0 && moveMode !== null) {
            entries.push({ label: getMotiveModeLabel(moveMode, this.unit.getUnit(), turnState.airborne() ?? false), modifier: movementModifier });
        }
        if (turnState.unitState.hasCondition('skidding')) {
            entries.push({ label: 'Skidding', modifier: TN_SKIDDING_ATTACKER });
        }
        const spottingModifier = turnState.spotting() ? this.getSpottingModifier() : 0;
        if (spottingModifier !== 0) {
            entries.push({ label: 'Spotting', modifier: spottingModifier });
        }
        return entries;
    }

    getDefenseModifierBreakdown(turnState: TurnState): UnitModifierBreakdownEntry[] {
        const entries: UnitModifierBreakdownEntry[] = [];
        if (turnState.unitState.hasCondition('immobile')) {
            entries.push({ label: 'Immobile', modifier: TN_IMMOBILE });
        }
        if (turnState.unitState.hasCondition('skidding')) {
            entries.push({ label: 'Skidding', modifier: TN_SKIDDING_MODIFIER });
        }
        const moveMode = turnState.moveMode();
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

/**
 * Format a piloting skill value for display, applying PSR modifiers.
 * Encapsulates the BattleTech rule: PSR target > 12 = automatic failure.
 */
export function formatPilotingDisplay(pilotingSkill: number, psrModifier: number): string {
    if (!psrModifier) return pilotingSkill.toString();
    const sign = psrModifier > 0 ? '+' : '';
    return `${pilotingSkill}${sign}${psrModifier}`;
}

/** Format a gunnery skill value for display, applying the unit's own attack modifier. */
export function formatGunneryDisplay(gunnerySkill: number, attackerModifier: number): string {
    if (!attackerModifier) return gunnerySkill.toString();
    const sign = attackerModifier > 0 ? '+' : '';
    return `${gunnerySkill}${sign}${attackerModifier}`;
}
