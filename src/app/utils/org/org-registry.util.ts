import type { Era } from '../../models/eras.model';
import { getFactionAffinity, type Faction } from '../../models/factions.model';
import {
	CC_CORE_ORG,
	CLAN_CORE_ORG,
	COMSTAR_CORE_ORG,
	IS_CORE_ORG,
	MH_CORE_ORG,
	SOCIETY_CORE_ORG,
	WD_CORE_ORG,
} from './definitions';
import type { OrgDefinitionSpec } from './org-types';

export interface OrgDefinitionRegistryEntry {
	readonly match: (faction: Faction, era?: Era | null) => boolean;
	readonly org: OrgDefinitionSpec;
}

export function isClan(faction: Faction): boolean {
	if (getFactionAffinity(faction).includes('Clan')) {
		return true;
	}
	if (faction.name.includes('Escorpi') || faction.name.includes('Scorpion Empire')) {
		return true;
	}
	return false;
}


export const ORG_SPEC_REGISTRY: readonly OrgDefinitionRegistryEntry[] = [
	{ match: (faction) => faction.name.includes('ComStar') || faction.name.includes('Word of Blake'), org: COMSTAR_CORE_ORG },
	{ match: (faction) => faction.name.includes('Society'), org: SOCIETY_CORE_ORG },
	{ match: (faction) => faction.name.includes('Marian Hegemony'), org: MH_CORE_ORG },
	{ match: (faction, era) => faction.name.includes('Dragoons') && (era?.years.to ?? Number.POSITIVE_INFINITY) <= 3050, org: IS_CORE_ORG },
	{ match: (faction) => faction.name.includes('Dragoons'), org: WD_CORE_ORG },
	{ match: (faction) => faction.name.includes('Capellan Confederation'), org: CC_CORE_ORG },
	{ match: (faction) => isClan(faction), org: CLAN_CORE_ORG },
];

export const DEFAULT_ORG_SPEC: OrgDefinitionSpec = IS_CORE_ORG;

export function resolveOrgDefinitionSpec(
	faction: Faction,
	era?: Era | null,
): OrgDefinitionSpec {
	return ORG_SPEC_REGISTRY.find((entry) => entry.match(faction, era))?.org ?? DEFAULT_ORG_SPEC;
}