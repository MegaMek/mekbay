// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CrewMemberState } from './crew.model';
import type { MekLocationConditionKey } from './runtime/runtime-state';
import type { UnitConditionKey } from './unit-condition.model';

export const NARC_CONDITION_COLOR = '#f00';

export interface LocationConditionControl {
    readonly key: MekLocationConditionKey;
    readonly label: string;
    readonly color: string;
    readonly counted?: boolean;
}

export type UnitConditionControlPlacement = 'button' | 'menu';

export interface UnitConditionDefinition {
    readonly key: UnitConditionKey;
    readonly label: string;
    readonly bannerLabel?: string;
    readonly bannerFontScaling?: number;
    readonly bannerTextColor?: string;
    readonly color: string;
    readonly placement?: UnitConditionControlPlacement;
    readonly important?: boolean;
}

export type UnitConditionControl = UnitConditionDefinition & {
    readonly placement: UnitConditionControlPlacement;
};

export interface CrewStateDefinition {
    readonly key: CrewMemberState;
    readonly label: string;
    readonly bannerLabel: string;
    readonly color: string;
}

export type CrewStateControlKey = Exclude<CrewMemberState, 'healthy' | 'dead'>;
export type CrewStateControlDefinition = CrewStateDefinition & {
    readonly key: CrewStateControlKey;
};

export const UNIT_CONDITION_DEFINITIONS: readonly UnitConditionDefinition[] = Object.freeze([
    Object.freeze({ key: 'shutdown', important: true, label: 'SHUTDOWN', color: '#840000', placement: 'button' }),
    Object.freeze({ key: 'abandoned', important: true, label: 'ABANDONED', color: '#222' }),
    Object.freeze({ key: 'disconnected', important: true, label: 'UNLINK', bannerLabel: 'DISCONNECTED', bannerFontScaling: 0.8, color: '#455a64', placement: 'button' }),
    Object.freeze({ key: 'immobile', label: 'IMMOBILE', color: '#ff8800' }),
    Object.freeze({ key: 'prone', label: 'PRONE', color: '#666', placement: 'button' }),
    Object.freeze({ key: 'crippled', label: 'CRIPPLED', color: '#b70000' }),
    Object.freeze({ key: 'swarmed', label: 'SWARMED', color: '#46b48e', placement: 'menu' }),
    Object.freeze({ key: 'tagged', label: 'TAGGED', color: '#3385d7', placement: 'menu' }),
    Object.freeze({ key: 'ecm-shielded', label: 'ECM SHIELDED', color: '#008f7a', placement: 'menu' }),
    Object.freeze({ key: 'skidding', label: 'SKIDDING', color: '#bfb300', placement: 'menu' }),
    Object.freeze({ key: 'jammed', label: 'JAMMED', color: '#ff6be6', placement: 'menu' }),
    Object.freeze({ key: 'out-of-control', important: true, label: 'OUT OF CONTROL', color: '#d46b00', placement: 'menu' }),
    Object.freeze({ key: 'random-movement', important: true, label: 'RANDOM MOVEMENT', color: '#b56bdb', placement: 'menu' }),
    Object.freeze({ key: 'spotting', label: 'SPOTTING', color: '#471fad' }),
    Object.freeze({ key: 'stealth', label: 'STEALTH', color: '#226' }),
    Object.freeze({ key: 'airborne', label: 'AIRBORNE', color: '#1976d2' }),
]);

const UNIT_CONDITION_BY_KEY = new Map<UnitConditionKey, UnitConditionDefinition>(
    UNIT_CONDITION_DEFINITIONS.map(condition => [condition.key, condition]),
);
const UNIT_CONDITION_SORT_INDEX = new Map(
    UNIT_CONDITION_DEFINITIONS.map((condition, index) => [condition.key, index]),
);

export function unitConditionControls(keys: readonly UnitConditionKey[]): readonly UnitConditionControl[] {
    return Object.freeze(keys.map(key => {
        const condition = UNIT_CONDITION_BY_KEY.get(key);
        if (!condition?.placement) throw new Error(`Unknown controllable unit condition: ${key}`);
        return condition as UnitConditionControl;
    }));
}

export function getUnitConditionDefinition(key: UnitConditionKey): UnitConditionDefinition {
    const condition = UNIT_CONDITION_BY_KEY.get(key);
    if (!condition) throw new Error(`Missing presentation for unit condition ${key}`);
    return condition;
}

export function unitConditionSortIndex(key: UnitConditionKey): number {
    return UNIT_CONDITION_SORT_INDEX.get(key) ?? UNIT_CONDITION_DEFINITIONS.length;
}

const CREW_STATE_DEFINITIONS: readonly CrewStateDefinition[] = Object.freeze([
    Object.freeze({ key: 'unconscious', label: 'Unconscious', bannerLabel: 'UNCONSCIOUS', color: '#ff9a1f' }),
    Object.freeze({ key: 'ejected', label: 'Eject', bannerLabel: 'EJECTED', color: '#2f8f46' }),
    Object.freeze({ key: 'dead', label: 'Dead', bannerLabel: 'DEAD', color: '#c62828' }),
    Object.freeze({ key: 'killed', label: 'Crew Killed', bannerLabel: 'CREW KILLED', color: '#c62828' }),
    Object.freeze({ key: 'stunned', label: 'Stunned', bannerLabel: 'STUNNED', color: '#ff5ce6' }),
]);
const CREW_STATE_BY_KEY = new Map(CREW_STATE_DEFINITIONS.map(state => [state.key, state]));

export function crewStateDefinitions(keys: readonly CrewMemberState[]): readonly CrewStateDefinition[] {
    return Object.freeze(keys.map(key => {
        const state = CREW_STATE_BY_KEY.get(key);
        if (!state) throw new Error(`Unknown crew state: ${key}`);
        return state;
    }));
}

export function formatPilotingDisplay(
    pilotingSkill: number,
    controlRollModifier: number,
    controlRollLabel = 'PSR',
): string {
    if (!controlRollModifier) return pilotingSkill.toString();
    return `${pilotingSkill} ${controlRollModifier > 0 ? '+' : ''}${controlRollModifier}${controlRollLabel}`;
}

export function formatGunneryDisplay(gunnerySkill: number, attackerModifier: number): string {
    if (!attackerModifier) return gunnerySkill.toString();
    return `${gunnerySkill}${attackerModifier > 0 ? '+' : ''}${attackerModifier}`;
}
