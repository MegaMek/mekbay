import { type Force, UnitGroup } from '../../models/force.model';
import { FactionAffinity } from '../../models/factions.model';
import { LoadForceEntry, type LoadForceGroup } from '../../models/load-force-entry.model';
import type { Unit } from '../../models/units.model';
import { resolveOrgDefinitionSpec } from './org-registry.util';
import {
	EMPTY_RESULT,
	evaluateFactionOrgDefinition,
	resolveFromGroups,
	resolveFromUnits,
	type OrgDefinitionEvaluation,
} from './org-solver.util';
import { getAggregatedTier, getDynamicTierForModifier, getEquivalentGroupCountAtTier, getTierForRepeatedGroup } from './org-tier.util';
import type {
	GroupSizeResult,
	OrgComposedCountRule,
	OrgComposedPatternRule,
	OrgDefinitionSpec,
	OrgRuleDefinition,
	OrgSizeResult,
	OrgTypeModifier,
} from './org-types';

interface OrgAggregateResult {
	readonly name: string;
	readonly tier: number;
	readonly groups: readonly GroupSizeResult[];
}

function expandVisibleTopLevelGroups(
	groups: readonly GroupSizeResult[],
	factionName: string,
	factionAffinity: FactionAffinity,
): GroupSizeResult[] {
	return groups.flatMap((group) => expandVisibleTopLevelGroup(group, factionName, factionAffinity));
}

function expandVisibleTopLevelGroup(
	group: GroupSizeResult,
	factionName: string,
	factionAffinity: FactionAffinity,
): GroupSizeResult[] {
	const leftoverUnits = group.leftoverUnits ?? [];
	if (leftoverUnits.length === 0) {
		return [group];
	}

	const { leftoverUnits: _ignored, ...groupWithoutLeftovers } = group;
	const resolvedLeftovers = resolveFromUnits(leftoverUnits, factionName, factionAffinity);
	if (
		resolvedLeftovers.length === 0
		|| (resolvedLeftovers.length === 1
			&& resolvedLeftovers[0].type === EMPTY_RESULT.type
			&& resolvedLeftovers[0].name === EMPTY_RESULT.name)
	) {
		return [group];
	}

	return [
		groupWithoutLeftovers,
		...expandVisibleTopLevelGroups(resolvedLeftovers, factionName, factionAffinity),
	];
}

function buildOrgSizeResult(
	displayGroups: GroupSizeResult[],
	factionName: string,
	factionAffinity: FactionAffinity,
): OrgSizeResult {
	const aggregated = getAggregatedGroupsResult(displayGroups, factionName, factionAffinity);

	return {
		name: aggregated.name,
		tier: aggregated.tier,
		groups: displayGroups,
	};
}

function resolveOrgGroupsFromUnits(
	units: readonly Unit[],
	factionName: string,
	factionAffinity: FactionAffinity,
): GroupSizeResult[] {
	const rawGroups = resolveFromUnits([...units], factionName, factionAffinity);
	return expandVisibleTopLevelGroups(rawGroups, factionName, factionAffinity);
}

function getGroupResultsFromOrgResult(result: OrgSizeResult): GroupSizeResult[] {
	return [...result.groups];
}

function getGroupResultsFromLoadForceGroup(
	group: LoadForceGroup,
	factionName: string,
	factionAffinity: FactionAffinity,
): GroupSizeResult[] {
	const units = group.units
		.filter((unit): unit is typeof unit & { unit: Unit } => unit.unit !== undefined)
		.map((unit) => unit.unit);
	return resolveOrgGroupsFromUnits(units, factionName, factionAffinity);
}

export function getOrgEvaluationFromGroup(group: UnitGroup): OrgDefinitionEvaluation;
export function getOrgEvaluationFromGroup(group: LoadForceGroup, factionName: string, factionAffinity: FactionAffinity): OrgDefinitionEvaluation;
export function getOrgEvaluationFromGroup(group: UnitGroup | LoadForceGroup, factionName?: string, factionAffinity?: FactionAffinity): OrgDefinitionEvaluation {
	if (group instanceof UnitGroup) {
		const force = group.force;
		const resolvedFactionName = force.faction()?.name ?? 'Mercenary';
		const resolvedFactionAffinity = force.faction()?.group ?? 'Mercenary';
		const allUnits = group.units().map((unit) => unit.getUnit()).filter((unit): unit is Unit => unit !== undefined);
		return evaluateFactionOrgDefinition(resolvedFactionName, resolvedFactionAffinity, allUnits);
	}

	const units = group.units
		.filter((unit): unit is typeof unit & { unit: Unit } => unit.unit !== undefined)
		.map((unit) => unit.unit);
	return evaluateFactionOrgDefinition(factionName!, factionAffinity!, units);
}

export function getOrgFromGroup(group: UnitGroup, factionName: string, factionAffinity: FactionAffinity): OrgSizeResult;
export function getOrgFromGroup(group: UnitGroup): OrgSizeResult;
export function getOrgFromGroup(group: LoadForceGroup, factionName: string, factionAffinity: FactionAffinity): OrgSizeResult;
export function getOrgFromGroup(group: UnitGroup | LoadForceGroup, factionName?: string, factionAffinity?: FactionAffinity): OrgSizeResult {
	if (group instanceof UnitGroup) {
		const force = group.force;
		const resolvedFactionName = factionName ?? force.faction()?.name ?? 'Mercenary';
		const resolvedFactionAffinity = factionAffinity ?? force.faction()?.group ?? 'Mercenary';
		const allUnits = group.units().map((unit) => unit.getUnit()).filter((unit): unit is Unit => unit !== undefined);
		const rawGroups = resolveOrgGroupsFromUnits(allUnits, resolvedFactionName, resolvedFactionAffinity);
		return buildOrgSizeResult(
			rawGroups,
			resolvedFactionName,
			resolvedFactionAffinity,
		);
	}

	const resolvedFactionName = factionName ?? 'Mercenary';
	const resolvedFactionAffinity = factionAffinity ?? 'Mercenary';
	const units = group.units
		.filter((unit): unit is typeof unit & { unit: Unit } => unit.unit !== undefined)
		.map((unit) => unit.unit);
	const rawGroups = resolveOrgGroupsFromUnits(units, resolvedFactionName, resolvedFactionAffinity);
	return buildOrgSizeResult(
		rawGroups,
		resolvedFactionName,
		resolvedFactionAffinity,
	);
}

export function getOrgFromForce(force: Force, factionName: string, factionAffinity: FactionAffinity): OrgSizeResult;
export function getOrgFromForce(force: Force): OrgSizeResult;
export function getOrgFromForce(entry: LoadForceEntry, factionName: string, factionAffinity: FactionAffinity): OrgSizeResult;
export function getOrgFromForce(forceOrEntry: Force | LoadForceEntry, factionName?: string, factionAffinity?: FactionAffinity): OrgSizeResult {
	if (forceOrEntry instanceof LoadForceEntry) {
		const resolvedFactionName = factionName ?? 'Mercenary';
		const resolvedFactionAffinity = factionAffinity ?? 'Mercenary';
		const groupResults = forceOrEntry.groups
			.filter((group) => group.units.some((unit) => unit.unit !== undefined))
			.flatMap((group) => getGroupResultsFromLoadForceGroup(group, resolvedFactionName, resolvedFactionAffinity));
		const rawGroups = resolveFromGroups(resolvedFactionName, resolvedFactionAffinity, groupResults);
		const displayGroups = expandVisibleTopLevelGroups(rawGroups, resolvedFactionName, resolvedFactionAffinity);
		return buildOrgSizeResult(
			displayGroups,
			resolvedFactionName,
			resolvedFactionAffinity,
		);
	}

	const resolvedFactionName = factionName ?? forceOrEntry.faction()?.name ?? 'Mercenary';
	const resolvedFactionAffinity = factionAffinity ?? forceOrEntry.faction()?.group ?? 'Mercenary';
	const groupResults = forceOrEntry.groups()
		.filter((group) => group.units().length > 0)
		.flatMap((group) => getGroupResultsFromOrgResult(group.sizeResult()));
	const rawGroups = resolveFromGroups(resolvedFactionName, resolvedFactionAffinity, groupResults);
	const displayGroups = expandVisibleTopLevelGroups(rawGroups, resolvedFactionName, resolvedFactionAffinity);
	return buildOrgSizeResult(
		displayGroups,
		resolvedFactionName,
		resolvedFactionAffinity,
	);
}

export function getOrgEvaluationFromForce(force: Force): OrgDefinitionEvaluation;
export function getOrgEvaluationFromForce(entry: LoadForceEntry, factionName: string, factionAffinity: FactionAffinity): OrgDefinitionEvaluation;
export function getOrgEvaluationFromForce(forceOrEntry: Force | LoadForceEntry, factionName?: string, factionAffinity?: FactionAffinity): OrgDefinitionEvaluation {
	if (forceOrEntry instanceof LoadForceEntry) {
		const resolvedFactionName = factionName ?? 'Mercenary';
		const resolvedFactionAffinity = factionAffinity ?? 'Mercenary';
		const groupResults = forceOrEntry.groups
			.filter((group) => group.units.some((unit) => unit.unit !== undefined))
			.flatMap((group) => getGroupResultsFromLoadForceGroup(group, resolvedFactionName, resolvedFactionAffinity));
		return evaluateFactionOrgDefinition(resolvedFactionName, resolvedFactionAffinity, [], groupResults);
	}

	const resolvedFactionName = forceOrEntry.faction()?.name ?? 'Mercenary';
	const resolvedFactionAffinity = forceOrEntry.faction()?.group ?? 'Mercenary';
	const groupResults = forceOrEntry.groups()
		.filter((group) => group.units().length > 0)
		.flatMap((group) => getGroupResultsFromOrgResult(group.sizeResult()));
	return evaluateFactionOrgDefinition(resolvedFactionName, resolvedFactionAffinity, [], groupResults);
}

export function getOrgFromForceCollection(
	entries: LoadForceEntry[],
	factionName: string,
	factionAffinity: FactionAffinity,
	childGroupResults?: GroupSizeResult[],
): OrgSizeResult {
	if (entries.length === 0 && (!childGroupResults || childGroupResults.length === 0)) {
		return {
			name: EMPTY_RESULT.name,
			tier: EMPTY_RESULT.tier,
			groups: [],
		};
	}

	const groupResults = childGroupResults
		? [...childGroupResults]
		: entries.flatMap((entry) => getGroupResultsFromOrgResult(getOrgFromForce(entry, factionName, factionAffinity)));
	const rawGroups = resolveFromGroups(factionName, factionAffinity, groupResults);
	const displayGroups = expandVisibleTopLevelGroups(rawGroups, factionName, factionAffinity);
	return buildOrgSizeResult(
		displayGroups,
		factionName,
		factionAffinity,
	);
}

export function getOrgEvaluationFromForceCollection(
	entries: LoadForceEntry[],
	factionName: string,
	factionAffinity: FactionAffinity,
	childGroupResults?: GroupSizeResult[],
): OrgDefinitionEvaluation {
	const groupResults = childGroupResults
		? [...childGroupResults]
		: entries.flatMap((entry) => getGroupResultsFromOrgResult(getOrgFromForce(entry, factionName, factionAffinity)));
	return evaluateFactionOrgDefinition(factionName, factionAffinity, [], groupResults);
}

function resolveOrgDefinition(
	factionName: string,
	factionAffinity: FactionAffinity,
): OrgDefinitionSpec {
	return resolveOrgDefinitionSpec(factionName, factionAffinity);
}

function isComposedRule(rule: OrgRuleDefinition): rule is OrgComposedCountRule | OrgComposedPatternRule {
	return rule.kind === 'composed-count' || rule.kind === 'composed-pattern';
}

function getModifierCount(modifier: number | OrgTypeModifier): number {
	return typeof modifier === 'number' ? modifier : modifier.count;
}

function getSortedModifiers(rule: OrgRuleDefinition): [string, number][] {
	return Object.entries(rule.modifiers)
		.map(([prefix, modifier]) => [prefix, getModifierCount(modifier)] as [string, number])
		.sort((left, right) => left[1] - right[1]);
}

function getRegularCount(rule: OrgRuleDefinition): number {
	const regularModifier = rule.modifiers[''] ?? Object.values(rule.modifiers)[0];
	return regularModifier ? getModifierCount(regularModifier) : 0;
}

function resolveTier(rule: OrgRuleDefinition, prefix: string): number {
	const modifier = rule.modifiers[prefix];
	if (modifier != null && typeof modifier === 'object' && modifier.tier != null) {
		return modifier.tier;
	}
	if (rule.dynamicTier && rule.dynamicTier > 0) {
		const regularCount = getRegularCount(rule);
		const modifierCount = modifier != null ? getModifierCount(modifier) : regularCount;
		if (regularCount > 0 && modifierCount !== regularCount) {
			return getDynamicTierForModifier(rule.tier, regularCount, modifierCount, rule.dynamicTier);
		}
	}
	return rule.tier;
}

function buildRuleName(rule: OrgRuleDefinition, prefix: string): string {
	return prefix ? `${prefix}${rule.type}` : rule.type;
}

function getAcceptedChildTypes(rule: OrgComposedCountRule | OrgComposedPatternRule): Set<GroupSizeResult['type']> {
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

	return accepted;
}

function findGroupRuleState(
	group: GroupSizeResult,
	rules: ReadonlyArray<OrgRuleDefinition>,
): { rule: OrgRuleDefinition; prefix: string; count: number } | null {
	if (!group.type) {
		return null;
	}

	for (const rule of rules) {
		if (rule.type !== group.type) {
			continue;
		}

		const modifier = rule.modifiers[group.modifierKey];
		if (modifier != null) {
			return { rule, prefix: group.modifierKey, count: getModifierCount(modifier) };
		}
	}

	return null;
}

function promoteDisplayGroups(
	groups: GroupSizeResult[],
	definition: OrgDefinitionSpec,
): GroupSizeResult[] {
	const promoted = [...groups].sort(compareGroupTierDescending);

	let changed = true;
	while (changed) {
		changed = false;

		for (let index = 0; index < promoted.length; index++) {
			const state = findGroupRuleState(promoted[index], definition.rules);
			if (!state || !isComposedRule(state.rule)) {
				continue;
			}

			const nextModifiers = getSortedModifiers(state.rule)
				.filter(([, count]) => count > state.count)
				.sort((left, right) => left[1] - right[1]);
			if (nextModifiers.length === 0) {
				continue;
			}

			const acceptedTypes = getAcceptedChildTypes(state.rule);
			const candidateIndices = promoted
				.map((group, candidateIndex) => ({ group, candidateIndex }))
				.filter(({ candidateIndex, group }) =>
					candidateIndex !== index
					&& ((group.type && acceptedTypes.has(group.type))
						|| (group.countsAsType && acceptedTypes.has(group.countsAsType))),
				)
				.map(({ candidateIndex }) => candidateIndex);

			if (candidateIndices.length === 0) {
				continue;
			}

			const reachableModifier = nextModifiers
				.filter(([, count]) => count <= state.count + candidateIndices.length)
				.at(-1);
			if (!reachableModifier) {
				continue;
			}

			const [nextPrefix, nextCount] = reachableModifier;
			const consumeCount = nextCount - state.count;
			const consumedIndices = candidateIndices.slice(0, consumeCount).sort((left, right) => right - left);
			const consumedGroups = consumedIndices.map((candidateIndex) => promoted[candidateIndex]);

			promoted[index] = {
				...promoted[index],
				name: buildRuleName(state.rule, nextPrefix),
				modifierKey: nextPrefix,
				tier: resolveTier(state.rule, nextPrefix),
				children: [
					...(promoted[index].children ?? []),
					...consumedGroups,
				],
			};

			for (const consumedIndex of consumedIndices) {
				promoted.splice(consumedIndex, 1);
			}

			promoted.sort(compareGroupTierDescending);
			changed = true;
			break;
		}
	}

	return promoted;
}

function compareGroupTierDescending(left: GroupSizeResult, right: GroupSizeResult): number {
	if (right.tier !== left.tier) {
		return right.tier - left.tier;
	}
	return left.name.localeCompare(right.name);
}

export function getAggregatedGroupsResult(
	groups: GroupSizeResult[],
	factionName: string,
	factionAffinity: FactionAffinity,
): OrgAggregateResult {
	const definition = resolveOrgDefinition(factionName, factionAffinity);
	if (groups.length === 0) {
		return {
			name: EMPTY_RESULT.name,
			tier: EMPTY_RESULT.tier,
			groups,
		};
	}

	if (groups.length === 1) {
		return {
			name: groups[0].name,
			tier: groups[0].tier,
			groups,
		};
	}

	const displayGroups = getDisplayGroups(groups, factionName, factionAffinity);
	return aggregateGroupsResult(displayGroups, definition);
}

function getDisplayGroups(
	groups: GroupSizeResult[],
	factionName: string,
	factionAffinity: FactionAffinity,
): GroupSizeResult[] {
	if (groups.length <= 1) {
		return groups;
	}

	const promotedGroups = promoteDisplayGroups(groups, resolveOrgDefinition(factionName, factionAffinity));
	return resolveFromGroups(factionName, factionAffinity, promotedGroups, true);
}

export function aggregateGroupsResult(
	groups: GroupSizeResult[],
	definition?: OrgDefinitionSpec,
): OrgAggregateResult {
	if (groups.length === 0) {
		return {
			name: EMPTY_RESULT.name,
			tier: EMPTY_RESULT.tier,
			groups,
		};
	}

	if (groups.length === 1) {
		return {
			name: groups[0].name,
			tier: groups[0].tier,
			groups,
		};
	}

	const sorted = [...groups].sort((left, right) => right.tier - left.tier);
	const tierSum = getAggregatedTier(sorted.map((group) => group.tier));
	const name = definition
		? buildAggregatedDisplayName(sorted, tierSum, definition)
		: buildAggregatedNameParts(sorted).join(' + ');

	return {
		name,
		tier: tierSum,
		groups,
	};
}

function buildAggregatedNameParts(groups: GroupSizeResult[]): string[] {
	const buckets = new Map<string, GroupSizeResult[]>();
	for (const group of groups) {
		const key = `${group.type ?? 'null'}:${group.name}:${group.tag ?? ''}`;
		if (!buckets.has(key)) {
			buckets.set(key, []);
		}
		buckets.get(key)?.push(group);
	}

	const parts: string[] = [];
	for (const bucket of buckets.values()) {
		const [first] = bucket;
		if (!first) {
			continue;
		}
		parts.push(bucket.length > 1 ? `${bucket.length}x ${first.name}` : first.name);
	}

	return parts;
}

function buildAggregatedDisplayName(
	groups: GroupSizeResult[],
	aggregatedTier: number,
	definition: OrgDefinitionSpec,
): string {
	const anchorState = findGroupRuleState(groups[0], definition.rules);
	if (!anchorState) {
		return buildAggregatedNameParts(groups).join(' + ');
	}

	return findClosestAggregatedRuleLabel(anchorState.rule, aggregatedTier);
}

function findClosestAggregatedRuleLabel(rule: OrgRuleDefinition, aggregatedTier: number): string {
	const modifiers = getSortedModifiers(rule);
	if (modifiers.length === 0) {
		return rule.type;
	}

	let bestName = buildRuleName(rule, modifiers[0][0]);
	let bestTier = resolveTier(rule, modifiers[0][0]);
	let bestDistance = Math.abs(aggregatedTier - bestTier);

	const consider = (name: string, tier: number): void => {
		const distance = Math.abs(aggregatedTier - tier);
		if (distance < bestDistance || (distance === bestDistance && tier < bestTier)) {
			bestName = name;
			bestTier = tier;
			bestDistance = distance;
		}
	};

	for (const [prefix] of modifiers) {
		consider(buildRuleName(rule, prefix), resolveTier(rule, prefix));
	}

	const regularIndex = modifiers.findIndex(([prefix]) => prefix === '');
	if (regularIndex === -1) {
		return bestName;
	}

	const multiplierCycle = modifiers.slice(regularIndex);
	const tierSlack = 2;
	const maxMultiplier = Math.max(2, Math.ceil(getEquivalentGroupCountAtTier(aggregatedTier, bestTier)) + 2);

	for (let multiplier = 2; multiplier <= maxMultiplier; multiplier++) {
		for (const [prefix] of multiplierCycle) {
			const tier = getTierForRepeatedGroup(resolveTier(rule, prefix), multiplier);
			if (tier > aggregatedTier + tierSlack && multiplier > maxMultiplier - 1) {
				continue;
			}
			consider(`${multiplier}x ${buildRuleName(rule, prefix)}`, tier);
		}
	}

	return bestName;
}
