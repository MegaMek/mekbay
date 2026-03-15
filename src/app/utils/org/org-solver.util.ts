/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
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
 */

import type { FactionAffinity } from '../../models/factions.model';
import type { Unit } from '../../models/units.model';
import {
	buildUnitFactsMap,
	compileGroupFactsList,
	compileUnitFactsList,
	DEFAULT_ORG_RULE_REGISTRY,
} from './org-facts.util';
import { resolveOrgDefinitionSpec } from './org-registry.util';
import {
	getEquivalentGroupCountAtTier,
} from './org-tier.util';
import type {
	GroupSizeResult,
	GroupFacts,
	OrgBucketValue,
	OrgDefinitionSpec,
	OrgBucketName,
	OrgChildRoleSpec,
	OrgFactPath,
	OrgComposedCountRule,
	OrgComposedPatternRule,
	OrgLeafCountRule,
	OrgLeafPatternRule,
	OrgPatternBucketMatcher,
	OrgPatternScoreTerm,
	OrgPatternReferenceName,
	OrgSelectorName,
	OrgRuleDefinition,
	OrgRuleRegistry,
	OrgTypeModifier,
	PointRange,
	UnitFacts,
} from './org-types';

export interface OrgModifierResolution {
	readonly prefix: string;
	readonly count: number;
	readonly tier: number;
}

export interface LeafCountEvaluation {
	readonly eligibleUnits: readonly UnitFacts[];
	readonly bucketCounts: ReadonlyMap<OrgBucketValue, number>;
	readonly emitted: readonly LeafCountMatch[];
	readonly leftoverCount: number;
}

export interface LeafCountMatch {
	readonly modifierKey: string;
	readonly perGroupCount: number;
	readonly copies: number;
	readonly tier: number;
}

export interface LeafPatternMatch {
	readonly modifierKey: string;
	readonly perGroupCount: number;
	readonly copies: number;
	readonly tier: number;
	readonly patternIndex: number;
	readonly score: number;
	readonly allocations: readonly ReadonlyMap<OrgBucketValue, number>[];
}

export interface LeafPatternEvaluation {
	readonly eligibleUnits: readonly UnitFacts[];
	readonly bucketCounts: ReadonlyMap<OrgBucketValue, number>;
	readonly emitted: readonly LeafPatternMatch[];
	readonly leftoverCount: number;
}

export interface ComposedRoleAvailability {
	readonly role: string;
	readonly min: number;
	readonly max?: number;
	readonly count: number;
}

export interface ComposedCountMatch {
	readonly modifierKey: string;
	readonly perGroupCount: number;
	readonly copies: number;
	readonly tier: number;
}

export interface ComposedCountEvaluation {
	readonly acceptedGroups: readonly GroupFacts[];
	readonly bucketCounts: ReadonlyMap<OrgBucketValue, number>;
	readonly roleAvailability: readonly ComposedRoleAvailability[];
	readonly emitted: readonly ComposedCountMatch[];
	readonly leftoverCount: number;
}

export type OrgRuleEvaluation = LeafCountEvaluation | LeafPatternEvaluation | ComposedCountEvaluation;

export interface OrgDefinitionEvaluation {
	readonly unitFacts: readonly UnitFacts[];
	readonly groupFacts: readonly GroupFacts[];
	readonly ruleEvaluations: ReadonlyMap<OrgRuleDefinition, OrgRuleEvaluation>;
}

export interface MaterializedUnitResolution {
	readonly groups: readonly GroupSizeResult[];
	readonly leftoverUnitFacts: readonly UnitFacts[];
}

export interface MaterializedGroupResolution {
	readonly groups: readonly GroupSizeResult[];
	readonly leftoverGroupFacts: readonly GroupFacts[];
}

interface SolveContext {
	readonly unitFactsMap: WeakMap<Unit, UnitFacts>;
	readonly groupUnitCache: WeakMap<GroupSizeResult, Unit[]>;
	readonly groupSignatureCache: WeakMap<GroupSizeResult, string>;
}

const GLOBAL_RULE_MODIFIER_RESOLUTION_CACHE = new WeakMap<object, readonly OrgModifierResolution[]>();
const GLOBAL_ACCEPTED_CHILD_TYPES_CACHE = new WeakMap<OrgComposedCountRule | OrgComposedPatternRule, ReadonlySet<GroupSizeResult['type']>>();
const GLOBAL_COMPOSED_CONFIGURATION_CACHE = new WeakMap<OrgComposedCountRule, readonly ResolvedComposedCountConfiguration[]>();
const GLOBAL_DEFINITION_CACHE = new WeakMap<OrgDefinitionSpec, CompiledDefinitionSpec>();

export function getModifierCount(modifier: number | OrgTypeModifier): number {
	return typeof modifier === 'object' ? modifier.count : modifier;
}

export function resolveModifierTier(
	baseTier: number,
	modifier: number | OrgTypeModifier,
): number {
	return typeof modifier === 'object' && modifier.tier !== undefined
		? modifier.tier
		: baseTier;
}

export function getRuleModifierResolutions(
	rule: Pick<OrgLeafCountRule, 'modifiers' | 'tier'>,
): OrgModifierResolution[] {
	const cached = GLOBAL_RULE_MODIFIER_RESOLUTION_CACHE.get(rule as object);
	if (cached) {
		return cached as OrgModifierResolution[];
	}

	const resolved = Object.entries(rule.modifiers)
		.map(([prefix, modifier]) => ({
			prefix,
			count: getModifierCount(modifier),
			tier: resolveModifierTier(rule.tier, modifier),
		}))
		.sort((left, right) => right.count - left.count);

	GLOBAL_RULE_MODIFIER_RESOLUTION_CACHE.set(rule as object, resolved);
	return resolved;
}

export function resolveUnitSelectorNames(
	selector: OrgLeafCountRule['unitSelector'],
): readonly OrgSelectorName[] {
	return typeof selector === 'string' ? [selector] : selector;
}

export function filterUnitFactsBySelector(
	unitFacts: ReadonlyArray<UnitFacts>,
	selector: OrgLeafCountRule['unitSelector'],
	registry: OrgRuleRegistry = DEFAULT_ORG_RULE_REGISTRY,
): UnitFacts[] {
	const selectorNames = resolveUnitSelectorNames(selector);
	const selectors = selectorNames.map((name) => {
		const resolved = registry.unitSelectors[name];
		if (!resolved) {
			throw new Error(`Unknown unit selector: ${name}`);
		}
		return resolved;
	});

	return unitFacts.filter((facts) => selectors.some((matches) => matches(facts)));
}

export function bucketUnitFacts(
	unitFacts: ReadonlyArray<UnitFacts>,
	bucketName: OrgBucketName,
	registry: OrgRuleRegistry = DEFAULT_ORG_RULE_REGISTRY,
): Map<OrgBucketValue, UnitFacts[]> {
	const bucketFactory = registry.unitBuckets[bucketName];
	if (!bucketFactory) {
		throw new Error(`Unknown unit bucket: ${bucketName}`);
	}

	const buckets = new Map<OrgBucketValue, UnitFacts[]>();

	for (const facts of unitFacts) {
		const bucketKey = bucketFactory(facts);
		const existing = buckets.get(bucketKey);
		if (existing) {
			existing.push(facts);
			continue;
		}
		buckets.set(bucketKey, [facts]);
	}

	return buckets;
}

export function countBucketedUnitFacts(
	unitFacts: ReadonlyArray<UnitFacts>,
	bucketName: OrgBucketName,
	registry: OrgRuleRegistry = DEFAULT_ORG_RULE_REGISTRY,
): Map<OrgBucketValue, number> {
	const grouped = bucketUnitFacts(unitFacts, bucketName, registry);
	const counts = new Map<OrgBucketValue, number>();

	for (const [bucketKey, bucketUnits] of grouped) {
		counts.set(bucketKey, bucketUnits.length);
	}

	return counts;
}

export function matchesGroupFactsRole(
	facts: GroupFacts,
	role: OrgChildRoleSpec,
): boolean {
	const matchesType = role.matches.some((orgType) =>
		facts.type === orgType || facts.countsAsType === orgType,
	);
	if (!matchesType) {
		return false;
	}

	if (role.requiredTagsAny && role.requiredTagsAny.length > 0) {
		if (!facts.tag || !role.requiredTagsAny.includes(facts.tag)) {
			return false;
		}
	}

	if (role.requiredTagsAll && role.requiredTagsAll.length > 0) {
		if (!facts.tag || !role.requiredTagsAll.every((tag) => tag === facts.tag)) {
			return false;
		}
	}

	if (role.onlyUnitTypes && role.onlyUnitTypes.length > 0) {
		for (const [unitType, count] of facts.unitTypeCounts) {
			if (count <= 0) {
				continue;
			}
			if (!role.onlyUnitTypes.includes(unitType)) {
				return false;
			}
		}
	}

	if (role.requiredUnitTagsAny && role.requiredUnitTagsAny.length > 0) {
		if (!role.requiredUnitTagsAny.some((tag) => (facts.unitTagCounts.get(tag) ?? 0) > 0)) {
			return false;
		}
	}

	if (role.requiredUnitTagsAll && role.requiredUnitTagsAll.length > 0) {
		if (!role.requiredUnitTagsAll.every((tag) => (facts.unitTagCounts.get(tag) ?? 0) > 0)) {
			return false;
		}
	}

	return true;
}

export function filterGroupFactsByRole(
	groupFacts: ReadonlyArray<GroupFacts>,
	role: OrgChildRoleSpec,
): GroupFacts[] {
	return groupFacts.filter((facts) => matchesGroupFactsRole(facts, role));
}

export function bucketGroupFacts(
	groupFacts: ReadonlyArray<GroupFacts>,
	bucketName: OrgBucketName,
	registry: OrgRuleRegistry = DEFAULT_ORG_RULE_REGISTRY,
): Map<OrgBucketValue, GroupFacts[]> {
	const bucketFactory = registry.groupBuckets[bucketName];
	if (!bucketFactory) {
		throw new Error(`Unknown group bucket: ${bucketName}`);
	}

	const buckets = new Map<OrgBucketValue, GroupFacts[]>();

	for (const facts of groupFacts) {
		const bucketKey = bucketFactory(facts);
		const existing = buckets.get(bucketKey);
		if (existing) {
			existing.push(facts);
			continue;
		}
		buckets.set(bucketKey, [facts]);
	}

	return buckets;
}

export function countBucketedGroupFacts(
	groupFacts: ReadonlyArray<GroupFacts>,
	bucketName: OrgBucketName,
	registry: OrgRuleRegistry = DEFAULT_ORG_RULE_REGISTRY,
): Map<OrgBucketValue, number> {
	const grouped = bucketGroupFacts(groupFacts, bucketName, registry);
	const counts = new Map<OrgBucketValue, number>();

	for (const [bucketKey, bucketGroups] of grouped) {
		counts.set(bucketKey, bucketGroups.length);
	}

	return counts;
}

function getAcceptedGroupsForComposedRule(
	rule: OrgComposedCountRule,
	allGroupFacts: ReadonlyArray<GroupFacts>,
): GroupFacts[] {
	return allGroupFacts.filter((facts) =>
		rule.childRoles.some((role) => matchesGroupFactsRole(facts, role)),
	);
}

function getAcceptedGroupsForChildRoles(
	childRoles: readonly OrgChildRoleSpec[],
	allGroupFacts: ReadonlyArray<GroupFacts>,
): GroupFacts[] {
	return allGroupFacts.filter((facts) =>
		childRoles.some((role) => matchesGroupFactsRole(facts, role)),
	);
}

interface IndexedGroupFacts {
	readonly facts: GroupFacts;
	readonly index: number;
}

interface RoleAssignmentEntry {
	readonly facts: GroupFacts;
	readonly index: number;
	readonly matchingRoleIndices: number[];
}

interface PlannedComposedCountRule {
	readonly acceptedGroups: readonly GroupFacts[];
	readonly bucketCounts: ReadonlyMap<OrgBucketValue, number>;
	readonly roleAvailability: readonly ComposedRoleAvailability[];
	readonly emitted: readonly ComposedCountMatch[];
	readonly groups: readonly GroupSizeResult[];
	readonly leftoverGroupFacts: readonly GroupFacts[];
}

interface RoleMaskPool {
	readonly roleIndices: number[];
	readonly entries: IndexedGroupFacts[];
}

interface BucketRoleMaskCandidate {
	readonly pools: RoleMaskPool[];
	availableCount: number;
}

interface PlannedBucketCopy {
	readonly bucketCandidate: BucketRoleMaskCandidate;
	readonly poolIndices: number[];
}

function getGroupFactsBucketValue(
	facts: GroupFacts,
	bucketName: OrgBucketName,
	registry: OrgRuleRegistry = DEFAULT_ORG_RULE_REGISTRY,
): OrgBucketValue {
	const bucketFactory = registry.groupBuckets[bucketName];
	if (!bucketFactory) {
		throw new Error(`Unknown group bucket: ${bucketName}`);
	}

	return bucketFactory(facts);
}

function collectComposableBucketCandidates(
	childRoles: readonly OrgChildRoleSpec[],
	workingGroupFacts: ReadonlyArray<GroupFacts>,
	childBucketBy?: OrgBucketName,
	registry: OrgRuleRegistry = DEFAULT_ORG_RULE_REGISTRY,
): IndexedGroupFacts[][] {
	const eligibleEntries = workingGroupFacts
		.map((facts, index) => ({ facts, index }))
		.filter(({ facts }) => childRoles.some((role) => matchesGroupFactsRole(facts, role)));

	if (!childBucketBy) {
		return eligibleEntries.length > 0 ? [eligibleEntries] : [];
	}

	const buckets = new Map<OrgBucketValue, IndexedGroupFacts[]>();
	for (const entry of eligibleEntries) {
		const bucketKey = getGroupFactsBucketValue(entry.facts, childBucketBy, registry);
		const bucketEntries = buckets.get(bucketKey);
		if (bucketEntries) {
			bucketEntries.push(entry);
			continue;
		}
		buckets.set(bucketKey, [entry]);
	}

	return Array.from(buckets.entries())
		.sort((left, right) => {
			if (right[1].length !== left[1].length) {
				return right[1].length - left[1].length;
			}
			return String(left[0]).localeCompare(String(right[0]));
		})
		.map(([, entries]) => entries);
}

function bucketSatisfiesRoleMinimums(
	childRoles: readonly OrgChildRoleSpec[],
	eligibleEntries: ReadonlyArray<IndexedGroupFacts>,
): boolean {
	for (const role of childRoles) {
		const requiredCount = role.min ?? 0;
		if (requiredCount <= 0) {
			continue;
		}

		let matchCount = 0;
		for (const entry of eligibleEntries) {
			if (matchesGroupFactsRole(entry.facts, role)) {
				matchCount += 1;
				if (matchCount >= requiredCount) {
					break;
				}
			}
		}

		if (matchCount < requiredCount) {
			return false;
		}
	}

	return true;
}

function getRoleMaxCapacity(role: OrgChildRoleSpec): number {
	return role.max ?? Number.POSITIVE_INFINITY;
}

function buildRoleAssignmentEntries(
	childRoles: readonly OrgChildRoleSpec[],
	eligibleEntries: ReadonlyArray<IndexedGroupFacts>,
): RoleAssignmentEntry[] {
	return eligibleEntries
		.map(({ facts, index }) => {
			const matchingRoleIndices = childRoles
				.map((role, roleIndex) => matchesGroupFactsRole(facts, role) ? roleIndex : -1)
				.filter((roleIndex) => roleIndex >= 0);

			return matchingRoleIndices.length > 0
				? { facts, index, matchingRoleIndices }
				: null;
		})
		.filter((entry): entry is RoleAssignmentEntry => entry !== null);
}

function getAssignableRoleIndex(
	entry: RoleAssignmentEntry,
	childRoles: readonly OrgChildRoleSpec[],
	roleCounts: readonly number[],
): number {
	for (const roleIndex of entry.matchingRoleIndices) {
		if (roleCounts[roleIndex] < getRoleMaxCapacity(childRoles[roleIndex])) {
			return roleIndex;
		}
	}

	return -1;
}

function getAssignableRoleIndexForMask(
	roleIndices: readonly number[],
	childRoles: readonly OrgChildRoleSpec[],
	roleCounts: readonly number[],
): number {
	for (const roleIndex of roleIndices) {
		if (roleCounts[roleIndex] < getRoleMaxCapacity(childRoles[roleIndex])) {
			return roleIndex;
		}
	}

	return -1;
}

function buildRoleMaskPools(
	childRoles: readonly OrgChildRoleSpec[],
	eligibleEntries: ReadonlyArray<IndexedGroupFacts>,
): RoleMaskPool[] {
	const poolsByMask = new Map<string, RoleMaskPool>();

	for (const { facts, index } of eligibleEntries) {
		const roleIndices = childRoles
			.map((role, roleIndex) => matchesGroupFactsRole(facts, role) ? roleIndex : -1)
			.filter((roleIndex) => roleIndex >= 0);
		if (roleIndices.length === 0) {
			continue;
		}

		const maskKey = roleIndices.join(',');
		const existing = poolsByMask.get(maskKey);
		if (existing) {
			existing.entries.push({ facts, index });
			continue;
		}

		poolsByMask.set(maskKey, {
			roleIndices,
			entries: [{ facts, index }],
		});
	}

	return Array.from(poolsByMask.values())
		.sort((left, right) =>
			left.roleIndices.length - right.roleIndices.length
			|| right.entries.length - left.entries.length
			|| left.entries[0]!.index - right.entries[0]!.index,
		);
}

function buildBucketRoleMaskCandidates(
	childRoles: readonly OrgChildRoleSpec[],
	workingGroupFacts: ReadonlyArray<GroupFacts>,
	childBucketBy?: OrgBucketName,
	registry: OrgRuleRegistry = DEFAULT_ORG_RULE_REGISTRY,
): BucketRoleMaskCandidate[] {
	return collectComposableBucketCandidates(childRoles, workingGroupFacts, childBucketBy, registry)
		.map((eligibleEntries) => ({
			pools: buildRoleMaskPools(childRoles, eligibleEntries),
			availableCount: eligibleEntries.length,
		}))
		.filter((candidate) => candidate.availableCount > 0);
}

function tryPlanCopyFromRoleMaskPools(
	childRoles: readonly OrgChildRoleSpec[],
	childCount: number,
	pools: ReadonlyArray<RoleMaskPool>,
): number[] | null {
	const remainingCounts = pools.map((pool) => pool.entries.length);
	const roleCounts = new Array<number>(childRoles.length).fill(0);
	const selectedPoolIndices: number[] = [];

	for (const [roleIndex, role] of childRoles.entries()) {
		const requiredCount = role.min ?? 0;
		if (requiredCount <= 0) {
			continue;
		}

		if (requiredCount > getRoleMaxCapacity(role)) {
			return null;
		}

		for (let assigned = 0; assigned < requiredCount; assigned += 1) {
			const poolIndex = pools.findIndex((pool, index) =>
				remainingCounts[index] > 0 && pool.roleIndices.includes(roleIndex),
			);
			if (poolIndex < 0) {
				return null;
			}

			remainingCounts[poolIndex] -= 1;
			roleCounts[roleIndex] += 1;
			selectedPoolIndices.push(poolIndex);
		}
	}

	while (selectedPoolIndices.length < childCount) {
		let selectedPoolIndex = -1;
		let selectedRoleIndex = -1;

		for (const [poolIndex, pool] of pools.entries()) {
			if (remainingCounts[poolIndex] <= 0) {
				continue;
			}

			const roleIndex = getAssignableRoleIndexForMask(pool.roleIndices, childRoles, roleCounts);
			if (roleIndex < 0) {
				continue;
			}

			selectedPoolIndex = poolIndex;
			selectedRoleIndex = roleIndex;
			break;
		}

		if (selectedPoolIndex < 0 || selectedRoleIndex < 0) {
			return null;
		}

		remainingCounts[selectedPoolIndex] -= 1;
		roleCounts[selectedRoleIndex] += 1;
		selectedPoolIndices.push(selectedPoolIndex);
	}

	return selectedPoolIndices;
}

function tryPlanCopyFromBucketRoleMaskCandidates(
	childRoles: readonly OrgChildRoleSpec[],
	childCount: number,
	bucketCandidates: ReadonlyArray<BucketRoleMaskCandidate>,
): PlannedBucketCopy | null {
	for (const bucketCandidate of bucketCandidates) {
		if (bucketCandidate.availableCount < childCount) {
			continue;
		}

		const poolIndices = tryPlanCopyFromRoleMaskPools(childRoles, childCount, bucketCandidate.pools);
		if (!poolIndices) {
			continue;
		}

		return { bucketCandidate, poolIndices };
	}

	return null;
}

function materializePlannedBucketCopy(plannedCopy: PlannedBucketCopy): GroupFacts[] {
	const selectionsByPool = new Map<number, number>();
	for (const poolIndex of plannedCopy.poolIndices) {
		selectionsByPool.set(poolIndex, (selectionsByPool.get(poolIndex) ?? 0) + 1);
	}

	const consumedFacts: GroupFacts[] = [];
	for (const [poolIndex, selectionCount] of selectionsByPool) {
		const pool = plannedCopy.bucketCandidate.pools[poolIndex];
		for (let count = 0; count < selectionCount; count += 1) {
			const entry = pool.entries.shift();
			if (!entry) {
				throw new Error('Role-mask planner lost bucket entry state during materialization.');
			}
			consumedFacts.push(entry.facts);
		}
	}

	plannedCopy.bucketCandidate.availableCount -= plannedCopy.poolIndices.length;
	return consumedFacts;
}

function collectRemainingFactsFromBucketRoleMaskCandidates(
	bucketCandidates: ReadonlyArray<BucketRoleMaskCandidate>,
): GroupFacts[] {
	return bucketCandidates.flatMap((bucketCandidate) =>
		bucketCandidate.pools.flatMap((pool) => pool.entries.map((entry) => entry.facts)),
	);
}

function collectViableComposableBucketCandidates(
	childRoles: readonly OrgChildRoleSpec[],
	workingGroupFacts: ReadonlyArray<GroupFacts>,
	minChildCount: number,
	childBucketBy?: OrgBucketName,
	registry: OrgRuleRegistry = DEFAULT_ORG_RULE_REGISTRY,
): IndexedGroupFacts[][] {
	if (minChildCount <= 0) {
		return [];
	}

	return collectComposableBucketCandidates(childRoles, workingGroupFacts, childBucketBy, registry)
		.filter((eligibleEntries) =>
			eligibleEntries.length >= minChildCount
			&& bucketSatisfiesRoleMinimums(childRoles, eligibleEntries),
		);
}

function tryConsumeComposedCountCopyFromBucketCandidates(
	childRoles: readonly OrgChildRoleSpec[],
	childCount: number,
	bucketCandidates: ReadonlyArray<ReadonlyArray<IndexedGroupFacts>>,
): number[] | null {
	for (const eligibleEntries of bucketCandidates) {
		if (eligibleEntries.length < childCount) {
			continue;
		}

		const consumedIndices = tryConsumeComposedCountCopyFromEntries(
			childRoles,
			childCount,
			eligibleEntries,
		);
		if (consumedIndices) {
			return consumedIndices;
		}
	}

	return null;
}

function tryConsumeComposedCountCopyFromEntries(
	childRoles: readonly OrgChildRoleSpec[],
	childCount: number,
	eligibleEntries: ReadonlyArray<IndexedGroupFacts>,
): number[] | null {
	const assignmentEntries = buildRoleAssignmentEntries(childRoles, eligibleEntries);
	const acceptedIndices = assignmentEntries.map(({ index }) => index);

	if (acceptedIndices.length < childCount) {
		return null;
	}

	const usedIndices = new Set<number>();
	const roleCounts = new Array<number>(childRoles.length).fill(0);

	for (const [roleIndex, role] of childRoles.entries()) {
		const requiredCount = role.min ?? 0;
		if (requiredCount <= 0) {
			continue;
		}

		const matchingIndices = assignmentEntries
			.filter(({ facts, index }) => !usedIndices.has(index) && matchesGroupFactsRole(facts, role))
			.map(({ index }) => index);

		if (matchingIndices.length < requiredCount) {
			return null;
		}

		for (const index of matchingIndices.slice(0, requiredCount)) {
			usedIndices.add(index);
			roleCounts[roleIndex] += 1;
		}
	}

	const remainingSlots = childCount - usedIndices.size;
	if (remainingSlots < 0) {
		return null;
	}

	const fillerEntries = assignmentEntries
		.filter(({ index }) => !usedIndices.has(index))
		.sort((left, right) => left.matchingRoleIndices.length - right.matchingRoleIndices.length || left.index - right.index);
	if (fillerEntries.length < remainingSlots) {
		return null;
	}

	let assignedFillers = 0;
	for (const entry of fillerEntries) {
		if (assignedFillers >= remainingSlots) {
			break;
		}

		const roleIndex = getAssignableRoleIndex(entry, childRoles, roleCounts);
		if (roleIndex < 0) {
			continue;
		}

		usedIndices.add(entry.index);
		roleCounts[roleIndex] += 1;
		assignedFillers += 1;
	}

	if (assignedFillers < remainingSlots) {
		return null;
	}

	return Array.from(usedIndices).sort((left, right) => right - left);
}

interface ResolvedComposedCountConfiguration {
	readonly childRoles: readonly OrgChildRoleSpec[];
	readonly childBucketBy?: OrgBucketName;
	readonly childMatchBucketBy?: OrgBucketName;
	readonly modifierResolutions: readonly OrgModifierResolution[];
	readonly sortCount: number;
	readonly order: number;
}

function resolveComposedCountConfigurations(
	rule: OrgComposedCountRule,
): ResolvedComposedCountConfiguration[] {
	const cached = GLOBAL_COMPOSED_CONFIGURATION_CACHE.get(rule);
	if (cached) {
		return cached as ResolvedComposedCountConfiguration[];
	}

	const baseModifierResolutions = getRuleModifierResolutions(rule);
	const configurations: Array<ResolvedComposedCountConfiguration> = [{
		childRoles: rule.childRoles,
		childBucketBy: rule.childBucketBy,
		childMatchBucketBy: rule.childMatchBucketBy,
		modifierResolutions: baseModifierResolutions,
		sortCount: Math.min(...baseModifierResolutions.map((modifier) => modifier.count)),
		order: rule.alternativeCompositions?.length ? 1_000_000 : 0,
	}];

	for (const [index, alternative] of (rule.alternativeCompositions ?? []).entries()) {
		const modifierResolutions = getRuleModifierResolutions({
			modifiers: alternative.modifiers,
			tier: rule.tier,
		});
		configurations.push({
			childRoles: alternative.childRoles,
			childBucketBy: alternative.childBucketBy ?? rule.childBucketBy,
			childMatchBucketBy: alternative.childMatchBucketBy ?? rule.childMatchBucketBy,
			modifierResolutions,
			sortCount: Math.min(...modifierResolutions.map((modifier) => modifier.count)),
			order: index,
		});
	}

	const resolved = configurations.sort((left, right) => {
		if (left.sortCount !== right.sortCount) {
			return left.sortCount - right.sortCount;
		}
		return left.order - right.order;
	});

	GLOBAL_COMPOSED_CONFIGURATION_CACHE.set(rule, resolved);
	return resolved;
}

function tryConsumeComposedCountCopy(
	childRoles: readonly OrgChildRoleSpec[],
	childCount: number,
	workingGroupFacts: ReadonlyArray<GroupFacts>,
	childMatchBucketBy?: OrgBucketName,
	registry: OrgRuleRegistry = DEFAULT_ORG_RULE_REGISTRY,
): number[] | null {
	for (const eligibleEntries of collectComposableBucketCandidates(
		childRoles,
		workingGroupFacts,
		childMatchBucketBy,
		registry,
	)) {
		const consumedIndices = tryConsumeComposedCountCopyFromEntries(
			childRoles,
			childCount,
			eligibleEntries,
		);
		if (consumedIndices) {
			return consumedIndices;
		}
	}

	return null;
}

function getAcceptedGroupsForComposedConfigurations(
	configurations: readonly ResolvedComposedCountConfiguration[],
	allGroupFacts: ReadonlyArray<GroupFacts>,
): GroupFacts[] {
	return allGroupFacts.filter((facts) =>
		configurations.some((configuration) =>
			configuration.childRoles.some((role) => matchesGroupFactsRole(facts, role)),
		),
	);
}

function planComposedCountConfiguration(
	rule: OrgComposedCountRule,
	configuration: ResolvedComposedCountConfiguration,
	workingGroups: ReadonlyArray<GroupFacts>,
	registry: OrgRuleRegistry = DEFAULT_ORG_RULE_REGISTRY,
): {
	readonly emitted: readonly ComposedCountMatch[];
	readonly groups: readonly GroupSizeResult[];
	readonly leftoverGroupFacts: readonly GroupFacts[];
} {
	const bucketCandidates = buildBucketRoleMaskCandidates(
		configuration.childRoles,
		workingGroups,
		configuration.childMatchBucketBy,
		registry,
	);
	const emitted: ComposedCountMatch[] = [];
	const groups: GroupSizeResult[] = [];

	for (const modifier of configuration.modifierResolutions) {
		if (modifier.count <= 0) {
			continue;
		}

		let copies = 0;
		while (true) {
			const plannedCopy = tryPlanCopyFromBucketRoleMaskCandidates(
				configuration.childRoles,
				modifier.count,
				bucketCandidates,
			);
			if (!plannedCopy) {
				break;
			}

			copies += 1;
			const children = materializePlannedBucketCopy(plannedCopy).map((facts) => facts.group);

			groups.push({
				name: `${modifier.prefix}${rule.type}`,
				type: rule.type,
				modifierKey: modifier.prefix,
				countsAsType: rule.countsAs ?? null,
				tier: modifier.tier,
				tag: rule.tag,
				priority: rule.priority,
				children,
			});
		}

		if (copies <= 0) {
			continue;
		}

		emitted.push({
			modifierKey: modifier.prefix,
			perGroupCount: modifier.count,
			copies,
			tier: modifier.tier,
		});
	}

	return {
		emitted,
		groups,
		leftoverGroupFacts: collectRemainingFactsFromBucketRoleMaskCandidates(bucketCandidates),
	};
}

function planComposedCountRule(
	rule: OrgComposedCountRule,
	allGroupFacts: ReadonlyArray<GroupFacts>,
	registry: OrgRuleRegistry = DEFAULT_ORG_RULE_REGISTRY,
): PlannedComposedCountRule {
	const configurations = resolveComposedCountConfigurations(rule);
	const acceptedGroups = rule.alternativeCompositions?.length
		? getAcceptedGroupsForComposedConfigurations(configurations, allGroupFacts)
		: getAcceptedGroupsForComposedRule(rule, allGroupFacts);
	const bucketBy = rule.childBucketBy ?? configurations[0]?.childBucketBy;
	const bucketCounts = bucketBy
		? countBucketedGroupFacts(acceptedGroups, bucketBy, registry)
		: new Map<OrgBucketValue, number>([['*' as OrgBucketValue, acceptedGroups.length]]);
	const roleAvailability = (rule.alternativeCompositions?.length ? configurations[0]?.childRoles : rule.childRoles)
		.map((role) => getRoleAvailability(role, allGroupFacts));

	let workingGroups = [...acceptedGroups];
	const emitted: ComposedCountMatch[] = [];
	const groups: GroupSizeResult[] = [];

	for (const configuration of configurations) {
		const planned = planComposedCountConfiguration(rule, configuration, workingGroups, registry);
		emitted.push(...planned.emitted);
		groups.push(...planned.groups);
		workingGroups = [...planned.leftoverGroupFacts];
	}

	return {
		acceptedGroups,
		bucketCounts,
		roleAvailability,
		emitted,
		groups,
		leftoverGroupFacts: workingGroups,
	};
}

function getRoleAvailability(
	role: OrgChildRoleSpec,
	allGroupFacts: ReadonlyArray<GroupFacts>,
): ComposedRoleAvailability {
	const matchingGroups = filterGroupFactsByRole(allGroupFacts, role);

	return {
		role: role.role,
		min: role.min ?? 0,
		max: role.max,
		count: matchingGroups.length,
	};
}

function getMapCount(map: ReadonlyMap<OrgBucketValue, number>, key: OrgBucketValue): number {
	return map.get(key) ?? 0;
}

function rangeDistToPoint(range: PointRange, point: number): number {
	if (point >= range.min && point <= range.max) return 0;
	if (point < range.min) return range.min - point;
	return point - range.max;
}

function isPatternBucketPrefixMatcher(
	matcher: OrgPatternBucketMatcher,
): matcher is Exclude<OrgPatternBucketMatcher, readonly OrgBucketValue[]> {
	return !Array.isArray(matcher);
}

function matchesPatternBucketMatcher(
	bucket: OrgBucketValue,
	matcher: OrgPatternBucketMatcher,
): boolean {
	if (!isPatternBucketPrefixMatcher(matcher)) {
		return matcher.includes(bucket);
	}

	return bucket.startsWith(matcher.prefix);
}

function getPatternMatcherBuckets(
	matcher: OrgPatternBucketMatcher,
	allocation: ReadonlyMap<OrgBucketValue, number>,
): OrgBucketValue[] {
	if (!isPatternBucketPrefixMatcher(matcher)) {
		return [...matcher];
	}

	return Array.from(allocation.keys()).filter((bucket) => bucket.startsWith(matcher.prefix));
}

function parseBucketNumericValue(bucket: OrgBucketValue): number | null {
	const separatorIndex = bucket.lastIndexOf(':');
	if (separatorIndex < 0) {
		return null;
	}

	const value = Number(bucket.slice(separatorIndex + 1));
	return Number.isFinite(value) ? value : null;
}

function sumPatternReference(
	reference: OrgPatternReferenceName,
	allocation: ReadonlyMap<OrgBucketValue, number>,
	pattern: OrgLeafPatternRule['patterns'][number],
): number {
	const matcher = pattern.bucketGroups?.[reference];
	if (matcher) {
		let total = 0;
		for (const bucket of getPatternMatcherBuckets(matcher, allocation)) {
			if (!matchesPatternBucketMatcher(bucket, matcher)) {
				continue;
			}
			total += getMapCount(allocation, bucket);
		}
		return total;
	}

	return getMapCount(allocation, reference as OrgBucketValue);

}

function sumNumericPatternReference(
	reference: OrgPatternReferenceName,
	allocation: ReadonlyMap<OrgBucketValue, number>,
	pattern: OrgLeafPatternRule['patterns'][number],
): number {
	const matcher = pattern.bucketGroups?.[reference];
	if (matcher) {
		let total = 0;
		for (const bucket of getPatternMatcherBuckets(matcher, allocation)) {
			if (!matchesPatternBucketMatcher(bucket, matcher)) {
				continue;
			}

			const numericValue = parseBucketNumericValue(bucket);
			if (numericValue === null) {
				continue;
			}

			total += numericValue * getMapCount(allocation, bucket);
		}
		return total;
	}

	const numericValue = parseBucketNumericValue(reference as OrgBucketValue);
	if (numericValue === null) {
		return 0;
	}

	return numericValue * getMapCount(allocation, reference as OrgBucketValue);
}

function getPatternScoreTermValue(
	term: OrgPatternScoreTerm,
	allocation: ReadonlyMap<OrgBucketValue, number>,
	pattern: OrgLeafPatternRule['patterns'][number],
): number {
	switch (term.kind) {
		case 'target':
			return sumPatternReference(term.ref, allocation, pattern);
		case 'numeric-target':
			return sumNumericPatternReference(term.ref, allocation, pattern);
		case 'positive-diff':
			return Math.max(0, sumPatternReference(term.left, allocation, pattern) - sumPatternReference(term.right, allocation, pattern));
		default: {
			const unreachableTerm: never = term;
			return unreachableTerm;
		}
	}
}

function evaluatePatternScore(
	allocation: ReadonlyMap<OrgBucketValue, number>,
	pattern: OrgLeafPatternRule['patterns'][number],
): number {
	if (pattern.matchMode !== 'score') {
		return 0;
	}

	let score = 0;

	for (const term of pattern.scoreTerms) {
		const value = getPatternScoreTermValue(term, allocation, pattern);
		const weight = term.weight ?? 1;

		if (term.kind === 'target' || term.kind === 'numeric-target') {
			const targetDistance = typeof term.target === 'number'
				? Math.abs(value - term.target)
				: rangeDistToPoint(term.target, value);
			const normalizedDistance = term.kind === 'numeric-target' && term.divisor
				? targetDistance / term.divisor
				: targetDistance;
			score += normalizedDistance * weight;
			continue;
		}

		score += value * weight;
	}

	return score;
}

function resolveConstraintOperand(
	operand: OrgFactPath | number | boolean | string,
	allocation: ReadonlyMap<OrgBucketValue, number>,
	pattern: OrgLeafPatternRule['patterns'][number],
): string | number | boolean {
	if (typeof operand !== 'string') {
		return operand;
	}

	if (operand.startsWith('bucket:')) {
		return getMapCount(allocation, operand.slice('bucket:'.length) as OrgBucketValue);
	}

	if (operand.startsWith('sum:')) {
		return sumPatternReference(operand.slice('sum:'.length), allocation, pattern);
	}

	return operand;
}

function satisfiesPatternConstraints(
	allocation: ReadonlyMap<OrgBucketValue, number>,
	pattern: OrgLeafPatternRule['patterns'][number],
): boolean {
	for (const [reference, exact] of Object.entries(pattern.demands ?? {})) {
		if (sumPatternReference(reference, allocation, pattern) !== exact) {
			return false;
		}
	}

	for (const [reference, min] of Object.entries(pattern.minSums ?? {})) {
		if (min === undefined) {
			continue;
		}
		if (sumPatternReference(reference, allocation, pattern) < min) {
			return false;
		}
	}

	for (const [reference, max] of Object.entries(pattern.maxSums ?? {})) {
		if (max === undefined) {
			continue;
		}
		if (sumPatternReference(reference, allocation, pattern) > max) {
			return false;
		}
	}

	for (const constraint of pattern.constraints ?? []) {
		const left = resolveConstraintOperand(constraint.left, allocation, pattern);
		const right = resolveConstraintOperand(constraint.right, allocation, pattern);

		if (typeof left !== 'number' || typeof right !== 'number') {
			return false;
		}

		switch (constraint.op) {
			case '<=':
				if (!(left <= right)) return false;
				break;
			case '>=':
				if (!(left >= right)) return false;
				break;
			case '=':
				if (left !== right) return false;
				break;
		}
	}

	return true;
}

function findBestPatternAllocation(
	pattern: OrgLeafPatternRule['patterns'][number],
	availableCounts: ReadonlyMap<OrgBucketValue, number>,
): { allocation: ReadonlyMap<OrgBucketValue, number>; score: number } | null {
	const bucketNames = Array.from(availableCounts.keys()).filter((bucket) => getMapCount(availableCounts, bucket) > 0);
	const remainingFromIndex = new Array<number>(bucketNames.length + 1).fill(0);
	for (let index = bucketNames.length - 1; index >= 0; index--) {
		remainingFromIndex[index] = remainingFromIndex[index + 1] + getMapCount(availableCounts, bucketNames[index]);
	}

	let best: { allocation: ReadonlyMap<OrgBucketValue, number>; score: number } | null = null;

	const search = (
		index: number,
		remaining: number,
		allocation: Map<OrgBucketValue, number>,
	): void => {
		if (remaining === 0) {
			if (!satisfiesPatternConstraints(allocation, pattern)) {
				return;
			}

			const resolvedAllocation = new Map(allocation);
			if (pattern.matchMode !== 'score') {
				if (!best) {
					best = { allocation: resolvedAllocation, score: 0 };
				}
				return;
			}

			const score = evaluatePatternScore(resolvedAllocation, pattern);
			if (!best || score < best.score) {
				best = { allocation: resolvedAllocation, score };
			}
			return;
		}

		if (index >= bucketNames.length || remainingFromIndex[index] < remaining) {
			return;
		}

		const bucket = bucketNames[index];
		const available = getMapCount(availableCounts, bucket);
		const maxTake = Math.min(available, remaining);

		for (let take = maxTake; take >= 0; take--) {
			if (take > 0) {
				allocation.set(bucket, take);
			} else {
				allocation.delete(bucket);
			}

			search(index + 1, remaining - take, allocation);
		}

		allocation.delete(bucket);
	};

	search(0, pattern.copySize, new Map<OrgBucketValue, number>());
	return best;
}

function subtractAllocation(
	counts: Map<OrgBucketValue, number>,
	allocation: ReadonlyMap<OrgBucketValue, number>,
): void {
	for (const [bucket, used] of allocation) {
		const remaining = getMapCount(counts, bucket) - used;
		if (remaining > 0) {
			counts.set(bucket, remaining);
			continue;
		}
		counts.delete(bucket);
	}
}

export function evaluateLeafCountRule(
	rule: OrgLeafCountRule,
	allUnitFacts: ReadonlyArray<UnitFacts>,
	registry: OrgRuleRegistry = DEFAULT_ORG_RULE_REGISTRY,
): LeafCountEvaluation {
	const eligibleUnits = filterUnitFactsBySelector(allUnitFacts, rule.unitSelector, registry);
	const bucketCounts = rule.bucketBy
		? countBucketedUnitFacts(eligibleUnits, rule.bucketBy, registry)
		: new Map<OrgBucketValue, number>([['*' as OrgBucketValue, eligibleUnits.length]]);

	const emitted: LeafCountMatch[] = [];
	const workingCounts = new Map(bucketCounts);

	for (const modifier of getRuleModifierResolutions(rule)) {
		if (modifier.count <= 0) {
			continue;
		}

		let copies = 0;
		for (const [bucket, count] of workingCounts) {
			const bucketCopies = Math.floor(count / modifier.count);
			if (bucketCopies <= 0) {
				continue;
			}

			copies += bucketCopies;
			const remainingCount = count - (bucketCopies * modifier.count);
			if (remainingCount > 0) {
				workingCounts.set(bucket, remainingCount);
				continue;
			}

			workingCounts.delete(bucket);
		}

		if (copies <= 0) {
			continue;
		}

		emitted.push({
			modifierKey: modifier.prefix,
			perGroupCount: modifier.count,
			copies,
			tier: modifier.tier,
		});
	}

	let remainingUnits = 0;
	for (const count of workingCounts.values()) {
		remainingUnits += count;
	}

	return {
		eligibleUnits,
		bucketCounts,
		emitted,
		leftoverCount: remainingUnits,
	};
}

export function materializeLeafCountRule(
	rule: OrgLeafCountRule,
	allUnitFacts: ReadonlyArray<UnitFacts>,
	registry: OrgRuleRegistry = DEFAULT_ORG_RULE_REGISTRY,
): MaterializedUnitResolution {
	const eligibleUnits = filterUnitFactsBySelector(allUnitFacts, rule.unitSelector, registry);
	const groupedUnits = rule.bucketBy
		? bucketUnitFacts(eligibleUnits, rule.bucketBy, registry)
		: new Map<OrgBucketValue, UnitFacts[]>([['*' as OrgBucketValue, [...eligibleUnits]]]);
	const workingBuckets = new Map<OrgBucketValue, UnitFacts[]>(
		Array.from(groupedUnits.entries(), ([bucketKey, bucketUnits]) => [bucketKey, [...bucketUnits]]),
	);
	const groups: GroupSizeResult[] = [];

	for (const modifier of getRuleModifierResolutions(rule)) {
		if (modifier.count <= 0) {
			continue;
		}

		for (const [bucketKey, bucketUnits] of workingBuckets) {
			while (bucketUnits.length >= modifier.count) {
				const selectedUnits = bucketUnits.splice(0, modifier.count);
				groups.push({
					name: `${modifier.prefix}${rule.type}`,
					type: rule.type,
					modifierKey: modifier.prefix,
					countsAsType: rule.countsAs ?? null,
					tier: modifier.tier,
					tag: rule.tag,
					priority: rule.priority,
					units: selectedUnits.map((unitFacts) => unitFacts.unit),
				});
			}

			if (bucketUnits.length === 0) {
				workingBuckets.delete(bucketKey);
			}
		}
	}

	return {
		groups,
		leftoverUnitFacts: Array.from(workingBuckets.values()).flat(),
	};
}

export function evaluateLeafPatternRule(
	rule: OrgLeafPatternRule,
	allUnitFacts: ReadonlyArray<UnitFacts>,
	registry: OrgRuleRegistry = DEFAULT_ORG_RULE_REGISTRY,
): LeafPatternEvaluation {
	const eligibleUnits = filterUnitFactsBySelector(allUnitFacts, rule.unitSelector, registry);
	const initialBucketCounts = countBucketedUnitFacts(eligibleUnits, rule.bucketBy, registry);
	const emitted: LeafPatternMatch[] = [];
	const workingCounts = new Map(initialBucketCounts);

	for (const modifier of getRuleModifierResolutions(rule)) {
		if (modifier.count <= 0) {
			continue;
		}

		while (Array.from(workingCounts.values()).reduce((sum, count) => sum + count, 0) >= modifier.count) {
			let matchedAllocation: ReadonlyMap<OrgBucketValue, number> | null = null;
			let matchedPatternIndex = -1;
			let matchedScore = Number.POSITIVE_INFINITY;

			for (const [patternIndex, pattern] of rule.patterns.entries()) {
				if (pattern.copySize !== modifier.count) {
					continue;
				}

				const bestPatternAllocation = findBestPatternAllocation(pattern, workingCounts);
				if (!bestPatternAllocation) {
					continue;
				}

				if (bestPatternAllocation.score > matchedScore) {
					continue;
				}

				matchedAllocation = bestPatternAllocation.allocation;
				matchedPatternIndex = patternIndex;
				matchedScore = bestPatternAllocation.score;
			}

			if (!matchedAllocation) {
				break;
			}

			subtractAllocation(workingCounts, matchedAllocation);

			const existingMatch = emitted.find((match) =>
				match.modifierKey === modifier.prefix && match.patternIndex === matchedPatternIndex,
			);
			if (existingMatch) {
				const nextAllocations = [...existingMatch.allocations, matchedAllocation];
				emitted.splice(emitted.indexOf(existingMatch), 1, {
					...existingMatch,
					copies: existingMatch.copies + 1,
					allocations: nextAllocations,
				});
				continue;
			}

			emitted.push({
				modifierKey: modifier.prefix,
				perGroupCount: modifier.count,
				copies: 1,
				tier: modifier.tier,
				patternIndex: matchedPatternIndex,
				score: matchedScore,
				allocations: [matchedAllocation],
			});
		}
	}

	let remainingUnits = 0;
	for (const count of workingCounts.values()) {
		remainingUnits += count;
	}

	return {
		eligibleUnits,
		bucketCounts: initialBucketCounts,
		emitted,
		leftoverCount: remainingUnits,
	};
}

export function materializeLeafPatternRule(
	rule: OrgLeafPatternRule,
	allUnitFacts: ReadonlyArray<UnitFacts>,
	registry: OrgRuleRegistry = DEFAULT_ORG_RULE_REGISTRY,
): MaterializedUnitResolution {
	const eligibleUnits = filterUnitFactsBySelector(allUnitFacts, rule.unitSelector, registry);
	const groupedUnits = bucketUnitFacts(eligibleUnits, rule.bucketBy, registry);
	const workingBuckets = new Map<OrgBucketValue, UnitFacts[]>(
		Array.from(groupedUnits.entries(), ([bucketKey, bucketUnits]) => [bucketKey, [...bucketUnits]]),
	);
	const workingCounts = new Map<OrgBucketValue, number>(
		Array.from(groupedUnits.entries(), ([bucketKey, bucketUnits]) => [bucketKey, bucketUnits.length]),
	);
	const groups: GroupSizeResult[] = [];

	for (const modifier of getRuleModifierResolutions(rule)) {
		if (modifier.count <= 0) {
			continue;
		}

		while (true) {
			let matchedAllocation: ReadonlyMap<OrgBucketValue, number> | null = null;
			let matchedPattern: OrgLeafPatternRule['patterns'][number] | null = null;
			let matchedScore = Number.POSITIVE_INFINITY;

			for (const pattern of rule.patterns) {
				if (pattern.copySize !== modifier.count) {
					continue;
				}

				const bestPatternAllocation = findBestPatternAllocation(pattern, workingCounts);
				if (!bestPatternAllocation) {
					continue;
				}

				if (bestPatternAllocation.score > matchedScore) {
					continue;
				}

				matchedAllocation = bestPatternAllocation.allocation;
				matchedPattern = pattern;
				matchedScore = bestPatternAllocation.score;
			}

			if (!matchedAllocation || !matchedPattern) {
				break;
			}

			const selectedUnits: Unit[] = [];
			for (const [bucketKey, usedCount] of matchedAllocation) {
				const bucketUnits = workingBuckets.get(bucketKey);
				if (!bucketUnits || bucketUnits.length < usedCount) {
					throw new Error(`Pattern materialization lost bucket state for ${bucketKey}.`);
				}

				selectedUnits.push(...bucketUnits.splice(0, usedCount).map((unitFacts) => unitFacts.unit));
				if (bucketUnits.length === 0) {
					workingBuckets.delete(bucketKey);
				}
			}

			subtractAllocation(workingCounts, matchedAllocation);
			groups.push({
				name: `${modifier.prefix}${rule.type}`,
				type: rule.type,
				modifierKey: modifier.prefix,
				countsAsType: rule.countsAs ?? null,
				tier: modifier.tier,
				tag: rule.tag,
				priority: rule.priority,
				units: selectedUnits,
			});
		}
	}

	return {
		groups,
		leftoverUnitFacts: Array.from(workingBuckets.values()).flat(),
	};
}

export function evaluateComposedCountRule(
	rule: OrgComposedCountRule,
	allGroupFacts: ReadonlyArray<GroupFacts>,
	registry: OrgRuleRegistry = DEFAULT_ORG_RULE_REGISTRY,
): ComposedCountEvaluation {
	const planned = planComposedCountRule(rule, allGroupFacts, registry);
	return {
		acceptedGroups: planned.acceptedGroups,
		bucketCounts: planned.bucketCounts,
		roleAvailability: planned.roleAvailability,
		emitted: planned.emitted,
		leftoverCount: planned.leftoverGroupFacts.length,
	};
}

export function materializeComposedCountRule(
	rule: OrgComposedCountRule,
	allGroupFacts: ReadonlyArray<GroupFacts>,
	registry: OrgRuleRegistry = DEFAULT_ORG_RULE_REGISTRY,
): MaterializedGroupResolution {
	const planned = planComposedCountRule(rule, allGroupFacts, registry);
	return {
		groups: planned.groups,
		leftoverGroupFacts: planned.leftoverGroupFacts,
	};
}

export function evaluateRule(
	rule: OrgRuleDefinition,
	unitFacts: ReadonlyArray<UnitFacts>,
	groupFacts: ReadonlyArray<GroupFacts>,
	registry: OrgRuleRegistry = DEFAULT_ORG_RULE_REGISTRY,
): OrgRuleEvaluation {
	switch (rule.kind) {
		case 'leaf-count':
			return evaluateLeafCountRule(rule, unitFacts, registry);
		case 'leaf-pattern':
			return evaluateLeafPatternRule(rule, unitFacts, registry);
		case 'composed-count':
			return evaluateComposedCountRule(rule, groupFacts, registry);
		case 'composed-pattern':
			throw new Error(`Rule kind not implemented yet: ${rule.kind}`);
		default: {
			const unreachableRule: never = rule;
			return unreachableRule;
		}
	}
}

export function evaluateOrgDefinition(
	definition: OrgDefinitionSpec,
	units: ReadonlyArray<Unit>,
	groups: ReadonlyArray<GroupSizeResult> = [],
): OrgDefinitionEvaluation {
	const groupUnitCache = new WeakMap<GroupSizeResult, Unit[]>();
	const solveContext: SolveContext = {
		unitFactsMap: buildUnitFactsMap([...units, ...collectAllGroupUnits(groups, groupUnitCache)]),
		groupUnitCache,
		groupSignatureCache: new WeakMap<GroupSizeResult, string>(),
	};
	const unitFacts = compileUnitFactsList(units);
	const groupFacts = compileGroupFactsList(groups, solveContext.unitFactsMap, solveContext.groupUnitCache);
	const ruleEvaluations = new Map<OrgRuleDefinition, OrgRuleEvaluation>();

	for (const rule of definition.rules) {
		ruleEvaluations.set(rule, evaluateRule(rule, unitFacts, groupFacts, definition.registry));
	}

	return {
		unitFacts,
		groupFacts,
		ruleEvaluations,
	};
}

export function evaluateFactionOrgDefinition(
	factionName: string,
	factionAffinity: FactionAffinity,
	units: ReadonlyArray<Unit>,
	groups: ReadonlyArray<GroupSizeResult> = [],
): OrgDefinitionEvaluation {
	return evaluateOrgDefinition(resolveOrgDefinitionSpec(factionName, factionAffinity), units, groups);
}

export const EMPTY_RESULT: GroupSizeResult = {
	name: 'Force',
	type: null,
	modifierKey: '',
	countsAsType: null,
	tier: 0,
};

const FOREIGN_UNITS_EVALUATION = true;
const FLATTEN_REEVALUATED_FOREIGN_GROUPS_BEFORE_COMPOSITION = false;
const MAX_LEAF_CANDIDATES = 256;

interface LeafAllocationCandidate {
	readonly groups: readonly GroupSizeResult[];
	readonly leftoverUnitFacts: readonly UnitFacts[];
}

interface ResultScore {
	readonly priorityWithoutLeftovers: number;
	readonly maxTier: number;
	readonly rawPriority: number;
	readonly groupCount: number;
	readonly tierSum: number;
}

interface NormalizationTarget {
	readonly name: string;
	readonly type: GroupSizeResult['type'];
	readonly modifierKey: string;
	readonly countsAsType: GroupSizeResult['countsAsType'];
	readonly tier: number;
	readonly tag?: GroupSizeResult['tag'];
	readonly priority?: number;
}

interface CompiledDefinitionSpec {
	readonly leafRules: readonly (OrgLeafCountRule | OrgLeafPatternRule)[];
	readonly composedCountRules: readonly OrgComposedCountRule[];
	readonly knownGroupTypes: ReadonlySet<GroupSizeResult['type']>;
	readonly normalizationTargets: readonly NormalizationTarget[];
}

function isLeafRuleDefinition(rule: OrgRuleDefinition): rule is OrgLeafCountRule | OrgLeafPatternRule {
	return rule.kind === 'leaf-count' || rule.kind === 'leaf-pattern';
}

function isComposedRuleDefinition(rule: OrgRuleDefinition): rule is OrgComposedCountRule | OrgComposedPatternRule {
	return rule.kind === 'composed-count' || rule.kind === 'composed-pattern';
}

function getCompiledDefinitionSpec(definition: OrgDefinitionSpec): CompiledDefinitionSpec {
	const cached = GLOBAL_DEFINITION_CACHE.get(definition);
	if (cached) {
		return cached;
	}

	const leafRules = definition.rules
		.filter(isLeafRuleDefinition)
		.sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0) || right.tier - left.tier);
	const composedCountRules = definition.rules.filter((rule): rule is OrgComposedCountRule => rule.kind === 'composed-count');
	const knownGroupTypes = new Set<GroupSizeResult['type']>();
	for (const rule of definition.rules) {
		knownGroupTypes.add(rule.type);
		if (rule.countsAs) {
			knownGroupTypes.add(rule.countsAs);
		}
	}
	const normalizationTargets = definition.rules.flatMap((rule) =>
		getRuleModifierResolutions(rule).map((modifier) => ({
			name: `${modifier.prefix}${rule.type}`,
			type: rule.type,
			modifierKey: modifier.prefix,
			countsAsType: rule.countsAs ?? null,
			tier: modifier.tier,
			tag: rule.tag,
			priority: rule.priority,
		})),
	).sort((left, right) => left.tier - right.tier);

	const compiled: CompiledDefinitionSpec = {
		leafRules,
		composedCountRules,
		knownGroupTypes,
		normalizationTargets,
	};

	GLOBAL_DEFINITION_CACHE.set(definition, compiled);
	return compiled;
}

function materializeLeafRule(
	rule: OrgLeafCountRule | OrgLeafPatternRule,
	unitFacts: ReadonlyArray<UnitFacts>,
	registry: OrgRuleRegistry,
): MaterializedUnitResolution {
	return rule.kind === 'leaf-count'
		? materializeLeafCountRule(rule, unitFacts, registry)
		: materializeLeafPatternRule(rule, unitFacts, registry);
}

function collectGroupUnits(
	group: GroupSizeResult,
	groupUnitCache?: WeakMap<GroupSizeResult, Unit[]>,
): Unit[] {
	const cached = groupUnitCache?.get(group);
	if (cached) {
		return cached;
	}

	const units: Unit[] = [];

	if (group.units) {
		units.push(...group.units);
	}

	if (group.children) {
		for (const child of group.children) {
			units.push(...collectGroupUnits(child, groupUnitCache));
		}
	}

	if (groupUnitCache) {
		groupUnitCache.set(group, units);
	}

	return units;
}

function collectAllGroupUnits(
	groups: ReadonlyArray<GroupSizeResult>,
	groupUnitCache?: WeakMap<GroupSizeResult, Unit[]>,
): Unit[] {
	return groups.flatMap((group) => collectGroupUnits(group, groupUnitCache));
}

function scoreResolvedGroups(
	groups: ReadonlyArray<GroupSizeResult>,
	leftoverUnitCount: number,
): ResultScore {
	let maxTier = 0;
	let rawPriority = 0;
	let tierSum = 0;

	for (const group of groups) {
		if (group.tier > maxTier) {
			maxTier = group.tier;
		}
		if ((group.priority ?? 0) > rawPriority) {
			rawPriority = group.priority ?? 0;
		}
		tierSum += group.tier;
	}

	const priorityWithoutLeftovers = groups.length === 1 && leftoverUnitCount === 0
		? rawPriority
		: 0;

	return {
		priorityWithoutLeftovers,
		maxTier,
		rawPriority: priorityWithoutLeftovers,
		groupCount: groups.length,
		tierSum,
	};
}

function betterResolvedResult(left: ResultScore, right: ResultScore): boolean {
	if (left.priorityWithoutLeftovers !== right.priorityWithoutLeftovers) {
		return left.priorityWithoutLeftovers > right.priorityWithoutLeftovers;
	}
	if (left.maxTier !== right.maxTier) {
		return left.maxTier > right.maxTier;
	}
	if (left.rawPriority !== right.rawPriority) {
		return left.rawPriority > right.rawPriority;
	}
	if (left.groupCount !== right.groupCount) {
		return left.groupCount < right.groupCount;
	}
	return left.tierSum > right.tierSum;
}

function sortGroupsByTier(groups: ReadonlyArray<GroupSizeResult>): GroupSizeResult[] {
	return [...groups].sort((left, right) => right.tier - left.tier || left.name.localeCompare(right.name));
}

function attachTopLevelLeftovers(
	groups: ReadonlyArray<GroupSizeResult>,
	leftoverUnits: ReadonlyArray<Unit>,
): GroupSizeResult[] {
	if (groups.length === 0) {
		if (leftoverUnits.length === 0) {
			return [EMPTY_RESULT];
		}

		return [{
			...EMPTY_RESULT,
			leftoverUnits: [...leftoverUnits],
		}];
	}

	if (leftoverUnits.length === 0) {
		return [...groups];
	}

	const sorted = sortGroupsByTier(groups);
	const [head, ...tail] = sorted;
	return [{
		...head,
		leftoverUnits: [...(head.leftoverUnits ?? []), ...leftoverUnits],
	}, ...tail];
}

function buildLeafCandidateKey(
	unitFacts: ReadonlyArray<UnitFacts>,
	ruleIndex: number,
): string {
	return `${ruleIndex}|${unitFacts.map((facts) => facts.unitId).sort().join(',')}`;
}

function collectLeafAllocationCandidates(
	leafRules: ReadonlyArray<OrgLeafCountRule | OrgLeafPatternRule>,
	unitFacts: ReadonlyArray<UnitFacts>,
	registry: OrgRuleRegistry,
): LeafAllocationCandidate[] {
	const memo = new Map<string, LeafAllocationCandidate[]>();

	function visit(ruleIndex: number, remainingUnitFacts: ReadonlyArray<UnitFacts>): LeafAllocationCandidate[] {
		const key = buildLeafCandidateKey(remainingUnitFacts, ruleIndex);
		const cached = memo.get(key);
		if (cached) {
			return cached;
		}

		if (ruleIndex >= leafRules.length) {
			const terminal = [{ groups: [], leftoverUnitFacts: [...remainingUnitFacts] }];
			memo.set(key, terminal);
			return terminal;
		}

		const rule = leafRules[ruleIndex];
		const candidates: LeafAllocationCandidate[] = [];

		for (const downstream of visit(ruleIndex + 1, remainingUnitFacts)) {
			candidates.push(downstream);
			if (candidates.length >= MAX_LEAF_CANDIDATES) {
				console.error(`Too many leaf candidates at rule index ${ruleIndex}, skipping further exploration.`);
				break;
			}
		}

		if (candidates.length < MAX_LEAF_CANDIDATES) {
			const materialized = materializeLeafRule(rule, remainingUnitFacts, registry);
			if (materialized.groups.length > 0) {
				for (const downstream of visit(ruleIndex + 1, materialized.leftoverUnitFacts)) {
					candidates.push({
						groups: [...materialized.groups, ...downstream.groups],
						leftoverUnitFacts: downstream.leftoverUnitFacts,
					});
					if (candidates.length >= MAX_LEAF_CANDIDATES) {
						console.error(`Too many leaf candidates at rule index ${ruleIndex}, skipping further exploration.`);
						break;
					}
				}
			}
		} else {
			console.error(`Too many leaf candidates at rule index ${ruleIndex}, skipping further exploration.`);
		}

		memo.set(key, candidates);
		return candidates;
	}

	return visit(0, unitFacts);
}

function getAcceptedChildTypes(rule: OrgComposedCountRule | OrgComposedPatternRule): Set<GroupSizeResult['type']> {
	const cached = GLOBAL_ACCEPTED_CHILD_TYPES_CACHE.get(rule);
	if (cached) {
		return cached as Set<GroupSizeResult['type']>;
	}

	const accepted = new Set<GroupSizeResult['type']>();

	for (const childRole of rule.childRoles) {
		for (const match of childRole.matches) {
			accepted.add(match);
		}
	}

	if (rule.kind === 'composed-count') {
		for (const alternative of rule.alternativeCompositions ?? []) {
			for (const childRole of alternative.childRoles) {
				for (const match of childRole.matches) {
					accepted.add(match);
				}
			}
		}
	}

	GLOBAL_ACCEPTED_CHILD_TYPES_CACHE.set(rule, accepted);
	return accepted;
}

function isKnownGroupType(
	group: GroupSizeResult,
	definition: OrgDefinitionSpec,
): boolean {
	const knownTypes = getCompiledDefinitionSpec(definition).knownGroupTypes;
	return (group.type != null && knownTypes.has(group.type))
		|| (group.countsAsType != null && knownTypes.has(group.countsAsType));
}

function buildGroupSignature(group: GroupSizeResult, solveContext: SolveContext): string {
	const cached = solveContext.groupSignatureCache.get(group);
	if (cached) {
		return cached;
	}

	const unitIds = collectGroupUnits(group, solveContext.groupUnitCache)
		.map((unit) => `${unit.id}:${unit.name}`)
		.sort()
		.join(',');

	const signature = [
		group.name,
		group.type ?? 'null',
		group.modifierKey,
		group.countsAsType ?? 'null',
		String(group.tier),
		group.tag ?? '',
		unitIds,
		group.children?.length ?? 0,
	].join('|');

	solveContext.groupSignatureCache.set(group, signature);
	return signature;
}

function buildGroupsStateKey(groups: ReadonlyArray<GroupSizeResult>, solveContext: SolveContext): string {
	return groups.map((group) => buildGroupSignature(group, solveContext)).sort().join('||');
}

function getStateGroupFacts(
	groups: ReadonlyArray<GroupSizeResult>,
	stateKey: string,
	groupFactsMemo: Map<string, GroupFacts[]>,
	solveContext: SolveContext,
): GroupFacts[] {
	const cached = groupFactsMemo.get(stateKey);
	if (cached) {
		return cached;
	}

	const groupFacts = compileGroupFactsList(groups, solveContext.unitFactsMap, solveContext.groupUnitCache);
	groupFactsMemo.set(stateKey, groupFacts);
	return groupFacts;
}

function canPromoteFurther(
	groups: ReadonlyArray<GroupSizeResult>,
	definition: OrgDefinitionSpec,
	groupFactsMemo: Map<string, GroupFacts[]>,
	promoteMemo: Map<string, boolean>,
	solveContext: SolveContext,
): boolean {
	const stateKey = buildGroupsStateKey(groups, solveContext);
	const cached = promoteMemo.get(stateKey);
	if (cached !== undefined) {
		return cached;
	}

	const groupFacts = getStateGroupFacts(groups, stateKey, groupFactsMemo, solveContext);

	for (const rule of getCompiledDefinitionSpec(definition).composedCountRules) {
		for (const configuration of resolveComposedCountConfigurations(rule)) {
			const bucketCandidates = buildBucketRoleMaskCandidates(
				configuration.childRoles,
				groupFacts,
				configuration.childMatchBucketBy,
				definition.registry,
			);

			if (bucketCandidates.length === 0) {
				continue;
			}

			for (const modifier of configuration.modifierResolutions) {
				if (modifier.count <= 0) {
					continue;
				}

				if (tryPlanCopyFromBucketRoleMaskCandidates(
					configuration.childRoles,
					modifier.count,
					bucketCandidates,
				)) {
					promoteMemo.set(stateKey, true);
					return true;
				}
			}
		}
	}

	promoteMemo.set(stateKey, false);
	return false;
}

function collectComposedCandidates(
	groups: ReadonlyArray<GroupSizeResult>,
	definition: OrgDefinitionSpec,
	groupFactsMemo: Map<string, GroupFacts[]>,
	solveContext: SolveContext,
): GroupSizeResult[][] {
	const stateKey = buildGroupsStateKey(groups, solveContext);
	const groupFacts = getStateGroupFacts(groups, stateKey, groupFactsMemo, solveContext);
	const candidates: GroupSizeResult[][] = [];

	for (const rule of getCompiledDefinitionSpec(definition).composedCountRules) {
		const materialized = materializeComposedCountRule(rule, groupFacts, definition.registry);
		if (materialized.groups.length === 0) {
			continue;
		}

		candidates.push(sortGroupsByTier([
			...materialized.leftoverGroupFacts.map((facts) => facts.group),
			...materialized.groups,
		]));
	}

	return candidates;
}

function composeGroupsUpward(
	groups: ReadonlyArray<GroupSizeResult>,
	definition: OrgDefinitionSpec,
	solveContext: SolveContext,
	memo: Map<string, GroupSizeResult[]> = new Map(),
	groupFactsMemo: Map<string, GroupFacts[]> = new Map(),
	promoteMemo: Map<string, boolean> = new Map(),
): GroupSizeResult[] {
	const sortedGroups = sortGroupsByTier(groups);
	const key = buildGroupsStateKey(sortedGroups, solveContext);
	const cached = memo.get(key);
	if (cached) {
		return cached;
	}

	let bestGroups = sortedGroups;
	let bestScore = scoreResolvedGroups(bestGroups, 0);

	for (const candidateGroups of collectComposedCandidates(sortedGroups, definition, groupFactsMemo, solveContext)) {
		const resolvedCandidate = composeGroupsUpward(candidateGroups, definition, solveContext, memo, groupFactsMemo, promoteMemo);
		const candidateScore = scoreResolvedGroups(resolvedCandidate, 0);

		const promoteBonus = canPromoteFurther(resolvedCandidate, definition, groupFactsMemo, promoteMemo, solveContext);
		const currentPromoteBonus = canPromoteFurther(bestGroups, definition, groupFactsMemo, promoteMemo, solveContext);
		const betterCandidate = betterResolvedResult(candidateScore, bestScore)
			|| (
				candidateScore.maxTier === bestScore.maxTier
				&& candidateScore.groupCount === bestScore.groupCount
				&& promoteBonus
				&& !currentPromoteBonus
			);

		if (betterCandidate) {
			bestGroups = resolvedCandidate;
			bestScore = candidateScore;
		}
	}

	memo.set(key, bestGroups);
	return bestGroups;
}

function resolveFromUnitsForDefinition(
	definition: OrgDefinitionSpec,
	units: ReadonlyArray<Unit>,
): GroupSizeResult[] {
	if (units.length === 0) {
		return [EMPTY_RESULT];
	}

	const solveContext: SolveContext = {
		unitFactsMap: buildUnitFactsMap(units),
		groupUnitCache: new WeakMap<GroupSizeResult, Unit[]>(),
		groupSignatureCache: new WeakMap<GroupSizeResult, string>(),
	};
	const unitFacts = compileUnitFactsList(units);
	const leafRules = getCompiledDefinitionSpec(definition).leafRules;
	const leafCandidates = collectLeafAllocationCandidates(leafRules, unitFacts, definition.registry);

	let bestResult: GroupSizeResult[] | null = null;
	let bestScore: ResultScore | null = null;

	for (const candidate of leafCandidates) {
		if (candidate.groups.length === 0 && candidate.leftoverUnitFacts.length === 0) {
			continue;
		}

		const composedGroups = composeGroupsUpward(candidate.groups, definition, solveContext);
		const resolvedGroups = attachTopLevelLeftovers(
			composedGroups,
			candidate.leftoverUnitFacts.map((facts) => facts.unit),
		);
		const score = scoreResolvedGroups(resolvedGroups, candidate.leftoverUnitFacts.length);

		if (!bestScore || betterResolvedResult(score, bestScore)) {
			bestResult = resolvedGroups;
			bestScore = score;
		}
	}

	return bestResult ?? [EMPTY_RESULT];
}

function buildNormalizationTargets(definition: OrgDefinitionSpec): NormalizationTarget[] {
	return getCompiledDefinitionSpec(definition).normalizationTargets as NormalizationTarget[];
}

function normalizeGroupsToDefinition(
	groups: ReadonlyArray<GroupSizeResult>,
	definition: OrgDefinitionSpec,
): GroupSizeResult[] {
	const targets = buildNormalizationTargets(definition);
	if (targets.length === 0) {
		return [...groups];
	}

	const highestTarget = targets[targets.length - 1];

	return groups.flatMap((group) => {
		if (group.tier > highestTarget.tier) {
			const copies = Math.max(1, Math.floor(getEquivalentGroupCountAtTier(group.tier, highestTarget.tier)));
			return Array.from({ length: copies }, () => ({
				...highestTarget,
				children: undefined,
				units: undefined,
				leftoverUnits: undefined,
			}));
		}

		const closestTarget = targets.reduce((best, candidate) => {
			const bestDistance = Math.abs(best.tier - group.tier);
			const candidateDistance = Math.abs(candidate.tier - group.tier);
			if (candidateDistance < bestDistance) {
				return candidate;
			}
			if (candidateDistance === bestDistance && candidate.tier < best.tier) {
				return candidate;
			}
			return best;
		}, targets[0]);

		return [{
			...closestTarget,
			children: undefined,
			units: undefined,
			leftoverUnits: undefined,
		}];
	});
}

function resolveFromGroupsForDefinition(
	definition: OrgDefinitionSpec,
	groupResults: ReadonlyArray<GroupSizeResult>,
): GroupSizeResult[] {
	if (groupResults.length === 0) {
		return [EMPTY_RESULT];
	}

	const groupUnitCache = new WeakMap<GroupSizeResult, Unit[]>();
	const solveContext: SolveContext = {
		unitFactsMap: buildUnitFactsMap(collectAllGroupUnits(groupResults, groupUnitCache)),
		groupUnitCache,
		groupSignatureCache: new WeakMap<GroupSizeResult, string>(),
	};
	let normalizedGroups: GroupSizeResult[];
	if (FOREIGN_UNITS_EVALUATION) {
		const knownGroups: GroupSizeResult[] = [];
		const foreignGroupsWithUnits: GroupSizeResult[] = [];
		const foreignGroupsWithoutUnits: GroupSizeResult[] = [];

		for (const group of groupResults) {
			if (isKnownGroupType(group, definition)) {
				knownGroups.push(group);
				continue;
			}

			if (collectGroupUnits(group, solveContext.groupUnitCache).length > 0) {
				foreignGroupsWithUnits.push(group);
				continue;
			}

			foreignGroupsWithoutUnits.push(group);
		}

		const reevaluatedForeignGroups = FLATTEN_REEVALUATED_FOREIGN_GROUPS_BEFORE_COMPOSITION
			? (() => {
				const pooledUnits = collectAllGroupUnits(foreignGroupsWithUnits, solveContext.groupUnitCache);
				return pooledUnits.length > 0 ? resolveFromUnitsForDefinition(definition, pooledUnits) : [];
			})()
			: foreignGroupsWithUnits.flatMap((group) =>
				resolveFromUnitsForDefinition(definition, collectGroupUnits(group, solveContext.groupUnitCache)),
			);

		normalizedGroups = [
			...knownGroups,
			...reevaluatedForeignGroups,
			...normalizeGroupsToDefinition(foreignGroupsWithoutUnits, definition),
		];
	} else {
		normalizedGroups = normalizeGroupsToDefinition(groupResults, definition);
	}

	return composeGroupsUpward(normalizedGroups, definition, solveContext);
}

function composeFactionOrgFromUnits(
	units: Unit[],
	factionName: string,
	factionAffinity: FactionAffinity,
	hierarchicalAggregation: boolean = false,
): GroupSizeResult[] {
	void hierarchicalAggregation;
	return resolveFromUnitsForDefinition(resolveOrgDefinitionSpec(factionName, factionAffinity), units);
}

function composeFactionOrgFromGroups(
	factionName: string,
	factionAffinity: FactionAffinity,
	groupResults: GroupSizeResult[],
	hierarchicalAggregation: boolean = false,
): GroupSizeResult[] {
	void hierarchicalAggregation;
	return resolveFromGroupsForDefinition(resolveOrgDefinitionSpec(factionName, factionAffinity), groupResults);
}

export function resolveFromUnits(
	units: Unit[],
	factionName: string,
	factionAffinity: FactionAffinity,
	hierarchicalAggregation: boolean = false,
): GroupSizeResult[] {
	return composeFactionOrgFromUnits(units, factionName, factionAffinity, hierarchicalAggregation);
}

export function resolveFromGroups(
	factionName: string,
	factionAffinity: FactionAffinity,
	groupResults: GroupSizeResult[],
	hierarchicalAggregation: boolean = false,
): GroupSizeResult[] {
	return composeFactionOrgFromGroups(factionName, factionAffinity, groupResults, hierarchicalAggregation);
}

export function evaluateFactionOrgDefinitionFromUnits(
	units: Unit[],
	factionName: string,
	factionAffinity: FactionAffinity,
): OrgDefinitionEvaluation {
	return evaluateFactionOrgDefinition(factionName, factionAffinity, units);
}

export function evaluateFactionOrgDefinitionFromGroups(
	factionName: string,
	factionAffinity: FactionAffinity,
	groupResults: GroupSizeResult[],
	units: Unit[] = [],
): OrgDefinitionEvaluation {
	return evaluateFactionOrgDefinition(factionName, factionAffinity, units, groupResults);
}
