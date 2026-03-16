import { type Force, UnitGroup } from '../../models/force.model';
import { FactionAffinity } from '../../models/factions.model';
import { LoadForceEntry, type LoadForceGroup } from '../../models/load-force-entry.model';
import type { Unit } from '../../models/units.model';
import { resolveOrgDefinitionSpec } from './org-registry.util';
import { resolveFromGroups, resolveFromUnits } from './org-solver.util';
import { EMPTY_RESULT, type GroupSizeResult, type OrgSizeResult } from './org-types';
import { getAggregatedTier, getEquivalentGroupCountAtTier, getTierForRepeatedGroup } from './org-tier.util';

interface DisplayModifierStep {
	readonly modifierKey: string;
	readonly count: number;
	readonly tier: number;
}

function toOrgSizeResult(name: string, tier: number, groups: readonly GroupSizeResult[]): OrgSizeResult {
	return {
		name,
		tier,
		groups,
	};
}

function getEquivalentName(groups: readonly GroupSizeResult[]): string {
	if (groups.length === 0) {
		return EMPTY_RESULT.name;
	}
	if (groups.length === 1) {
		return groups[0].name;
	}

	const [highest] = [...groups].sort((left, right) => right.tier - left.tier);
	return `${groups.length}x ${highest.name}`;
}

export function aggregateGroupsResult(groups: readonly GroupSizeResult[]): OrgSizeResult {
	if (groups.length === 0) {
		return toOrgSizeResult(EMPTY_RESULT.name, EMPTY_RESULT.tier, []);
	}
	if (groups.length === 1) {
		return toOrgSizeResult(groups[0].name, groups[0].tier, groups);
	}

	return toOrgSizeResult(getEquivalentName(groups), getAggregatedTier(groups.map((group) => group.tier)), groups);
}

function getModifierCount(value: number | { count: number; tier?: number }): number {
	return typeof value === 'number' ? value : value.count;
}

function getDisplayModifierSteps(
	groups: readonly GroupSizeResult[],
	factionName: string,
	factionAffinity: FactionAffinity,
): DisplayModifierStep[] | null {
	const type = groups[0]?.type;
	if (!type) {
		return null;
	}

	const definition = resolveOrgDefinitionSpec(factionName, factionAffinity);
	const rule = definition.rules.find((candidate) => candidate.type === type);
	if (!rule) {
		return null;
	}

	const modifierEntries = Object.entries(rule.modifiers);
	const regularModifier = rule.modifiers[''] ?? modifierEntries[0]?.[1];
	if (!regularModifier) {
		return null;
	}

	const regularCount = getModifierCount(regularModifier);
	return modifierEntries
		.map(([modifierKey, modifierValue]) => ({
			modifierKey,
			count: getModifierCount(modifierValue),
			tier: typeof modifierValue === 'number'
				? rule.dynamicTier
					? rule.tier + (Math.log(getModifierCount(modifierValue) / regularCount) / Math.log(3)) * rule.dynamicTier
					: rule.tier
				: modifierValue.tier ?? (rule.dynamicTier
					? rule.tier + (Math.log(getModifierCount(modifierValue) / regularCount) / Math.log(3)) * rule.dynamicTier
					: rule.tier),
		}))
		.sort((left, right) => left.tier - right.tier);
}

function getSameTypeAggregatedDisplay(
	groups: readonly GroupSizeResult[],
	factionName: string,
	factionAffinity: FactionAffinity,
): OrgSizeResult | null {
	if (groups.length === 0) {
		return null;
	}

	const first = groups[0];
	if (!first.type) {
		return null;
	}

	const isHomogeneous = groups.every((group) =>
		group.type === first.type
		&& group.tag === first.tag
		&& group.countsAsType === first.countsAsType,
	);
	if (!isHomogeneous) {
		return null;
	}

	const modifierSteps = getDisplayModifierSteps(groups, factionName, factionAffinity);
	if (!modifierSteps || modifierSteps.length === 0) {
		return null;
	}

	const aggregatedTier = getAggregatedTier(groups.map((group) => group.tier));
	const regularStep = modifierSteps.find((step) => step.modifierKey === '') ?? modifierSteps[0];
	const regularCount = regularStep.count;
	const equivalentRegularCount = groups.reduce(
		(sum, group) => sum + getEquivalentGroupCountAtTier(group.tier, regularStep.tier),
		0,
	);
	const maxRepeatCount = Math.max(1, Math.ceil(equivalentRegularCount));

	let best: { name: string; tier: number; repeatCount: number; modifierCount: number } | null = null;
	for (let repeatCount = groups.length > 1 ? 2 : 1; repeatCount <= maxRepeatCount; repeatCount += 1) {
		for (const step of modifierSteps) {
			const candidateTier = getTierForRepeatedGroup(step.tier, repeatCount);
			if (candidateTier - aggregatedTier > 0.0001) {
				continue;
			}

			const name = repeatCount === 1
				? `${step.modifierKey}${first.type}`
				: `${repeatCount}x ${first.type}`;
			const candidate = {
				name,
				tier: candidateTier,
				repeatCount,
				modifierCount: step.count,
			};

			if (!best
				|| candidate.tier > best.tier
				|| (candidate.tier === best.tier && candidate.repeatCount < best.repeatCount)
				|| (
					candidate.tier === best.tier
					&& candidate.repeatCount === best.repeatCount
					&& Math.abs(candidate.modifierCount - regularCount) < Math.abs(best.modifierCount - regularCount)
				)) {
				best = candidate;
			}
		}
	}

	if (!best) {
		return null;
	}

	return toOrgSizeResult(best.name, best.tier, groups);
}

export function getAggregatedGroupsResult(
	groups: readonly GroupSizeResult[],
	factionName: string,
	factionAffinity: FactionAffinity,
): OrgSizeResult {
	if (groups.length <= 1) {
		return aggregateGroupsResult(groups);
	}

	const first = groups[0];
	if (first?.type && groups.every((group) =>
		group.type === first.type
		&& group.tag === first.tag
		&& group.countsAsType === first.countsAsType,
	)) {
		return toOrgSizeResult(`${groups.length}x ${first.type}`, getAggregatedTier(groups.map((group) => group.tier)), groups);
	}

	const sameTypeDisplay = getSameTypeAggregatedDisplay(groups, factionName, factionAffinity);
	if (sameTypeDisplay) {
		return sameTypeDisplay;
	}

	const resolved = resolveFromGroups(factionName, factionAffinity, groups, true);
	if (resolved.length > 0 && resolved.length < groups.length) {
		const display = aggregateGroupsResult(resolved);
		return toOrgSizeResult(display.name, display.tier, resolved);
	}

	const aggregated = aggregateGroupsResult(groups);
	return toOrgSizeResult(aggregated.name, aggregated.tier, groups);
}

function getResolvedOrgResult(groups: readonly GroupSizeResult[], factionName: string, factionAffinity: FactionAffinity): OrgSizeResult {
	const display = getAggregatedGroupsResult(groups, factionName, factionAffinity);
	return toOrgSizeResult(display.name, display.tier, groups);
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
		.filter((entry): entry is typeof entry & { unit: Unit } => entry.unit !== undefined)
		.map((entry) => entry.unit);
	return resolveFromUnits(units, factionName, factionAffinity);
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
		const rawGroups = resolveFromUnits(allUnits, resolvedFactionName, resolvedFactionAffinity);
		return getResolvedOrgResult(rawGroups, resolvedFactionName, resolvedFactionAffinity);
	}

	const resolvedFactionName = factionName ?? 'Mercenary';
	const resolvedFactionAffinity = factionAffinity ?? 'Mercenary';
	const units = group.units
		.filter((unit): unit is typeof unit & { unit: Unit } => unit.unit !== undefined)
		.map((unit) => unit.unit);
	const rawGroups = resolveFromUnits(units, resolvedFactionName, resolvedFactionAffinity);
	return getResolvedOrgResult(rawGroups, resolvedFactionName, resolvedFactionAffinity);
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
		return getResolvedOrgResult(rawGroups, resolvedFactionName, resolvedFactionAffinity);
	}

	const resolvedFactionName = factionName ?? forceOrEntry.faction()?.name ?? 'Mercenary';
	const resolvedFactionAffinity = factionAffinity ?? forceOrEntry.faction()?.group ?? 'Mercenary';
	const groupResults = forceOrEntry.groups()
		.filter((group) => group.units().length > 0)
		.flatMap((group) => getGroupResultsFromOrgResult(group.sizeResult()));
	const rawGroups = resolveFromGroups(resolvedFactionName, resolvedFactionAffinity, groupResults);
	return getResolvedOrgResult(rawGroups, resolvedFactionName, resolvedFactionAffinity);
}

export function getOrgFromForceCollection(
	entries: readonly LoadForceEntry[],
	factionName: string,
	factionAffinity: FactionAffinity,
	childGroupResults?: readonly GroupSizeResult[],
): OrgSizeResult {
	const rawGroups = childGroupResults
		? [...childGroupResults]
		: entries.flatMap((entry) =>
			entry.groups.flatMap((group) => getGroupResultsFromLoadForceGroup(group, factionName, factionAffinity)),
		);
	const display = getAggregatedGroupsResult(rawGroups, factionName, factionAffinity);
	return toOrgSizeResult(display.name, display.tier, rawGroups);
}

