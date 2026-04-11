import { type Force, UnitGroup } from '../../models/force.model';
import type { Era } from '../../models/eras.model';
import { type Faction } from '../../models/factions.model';
import { LoadForceEntry, type LoadForceGroup } from '../../models/load-force-entry.model';
import type { Unit } from '../../models/units.model';
import { resolveOrgDefinition } from './org-registry.util';
import { getAggregatedTier, getDynamicTierForModifier } from './org-tier.util';
import { resolveFromGroups, resolveFromUnits } from './org-solver.util';
import { type GroupSizeResult, type OrgDefinition, type OrgSizeResult } from './org-types';
import { MULFACTION_MERCENARY } from '../../models/mulfactions.model';

/**
 * Author: Drake
 * 
 * This module provides utilities for generating human-readable organizational names and summaries 
 * based on the structure of forces and groups.
 */
export interface OrgNamingOptions {
	readonly displayOnlyTopLevel?: boolean;
	readonly displayTierCutoff?: number;
}

interface DisplayBucket {
	readonly label: string;
	readonly count: number;
	readonly tier: number;
	readonly groups: readonly GroupSizeResult[];
}

interface ModifierSortKey {
	readonly tier: number;
	readonly count: number;
	readonly modifierKey: string;
}

const DEFAULT_FACTION: Faction = {
	id: MULFACTION_MERCENARY,
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
			.flatMap((group) => getGroupResultsFromLoadForceGroup(group, resolvedFaction, resolvedEra));
		const rawGroups = resolveFromGroups(groupResults, resolvedFaction, resolvedEra);
		return getResolvedOrgResult(rawGroups, resolvedFaction, resolvedEra, resolvedOptions);
	}

	const resolvedFaction = forceOrEntry.faction() ?? DEFAULT_FACTION;
	const resolvedEra = forceOrEntry.era();
	const groupResults = forceOrEntry.groups()
		.filter((group) => group.units().length > 0)
		.flatMap((group) => group.organizationalResult().groups);
	const rawGroups = resolveFromGroups(groupResults, resolvedFaction, resolvedEra);
	return getResolvedOrgResult(rawGroups, resolvedFaction, resolvedEra, resolvedOptions);
}

export function getOrgFromForceCollection(
	entries: readonly LoadForceEntry[],
	faction: Faction | null | undefined,
	era: Era | null = null,
	childGroupResults?: readonly GroupSizeResult[],
	options: OrgNamingOptions = {},
): OrgSizeResult {
	const resolvedFaction = faction ?? DEFAULT_FACTION;
	const inputGroups = childGroupResults
		? [...childGroupResults]
		: entries.flatMap((entry) => getOrgFromForce(entry).groups);
	const finalGroups = inputGroups.length > 1
		? resolveFromGroups(inputGroups, resolvedFaction, era)
		: [...inputGroups];
	return getResolvedOrgResult(finalGroups, resolvedFaction, era, options);
}

export function getOrgFromResolvedGroups(
	groups: readonly GroupSizeResult[],
	options: OrgNamingOptions = {},
): OrgSizeResult {
	return getResolvedOrgResult(groups, DEFAULT_FACTION, null, options);
}

// Internal utilities

function getGroupResultsFromLoadForceGroup(
	group: LoadForceGroup,
	faction: Faction,
	era: Era | null | undefined,
): GroupSizeResult[] {
	const force = group.force ?? null;
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
	if (groups.length === 0) {
		return toOrgSizeResult('Force', 0, []);
	}

	const definition = resolveOrgDefinition(faction, era);
	const displayBuckets = getDisplayBuckets(groups, definition);
	const filteredBuckets = getDisplayBucketsForOptions(displayBuckets, options);
	const displayWasTruncated = filteredBuckets.length < displayBuckets.length;
	if (filteredBuckets.length === 1) {
		const bucket = filteredBuckets[0];
		return toOrgSizeResult(addTruncationSuffix(formatDisplayBucket(bucket), displayWasTruncated), bucket.tier, groups);
	}

	return toOrgSizeResult(
		addTruncationSuffix(formatDisplayBuckets(filteredBuckets), displayWasTruncated),
		getAggregatedTier(filteredBuckets.flatMap((bucket) => getExpandedGroupTiers(bucket.groups))),
		groups,
	);
}

function getDisplayBucketsForOptions(
	buckets: readonly DisplayBucket[],
	options: OrgNamingOptions,
): DisplayBucket[] {
	let filteredBuckets = [...buckets];
	const displayTierCutoff = options.displayTierCutoff;
	if (displayTierCutoff !== undefined && filteredBuckets.length > 1) {
		const bucketsAtOrAboveCutoff = filteredBuckets.filter((bucket) => bucket.tier >= displayTierCutoff);
		const hasBucketsBelowCutoff = filteredBuckets.some((bucket) => bucket.tier < displayTierCutoff);
		if (bucketsAtOrAboveCutoff.length > 0 && hasBucketsBelowCutoff) {
			filteredBuckets = bucketsAtOrAboveCutoff;
		}
	}

	if (!options.displayOnlyTopLevel || filteredBuckets.length <= 1) {
		return filteredBuckets;
	}

	const highestTier = filteredBuckets[0]?.tier ?? 0;
	return filteredBuckets.filter((bucket) => Math.abs(bucket.tier - highestTier) < 0.0001);
}

function getGroupDisplayCount(group: GroupSizeResult): number {
	return Math.max(1, group.count ?? 1);
}

function getGroupTierWeight(group: GroupSizeResult): number {
	return group.isFragment ? 1 : getGroupDisplayCount(group);
}

function getExpandedGroupTiers(groups: readonly GroupSizeResult[]): number[] {
	return groups.flatMap((group) => Array.from({ length: getGroupTierWeight(group) }, () => group.tier));
}

function getAggregatedDisplayTier(groups: readonly GroupSizeResult[]): number {
	if (groups.length === 0) {
		return 0;
	}

	const highestTier = Math.max(...groups.map((group) => group.tier));
	if (highestTier <= 0) {
		return highestTier;
	}

	return getAggregatedTier(getExpandedGroupTiers(groups));
}

function addTruncationSuffix(label: string, truncated: boolean): string {
	return truncated ? `${label}+` : label;
}

function getGroupDisplayLabel(group: GroupSizeResult): string {
	if (group.foreignDisplayName) {
		return group.foreignDisplayName;
	}

	if (group.type) {
		return `${group.modifierKey}${group.type}`;
	}

	return group.name;
}

function getModifierCount(value: number | { count: number; tier?: number }): number {
	return typeof value === 'number' ? value : value.count;
}

function getModifierTier(
	baseTier: number,
	regularCount: number,
	modifierValue: number | { count: number; tier?: number },
	dynamicTier?: number,
): number {
	if (typeof modifierValue !== 'number' && modifierValue.tier !== undefined) {
		return modifierValue.tier;
	}

	return getDynamicTierForModifier(baseTier, regularCount, getModifierCount(modifierValue), dynamicTier ?? 0);
}

function getDisplayBucketModifierSortKey(
	bucket: DisplayBucket,
	definition: OrgDefinition,
): ModifierSortKey | null {
	const representative = bucket.groups[0];
	if (!representative?.type) {
		return null;
	}

	const rule = definition.rules.find((candidate) => candidate.type === representative.type);
	if (!rule) {
		return null;
	}

	const modifierEntries = Object.entries(rule.modifiers);
	const regularModifierValue = rule.modifiers[''] ?? modifierEntries[0]?.[1];
	if (regularModifierValue === undefined) {
		return null;
	}

	const modifierValue = rule.modifiers[representative.modifierKey];
	if (modifierValue === undefined) {
		return null;
	}

	const regularCount = getModifierCount(regularModifierValue);
	return {
		tier: getModifierTier(rule.tier, regularCount, modifierValue, rule.dynamicTier),
		count: getModifierCount(modifierValue),
		modifierKey: representative.modifierKey,
	};
}

function compareDisplayBuckets(
	left: DisplayBucket,
	right: DisplayBucket,
	definition: OrgDefinition,
): number {
	const tierDelta = right.tier - left.tier;
	if (tierDelta !== 0) {
		return tierDelta;
	}

	const leftRepresentative = left.groups[0];
	const rightRepresentative = right.groups[0];
	if (leftRepresentative?.type && leftRepresentative.type === rightRepresentative?.type) {
		const leftModifier = getDisplayBucketModifierSortKey(left, definition);
		const rightModifier = getDisplayBucketModifierSortKey(right, definition);
		if (leftModifier && rightModifier) {
			const modifierTierDelta = rightModifier.tier - leftModifier.tier;
			if (modifierTierDelta !== 0) {
				return modifierTierDelta;
			}

			const modifierCountDelta = rightModifier.count - leftModifier.count;
			if (modifierCountDelta !== 0) {
				return modifierCountDelta;
			}

			const modifierKeyDelta = leftModifier.modifierKey.localeCompare(rightModifier.modifierKey);
			if (modifierKeyDelta !== 0) {
				return modifierKeyDelta;
			}
		}
	}

	return left.label.localeCompare(right.label);
}

function getDisplayBuckets(
	groups: readonly GroupSizeResult[],
	definition: OrgDefinition,
): DisplayBucket[] {
	const buckets = new Map<string, { label: string; count: number; groups: GroupSizeResult[] }>();

	for (const group of groups) {
		const label = getGroupDisplayLabel(group);
		const key = `${label}::${group.tier}`;
		const bucket = buckets.get(key);
		if (bucket) {
			bucket.count += getGroupDisplayCount(group);
			bucket.groups.push(group);
			continue;
		}

		buckets.set(key, { label, count: getGroupDisplayCount(group), groups: [group] });
	}

	return [...buckets.values()]
		.map((bucket) => ({
			label: bucket.label,
			count: bucket.count,
			tier: getAggregatedDisplayTier(bucket.groups),
			groups: bucket.groups,
		}))
		.sort((left, right) => compareDisplayBuckets(left, right, definition));
}

function formatDisplayBucket(bucket: DisplayBucket): string {
	return formatRepeatedDisplayLabel(bucket.label, bucket.count);
}

function formatRepeatedDisplayLabel(label: string, count: number): string {
	if (count <= 1) {
		return label;
	}

	if (label === 'Unit') {
		return `${count} Units`;
	}

	return `${count}x ${label}`;
}

function formatDisplayBuckets(buckets: readonly DisplayBucket[]): string {
	return buckets.map((bucket) => formatDisplayBucket(bucket)).join(' + ');
}

function toOrgSizeResult(name: string, tier: number, groups: readonly GroupSizeResult[]): OrgSizeResult {
	return {
		name,
		tier,
		groups,
	};
}