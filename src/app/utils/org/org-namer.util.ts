import { type Force, UnitGroup } from '../../models/force.model';
import type { Era } from '../../models/eras.model';
import { FACTION_MERCENARY, type Faction } from '../../models/factions.model';
import { LoadForceEntry, type LoadForceGroup } from '../../models/load-force-entry.model';
import type { Unit } from '../../models/units.model';
import { resolveFromGroups, resolveFromUnits } from './org-solver.util';
import { type GroupSizeResult, type OrgSizeResult } from './org-types';

/**
 * Author: Drake
 * 
 * This module provides utilities for generating human-readable organizational names and summaries 
 * based on the structure of forces and groups.
 */
export interface OrgNamingOptions {
	readonly aggregateEquivalentGroups?: boolean;
	readonly displayThresholdTier?: number;
}

const DEFAULT_FACTION: Faction = {
	id: FACTION_MERCENARY,
	name: 'Mercenary',
	group: 'Mercenary',
	img: '',
	eras: {},
};

// Public API

export function getOrgFromGroup(group: UnitGroup, options?: OrgNamingOptions): OrgSizeResult;
export function getOrgFromGroup(group: LoadForceGroup, options?: OrgNamingOptions): OrgSizeResult;
export function getOrgFromGroup(group: UnitGroup | LoadForceGroup, options: OrgNamingOptions = {}): OrgSizeResult {
	const resolvedOptions = options;

	if (group instanceof UnitGroup) {
		const force = group.force;
		const resolvedFaction = force.faction() ?? DEFAULT_FACTION;
		const resolvedEra = force.era();
		const allUnits = group.units().map((unit) => unit.getUnit()).filter((unit): unit is Unit => unit !== undefined);
		const rawGroups = resolveFromUnits(allUnits, resolvedFaction, resolvedEra);
		return getResolvedOrgResult(rawGroups, resolvedFaction, resolvedEra, resolvedOptions);
	}

	const force = group.force ?? null;
	const resolvedFaction = force?.faction ?? DEFAULT_FACTION;
	const resolvedEra = force?.era ?? null;
	const units = group.units
		.filter((unit): unit is typeof unit & { unit: Unit } => unit.unit !== undefined)
		.map((unit) => unit.unit);
	const rawGroups = resolveFromUnits(units, resolvedFaction, resolvedEra);
	return getResolvedOrgResult(rawGroups, resolvedFaction, resolvedEra, resolvedOptions);
}

export function getOrgFromForce(force: Force, options?: OrgNamingOptions): OrgSizeResult;
export function getOrgFromForce(entry: LoadForceEntry, options?: OrgNamingOptions): OrgSizeResult;
export function getOrgFromForce(forceOrEntry: Force | LoadForceEntry, options: OrgNamingOptions = {}): OrgSizeResult {
	const resolvedOptions = options;

	if (forceOrEntry instanceof LoadForceEntry) {
		const resolvedFaction = forceOrEntry.faction ?? DEFAULT_FACTION;
		const resolvedEra = forceOrEntry.era ?? null;
		const groupResults = forceOrEntry.groups
			.filter((group) => group.units.some((unit) => unit.unit !== undefined))
			.flatMap((group) => getGroupResultsFromLoadForceGroup(group));
		const rawGroups = resolveFromGroups(groupResults, resolvedFaction, resolvedEra);
		return getResolvedOrgResult(rawGroups, resolvedFaction, resolvedEra, resolvedOptions);
	}

	const resolvedFaction = forceOrEntry.faction() ?? DEFAULT_FACTION;
	const resolvedEra = forceOrEntry.era();
	const groupResults = forceOrEntry.groups()
		.filter((group) => group.units().length > 0)
		.flatMap((group) => group.sizeResult().groups);
	const rawGroups = resolveFromGroups(groupResults, resolvedFaction, resolvedEra);
	return getResolvedOrgResult(rawGroups, resolvedFaction, resolvedEra, resolvedOptions);
}

// Internal utilities

function getGroupResultsFromLoadForceGroup(
	group: LoadForceGroup,
): GroupSizeResult[] {
	const force = group.force ?? null;
	const faction = force?.faction ?? DEFAULT_FACTION;
	const era = force?.era ?? null;
	const units = group.units
		.filter((entry): entry is typeof entry & { unit: Unit } => entry.unit !== undefined)
		.map((entry) => entry.unit);
	return resolveFromUnits(units, faction, era);
}

function getResolvedOrgResult(
	groups: readonly GroupSizeResult[],
	faction: Faction,
	era: Era | null | undefined,
	options: OrgNamingOptions = {},
): OrgSizeResult {
	//const display = getAggregatedGroupsResult(groups, factionName, factionAffinity, options);
	// return toOrgSizeResult(display.name, display.tier, groups);
	return toOrgSizeResult('DUMMY', 0, groups);
}

function toOrgSizeResult(name: string, tier: number, groups: readonly GroupSizeResult[]): OrgSizeResult {
	return {
		name,
		tier,
		groups,
	};
}



/*

interface DisplayModifierStep {
	readonly modifierKey: string;
	readonly count: number;
	readonly tier: number;
}

interface GroupDisplayOptions {
	readonly includeAllocationSummary?: boolean;
	readonly preserveForeignNames?: boolean;
}

interface HeterogeneousDisplayBucket {
	readonly label: string;
	readonly count: number;
	readonly representative: GroupSizeResult;
}

export function getAggregatedGroupsResult(
	groups: readonly GroupSizeResult[],
	factionName: string,
	factionAffinity: FactionAffinity,
	options: OrgNamingOptions = {},
): OrgSizeResult {
	const aggregateEquivalentGroups = options.aggregateEquivalentGroups ?? true;
	const displayGroups = filterGroupsForDisplay(groups, options);

	if (groups.length <= 1) {
		return aggregateGroupsResult(groups, {
			includeAllocationSummary: true,
			preserveForeignNames: !aggregateEquivalentGroups,
		});
	}

	if (!aggregateEquivalentGroups) {
		return getListedGroupsResult(groups, options);
	}

	if (displayGroups.length <= 1) {
		const display = aggregateGroupsResult(displayGroups, {
			includeAllocationSummary: true,
			preserveForeignNames: false,
		});
		return toOrgSizeResult(display.name, display.tier, groups);
	}

	if (canReresolveAggregatedGroups(displayGroups)) {
		const resolved = resolveFromGroups(factionName, factionAffinity, displayGroups, true);
		if (resolved.length > 0 && resolved.length < displayGroups.length) {
			const display = aggregateGroupsResult(resolved);
			return toOrgSizeResult(display.name, display.tier, resolved);
		}
	}

	const sameTypeDisplay = getSameTypeAggregatedDisplay(displayGroups, factionName, factionAffinity);
	if (sameTypeDisplay) {
		return sameTypeDisplay;
	}

	const aggregated = aggregateGroupsResult(displayGroups);
	return toOrgSizeResult(aggregated.name, aggregated.tier, groups);
}

function getGroupDisplayCount(group: GroupSizeResult): number {
	return Math.max(1, group.count ?? 1);
}

function getTotalGroupDisplayCount(groups: readonly GroupSizeResult[]): number {
	return groups.reduce((sum, group) => sum + getGroupDisplayCount(group), 0);
}

function getExpandedGroupTiers(groups: readonly GroupSizeResult[]): number[] {
	return groups.flatMap((group) => Array.from({ length: getGroupDisplayCount(group) }, () => group.tier));
}

function getAggregatedDisplayTier(groups: readonly GroupSizeResult[]): number {
	return getAggregatedTier(getExpandedGroupTiers(groups));
}

function getDisplayThresholdTier(options: OrgNamingOptions): number {
	return options.displayThresholdTier ?? Number.NEGATIVE_INFINITY;
}

function filterGroupsForDisplay(
	groups: readonly GroupSizeResult[],
	options: OrgNamingOptions,
): GroupSizeResult[] {
	if (groups.length <= 1) {
		return [...groups];
	}

	const thresholdTier = getDisplayThresholdTier(options);
	const filtered = groups.filter((group) => group.tier >= thresholdTier);
	return filtered.length > 0 ? filtered : [...groups];
}

function getAllocatedTrooperCount(group: GroupSizeResult): number | null {
	if (!group.unitAllocations || group.unitAllocations.length === 0) {
		return null;
	}

	const trooperCount = group.unitAllocations.reduce((sum, allocation) => sum + allocation.troopers, 0);
	return trooperCount > 0 ? trooperCount : null;
}


function getGroupTypeDisplayName(group: GroupSizeResult, preserveForeignNames = false): string {
	if (preserveForeignNames && group.foreignDisplayName) {
		return group.foreignDisplayName;
	}

	if (!group.type) {
		return group.name;
	}

	return `${group.modifierKey}${group.type}`;
}

function getGroupDisplayName(group: GroupSizeResult, options: GroupDisplayOptions = {}): string {
	const includeAllocationSummary = options.includeAllocationSummary ?? true;
	const preserveForeignNames = options.preserveForeignNames ?? false;
	const displayCount = getGroupDisplayCount(group);
	const baseName = displayCount > 1
		? `${displayCount}x ${getGroupTypeDisplayName(group, preserveForeignNames)}`
		: getGroupTypeDisplayName(group, preserveForeignNames);

	if (!includeAllocationSummary) {
		return baseName;
	}

	const allocatedTroopers = getAllocatedTrooperCount(group);
	return allocatedTroopers ? `${baseName} (${allocatedTroopers} troopers)` : baseName;
}

function getEquivalentName(groups: readonly GroupSizeResult[], options: GroupDisplayOptions = {}): string {
	if (groups.length === 0) {
		return EMPTY_RESULT.name;
	}
	if (groups.length === 1) {
		return getGroupDisplayName(groups[0], options);
	}

	const first = groups[0];
	const isHomogeneous = groups.every((group) =>
		group.type === first?.type
		&& group.tag === first?.tag
		&& group.countsAsType === first?.countsAsType,
	);
	if (!isHomogeneous) {
		const bucketsByLabel = new Map<string, HeterogeneousDisplayBucket>();

		for (const group of groups) {
			const label = getGroupTypeDisplayName(group, options.preserveForeignNames ?? false);
			const existing = bucketsByLabel.get(label);
			if (existing) {
				bucketsByLabel.set(label, {
					...existing,
					count: existing.count + getGroupDisplayCount(group),
				});
				continue;
			}

			bucketsByLabel.set(label, {
				label,
				count: getGroupDisplayCount(group),
				representative: group,
			});
		}

		return [...bucketsByLabel.values()]
			.sort((left, right) => {
				if (left.representative.tier !== right.representative.tier) {
					return right.representative.tier - left.representative.tier;
				}
				const leftIsSubRegular = left.representative.modifierKey !== '';
				const rightIsSubRegular = right.representative.modifierKey !== '';
				if (leftIsSubRegular !== rightIsSubRegular) {
					return leftIsSubRegular ? -1 : 1;
				}
				return left.label.localeCompare(right.label);
			})
			.map((bucket) => {
				return bucket.count > 1 ? `${bucket.count}x ${bucket.label}` : bucket.label;
			})
			.join(' + ');
	}

	const baseLabel = first
		? getGroupTypeDisplayName({ ...first, modifierKey: '' }, options.preserveForeignNames ?? false)
		: EMPTY_RESULT.name;
	return `${getTotalGroupDisplayCount(groups)}x ${baseLabel}`;
}

function canReresolveAggregatedGroups(groups: readonly GroupSizeResult[]): boolean {
	return groups.every((group) => group.modifierKey === '');
}

export function aggregateGroupsResult(groups: readonly GroupSizeResult[], options: GroupDisplayOptions = {}): OrgSizeResult {
	if (groups.length === 0) {
		return toOrgSizeResult(EMPTY_RESULT.name, EMPTY_RESULT.tier, []);
	}
	if (groups.length === 1) {
		return toOrgSizeResult(getGroupDisplayName(groups[0], options), getAggregatedDisplayTier(groups), groups);
	}

	return toOrgSizeResult(getEquivalentName(groups, options), getAggregatedDisplayTier(groups), groups);
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
	if (new Set(modifierSteps.map((step) => step.tier.toFixed(4))).size <= 1) {
		return null;
	}

	const regularStep = modifierSteps.find((step) => step.modifierKey === '') ?? modifierSteps[0];
	const regularCount = regularStep.count;
	const equivalentRegularCount = groups.reduce(
		(sum, group) => sum + (getEquivalentGroupCountAtTier(group.tier, regularStep.tier) * getGroupDisplayCount(group)),
		0,
	);
	const aggregatedDisplayTier = equivalentRegularCount > 0
		? regularStep.tier + (Math.log(equivalentRegularCount) / Math.log(3))
		: getAggregatedDisplayTier(groups);
	const maxRepeatCount = Math.max(1, Math.ceil(equivalentRegularCount));

	let best: { name: string; tier: number; repeatCount: number; modifierCount: number } | null = null;
	for (let repeatCount = 1; repeatCount <= maxRepeatCount; repeatCount += 1) {
		const stepsForRepeat = repeatCount === 1
			? modifierSteps
			: modifierSteps.filter((step) => step.tier >= regularStep.tier - 0.0001);

		for (const step of stepsForRepeat) {
			const candidateTier = getTierForRepeatedGroup(step.tier, repeatCount);
			if (candidateTier - aggregatedDisplayTier > 0.0001) {
				continue;
			}

			const name = repeatCount === 1
				? `${step.modifierKey}${first.type}`
				: `${repeatCount}x ${step.modifierKey}${first.type}`;
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

interface ListedDisplayBucket {
	readonly label: string;
	readonly groups: GroupSizeResult[];
	readonly tier: number;
}

function getListedDisplayBuckets(groups: readonly GroupSizeResult[]): ListedDisplayBucket[] {
	const buckets = new Map<string, GroupSizeResult[]>();

	for (const group of groups) {
		const label = getGroupTypeDisplayName(group, true);
		const key = `${label}::${group.tier}`;
		const bucket = buckets.get(key);
		if (bucket) {
			bucket.push(group);
			continue;
		}

		buckets.set(key, [group]);
	}

	return Array.from(buckets.entries())
		.map(([key, bucketGroups]) => ({
			label: key.slice(0, key.lastIndexOf('::')),
			groups: bucketGroups,
			tier: getAggregatedDisplayTier(bucketGroups),
		}))
		.sort((left, right) => right.tier - left.tier || left.label.localeCompare(right.label));
}

function getListedGroupsResult(groups: readonly GroupSizeResult[], options: OrgNamingOptions = {}): OrgSizeResult {
	const displayGroups = filterGroupsForDisplay(groups, options);

	if (displayGroups.length <= 1) {
		const display = aggregateGroupsResult(displayGroups, {
			includeAllocationSummary: true,
			preserveForeignNames: true,
		});
		return toOrgSizeResult(display.name, display.tier, groups);
	}

	const buckets = getListedDisplayBuckets(displayGroups);
	const name = buckets
		.map((bucket) => {
			const totalCount = getTotalGroupDisplayCount(bucket.groups);
			return totalCount > 1 ? `${totalCount}x ${bucket.label}` : bucket.label;
		})
		.join(' + ');

	return toOrgSizeResult(name, getAggregatedDisplayTier(displayGroups), groups);
}

export function getOrgFromForceCollection(
	entries: readonly LoadForceEntry[],
	factionName: string,
	factionAffinity: FactionAffinity,
	childGroupResults?: readonly GroupSizeResult[],
	options: OrgNamingOptions = {},
): OrgSizeResult {
	const inputGroups = childGroupResults
		? [...childGroupResults]
		: entries.flatMap((entry) =>
			entry.groups.flatMap((group) => getGroupResultsFromLoadForceGroup(group, factionName, factionAffinity)),
		);
	const resolvedGroups = resolveFromGroups(factionName, factionAffinity, inputGroups, true);
	const finalGroups = resolvedGroups.length > 0 ? resolvedGroups : inputGroups;
	const display = getAggregatedGroupsResult(finalGroups, factionName, factionAffinity, options);
	return toOrgSizeResult(display.name, display.tier, finalGroups);
}

*/