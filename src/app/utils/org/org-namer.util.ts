import { type Force, UnitGroup } from '../../models/force.model';
import { FactionAffinity } from '../../models/factions.model';
import { LoadForceEntry, type LoadForceGroup } from '../../models/load-force-entry.model';
import type { Unit } from '../../models/units.model';
import { buildUnitFactsMap, compileGroupFactsList } from './org-facts.util';
import { resolveOrgDefinitionSpec } from './org-registry.util';
import { getAggregatedTier, getDynamicTierForModifier, getEquivalentGroupCountAtTier, getTierForRepeatedGroup } from './org-tier.util';
import type {
    EMPTY_RESULT,
	GroupSizeResult,
	OrgComposedCountRule,
	OrgComposedPatternRule,
	OrgDefinitionSpec,
	OrgRuleDefinition,
	OrgSizeResult,
	OrgTypeModifier,
} from './org-types';

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
		
	}

	const resolvedFactionName = factionName ?? 'Mercenary';
	const resolvedFactionAffinity = factionAffinity ?? 'Mercenary';
	const units = group.units
		.filter((unit): unit is typeof unit & { unit: Unit } => unit.unit !== undefined)
		.map((unit) => unit.unit);
	const rawGroups = resolveOrgGroupsFromUnits(units, resolvedFactionName, resolvedFactionAffinity);
	
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
		
	}

	const resolvedFactionName = factionName ?? forceOrEntry.faction()?.name ?? 'Mercenary';
	const resolvedFactionAffinity = factionAffinity ?? forceOrEntry.faction()?.group ?? 'Mercenary';
	const groupResults = forceOrEntry.groups()
		.filter((group) => group.units().length > 0)
		.flatMap((group) => getGroupResultsFromOrgResult(group.sizeResult()));
	const rawGroups = resolveFromGroups(resolvedFactionName, resolvedFactionAffinity, groupResults);
	
}

