// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { compareText } from '../../utils/string.util';
import type { ComponentId } from '../entity/entity-identifiers';
import type { MekEntity } from '../entity/entities/mek/mek-entity';
import type { CBTRuleset } from '../cbt-ruleset.model';
import type { UnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import { calculateModifierTotal, type UnitModifierBreakdownEntry, type UnitModifierTotal } from '../combat-modifier';
import { gameRulesFor } from '../rules/game-rules';
import {
    getDefaultAttackerMovementModifier,
    getTargetMovementBracketForDistance,
    TN_AIRBORNE_MOVE_TYPE_MODIFIER,
    TN_IMMOBILE,
    TN_PRONE,
    TN_PRONE_ADJACENT,
    TN_SKIDDING_MODIFIER,
} from '../target-number-calculator.model';
import type { MekRuntimeIndex } from './mek-runtime-index';
import type { MekHeatAutomationPolicyV2, MekHeatProjectionResultV2, MekHeatStateV2 } from './mek-heat-state-v2';
import { movementBoosterUsableWhile } from './component-escalating-failure';
import type { MekMovementModeV2, MekMovementPsrProjectionResultV2, MekMovementPsrStateV2 } from './mek-movement-psr-v2';
import type { MekUnitQueryPort } from './unit-instance';
import type { MekTurnStateV2 } from './mek-turn-state-v2';
import { MEK_TORSO_CRIPPLING_RULE_CHECK_KEY, type MekRuleCheckStateV2 } from './mek-destruction-state-v2';
import { isUnitBuildingLevel, resolveUnitBuildingCoverState, type UnitBuildingCoverState } from '../unit-cover.model';
import { mekUnitHeight, resolveMekUnitWaterState } from './mek-targeting-rules';
import { getMekLocationLabel } from '../entity/types';
import type { UnitConditionKey } from '../unit-condition.model';
import { isCrewDeathCommitted } from './cbt-unit-runtime';

export type MekAttackMovementModifiers = Readonly<Record<MekMovementModeV2, number>>;

export interface MekTurnPanelRuleCheck {
    readonly key: typeof MEK_TORSO_CRIPPLING_RULE_CHECK_KEY;
    readonly check: MekRuleCheckStateV2;
    readonly reason: 'Crippling destruction';
    readonly targetNumber: number | null;
}

/**
 * Complete typed turn-tracker read model for the retained Mek UI. Neither an
 * SVG nor UnitSummary participates in this projection.
 */
export interface MekTurnPanelSnapshot {
    readonly entityUuid: UnitUuid;
    readonly stateRevision: number;
    readonly hasPendingCombat: boolean;
    readonly hasPendingPhaseChanges: boolean;
    readonly movement: MekMovementPsrProjectionResultV2;
    readonly movementState: MekMovementPsrStateV2;
    readonly ruleChecks: readonly MekTurnPanelRuleCheck[];
    readonly activeBoosterComponentIds: readonly ComponentId[];
    readonly locationLabels: Readonly<Record<string, string>>;
    readonly attackMovementModifiers: MekAttackMovementModifiers;
    readonly defenseModifierBreakdown: readonly UnitModifierBreakdownEntry[];
    readonly defenseModifierTotal: UnitModifierTotal;
    readonly canTakeActiveActions: boolean;
    readonly spottingModifier: number;
    readonly turn: MekTurnStateV2;
    readonly cover: Readonly<{
        readonly partiallyUnderwater: boolean;
        readonly submerged: boolean;
        readonly building: UnitBuildingCoverState;
    }>;
    readonly heat: MekHeatStateV2;
    readonly heatProjection: MekHeatProjectionResultV2;
    readonly conditions: readonly UnitConditionKey[];
}

export function projectMekTurnPanel(
    entity: MekEntity,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    query: MekUnitQueryPort,
    heatPolicy: MekHeatAutomationPolicyV2,
): MekTurnPanelSnapshot {
    const turn = query.turnState();
    const activeBoosterComponentIds = [...index.components]
        .filter(([componentId, component]) => component.kind === 'equipment'
            && movementBoosterUsableWhile(component.mount.equipment, turn.airborne)
            && query.componentStatus(componentId) !== 'disabled'
            && query.componentEscalatingFailure(componentId)?.active === true)
        .map(([componentId]) => componentId)
        .sort(compareText);
    const locationLabels = Object.freeze(Object.fromEntries([...index.locations.values()]
        .map(location => [
            location.id,
            getMekLocationLabel(location.code) ?? location.code,
        ])));
    const displayedConditions: readonly UnitConditionKey[] = [
        'shutdown', 'prone', 'immobile', 'skidding', 'disconnected',
    ];
    const conditions = displayedConditions
        .filter(condition => query.hasCondition(condition));
    const prone = conditions.includes('prone');
    const height = mekUnitHeight(entity, prone);
    const movement = query.mekMovementPsr();
    const runtimeMovementState = query.mekMovementPsrState();
    const pilotChecks = query.mekPilotChecks();
    const movementState = pilotChecks === runtimeMovementState.checks
        ? runtimeMovementState
        : Object.freeze({ ...runtimeMovementState, checks: pilotChecks });
    const torsoCheck = query.mekRuleCheck(MEK_TORSO_CRIPPLING_RULE_CHECK_KEY);
    const ruleChecks = torsoCheck?.status === 'pending'
        ? Object.freeze([Object.freeze({
            key: MEK_TORSO_CRIPPLING_RULE_CHECK_KEY,
            check: torsoCheck,
            reason: 'Crippling destruction' as const,
            targetNumber: movement.kind === 'supported'
                ? movement.pilotingTargetNumber
                : null,
        })])
        : Object.freeze([]);
    const water = resolveMekUnitWaterState(entity, turn.cover, prone);
    const building = resolveUnitBuildingCoverState(
        isUnitBuildingLevel(turn.cover) ? turn.cover : undefined,
        height,
    );
    const attackMovementModifiers = Object.freeze({
        stationary: 0,
        walk: mekAttackMovementModifier(entity, 'walk', turn.airborne === true),
        run: mekAttackMovementModifier(entity, 'run', turn.airborne === true),
        sprint: 0,
        jump: mekAttackMovementModifier(entity, 'jump', turn.airborne === true),
        UMU: mekAttackMovementModifier(entity, 'UMU', turn.airborne === true),
    });
    const defenseModifierBreakdown = projectMekDefenseModifierBreakdown(
        ruleset,
        movementState,
        turn,
        conditions,
    );
    const stationaryAction = movement.kind === 'supported'
        ? movement.actions.find(action => action.kind === 'stationary')
        : undefined;
    const activeActionBlockers = new Set(['DESTROYED', 'SHUTDOWN', 'NO_FUNCTIONAL_CONTROL']);
    const canTakeActiveActions = stationaryAction !== undefined
        && !stationaryAction.reasons.some(reason => activeActionBlockers.has(reason.code));
    return Object.freeze({
        entityUuid: entity.uuid(),
        stateRevision: query.stateRevision,
        hasPendingCombat: query.hasPendingCombat(),
        hasPendingPhaseChanges: query.hasPendingPhaseChanges(),
        movement,
        movementState,
        ruleChecks,
        activeBoosterComponentIds: Object.freeze(activeBoosterComponentIds),
        locationLabels,
        attackMovementModifiers,
        defenseModifierBreakdown,
        defenseModifierTotal: calculateModifierTotal(defenseModifierBreakdown),
        canTakeActiveActions,
        spottingModifier: projectMekSpottingModifier(entity, index, query),
        turn,
        cover: Object.freeze({ ...water, building }),
        heat: query.heatState(),
        heatProjection: query.heatProjection(heatPolicy),
        conditions: Object.freeze(conditions),
    });
}

/** Production Mek attacker movement rule, including airborne LAM movement. */
export function mekAttackMovementModifier(
    entity: MekEntity,
    mode: MekMovementModeV2,
    airborne: boolean,
): number {
    if (entity.chassisConfig === 'LAM' && airborne) {
        if (mode === 'walk') return 3;
        if (mode === 'run') return 4;
    }
    return getDefaultAttackerMovementModifier(mode);
}

export function isMekTurnPanelDirty(snapshot: MekTurnPanelSnapshot): boolean {
    return snapshot.hasPendingCombat
        || snapshot.movementState.movement !== null
        || snapshot.movementState.action !== null
        || snapshot.movementState.damageThisPhase > 0
        || snapshot.movementState.checks.length > 0
        || snapshot.movementState.automaticFalls.length > 0
        || snapshot.ruleChecks.length > 0
        || snapshot.turn.airborne !== null
        || snapshot.turn.cover !== null
        || snapshot.turn.weaponsHeat > 0
        || snapshot.turn.acknowledgedHeatSources.size > 0
        || snapshot.turn.heatDissipationConsumed > 0
        || snapshot.turn.spotting
        || snapshot.turn.phaseStateChanged
        || snapshot.heat.pendingOverride !== undefined
        || (snapshot.heatProjection.kind === 'supported'
            && snapshot.heatProjection.projection.hasPendingSettlement);
}

export function isMekTurnPanelDirtyPhase(snapshot: MekTurnPanelSnapshot): boolean {
    return snapshot.hasPendingPhaseChanges;
}

/** Production turn-button phase: movement selection first, then weapon fire. */
export function mekTurnPanelPhase(snapshot: MekTurnPanelSnapshot): 'M' | 'W' | 'P' | 'H' {
    const coreImmobile = snapshot.movement.kind === 'supported'
        && snapshot.movement.rulesFlavor === 'core-2026'
        && snapshot.movement.immobile;
    return snapshot.movementState.movement === null
        && snapshot.movementState.action === null
        && !coreImmobile
        ? 'M'
        : 'W';
}

function projectMekDefenseModifierBreakdown(
    ruleset: CBTRuleset,
    movementState: MekMovementPsrStateV2,
    turn: MekTurnStateV2,
    conditions: readonly UnitConditionKey[],
): readonly UnitModifierBreakdownEntry[] {
    const entries: UnitModifierBreakdownEntry[] = [];
    if (conditions.includes('immobile')) entries.push({ label: 'Immobile', modifier: TN_IMMOBILE });
    if (gameRulesFor(ruleset).supportsSkidding && conditions.includes('skidding')) {
        entries.push({ label: 'Skidding', modifier: TN_SKIDDING_MODIFIER });
    }
    const movement = movementState.movement;
    if (movement?.mode === 'sprint') {
        entries.push({ label: 'Sprinting', modifier: -1 });
    }
    if (movement?.mode === 'jump') {
        entries.push({ label: 'Jumped', modifier: TN_AIRBORNE_MOVE_TYPE_MODIFIER });
    } else if (turn.airborne === true) {
        entries.push({ label: 'Airborne', modifier: TN_AIRBORNE_MOVE_TYPE_MODIFIER });
    }
    if (movement !== null && movement.mode !== 'stationary') {
        const bracket = getTargetMovementBracketForDistance(movement.distance);
        entries.push({
            label: `Moved ${bracket?.label ?? movement.distance} hexes`,
            modifier: bracket?.modifier ?? 0,
        });
    }
    if (conditions.includes('prone')) {
        entries.push({
            label: 'Prone',
            modifier: Math.max(TN_PRONE, TN_PRONE_ADJACENT),
            alternateModifier: Math.min(TN_PRONE, TN_PRONE_ADJACENT),
            alternateModifierLabel: 'adjacent',
        });
    }
    return Object.freeze(entries.map(entry => Object.freeze(entry)));
}

export function projectMekSpottingModifier(
    entity: MekEntity,
    index: MekRuntimeIndex,
    query: MekUnitQueryPort,
): number {
    if (!entity.mountedCockpit().hasCommandConsoleBonus) return 1;
    const crewByOccurrence = new Map([...index.crewPositions.values()]
        .map(position => [position.occurrence, position] as const));
    for (const occurrence of [0, 1]) {
        const position = crewByOccurrence.get(occurrence);
        if (!position) return 1;
        const state = query.crewState(position.id);
        if (state.unconscious || state.ejected || isCrewDeathCommitted(state)) return 1;
    }
    const cockpit = [...index.components.values()].find(component =>
        component.kind === 'system' && component.systemType === 'Cockpit');
    if (!cockpit || query.componentStatus(cockpit.id) !== 'available') return 1;
    const slots = [...index.slots.values()].filter(slot => slot.componentIds.includes(cockpit.id));
    return slots.length >= 2 && slots.every(slot =>
        query.criticalHits(slot.id) === 0 && query.remainingInternal(slot.locationId) > 0)
        ? 0
        : 1;
}
