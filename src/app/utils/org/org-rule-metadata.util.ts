// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

/** Compiled rule metadata and modifier ordering shared by organization planners. */

import { DEFAULT_ORG_RULE_REGISTRY } from './org-facts.util';
import { getModifierCount, getModifierTier } from './org-tier.util';
import type { OrgDefinition, OrgRuleDefinition, OrgRuleRegistry } from './org-types';

export type ModifierBand = 'sub-regular' | 'regular' | 'super-regular';

export type RuleExecutionStage = 'regular' | 'sub-regular' | 'all';

export interface ModifierStep {
    readonly modifierKey: string;
    readonly count: number;
    readonly tier: number;
    readonly relativeBand: ModifierBand;
    readonly distanceFromRegular: number;
}

export interface RuleModifierDescriptor {
    readonly stepsAscending: readonly ModifierStep[];
    readonly stepsDescending: readonly ModifierStep[];
    readonly regularStep: ModifierStep;
    readonly subRegularStepsDescending: readonly ModifierStep[];
    readonly superRegularStepsDescending: readonly ModifierStep[];
}

export interface CompiledRuleStageMetadata {
    readonly descriptor: RuleModifierDescriptor;
    readonly allowedModifierKeysByStage: Readonly<Record<RuleExecutionStage, ReadonlySet<string> | null>>;
    readonly participatesInRegularStage: boolean;
    readonly participatesInSubRegularStage: boolean;
    readonly blocksSubRegularPromotionChildren: boolean;
    readonly canEmitExactSuperRegularWholeLeaf: boolean;
}

export interface LeafCountEmission {
    readonly modifierKey: string;
    readonly perGroupCount: number;
    readonly copies: number;
    readonly tier: number;
}

const compiledRuleStageMetadataByRule = new WeakMap<OrgRuleDefinition, CompiledRuleStageMetadata>();

export function getRulePriority(rule: Pick<OrgRuleDefinition, 'priority'>): number {
    return rule.priority ?? 0;
}

export function getRuleModifierDescriptor(rule: Pick<OrgRuleDefinition, 'modifiers' | 'tier' | 'dynamicTier'>): RuleModifierDescriptor {
    const modifierEntries = Object.entries(rule.modifiers);
    const regularModifierValue = rule.modifiers[''] ?? modifierEntries[0]?.[1] ?? 1;
    const regularCount = getModifierCount(regularModifierValue);
    const stepsAscending = modifierEntries
        .map(([modifierKey, modifierValue]) => ({
            modifierKey,
            count: getModifierCount(modifierValue),
            tier: getModifierTier(rule.tier, regularCount, modifierValue, rule.dynamicTier),
            relativeBand: (getModifierCount(modifierValue) < regularCount
                ? 'sub-regular'
                : getModifierCount(modifierValue) > regularCount
                    ? 'super-regular'
                    : 'regular') as ModifierBand,
            distanceFromRegular: Math.abs(getModifierCount(modifierValue) - regularCount),
        }))
        .sort((left, right) => left.count - right.count);
    const regularStep = stepsAscending.find((step) => step.relativeBand === 'regular') ?? stepsAscending[0];

    return {
        stepsAscending,
        stepsDescending: [...stepsAscending].sort((left, right) => right.count - left.count),
        regularStep,
        subRegularStepsDescending: stepsAscending
            .filter((step) => step.relativeBand === 'sub-regular')
            .sort((left, right) => right.count - left.count),
        superRegularStepsDescending: stepsAscending
            .filter((step) => step.relativeBand === 'super-regular')
            .sort((left, right) => right.count - left.count),
    };
}

export function compileRuleStageMetadata(rule: OrgRuleDefinition): CompiledRuleStageMetadata {
    const cached = compiledRuleStageMetadataByRule.get(rule);
    if (cached) {
        return cached;
    }

    const descriptor = getRuleModifierDescriptor(rule);
    const regularModifierKeys = new Set([descriptor.regularStep.modifierKey]);
    const subRegularModifierKeys = new Set(descriptor.subRegularStepsDescending.map((step) => step.modifierKey));
    const allModifierKeys = new Set(descriptor.stepsDescending.map((step) => step.modifierKey));
    const isLeafPatternRule = rule.kind === 'leaf-pattern';
    const isLeafCountRule = rule.kind === 'leaf-count';
    const participatesInRegularStage = isLeafPatternRule || !isLeafCountRule || (rule.priority ?? 0) >= 0;
    const participatesInSubRegularStage = !isLeafPatternRule && subRegularModifierKeys.size > 0;
    const blocksSubRegularPromotionChildren = rule.kind === 'ci-formation' || rule.kind === 'composed-count'
        ? !!rule.requireRegularForPromotion
        : false;
    const canEmitExactSuperRegularWholeLeaf = (rule.kind === 'leaf-count' || rule.kind === 'leaf-pattern')
        && descriptor.superRegularStepsDescending.length > 0;

    const metadata = {
        descriptor,
        allowedModifierKeysByStage: {
            regular: participatesInRegularStage ? regularModifierKeys : new Set<string>(),
            'sub-regular': participatesInSubRegularStage ? subRegularModifierKeys : new Set<string>(),
            all: allModifierKeys,
        },
        participatesInRegularStage,
        participatesInSubRegularStage,
        blocksSubRegularPromotionChildren,
        canEmitExactSuperRegularWholeLeaf,
    };

    compiledRuleStageMetadataByRule.set(rule, metadata);
    return metadata;
}

export function getAllowedModifierKeysForStage(
    metadata: CompiledRuleStageMetadata,
    stage: RuleExecutionStage,
): ReadonlySet<string> | undefined {
    return stage === 'all' ? undefined : metadata.allowedModifierKeysByStage[stage] ?? undefined;
}

export function getModifierStepForRuleStage(
    metadata: CompiledRuleStageMetadata,
    stage: RuleExecutionStage,
): readonly ModifierStep[] {
    if (stage === 'regular') {
        return metadata.participatesInRegularStage ? [metadata.descriptor.regularStep] : [];
    }
    if (stage === 'sub-regular') {
        return metadata.participatesInSubRegularStage ? metadata.descriptor.subRegularStepsDescending : [];
    }
    return metadata.descriptor.stepsDescending;
}

export function isSubRegularModifierKey(
    metadata: CompiledRuleStageMetadata,
    modifierKey: string,
): boolean {
    return metadata.allowedModifierKeysByStage['sub-regular']?.has(modifierKey) ?? false;
}

export function getRuleRegistry(definition?: OrgDefinition, registry?: OrgRuleRegistry): OrgRuleRegistry {
    return registry ?? definition?.registry ?? DEFAULT_ORG_RULE_REGISTRY;
}

interface ModifierPreferenceBucket {
    readonly band: number;
    readonly distance: number;
    count: number;
}

function getModifierPreferenceBuckets(steps: readonly ModifierStep[]): ModifierPreferenceBucket[] {
    const buckets: ModifierPreferenceBucket[] = [];
    for (const step of steps) {
        const band = step.relativeBand === 'regular' ? 3 : step.relativeBand === 'super-regular' ? 2 : 1;
        const distance = step.distanceFromRegular;
        const bucket = buckets.find(candidate => candidate.band === band && candidate.distance === distance);
        if (bucket) bucket.count += 1;
        else buckets.push({ band, distance, count: 1 });
    }
    return buckets.sort((left, right) => right.band - left.band || left.distance - right.distance);
}

/** Prefer regular groups, then closer super/sub-regular groups, retaining multiplicities. */
export function compareModifierPreferences(left: readonly ModifierStep[], right: readonly ModifierStep[]): number {
    const leftBuckets = getModifierPreferenceBuckets(left);
    const rightBuckets = getModifierPreferenceBuckets(right);
    const sharedLength = Math.min(leftBuckets.length, rightBuckets.length);
    for (let index = 0; index < sharedLength; index += 1) {
        const leftBucket = leftBuckets[index];
        const rightBucket = rightBuckets[index];
        const comparison = leftBucket.band - rightBucket.band
            || rightBucket.distance - leftBucket.distance
            || leftBucket.count - rightBucket.count;
        if (comparison !== 0) return comparison;
    }
    return leftBuckets.length - rightBuckets.length;
}
