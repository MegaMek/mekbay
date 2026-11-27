// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

/** Lazy group records and shared group-fact construction and materialization. */

import {
    compileGroupFacts,
    getCIMoveClass,
    getCISquadCount,
    summarizeGroupUnitFacts,
} from './org-facts.util';
import type { ModifierStep } from './org-rule-metadata.util';
import type {
    GroupFacts,
    GroupSizeResult,
    GroupUnitAllocation,
    OrgBucketValue,
    OrgChildTypeCountKey,
    OrgCIFormationRule,
    OrgComposedCountRule,
    OrgComposedPatternRule,
    OrgLeafCountRule,
    OrgLeafPatternRule,
    OrgRuleDefinition,
    OrgUnit,
    OrgUnitBucketName,
    UnitFacts,
} from './org-types';

let nextSyntheticGroupFactId = -1;

export interface PlannedGroupRecord {
    readonly recordId: number;
    readonly facts: GroupFacts;
    readonly producedPlan?: AbstractProducedGroupPlan;
    readonly atomicPlan?: AbstractAtomicGroupPlan;
    materializedGroup?: GroupSizeResult;
    materialize: () => GroupSizeResult;
}

interface AbstractProducedGroupPlan {
    readonly rule: OrgComposedCountRule | OrgComposedPatternRule;
    readonly modifierStep: ModifierStep;
    readonly childRecords: readonly PlannedGroupRecord[];
}

interface AbstractAtomicGroupPlan {
    readonly kind: 'leaf' | 'ci-parent' | 'ci-fragment';
    readonly materializeAtomicGroup: () => GroupSizeResult;
}

export interface CIFragmentToken {
    readonly moveClass: NonNullable<ReturnType<typeof getCIMoveClass>>;
    readonly allocations: readonly CISquadAllocation[];
}

export interface CISquadAllocation {
    readonly unit: OrgUnit;
    readonly squads: number;
}

const compiledGroupFactsByGroup = new WeakMap<GroupSizeResult, GroupFacts>();

export function getCompiledGroupFacts(group: GroupSizeResult): GroupFacts {
    const cached = compiledGroupFactsByGroup.get(group);
    if (cached) {
        return cached;
    }

    const facts = compileGroupFacts(group);
    compiledGroupFactsByGroup.set(group, facts);
    return facts;
}

export function getCompiledGroupFactsList(groups: readonly GroupSizeResult[]): GroupFacts[] {
    return groups.map((group) => getCompiledGroupFacts(group));
}

function allocateSyntheticGroupFactId(): number {
    const groupFactId = nextSyntheticGroupFactId;
    nextSyntheticGroupFactId -= 1;
    return groupFactId;
}

export function makeGroupName(type: string | null, modifierKey: string): string {
    return `${modifierKey}${type ?? 'Force'}`;
}

export function getRuleDisplayName(rule: Pick<OrgRuleDefinition, 'type' | 'displayName'>): string {
    return rule.displayName ?? rule.type;
}

export function getPartialUnitAllocations(units: readonly UnitFacts[]): GroupUnitAllocation[] | undefined {
    if (!units.some(facts => facts.squads !== getCISquadCount(facts.unit))) return undefined;
    return units.map(facts => ({
        unit: facts.unit,
        squads: facts.unit.as.TP === 'CI' ? facts.squads : undefined,
    }));
}

export function createLeafGroup(
    rule: OrgLeafCountRule | OrgLeafPatternRule,
    modifierStep: ModifierStep,
    units: readonly UnitFacts[],
    formationMatchingIgnoredUnits: readonly OrgUnit[] = [],
): GroupSizeResult {
    return {
        name: makeGroupName(getRuleDisplayName(rule), modifierStep.modifierKey),
        type: rule.type,
        displayName: rule.displayName,
        modifierKey: modifierStep.modifierKey,
        countsAsType: rule.countsAs ?? null,
        tier: modifierStep.tier,
        provenance: 'produced-group',
        units: units.map((facts) => facts.unit),
        unitAllocations: getPartialUnitAllocations(units),
        formationMatchingIgnoredUnits: formationMatchingIgnoredUnits.length > 0
            ? [...formationMatchingIgnoredUnits]
            : undefined,
        tag: rule.tag,
        priority: rule.priority,
    };
}

export function createLeafFragmentGroup(
    rule: OrgLeafCountRule,
    count: number,
    units: readonly UnitFacts[],
): GroupSizeResult {
    const fragmentType = rule.fragmentType;
    if (!fragmentType) {
        throw new Error('Leaf fragment group requested without fragmentType');
    }

    return {
        name: makeFragmentGroupName(fragmentType, count),
        type: fragmentType,
        modifierKey: '',
        countsAsType: null,
        tier: rule.fragmentTier ?? rule.tier,
        count,
        isFragment: true,
        provenance: 'produced-group',
        units: units.map((facts) => facts.unit),
        unitAllocations: getPartialUnitAllocations(units),
        tag: rule.tag,
        priority: rule.priority,
    };
}

export function createComposedGroup(
    rule: OrgComposedCountRule | OrgComposedPatternRule,
    modifierStep: ModifierStep,
    children: readonly GroupSizeResult[],
): GroupSizeResult {
    return {
        name: makeGroupName(getRuleDisplayName(rule), modifierStep.modifierKey),
        type: rule.type,
        displayName: rule.displayName,
        modifierKey: modifierStep.modifierKey,
        countsAsType: rule.countsAs ?? null,
        tier: modifierStep.tier,
        provenance: 'produced-group',
        children: [...children],
        tag: rule.tag,
        priority: rule.priority,
    };
}

function createAtomicGroupTemplate(
    type: string,
    modifierKey: string,
    countsAsType: GroupSizeResult['countsAsType'],
    tier: number,
    tag: GroupSizeResult['tag'],
    priority: GroupSizeResult['priority'],
    displayName?: string,
): GroupSizeResult {
    return {
        name: makeGroupName(displayName ?? type, modifierKey),
        type: type as GroupSizeResult['type'],
        displayName,
        modifierKey,
        countsAsType,
        tier,
        provenance: 'produced-group',
        tag,
        priority,
    };
}

function createAtomicFragmentTemplate(
    type: string,
    count: number,
    tier: number,
    tag: GroupSizeResult['tag'],
    priority: GroupSizeResult['priority'],
): GroupSizeResult {
    return {
        name: makeFragmentGroupName(type, count),
        type: type as GroupSizeResult['type'],
        modifierKey: '',
        countsAsType: null,
        tier,
        count,
        isFragment: true,
        provenance: 'produced-group',
        tag,
        priority,
    };
}

function buildAbstractGroupFactsFromUnits(
    groupTemplate: GroupSizeResult,
    units: readonly UnitFacts[],
): GroupFacts {
    return {
        groupFactId: allocateSyntheticGroupFactId(),
        group: groupTemplate,
        type: groupTemplate.type,
        countsAsType: groupTemplate.countsAsType,
        modifierKey: groupTemplate.modifierKey,
        tier: groupTemplate.tier,
        isFragment: groupTemplate.isFragment === true,
        provenance: 'produced-group',
        tag: groupTemplate.tag,
        priority: groupTemplate.priority,
        directChildCount: 0,
        childTypeCounts: new Map(),
        ...summarizeGroupUnitFacts(units),
    };
}

function createAbstractAtomicGroupRecord(
    facts: GroupFacts,
    materializeAtomicGroup: () => GroupSizeResult,
    kind: AbstractAtomicGroupPlan['kind'],
): PlannedGroupRecord {
    const record: PlannedGroupRecord = {
        recordId: facts.groupFactId,
        facts,
        atomicPlan: {
            kind,
            materializeAtomicGroup,
        },
        materialize: () => {
            if (!record.materializedGroup) {
                record.materializedGroup = record.atomicPlan!.materializeAtomicGroup();
            }
            return record.materializedGroup;
        },
    };

    return record;
}

export function createAbstractLeafGroupRecord(
    rule: OrgLeafCountRule | OrgLeafPatternRule,
    modifierStep: ModifierStep,
    units: readonly UnitFacts[],
    formationMatchingIgnoredUnits: readonly OrgUnit[] = [],
): PlannedGroupRecord {
    const template = createAtomicGroupTemplate(
        rule.type,
        modifierStep.modifierKey,
        rule.countsAs ?? null,
        modifierStep.tier,
        rule.tag,
        rule.priority,
        rule.displayName,
    );
    const facts = buildAbstractGroupFactsFromUnits(template, units);

    return createAbstractAtomicGroupRecord(
        facts,
        () => createLeafGroup(rule, modifierStep, units, formationMatchingIgnoredUnits),
        'leaf',
    );
}

export function createAbstractLeafFragmentRecord(
    rule: OrgLeafCountRule,
    count: number,
    units: readonly UnitFacts[],
): PlannedGroupRecord {
    const fragmentType = rule.fragmentType;
    if (!fragmentType) {
        throw new Error('Leaf fragment record requested without fragmentType');
    }

    const template = createAtomicFragmentTemplate(
        fragmentType,
        count,
        rule.fragmentTier ?? rule.tier,
        rule.tag,
        rule.priority,
    );
    const facts = buildAbstractGroupFactsFromUnits(template, units);

    return createAbstractAtomicGroupRecord(
        facts,
        () => createLeafFragmentGroup(rule, count, units),
        'leaf',
    );
}

export function createAbstractCIParentRecord(
    rule: OrgCIFormationRule,
    modifierStep: ModifierStep,
    tokens: readonly CIFragmentToken[],
    unitFactsByUnit: ReadonlyMap<OrgUnit, UnitFacts>,
): PlannedGroupRecord {
    const allocations = aggregateTokenAllocations(tokens);
    const units = allocations
        .map((allocation) => unitFactsByUnit.get(allocation.unit))
        .filter((facts): facts is UnitFacts => !!facts);
    const template = createAtomicGroupTemplate(
        rule.type,
        modifierStep.modifierKey,
        rule.countsAs ?? null,
        modifierStep.tier,
        rule.tag,
        rule.priority,
        rule.displayName,
    );
    const facts = buildAbstractGroupFactsFromUnits(template, units);

    return createAbstractAtomicGroupRecord(
        facts,
        () => createCIParentGroup(rule, modifierStep, tokens),
        'ci-parent',
    );
}

export function createAbstractCIFragmentRecord(
    rule: OrgCIFormationRule,
    count: number,
    tokens: readonly CIFragmentToken[],
    unitFactsByUnit: ReadonlyMap<OrgUnit, UnitFacts>,
): PlannedGroupRecord {
    const allocations = aggregateTokenAllocations(tokens);
    const units = allocations
        .map((allocation) => unitFactsByUnit.get(allocation.unit))
        .filter((facts): facts is UnitFacts => !!facts);
    const template = createAtomicFragmentTemplate(
        rule.fragmentType,
        count,
        rule.fragmentTier,
        rule.tag,
        rule.priority,
    );
    const facts = buildAbstractGroupFactsFromUnits(template, units);

    return createAbstractAtomicGroupRecord(
        facts,
        () => createCIFragmentGroup(rule, count, tokens),
        'ci-fragment',
    );
}

function makeCountedGroupName(type: string, count: number): string {
    return count <= 1 ? type : `${count}x ${type}`;
}

function makeFragmentGroupName(type: string, count: number): string {
    if (count <= 1) {
        return type;
    }

    if (type === 'Unit') {
        return `${count} Units`;
    }

    return makeCountedGroupName(type, count);
}

export function getAllocationSquadCount(allocation: CISquadAllocation | GroupUnitAllocation): number {
    const squads = allocation.squads ?? getCISquadCount(allocation.unit);
    return Number.isFinite(squads) ? Math.max(0, Math.floor(squads)) : 0;
}

function aggregateTokenAllocations(tokens: readonly CIFragmentToken[]): GroupUnitAllocation[] {
    const squadsByUnit = new Map<OrgUnit, number>();

    for (const token of tokens) {
        for (const allocation of token.allocations) {
            squadsByUnit.set(allocation.unit, (squadsByUnit.get(allocation.unit) ?? 0) + getAllocationSquadCount(allocation));
        }
    }

    return Array.from(squadsByUnit.entries()).map(([unit, squads]) => ({
        unit,
        squads,
    }));
}

function getUnitsFromAllocations(allocations: readonly GroupUnitAllocation[]): OrgUnit[] {
    return allocations.map((allocation) => allocation.unit);
}

export function createCIParentGroup(
    rule: OrgCIFormationRule,
    modifierStep: ModifierStep,
    tokens: readonly CIFragmentToken[],
): GroupSizeResult {
    const unitAllocations = aggregateTokenAllocations(tokens);
    return {
        name: makeGroupName(getRuleDisplayName(rule), modifierStep.modifierKey),
        type: rule.type,
        displayName: rule.displayName,
        modifierKey: modifierStep.modifierKey,
        countsAsType: rule.countsAs ?? null,
        tier: modifierStep.tier,
        provenance: 'produced-group',
        units: getUnitsFromAllocations(unitAllocations),
        unitAllocations,
        tag: rule.tag,
        priority: rule.priority,
    };
}

export function createCIFragmentGroup(
    rule: OrgCIFormationRule,
    count: number,
    tokens: readonly CIFragmentToken[],
): GroupSizeResult {
    const unitAllocations = aggregateTokenAllocations(tokens);
    return {
        name: makeFragmentGroupName(rule.fragmentType, count),
        type: rule.fragmentType,
        modifierKey: '',
        countsAsType: null,
        tier: rule.fragmentTier,
        provenance: 'produced-group',
        count,
        isFragment: true,
        units: getUnitsFromAllocations(unitAllocations),
        unitAllocations,
        tag: rule.tag,
        priority: rule.priority,
    };
}

export function createConcretePlannedGroupRecord(group: GroupSizeResult): PlannedGroupRecord {
    const facts = getCompiledGroupFacts(group);

    return {
        recordId: facts.groupFactId,
        facts,
        materializedGroup: group,
        materialize: () => group,
    };
}

export function createAbstractProducedGroupTemplate(
    rule: OrgComposedCountRule | OrgComposedPatternRule,
    modifierStep: ModifierStep,
): GroupSizeResult {
    return {
        name: makeGroupName(getRuleDisplayName(rule), modifierStep.modifierKey),
        type: rule.type,
        displayName: rule.displayName,
        modifierKey: modifierStep.modifierKey,
        countsAsType: rule.countsAs ?? null,
        tier: modifierStep.tier,
        provenance: 'produced-group',
        tag: rule.tag,
        priority: rule.priority,
    };
}

export function copyReadonlyCountMap<Key extends string>(source: ReadonlyMap<Key, number>): Map<Key, number> {
    return new Map(source.entries());
}

function sumReadonlyCountMaps<Key extends string>(
    children: readonly GroupFacts[],
    select: (child: GroupFacts) => ReadonlyMap<Key, number>,
): Map<Key, number> {
    const result = new Map<Key, number>();

    for (const child of children) {
        for (const [key, count] of select(child).entries()) {
            result.set(key, (result.get(key) ?? 0) + count);
        }
    }

    return result;
}

function sumReadonlyNestedCountMaps<Key extends string>(
    children: readonly GroupFacts[],
    select: (child: GroupFacts) => ReadonlyMap<Key, ReadonlyMap<OrgBucketValue, number>>,
): Map<Key, Map<OrgBucketValue, number>> {
    const result = new Map<Key, Map<OrgBucketValue, number>>();

    for (const child of children) {
        for (const [bucketName, bucketCounts] of select(child).entries()) {
            let mergedCounts = result.get(bucketName);
            if (!mergedCounts) {
                mergedCounts = new Map<OrgBucketValue, number>();
                result.set(bucketName, mergedCounts);
            }

            for (const [bucketValue, count] of bucketCounts.entries()) {
                mergedCounts.set(bucketValue, (mergedCounts.get(bucketValue) ?? 0) + count);
            }
        }
    }

    return result;
}

export function createAbstractComposedGroupRecord(
    rule: OrgComposedCountRule | OrgComposedPatternRule,
    modifierStep: ModifierStep,
    childRecords: readonly PlannedGroupRecord[],
): PlannedGroupRecord {
    const groupFactId = allocateSyntheticGroupFactId();
    const materializedGroupTemplate = createAbstractProducedGroupTemplate(rule, modifierStep);
    const childFacts = childRecords.map((record) => record.facts);
    const childTypeCounts = new Map<OrgChildTypeCountKey, number>();

    for (const child of childFacts) {
        const childTypeKey = child.type ?? 'null';
        childTypeCounts.set(childTypeKey, (childTypeCounts.get(childTypeKey) ?? 0) + 1);
        if (child.countsAsType) {
            const countsAsKey = `countsAs:${child.countsAsType}` as OrgChildTypeCountKey;
            childTypeCounts.set(countsAsKey, (childTypeCounts.get(countsAsKey) ?? 0) + 1);
        }
        if (child.tag) {
            const tagKey = `tag:${child.tag}` as OrgChildTypeCountKey;
            childTypeCounts.set(tagKey, (childTypeCounts.get(tagKey) ?? 0) + 1);
        }
    }

    const facts: GroupFacts = {
        groupFactId,
        group: materializedGroupTemplate,
        type: rule.type,
        countsAsType: rule.countsAs ?? null,
        modifierKey: modifierStep.modifierKey,
        tier: modifierStep.tier,
        isFragment: materializedGroupTemplate.isFragment === true,
        provenance: 'produced-group',
        tag: rule.tag,
        directChildCount: childRecords.length,
        childTypeCounts,
        unitTypeCounts: sumReadonlyCountMaps(childFacts, (child) => child.unitTypeCounts),
        unitClassCounts: sumReadonlyCountMaps(childFacts, (child) => child.unitClassCounts),
        unitTagCounts: sumReadonlyCountMaps(childFacts, (child) => child.unitTagCounts),
        descendantUnitBucketCounts: sumReadonlyNestedCountMaps(childFacts, (child) => child.descendantUnitBucketCounts),
    };
    const record: PlannedGroupRecord = {
        recordId: groupFactId,
        facts,
        producedPlan: {
            rule,
            modifierStep,
            childRecords,
        },
        materialize: () => {
            if (!record.materializedGroup) {
                materializedGroupTemplate.children = record.producedPlan?.childRecords.map((child) => child.materialize()) ?? [];
                record.materializedGroup = materializedGroupTemplate;
            }
            return record.materializedGroup;
        },
    };

    return record;
}
