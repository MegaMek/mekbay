// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

/** Search limits and the metrics lifecycle for the synchronous organization solver. */

import type { CompositionConfig, PatternCompositionConfig } from './org-composition.util';

let lastOrgSolveMetrics: OrgSolveMetrics | null = null;

export type OrgSolveStopReason = 'deadline' | 'pattern-visits' | 'composition-visits' | 'iteration-limit';

const SOLVER_TIME_BUDGET_MS = 750;

export interface MutableOrgSolveMetrics {
    factCompilationMs: number;
    inputNormalizationMs: number;
    regularLeafAllocationMs: number;
    exactLeafPartitionMs: number;
    initialRepairMs: number;
    initialAssimilationMs: number;
    wholeComposedMs: number;
    leftoverImprovementMs: number;
    regularPromotionMs: number;
    subRegularFallbackMs: number;
    finalMaterializationMs: number;
    totalSolveMs: number;
    exactLeafPartitionCandidateStates: number;
    exactLeafPartitionSkipped: boolean;
    regularPromotionSearches: number;
    regularPromotionResultCacheHits: number;
    regularPromotionResultCacheMisses: number;
    regularPromotionMemoHits: number;
    regularPromotionMemoMisses: number;
    regularPromotionSuccessorCacheHits: number;
    regularPromotionSuccessorCacheMisses: number;
    regularPromotionSuccessorStates: number;
    composedPlanMetrics: Map<string, MutableComposedPlanMetric>;
}

interface OrgSolveSession {
    readonly deadline: number;
    stopReason: OrgSolveStopReason | null;
    readonly metrics: MutableOrgSolveMetrics | null;
}

export interface SolverGuard {
    readonly session: OrgSolveSession;
    patternVisits: number;
    compositionVisits: number;
}

type ComposedPlannerKind = 'single-role-fast-path' | 'exact-counted' | 'pattern-counted';

interface MutableComposedPlanMetric {
    ruleType: string;
    ruleKind: 'composed-count' | 'composed-pattern';
    compositionIndex: number;
    planner: ComposedPlannerKind;
    calls: number;
    totalMs: number;
    totalCandidates: number;
}

export interface ComposedPlanMetric {
    readonly ruleType: string;
    readonly ruleKind: 'composed-count' | 'composed-pattern';
    readonly compositionIndex: number;
    readonly planner: ComposedPlannerKind;
    readonly calls: number;
    readonly totalMs: number;
    readonly totalCandidates: number;
}

export function createMutableOrgSolveMetrics(): MutableOrgSolveMetrics {
    return {
        factCompilationMs: 0,
        inputNormalizationMs: 0,
        regularLeafAllocationMs: 0,
        exactLeafPartitionMs: 0,
        initialRepairMs: 0,
        initialAssimilationMs: 0,
        wholeComposedMs: 0,
        leftoverImprovementMs: 0,
        regularPromotionMs: 0,
        subRegularFallbackMs: 0,
        finalMaterializationMs: 0,
        totalSolveMs: 0,
        exactLeafPartitionCandidateStates: 0,
        exactLeafPartitionSkipped: false,
        regularPromotionSearches: 0,
        regularPromotionResultCacheHits: 0,
        regularPromotionResultCacheMisses: 0,
        regularPromotionMemoHits: 0,
        regularPromotionMemoMisses: 0,
        regularPromotionSuccessorCacheHits: 0,
        regularPromotionSuccessorCacheMisses: 0,
        regularPromotionSuccessorStates: 0,
        composedPlanMetrics: new Map<string, MutableComposedPlanMetric>(),
    };
}

function snapshotOrgSolveMetrics(metrics: MutableOrgSolveMetrics | null, stopReason: OrgSolveStopReason | null): OrgSolveMetrics | null {
    if (!metrics) {
        return null;
    }

    return {
        factCompilationMs: metrics.factCompilationMs,
        inputNormalizationMs: metrics.inputNormalizationMs,
        regularLeafAllocationMs: metrics.regularLeafAllocationMs,
        exactLeafPartitionMs: metrics.exactLeafPartitionMs,
        initialRepairMs: metrics.initialRepairMs,
        initialAssimilationMs: metrics.initialAssimilationMs,
        wholeComposedMs: metrics.wholeComposedMs,
        leftoverImprovementMs: metrics.leftoverImprovementMs,
        regularPromotionMs: metrics.regularPromotionMs,
        subRegularFallbackMs: metrics.subRegularFallbackMs,
        finalMaterializationMs: metrics.finalMaterializationMs,
        totalSolveMs: metrics.totalSolveMs,
        exactLeafPartitionCandidateStates: metrics.exactLeafPartitionCandidateStates,
        exactLeafPartitionSkipped: metrics.exactLeafPartitionSkipped,
        regularPromotionSearches: metrics.regularPromotionSearches,
        regularPromotionResultCacheHits: metrics.regularPromotionResultCacheHits,
        regularPromotionResultCacheMisses: metrics.regularPromotionResultCacheMisses,
        regularPromotionMemoHits: metrics.regularPromotionMemoHits,
        regularPromotionMemoMisses: metrics.regularPromotionMemoMisses,
        regularPromotionSuccessorCacheHits: metrics.regularPromotionSuccessorCacheHits,
        regularPromotionSuccessorCacheMisses: metrics.regularPromotionSuccessorCacheMisses,
        regularPromotionSuccessorStates: metrics.regularPromotionSuccessorStates,
        composedPlanMetrics: [...metrics.composedPlanMetrics.values()]
            .map((metric) => ({
                ruleType: metric.ruleType,
                ruleKind: metric.ruleKind,
                compositionIndex: metric.compositionIndex,
                planner: metric.planner,
                calls: metric.calls,
                totalMs: metric.totalMs,
                totalCandidates: metric.totalCandidates,
            }))
            .sort((left, right) => right.totalMs - left.totalMs || right.calls - left.calls || left.ruleType.localeCompare(right.ruleType)),
        timedOut: stopReason === 'deadline',
        stopReason,
    };
}

export function getLastOrgSolveMetrics(): OrgSolveMetrics | null {
    return lastOrgSolveMetrics;
}

export interface OrgSolveMetrics {
    readonly factCompilationMs: number;
    readonly inputNormalizationMs: number;
    readonly regularLeafAllocationMs: number;
    readonly exactLeafPartitionMs: number;
    readonly initialRepairMs: number;
    readonly initialAssimilationMs: number;
    readonly wholeComposedMs: number;
    readonly leftoverImprovementMs: number;
    readonly regularPromotionMs: number;
    readonly subRegularFallbackMs: number;
    readonly finalMaterializationMs: number;
    readonly totalSolveMs: number;
    readonly exactLeafPartitionCandidateStates: number;
    readonly exactLeafPartitionSkipped: boolean;
    readonly regularPromotionSearches: number;
    readonly regularPromotionResultCacheHits: number;
    readonly regularPromotionResultCacheMisses: number;
    readonly regularPromotionMemoHits: number;
    readonly regularPromotionMemoMisses: number;
    readonly regularPromotionSuccessorCacheHits: number;
    readonly regularPromotionSuccessorCacheMisses: number;
    readonly regularPromotionSuccessorStates: number;
    readonly composedPlanMetrics: readonly ComposedPlanMetric[];
    readonly timedOut: boolean;
    readonly stopReason: OrgSolveStopReason | null;
}

export function createSolverGuard(metrics: MutableOrgSolveMetrics | null = null): SolverGuard {
    return {
        session: { deadline: getSolveTimestampMs() + SOLVER_TIME_BUDGET_MS, stopReason: null, metrics },
        patternVisits: 0,
        compositionVisits: 0,
    };
}

/** Visit quotas bound an individual search; the deadline and stop status belong to the whole solve. */
export function forkSolverGuard(parent: SolverGuard): SolverGuard {
    return { session: parent.session, patternVisits: 0, compositionVisits: 0 };
}

/** One deadline and metrics lifecycle covers preprocessing and every nested search. */
export function runOrgSolve<T>(solve: (guard: SolverGuard) => T): T {
    const metrics = createMutableOrgSolveMetrics();
    const guard = createSolverGuard(metrics);
    const startedAt = getSolveTimestampMs();
    lastOrgSolveMetrics = null;
    let completed = false;
    try {
        const result = solve(guard);
        completed = true;
        return result;
    } finally {
        metrics.totalSolveMs = Math.max(0, getSolveTimestampMs() - startedAt);
        lastOrgSolveMetrics = completed ? snapshotOrgSolveMetrics(metrics, guard.session.stopReason) : null;
    }
}

export function getSolveTimestampMs(): number {
    return globalThis.performance?.now() ?? Date.now();
}

export function addMetricDuration(metrics: MutableOrgSolveMetrics | null, key: keyof Pick<
    MutableOrgSolveMetrics,
    'factCompilationMs'
    | 'inputNormalizationMs'
    | 'regularLeafAllocationMs'
    | 'exactLeafPartitionMs'
    | 'initialRepairMs'
    | 'initialAssimilationMs'
    | 'wholeComposedMs'
    | 'leftoverImprovementMs'
    | 'regularPromotionMs'
    | 'subRegularFallbackMs'
    | 'finalMaterializationMs'
    | 'totalSolveMs'
>, startedAtMs: number): void {
    if (!metrics) {
        return;
    }

    metrics[key] += Math.max(0, getSolveTimestampMs() - startedAtMs);
}

export function recordComposedPlanMetric(
    guard: SolverGuard,
    config: Pick<CompositionConfig | PatternCompositionConfig, 'ruleType' | 'ruleKind' | 'index'>,
    planner: ComposedPlannerKind,
    startedAtMs: number,
    candidateCount: number,
): void {
    const metrics = guard.session.metrics;
    if (!metrics) {
        return;
    }

    const key = `${config.ruleKind}::${config.ruleType}::${config.index}::${planner}`;
    const existing = metrics.composedPlanMetrics.get(key);
    const elapsedMs = Math.max(0, getSolveTimestampMs() - startedAtMs);

    if (existing) {
        existing.calls += 1;
        existing.totalMs += elapsedMs;
        existing.totalCandidates += candidateCount;
        return;
    }

    metrics.composedPlanMetrics.set(key, {
        ruleType: config.ruleType,
        ruleKind: config.ruleKind,
        compositionIndex: config.index,
        planner,
        calls: 1,
        totalMs: elapsedMs,
        totalCandidates: candidateCount,
    });
}

export function shouldAbortSearch(guard: SolverGuard): boolean {
    if (guard.session.stopReason === 'deadline' || getSolveTimestampMs() > guard.session.deadline) stopOrgSearch(guard, 'deadline');
    return guard.session.stopReason === 'deadline';
}

/** Exhausting enumeration must still allow inexpensive count-based promotions. */
export function visitOrgSearch(guard: SolverGuard, kind: 'pattern' | 'composition'): boolean {
    const visits = kind === 'pattern' ? ++guard.patternVisits : ++guard.compositionVisits;
    if (visits > 50_000) {
        stopOrgSearch(guard, `${kind}-visits`);
        return false;
    }
    return !shouldAbortSearch(guard);
}

export function stopOrgSearch(guard: SolverGuard, reason: OrgSolveStopReason): void {
    // A local search limit still allows independent alternatives within the shared deadline.
    if (reason === 'deadline' || !guard.session.stopReason) guard.session.stopReason = reason;
}
