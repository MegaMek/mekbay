// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import { getConsciousnessHitCount, getConsciousnessTarget, isCrewMemberAboard, isCrewMemberAvailable } from '../models/crew-member.model';
import type { SerializedPendingUnitCheck } from '../models/force-serialization';
import type { CBTAutomationKey } from '../models/options.model';
import type { PSRCheck } from '../models/rules/unit-type-rules';
import {
    UNIT_CHECK_CAUSE,
    UNIT_CHECK_KIND,
    unitCheckActionLabel,
    unitCheckAutomaticEffect,
    unitCheckAutomaticLabel,
    unitCheckAutomationKey,
    unitCheckDescription,
    unitCheckDialogTitle,
    unitCheckFailureOutcome,
    unitCheckIsApprovedAutomatic,
    unitCheckIsCascadeParticipant,
    unitCheckIsCrewOwned,
    unitCheckLabel,
    unitCheckPriority,
    unitCheckRequiresAmmoSelection,
    unitCheckResolvesBeforePsr,
    unitCheckReviewDescription,
    unitCheckUsesPilotAutomation,
    type PendingUnitCheckKind,
    type UnitCheckCause,
    type UnitCheckContext,
    type UnitCheckOutcome,
} from '../models/unit-check.model';
import { getPreferredHeatAmmoExplosionCandidates } from './heat-effects.util';

export interface PendingUnitCheckEntry {
    readonly unit: CBTForceUnit;
    readonly check: SerializedPendingUnitCheck;
}

export interface PendingPsrCheckEntry {
    readonly unit: CBTForceUnit;
    readonly check: PSRCheck;
}

export type PendingCheckReviewEntry = PendingUnitCheckEntry | PendingPsrCheckEntry;

export function isPendingUnitCheckEntry(
    entry: PendingCheckReviewEntry,
): entry is PendingUnitCheckEntry {
    return 'type' in entry.check && entry.check.type === 'unit-check';
}

export function pendingCheckReviewEntryKey(entry: PendingCheckReviewEntry): string {
    return `${entry.unit.id}:${isPendingUnitCheckEntry(entry) ? 'unit' : 'psr'}:${entry.check.id ?? ''}`;
}

function pendingFallCount(unit: CBTForceUnit): number {
    return unit.turnState().pendingFallCount?.() ?? unit.pendingFallCount?.() ?? 0;
}

/** Whether an aerospace unit has, or can later regain, a controller. */
export function canRetryAeroControlRecovery(unit: CBTForceUnit): boolean {
    if (unit.rules.isRemoteDrone() || unit.rules.getActivePilotCrewId() !== null) return true;
    return unit.getCrewMembers().some(crew => {
        const state = crew.getState();
        return state !== 'dead' && state !== 'ejected' && state !== 'killed';
    });
}

/** Rule order for checks whose effects can change later checks. */
export function pendingUnitCheckPriority(
    unit: CBTForceUnit,
    check: SerializedPendingUnitCheck,
): number {
    return unitCheckPriority(check.kind, !unit.gameRules.aggregatedEndPhaseConsciousRolls);
}

/** Every generic check that can currently be reviewed, in rules resolution order. */
export function pendingUnitCheckList(
    unit: CBTForceUnit,
    atPhaseEnd = false,
): readonly SerializedPendingUnitCheck[] {
    return visiblePendingUnitChecks(unit, atPhaseEnd, false);
}

/** Generic checks visible in one review, including rows that follow an interactive PSR. */
function pendingUnitCheckReviewList(
    unit: CBTForceUnit,
    atPhaseEnd = false,
): readonly SerializedPendingUnitCheck[] {
    return visiblePendingUnitChecks(unit, atPhaseEnd, true);
}

function visiblePendingUnitChecks(
    unit: CBTForceUnit,
    atPhaseEnd: boolean,
    includeChecksAfterPsr: boolean,
): readonly SerializedPendingUnitCheck[] {
    const turnState = unit.turnState();
    if (pendingFallCount(unit) > 0) return [];
    let checks = atPhaseEnd
        ? turnState.phaseEndPendingUnitChecks()
        : turnState.actionablePendingUnitChecks();
    const hasPendingCriticals = turnState.pendingCriticalChanceCount() > 0
        || turnState.pendingCriticalHitCount() > 0;
    if (hasPendingCriticals) {
        if (unit.gameRules.aggregatedEndPhaseConsciousRolls) return [];
        checks = checks.filter(isConsciousnessCheck);
    }
    if (!includeChecksAfterPsr && turnState.PSRRollsCount() > 0) {
        if (unit.gameRules.aggregatedEndPhaseConsciousRolls) return [];
        checks = checks.filter(check => unitCheckResolvesBeforePsr(check.kind));
    }
    return [...checks].sort((left, right) =>
        pendingUnitCheckPriority(unit, left) - pendingUnitCheckPriority(unit, right));
}

/** Earliest application stage for one unit. Later rows may still be reviewed together. */
export function pendingUnitCheckStage(
    unit: CBTForceUnit,
    atPhaseEnd = false,
): readonly SerializedPendingUnitCheck[] {
    const checks = pendingUnitCheckList(unit, atPhaseEnd);
    if (checks.length < 2) return checks;
    const priority = Math.min(...checks.map(check => pendingUnitCheckPriority(unit, check)));
    const stage = checks.filter(check => pendingUnitCheckPriority(unit, check) === priority);
    if (!stage[0] || !isConsciousnessCheck(stage[0])) return stage;

    // Per-hit TW checks are sequential: once one fails, later checks for that crew vanish.
    const crewIds = new Set<number>();
    return stage.filter(check => {
        const crewId = pendingUnitCheckCrewId(check);
        if (crewIds.has(crewId)) return false;
        crewIds.add(crewId);
        return true;
    });
}

/** Full generic-check review list across a force, globally sorted by rules order. */
export function pendingUnitCheckGroupList(
    units: readonly CBTForceUnit[],
    atPhaseEnd = false,
): readonly PendingUnitCheckEntry[] {
    return units.flatMap(unit =>
        pendingUnitCheckList(unit, atPhaseEnd).map(check => ({ unit, check })))
        .sort((left, right) => pendingUnitCheckPriority(left.unit, left.check)
            - pendingUnitCheckPriority(right.unit, right.check));
}

/**
 * Full interactive check review across the force. PSRs occupy their existing
 * rules barrier: immediate TW consciousness first, then PSRs, then later rows.
 */
export function pendingCheckReviewGroupList(
    units: readonly CBTForceUnit[],
    atPhaseEnd = false,
    manualResolution = false,
): readonly PendingCheckReviewEntry[] {
    if (units.some(unit => pendingFallCount(unit) > 0)) return [];

    const beforePsr: PendingUnitCheckEntry[] = [];
    const afterPsr: PendingUnitCheckEntry[] = [];
    const psrs: PendingPsrCheckEntry[] = [];
    let hasPendingCriticals = false;

    for (const unit of units) {
        const turnState = unit.turnState();
        hasPendingCriticals ||= turnState.pendingCriticalChanceCount() > 0
            || turnState.pendingCriticalHitCount() > 0;
        const unitPsrs = pendingPsrReviewList(unit, manualResolution);
        psrs.push(...unitPsrs.map(check => ({ unit, check })));

        for (const check of pendingUnitCheckReviewList(unit, atPhaseEnd)) {
            const entry = { unit, check };
            if (turnState.PSRRollsCount() === 0) {
                beforePsr.push(entry);
            } else if (!unit.gameRules.aggregatedEndPhaseConsciousRolls
                && unitCheckResolvesBeforePsr(check.kind)) {
                beforePsr.push(entry);
            } else if (unitPsrs.length > 0) {
                afterPsr.push(entry);
            }
        }
    }

    const byUnitCheckPriority = (left: PendingUnitCheckEntry, right: PendingUnitCheckEntry): number =>
        pendingUnitCheckPriority(left.unit, left.check)
        - pendingUnitCheckPriority(right.unit, right.check);
    beforePsr.sort(byUnitCheckPriority);
    afterPsr.sort(byUnitCheckPriority);

    // Dedicated critical dialogs remain a global barrier before PSRs.
    return hasPendingCriticals
        ? beforePsr
        : [...beforePsr, ...psrs, ...afterPsr];
}

export function pendingPsrReviewList(unit: CBTForceUnit, manualResolution = false): readonly PSRCheck[] {
    const turnState = unit.turnState();
    if (turnState.PSRRollsCount() === 0
        || (!manualResolution && unit.automationMode('pilotSkillCheck') !== 'ask')
        || turnState.automaticPSRFailure()
        || turnState.actionablePSRRollsCount() === 0) return [];
    return turnState.getPSRChecks().filter(check =>
        check.fallCheck !== undefined
        && check.id !== undefined
        && pendingPsrCommittedOutcome(unit, check) === undefined);
}

export function pendingPsrCommittedOutcome(
    unit: CBTForceUnit,
    check: PSRCheck,
): 'success' | 'failed' | undefined {
    if (check.resolution) {
        const current = unit.getRuleCheck(check.resolution.key);
        return !current
            || current.token !== check.resolution.token
            || current.status === 'pending'
            ? undefined
            : current.status;
    }
    return check.id ? unit.turnState().getPSROutcome(check.id) : undefined;
}

/** Earliest application stage across a force. Equal-priority checks resolve together. */
export function pendingUnitCheckGroupStage(
    units: readonly CBTForceUnit[],
    atPhaseEnd = false,
): readonly PendingUnitCheckEntry[] {
    const candidates = units.flatMap(unit =>
        pendingUnitCheckStage(unit, atPhaseEnd).map(check => ({ unit, check })));
    if (candidates.length < 2) return candidates;
    const priority = Math.min(...candidates.map(entry => pendingUnitCheckPriority(entry.unit, entry.check)));
    return candidates.filter(entry => pendingUnitCheckPriority(entry.unit, entry.check) === priority);
}

export function pendingUnitCheckOutcome(check: SerializedPendingUnitCheck): UnitCheckOutcome | undefined {
    if (!check.result) return undefined;
    if (check.result.kind !== 'roll') return check.result.outcome;
    if (check.target === undefined) return undefined;
    return check.result.dice[0] + check.result.dice[1] >= check.target ? 'success' : 'failed';
}

export function pendingUnitCheckIsAutomatic(check: SerializedPendingUnitCheck): boolean {
    return check.result?.kind === 'automatic';
}

export interface UnitCheckDetails {
    readonly kind: PendingUnitCheckKind;
    readonly target?: number;
    readonly hits?: number;
    readonly cause?: UnitCheckCause;
    readonly crewId?: number;
}

export function pendingUnitCheckContext(
    unit: CBTForceUnit,
    check: UnitCheckDetails,
    heat = unit.getHeat().current,
): UnitCheckContext {
    const crew = unitCheckIsCrewOwned(check.kind)
        ? unit.getCrewMember(check.crewId ?? 0)
        : undefined;
    const crewName = crew && unit.getCrewMembers().length > 1
        ? crew.getName() || `Crew ${crew.getId() + 1}`
        : undefined;
    return unitCheckContext(check, heat, crewName, crew?.getHits() ?? 0);
}

export function pendingUnitCheckLabel(check: UnitCheckDetails, review = false): string {
    return unitCheckLabel(check.kind, review);
}

export function pendingUnitCheckDescription(
    unit: CBTForceUnit,
    check: UnitCheckDetails,
    heat?: number,
): string {
    return unitCheckDescription(check.kind, pendingUnitCheckContext(unit, check, heat));
}

export function pendingUnitCheckReviewDescription(
    unit: CBTForceUnit,
    check: UnitCheckDetails,
    heat?: number,
): string {
    return unitCheckReviewDescription(check.kind, pendingUnitCheckContext(unit, check, heat));
}

/** Concise consequence shown separately from the descriptive check context. */
export function pendingUnitCheckFailureOutcome(check: UnitCheckDetails): string {
    return unitCheckFailureOutcome(check.kind, unitCheckContext(check));
}

export function pendingUnitCheckActionLabel(
    check: UnitCheckDetails,
    outcome: UnitCheckOutcome,
): string {
    return unitCheckActionLabel(check.kind, outcome);
}

export function pendingUnitCheckAutomaticLabel(
    check: UnitCheckDetails,
    outcome: UnitCheckOutcome,
): string {
    return unitCheckAutomaticLabel(check.kind, outcome);
}

export function pendingUnitCheckAutomaticEffect(
    check: UnitCheckDetails,
    outcome: UnitCheckOutcome,
): string | null {
    return unitCheckAutomaticEffect(check.kind, unitCheckContext(check), outcome);
}

export function pendingUnitCheckAutomationKey(check: UnitCheckDetails): CBTAutomationKey {
    return unitCheckAutomationKey(check.kind, unitCheckContext(check));
}

export function pendingUnitCheckUsesPilotAutomation(check: UnitCheckDetails): boolean {
    return unitCheckUsesPilotAutomation(check.kind, unitCheckContext(check));
}

export function pendingUnitCheckIsApprovedAutomatic(check: UnitCheckDetails): boolean {
    return unitCheckIsApprovedAutomatic(check.kind);
}

export function pendingUnitCheckDialogTitle(check: UnitCheckDetails): string | undefined {
    return unitCheckDialogTitle(check.kind);
}

export function pendingUnitCheckNeedsSelection(unit: CBTForceUnit, check: SerializedPendingUnitCheck): boolean {
    return unitCheckRequiresAmmoSelection(check.kind)
        && pendingUnitCheckOutcome(check) === 'failed'
        && getPreferredHeatAmmoExplosionCandidates(unit).length > 1;
}

export function pendingUnitCheckIsResolved(unit: CBTForceUnit, check: SerializedPendingUnitCheck): boolean {
    return pendingUnitCheckOutcome(check) !== undefined
        && (!pendingUnitCheckNeedsSelection(unit, check)
            || (isAmmoExplosionCheck(check) && !!check.selectionId));
}

export type PendingUnitCheckOf<K extends PendingUnitCheckKind> =
    Extract<SerializedPendingUnitCheck, { readonly kind: K }>;

export type CrewOwnedUnitCheck = Extract<SerializedPendingUnitCheck, { readonly crewId: number }>;
export type CascadeUnitCheck = PendingUnitCheckOf<
    typeof UNIT_CHECK_KIND.CONSCIOUSNESS | typeof UNIT_CHECK_KIND.SEATBELT
>;

export function isPendingUnitCheckKind<K extends PendingUnitCheckKind>(
    check: SerializedPendingUnitCheck,
    kind: K,
): check is PendingUnitCheckOf<K> {
    return check.kind === kind;
}

export function isConsciousnessCheck(
    check: SerializedPendingUnitCheck,
): check is PendingUnitCheckOf<typeof UNIT_CHECK_KIND.CONSCIOUSNESS> {
    return isPendingUnitCheckKind(check, UNIT_CHECK_KIND.CONSCIOUSNESS);
}

export function isConsciousnessRecoveryCheck(
    check: SerializedPendingUnitCheck,
): check is PendingUnitCheckOf<typeof UNIT_CHECK_KIND.CONSCIOUSNESS_RECOVERY> {
    return isPendingUnitCheckKind(check, UNIT_CHECK_KIND.CONSCIOUSNESS_RECOVERY);
}

export function isConsciousnessSequenceCheck(
    check: SerializedPendingUnitCheck,
): check is PendingUnitCheckOf<
    typeof UNIT_CHECK_KIND.CONSCIOUSNESS | typeof UNIT_CHECK_KIND.CONSCIOUSNESS_RECOVERY
> {
    return isConsciousnessCheck(check) || isConsciousnessRecoveryCheck(check);
}

export function isAmmoExplosionCheck(
    check: SerializedPendingUnitCheck,
): check is PendingUnitCheckOf<typeof UNIT_CHECK_KIND.HEAT_AMMO_EXPLOSION> {
    return isPendingUnitCheckKind(check, UNIT_CHECK_KIND.HEAT_AMMO_EXPLOSION);
}

export function isAeroControlRecoveryCheck(
    check: SerializedPendingUnitCheck,
): check is PendingUnitCheckOf<typeof UNIT_CHECK_KIND.AERO_CONTROL_RECOVERY> {
    return isPendingUnitCheckKind(check, UNIT_CHECK_KIND.AERO_CONTROL_RECOVERY);
}

export function isHeatControlRecoveryCheck(
    check: SerializedPendingUnitCheck,
): check is PendingUnitCheckOf<typeof UNIT_CHECK_KIND.AERO_CONTROL_RECOVERY>
    & { readonly cause: UnitCheckCause } {
    return isAeroControlRecoveryCheck(check)
        && check.cause === UNIT_CHECK_CAUSE.HEAT_RANDOM_MOVEMENT;
}

export function isCrewOwnedUnitCheck(check: SerializedPendingUnitCheck): check is CrewOwnedUnitCheck {
    return unitCheckIsCrewOwned(check.kind);
}

export function isCascadeUnitCheck(check: SerializedPendingUnitCheck): check is CascadeUnitCheck {
    return unitCheckIsCascadeParticipant(check.kind);
}

export function pendingUnitCheckCrewId(check: SerializedPendingUnitCheck): number {
    return isCrewOwnedUnitCheck(check) ? check.crewId : 0;
}

/** Revalidates the few checks whose target or applicability changes over time. */
export function refreshPendingUnitCheck(
    unit: CBTForceUnit,
    pending: SerializedPendingUnitCheck,
): SerializedPendingUnitCheck | null {
    if (isConsciousnessCheck(pending)) {
        const crew = unit.getCrewMember(pending.crewId);
        if (!crew || crew.getState() !== 'healthy') return null;
        const currentTarget = getConsciousnessTarget(crew.getHits());
        if (currentTarget === null) return null;
        if (unit.gameRules.aggregatedEndPhaseConsciousRolls) {
            return withRefreshedUnitCheckTarget(pending, currentTarget);
        }
        const checkHit = pending.target === undefined
            ? null
            : getConsciousnessHitCount(pending.target);
        return checkHit !== null && checkHit <= crew.getHits() ? pending : null;
    }
    if (isConsciousnessRecoveryCheck(pending)) {
        const crew = unit.getCrewMember(pending.crewId);
        const target = crew ? getConsciousnessTarget(crew.getHits()) : null;
        return crew?.getState() === 'unconscious' && target !== null
            ? withRefreshedUnitCheckTarget(pending, target)
            : null;
    }
    if (isPendingUnitCheckKind(pending, UNIT_CHECK_KIND.AERO_CONTROL_RECOVERY)) {
        if (!unit.getCondition('out-of-control')) return null;
        if (unit.rules.getActivePilotCrewId() === null && !unit.rules.isRemoteDrone()) {
            if (!canRetryAeroControlRecovery(unit)) return null;
            return withAutomaticUnitCheckOutcome(pending, 'failed');
        }
        const target = unit.rules.getStandardControlRollTarget();
        return target > 12
            ? withAutomaticUnitCheckOutcome(pending, 'failed')
            : withRefreshedUnitCheckTarget(pending, target);
    }
    if (isPendingUnitCheckKind(pending, UNIT_CHECK_KIND.SEATBELT)) {
        const crew = unit.getCrewMember(pending.crewId);
        if (!crew || !isCrewMemberAboard(crew.getState())) return null;
        if (!isCrewMemberAvailable(crew.getState())
            || unit.getCondition('shutdown')
            || unit.getCondition('immobile')
            || (pending.target ?? 13) > 12) {
            return withAutomaticUnitCheckOutcome(pending, 'failed');
        }
    }
    return pending;
}

function unitCheckContext(
    check: UnitCheckDetails,
    heat = 0,
    crewName?: string,
    crewHits = 0,
): UnitCheckContext {
    return {
        target: check.target,
        heat,
        hits: check.hits ?? 1,
        cause: check.cause,
        crewName,
        crewHits,
        consciousnessCheckHit: check.target === undefined
            ? null
            : getConsciousnessHitCount(check.target),
    };
}

function withRefreshedUnitCheckTarget(
    pending: SerializedPendingUnitCheck,
    target: number,
): SerializedPendingUnitCheck {
    if (pending.target === target) return pending;
    const { target: _staleTarget, result: staleResult, ...facts } = pending;
    return {
        ...facts,
        target,
        ...(staleResult?.kind === 'roll' || staleResult?.kind === 'automatic'
            ? { result: staleResult }
            : {}),
    } as SerializedPendingUnitCheck;
}

function withAutomaticUnitCheckOutcome(
    pending: SerializedPendingUnitCheck,
    outcome: UnitCheckOutcome,
): SerializedPendingUnitCheck {
    const { target: _target, result: _result, ...facts } = pending;
    return { ...facts, result: { kind: 'automatic', outcome } } as SerializedPendingUnitCheck;
}
