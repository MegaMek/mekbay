// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

/** Display names and tier aggregation for solved organizations. */

import { DEFAULT_ORG_DEFINITION } from './org-registry.util';
import { getAggregatedTier, getModifierCount, getModifierTier } from './org-tier.util';
import type { GroupSizeResult, OrgDefinition, OrgSizeResult } from './org-types';

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

export function getOrgFromResolvedGroups(
	groups: readonly GroupSizeResult[],
	options: OrgNamingOptions = {},
	definition: OrgDefinition = DEFAULT_ORG_DEFINITION,
): OrgSizeResult {
	if (groups.length === 0) {
		return toOrgSizeResult('Force', 0, []);
	}

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

	if (group.displayName) {
		return `${group.modifierKey}${group.displayName}`;
	}

	if (group.type) {
		return `${group.modifierKey}${group.type}`;
	}

	return group.name;
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
