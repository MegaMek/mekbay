// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

/** Search limits and the metrics lifecycle for the synchronous organization solver. */

import type { CompositionConfig, PatternCompositionConfig } from './org-composition.util';

export const orgSolveMetrics: {
    active: MutableOrgSolveMetrics | null;
    last: OrgSolveMetrics | null;
} = { active: null, last: null };

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
    timedOut: boolean;
}

export interface SolverGuard {
    readonly deadline: number;
    patternVisits: number;
    compositionVisits: number;
    timedOut: boolean;
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
        timedOut: false,
    };
}

export function snapshotOrgSolveMetrics(metrics: MutableOrgSolveMetrics | null): OrgSolveMetrics | null {
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
        timedOut: metrics.timedOut,
    };
}

export function getLastOrgSolveMetrics(): OrgSolveMetrics | null {
    return orgSolveMetrics.last;
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
}

export function createSolverGuard(): SolverGuard {
    return {
        deadline: Date.now() + SOLVER_TIME_BUDGET_MS,
        patternVisits: 0,
        compositionVisits: 0,
        timedOut: false,
    };
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
    config: Pick<CompositionConfig | PatternCompositionConfig, 'ruleType' | 'ruleKind' | 'index'>,
    planner: ComposedPlannerKind,
    startedAtMs: number,
    candidateCount: number,
): void {
    const metrics = orgSolveMetrics.active;
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
    if (guard.timedOut) {
        return true;
    }
    if (Date.now() > guard.deadline) {
        guard.timedOut = true;
        return true;
    }
    return false;
}
