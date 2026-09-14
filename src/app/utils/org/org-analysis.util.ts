// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

/** Adapt live forces and archive previews to organization solving and naming. */

import { type Force, UnitGroup } from '../../models/force.model';
import type { Era } from '../../models/eras.model';
import type { Faction } from '../../models/factions.model';
import { isForcePreviewEntry, type ForcePreviewEntry, type ForcePreviewGroup } from '../../models/force-preview.model';
import { MULFACTION_MERCENARY } from '../../models/mulfactions.model';
import type { UnitSummary } from '../../models/unit-summary.model';
import { getOrgFromResolvedGroups, type OrgNamingOptions } from './org-namer.util';
import { resolveOrgDefinition } from './org-registry.util';
import { resolveFromGroups, resolveFromUnits } from './org-solver.util';
import type { GroupSizeResult, OrgSizeResult } from './org-types';
import { orgUnitFromFormationUnit } from './org-unit-adapter.util';

const DEFAULT_FACTION: Faction = {
	id: MULFACTION_MERCENARY,
	name: 'Mercenary',
	group: 'Mercenary',
	img: '',
	eras: {},
};

export function getOrgFromGroup(group: UnitGroup, options?: OrgNamingOptions): OrgSizeResult;
export function getOrgFromGroup(group: ForcePreviewGroup, options?: OrgNamingOptions): OrgSizeResult;
export function getOrgFromGroup(group: UnitGroup | ForcePreviewGroup, options: OrgNamingOptions = {}): OrgSizeResult {
	if (group instanceof UnitGroup) {
		const force = group.force;
		const resolvedFaction = force.faction() ?? DEFAULT_FACTION;
		const resolvedEra = force.era();
		const allUnits = group.formationUnits().map(orgUnitFromFormationUnit);
		const rawGroups = resolveFromUnits(allUnits, resolvedFaction, resolvedEra);
		return getOrgFromResolvedGroups(rawGroups, options, resolveOrgDefinition(resolvedFaction, resolvedEra));
	}

	const force = group.force ?? null;
	const resolvedFaction = force?.faction ?? DEFAULT_FACTION;
	const resolvedEra = force?.era ?? null;
	const rawGroups = getGroupResultsFromForcePreviewGroup(group, resolvedFaction, resolvedEra);
	return getOrgFromResolvedGroups(rawGroups, options, resolveOrgDefinition(resolvedFaction, resolvedEra));
}

export function getOrgFromForce(force: Force, options?: OrgNamingOptions): OrgSizeResult;
export function getOrgFromForce(entry: ForcePreviewEntry, options?: OrgNamingOptions): OrgSizeResult;
export function getOrgFromForce(forceOrEntry: Force | ForcePreviewEntry, options: OrgNamingOptions = {}): OrgSizeResult {
	if (isForcePreviewEntry(forceOrEntry)) {
		const resolvedFaction = forceOrEntry.faction ?? DEFAULT_FACTION;
		const resolvedEra = forceOrEntry.era ?? null;
		const groupResults = forceOrEntry.groups
			.filter((group) => group.units.some((unit) => unit.unit !== undefined))
			.flatMap((group) => getGroupResultsFromForcePreviewGroup(group, resolvedFaction, resolvedEra));
		const rawGroups = resolveFromGroups(groupResults, resolvedFaction, resolvedEra);
		return getOrgFromResolvedGroups(rawGroups, options, resolveOrgDefinition(resolvedFaction, resolvedEra));
	}

	const resolvedFaction = forceOrEntry.faction() ?? DEFAULT_FACTION;
	const resolvedEra = forceOrEntry.era();
	const groupResults = forceOrEntry.groups()
		.filter((group) => group.formationUnits().length > 0)
		.flatMap((group) => group.organizationalResult().groups);
	const rawGroups = resolveFromGroups(groupResults, resolvedFaction, resolvedEra);
	return getOrgFromResolvedGroups(rawGroups, options, resolveOrgDefinition(resolvedFaction, resolvedEra));
}

export function getOrgFromForceCollection(
	entries: readonly ForcePreviewEntry[],
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
	return getOrgFromResolvedGroups(finalGroups, options, resolveOrgDefinition(resolvedFaction, era));
}

function getGroupResultsFromForcePreviewGroup(
	group: ForcePreviewGroup,
	faction: Faction,
	era: Era | null | undefined,
): GroupSizeResult[] {
	const units = group.units
		.filter((entry): entry is typeof entry & { unit: UnitSummary } => entry.unit !== undefined)
		.map((entry) => entry.unit);
	return resolveFromUnits(units, faction, era);
}
