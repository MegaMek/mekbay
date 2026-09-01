// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { AutomationMode } from '../../models/options.model';
import { cbtUnitCheckPresentation } from '../../models/cbt-unit-check-presentation';
import {
    hasMekRuntime,
    hasNonMekRuntime,
    type CBTMekUnitSnapshot,
    type CBTNonMekUnitSnapshot,
    type CBTUnitSnapshot,
} from '../../models/cbt-unit-snapshot';
import { AmmoEquipment } from '../../models/equipment.model';
import { getMekLocationLabel } from '../../models/entity/types';
import { isAeroEntity } from '../../models/entity/utils/entity-type-guards';
import { isCrewDeathCommitted } from '../../models/runtime/cbt-unit-runtime';
import { projectAeroRuntimeRules } from '../../models/rules/aero-runtime-rules';
import { projectAeroHeatAutomationChecks } from '../../models/runtime/aero-heat-automation-rules';
import { MEK_TORSO_CRIPPLING_RULE_CHECK_KEY } from '../../models/runtime/mek-destruction-state-v2';
import { ammoExplosionDamagePerShot, ammoRackSize } from '../../models/runtime/mek-critical-hit-v2';
import { mekConsciousnessTarget, mekHeatAutomationChecks } from '../../models/runtime/mek-automation-rules';
import { projectMekLifeSupportPilotDamage } from '../../models/runtime/mek-life-support';
import type { MekAutomaticFallV2, MekPilotCheckV2 } from '../../models/runtime/mek-movement-psr-v2';
import { projectNonMekEndTurnHeat } from '../../models/runtime/non-mek-unit-instance';
import { MAX_MEK_CREW_WOUNDS } from '../../models/runtime/runtime-state';
import type { TooltipLine } from '../tooltip/tooltip.component';

export type RuntimeUnitNotificationKind =
    | 'fall'
    | 'psr'
    | 'critical-chance'
    | 'critical-hit'
    | 'unit-check';

export interface RuntimeUnitNotificationEvent {
    readonly kind: RuntimeUnitNotificationKind;
    readonly count: number;
    readonly tooltip: readonly TooltipLine[];
}

/** Detached notification facts shared by the sheet overlay and force unit card. */
export interface RuntimeUnitNotificationSnapshot {
    readonly pendingEvents: readonly RuntimeUnitNotificationEvent[];
    readonly automaticFallTooltip: readonly TooltipLine[] | null;
}

export interface RuntimeUnitNotificationOptions {
    /** `no` suppresses boundary resolution, never the informational PSR badge. */
    readonly pilotSkillCheck: AutomationMode;
    readonly pilotHitsAndConsciousnessCheck: AutomationMode;
    readonly heatAndDissipationResolution?: AutomationMode;
    readonly heatEffectsCheck?: AutomationMode;
}

/**
 * Projects the actionable phase work from the same end-phase preview consumed
 * by direct automation. Pending combat deliberately has no live PSR rows until
 * that preview, so reading only the current query loses exactly the work that
 * a cancelled End Phase must advertise.
 */
export function projectRuntimeUnitNotifications(
    snapshot: CBTUnitSnapshot | null | undefined,
    options: RuntimeUnitNotificationOptions,
): RuntimeUnitNotificationSnapshot | null {
    if (!snapshot) return null;
    return hasMekRuntime(snapshot)
        ? projectMekNotifications(snapshot, options)
        : hasNonMekRuntime(snapshot)
            ? projectNonMekNotifications(snapshot, options)
            : null;
}

function projectMekNotifications(
    snapshot: CBTMekUnitSnapshot,
    options: RuntimeUnitNotificationOptions,
): RuntimeUnitNotificationSnapshot {
    const preview = snapshot.query.hasPendingPhaseChanges()
        ? snapshot.query.previewEndPhase()
        : null;
    const phaseState = preview?.accepted && preview.state !== null
        ? preview.state
        : snapshot.state;
    const movementState = phaseState.movementPsr;
    const pendingEvents: RuntimeUnitNotificationEvent[] = [];

    const pendingFall = snapshot.state.turn.pendingFallConsequences;
    if (pendingFall) {
        pendingEvents.push(Object.freeze({
            kind: 'fall',
            count: 1,
            tooltip: Object.freeze([Object.freeze({
                label: 'Fall damage',
                value: `${pendingFall.totalDamage} damage pending`,
            })]),
        }));
    }

    for (const critical of snapshot.state.turn.pendingCriticalEvents ?? []) {
        const location = snapshot.index.locations.get(critical.locationId);
        const locationLabel = location
            ? getMekLocationLabel(location.code) ?? location.code
            : critical.locationId;
        pendingEvents.push(Object.freeze({
            kind: critical.type,
            count: critical.type === 'critical-hit' ? critical.remainingHits : 1,
            tooltip: Object.freeze([Object.freeze({
                label: `${critical.type === 'critical-hit' ? 'Critical Hit' : 'Critical Chance'}: ${locationLabel}`,
                value: critical.type === 'critical-hit'
                    ? `${critical.remainingHits} hit${critical.remainingHits === 1 ? '' : 's'} pending`
                    : criticalChanceStatus(critical.result),
            })]),
        }));
    }

    const recoveries = options.pilotHitsAndConsciousnessCheck === 'no'
        ? []
        : dueCrewRecoveries(snapshot);
    if (recoveries.length > 0) {
        pendingEvents.push(Object.freeze({
            kind: 'unit-check',
            count: recoveries.length,
            tooltip: Object.freeze(recoveries),
        }));
    }

    const automaticFall = movementState.automaticFalls.length > 0;
    const movement = snapshot.query.mekMovementPsr();
    const pilotCanControl = [...snapshot.index.crewPositions.values()].some(position => {
        const state = snapshot.query.crewState(position.id);
        return !state.ejected
            && !state.unconscious
            && state.wounds < MAX_MEK_CREW_WOUNDS;
    }) || movement.kind === 'supported' && movement.controlledByDrone;
    const pendingChecks = movementState.checks.filter(check => check.status === 'pending');
    const automaticallyFallingChecks = pendingChecks.filter(check =>
        check.source.triggerKind !== 'get-up'
        && (automaticFall || pilotCheckAutomaticallyFails(snapshot, check, pilotCanControl)));
    const checks = pendingChecks.filter(check =>
        !pilotCheckAutomaticallyFails(snapshot, check, pilotCanControl)
        && (!automaticFall || check.source.triggerKind === 'get-up'));
    const torsoCheck = phaseState.ruleChecks.get(MEK_TORSO_CRIPPLING_RULE_CHECK_KEY);
    const ruleCheckIsAutomatic = !pilotCanControl
        || snapshot.query.hasCondition('shutdown');
    const ruleTooltip: readonly TooltipLine[] = torsoCheck?.status === 'pending'
        && !ruleCheckIsAutomatic
        ? [Object.freeze({
            label: 'Crippling destruction',
            value: movement.kind === 'supported'
                ? `Target ${movement.pilotingTargetNumber}+`
                : 'Pending',
        })]
        : [];
    if (checks.length > 0 || ruleTooltip.length > 0) {
        pendingEvents.push(Object.freeze({
            kind: 'psr',
            count: checks.length + ruleTooltip.length,
            tooltip: Object.freeze([
                ...ruleTooltip,
                ...checks.map(check => Object.freeze({
                    label: check.reason,
                    value: `Target ${check.targetNumber}+`,
                })),
            ]),
        }));
    }

    const endTurnChecks = projectMekEndTurnChecks(snapshot, options);
    if (endTurnChecks.length > 0) {
        pendingEvents.push(Object.freeze({
            kind: 'unit-check',
            count: endTurnChecks.length,
            tooltip: Object.freeze(endTurnChecks),
        }));
    }

    return Object.freeze({
        pendingEvents: Object.freeze(pendingEvents),
        automaticFallTooltip: pendingFall
            ? null
            : automaticPilotFailureTooltip(automaticallyFallingChecks)
                ?? automaticFallTooltip(movementState.automaticFalls),
    });
}

function criticalChanceStatus(result: 'none' | 'blown-off' | 1 | 2 | 3 | 4): string {
    if (result === 'none') return 'No criticals';
    if (result === 'blown-off') return 'Blown off';
    return `${result} critical hit${result === 1 ? '' : 's'}`;
}

function projectMekEndTurnChecks(
    snapshot: CBTMekUnitSnapshot,
    options: RuntimeUnitNotificationOptions,
): readonly TooltipLine[] {
    if (snapshot.state.turn.endTurnCheckpoint !== 'phase-ended'
        || options.heatEffectsCheck === 'no') return Object.freeze([]);
    const projection = snapshot.query.heatProjection('automatic');
    const automaticHeat = projection.kind === 'supported'
        ? projection.projection.projected
        : snapshot.state.heat.current;
    const heat = options.heatAndDissipationResolution === 'no'
        ? snapshot.state.heat.pendingOverride ?? snapshot.state.heat.current
        : automaticHeat;
    const consciousPilot = [...snapshot.index.crewPositions.values()].some(position => {
        const state = snapshot.query.crewState(position.id);
        return !state.ejected && !state.unconscious && !isCrewDeathCommitted(state);
    });
    const hasExplosiveAmmo = [...snapshot.index.components.entries()].some(([componentId, component]) => {
        const equipment = component.mount?.equipment;
        return component.kind === 'equipment'
            && equipment instanceof AmmoEquipment
            && equipment.isExplosive()
            && snapshot.query.componentStatus(componentId, 'committed') === 'available'
            && snapshot.query.remainingAmmo(componentId) > 0;
    });
    const rows: TooltipLine[] = mekHeatAutomationChecks({
        heat,
        shutdown: snapshot.query.hasCondition('shutdown'),
        consciousPilot,
        hasExplosiveAmmo,
    }).map(check => Object.freeze({
        label: check.kind === 'shutdown'
            ? 'Heat shutdown check'
            : check.kind === 'startup'
                ? 'Shutdown recovery check'
                : 'Heat ammunition explosion check',
        value: check.target === undefined ? 'Automatic' : `Target ${check.target}+`,
    }));
    if (options.pilotHitsAndConsciousnessCheck !== 'no') {
        const lifeSupport = projectMekLifeSupportPilotDamage(
            snapshot.entity,
            snapshot.index,
            snapshot.ruleset,
            snapshot.query,
            heat,
        );
        if (lifeSupport.heatHits > 0) rows.push(Object.freeze({
            label: 'Life Support heat damage',
            value: `${lifeSupport.heatHits} pilot hit${lifeSupport.heatHits === 1 ? '' : 's'}`,
        }));
        if (lifeSupport.oxygenHits > 0) rows.push(Object.freeze({
            label: 'Life Support drowning',
            value: `${lifeSupport.oxygenHits} pilot hit${lifeSupport.oxygenHits === 1 ? '' : 's'}`,
        }));
    }
    return Object.freeze(rows);
}

function projectNonMekNotifications(
    snapshot: CBTNonMekUnitSnapshot,
    options: RuntimeUnitNotificationOptions,
): RuntimeUnitNotificationSnapshot {
    const events: RuntimeUnitNotificationEvent[] = [];
    const recoveries = options.pilotHitsAndConsciousnessCheck === 'no'
        ? []
        : dueCrewRecoveries(snapshot);
    const controlRecovery = snapshot.state.turn.controlRecovery;
    const controlDue = controlRecovery !== undefined
        && controlRecovery.readyTurn <= snapshot.state.turn.turnCounter
        && snapshot.query.hasCondition('out-of-control')
        && (controlRecovery.cause === 'heat-random-movement'
            ? options.heatEffectsCheck !== 'no'
            : options.pilotHitsAndConsciousnessCheck !== 'no');
    const tooltip: TooltipLine[] = [
        ...recoveries,
        ...(controlDue ? [Object.freeze({
            label: controlRecovery.cause === 'heat-random-movement'
                ? 'Heat control recovery'
                : 'Control recovery',
            value: 'Pending',
        })] : []),
    ];
    if (tooltip.length > 0) {
        events.push(Object.freeze({
            kind: 'unit-check',
            count: tooltip.length,
            tooltip: Object.freeze(tooltip),
        }));
    }
    const endTurnChecks = projectAeroEndTurnChecks(snapshot, options);
    if (endTurnChecks.length > 0) {
        events.push(Object.freeze({
            kind: 'unit-check',
            count: endTurnChecks.length,
            tooltip: endTurnChecks,
        }));
    }
    return Object.freeze({
        pendingEvents: Object.freeze(events),
        automaticFallTooltip: null,
    });
}

function projectAeroEndTurnChecks(
    snapshot: CBTNonMekUnitSnapshot,
    options: RuntimeUnitNotificationOptions,
): readonly TooltipLine[] {
    if (snapshot.state.turn.endTurnCheckpoint !== 'phase-ended'
        || options.heatEffectsCheck === 'no'
        || !isAeroEntity(snapshot.entity)) return Object.freeze([]);
    const heatProjection = projectNonMekEndTurnHeat(
        snapshot.entity,
        snapshot.index,
        snapshot.state,
        snapshot.ruleset,
    );
    if (!heatProjection) return Object.freeze([]);
    const heat = options.heatAndDissipationResolution === 'no'
        ? snapshot.state.heat.pendingOverride ?? snapshot.state.heat.current
        : heatProjection.projected;
    const state = heat === snapshot.state.heat.current
        ? snapshot.state
        : Object.freeze({
            ...snapshot.state,
            heat: Object.freeze({ ...snapshot.state.heat, current: heat }),
        });
    const rules = projectAeroRuntimeRules(
        snapshot.entity,
        snapshot.index,
        state,
        snapshot.ruleset,
    );
    if (!rules.heat.tracked) return Object.freeze([]);
    const activeController = [...snapshot.index.crewPositions.values()].some(position => {
        const common = snapshot.query.crewState(position.id);
        const crew = snapshot.state.crew.get(position.id);
        return !common.ejected
            && common.wounds < MAX_MEK_CREW_WOUNDS
            && !common.unconscious
            && !crew?.killed
            && !crew?.stunned;
    });
    const hasExplosiveAmmo = [...snapshot.index.components.values()].some(component => {
        const ammo = component.mount.equipment;
        return ammo instanceof AmmoEquipment
            && ammo.isExplosive()
            && snapshot.query.componentStatus(component.id, 'committed') === 'available'
            && snapshot.query.remainingAmmo(component.id) > 0
            && ammoRackSize(ammo) * ammoExplosionDamagePerShot(ammo) > 0;
    });
    const hadHeatControlEffect = snapshot.state.turn.controlRecovery?.cause
        === 'heat-random-movement'
        && snapshot.query.hasCondition('out-of-control')
        && snapshot.query.hasCondition('random-movement');
    const checks = projectAeroHeatAutomationChecks({
        heat,
        effects: rules.heat.effects,
        shutdown: snapshot.query.hasCondition('shutdown'),
        activeController,
        hasExplosiveAmmo,
        hadHeatControlEffect,
    }).filter(check => check.kind !== 'pilot-damage'
        || options.pilotHitsAndConsciousnessCheck !== 'no');
    return Object.freeze(checks.map(check => {
        const presentation = cbtUnitCheckPresentation(check.kind, {
            targetNumber: check.target,
            heat,
            ...(check.kind === 'pilot-damage' ? { hits: 1 } : {}),
        });
        return Object.freeze({
            label: presentation.label,
            value: check.automaticOutcome === undefined
                ? `Target ${check.target}+`
                : 'Automatic',
        });
    }));
}

function dueCrewRecoveries(snapshot: CBTUnitSnapshot): readonly TooltipLine[] {
    const turn = snapshot.state.turn.turnCounter;
    return Object.freeze([...snapshot.index.crewPositions.values()]
        .sort((left, right) => left.occurrence - right.occurrence)
        .flatMap(position => {
            const state = snapshot.query.crewState(position.id);
            const target = mekConsciousnessTarget(state.wounds);
            const readyTurn = state.recoveryReadyTurn;
            if (!state.unconscious || state.ejected || isCrewDeathCommitted(state)
                || target === undefined || readyTurn === null
                || readyTurn !== undefined && readyTurn > turn) return [];
            const assignment = snapshot.crewAssignment.positions.find(candidate =>
                candidate.positionId === position.id);
            const name = assignment?.name.trim() || `Crew ${position.occurrence + 1}`;
            return [Object.freeze({
                label: `${name}: Consciousness recovery`,
                value: `Target ${target}+`,
            })];
        }));
}

function pilotCheckAutomaticallyFails(
    snapshot: CBTMekUnitSnapshot,
    check: MekPilotCheckV2,
    pilotCanControl: boolean,
): boolean {
    return !pilotCanControl
        || snapshot.query.hasCondition('shutdown')
            && check.source.triggerKind !== 'shutdown';
}

function automaticPilotFailureTooltip(
    checks: readonly MekPilotCheckV2[],
): readonly TooltipLine[] | null {
    if (checks.length === 0) return null;
    return Object.freeze(checks.map(check => Object.freeze({
        label: check.reason,
        value: 'Automatic fall',
    })));
}

function automaticFallTooltip(
    falls: readonly MekAutomaticFallV2[],
): readonly TooltipLine[] | null {
    if (falls.length === 0) return null;
    return Object.freeze(falls.map(fall => Object.freeze({
        label: 'Automatic fall',
        value: fall.triggerKind === 'gyro-destroyed' ? 'Gyro destroyed' : 'Leg destroyed',
    })));
}
