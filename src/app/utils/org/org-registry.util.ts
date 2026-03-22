import type { FactionAffinity } from '../../models/factions.model';
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
	readonly match: (factionName: string, factionAffinity: FactionAffinity) => boolean;
	readonly org: OrgDefinitionSpec;
}

export const ORG_SPEC_REGISTRY: readonly OrgDefinitionRegistryEntry[] = [
	{ match: (factionName) => factionName.includes('ComStar') || factionName.includes('Word of Blake'), org: COMSTAR_CORE_ORG },
	{ match: (factionName) => factionName.includes('Society'), org: SOCIETY_CORE_ORG },
	{ match: (factionName) => factionName.includes('Marian Hegemony'), org: MH_CORE_ORG },
	{ match: (factionName) => factionName.includes('Dragoons'), org: WD_CORE_ORG },
	{ match: (factionName) => factionName.includes('Capellan Confederation'), org: CC_CORE_ORG },
	{ match: (_factionName, factionAffinity) => factionAffinity.includes('Clan'), org: CLAN_CORE_ORG },
    { match: (factionName, _factionAffinity) =>
        factionName.includes('Rasalhague Dominion') || factionName.includes('Raven Alliance') || factionName.includes('Wolf Empire') ||
        factionName.includes('Escorpi') || factionName.includes('Scorpion Empire') || factionName.includes('Alyina Mercantile League'),
        org: CLAN_CORE_ORG,
    },
	{ match: (_factionName, factionAffinity) => factionAffinity == 'Inner Sphere', org: IS_CORE_ORG },
];

export const DEFAULT_ORG_SPEC: OrgDefinitionSpec = IS_CORE_ORG;

export function resolveOrgDefinitionSpec(
	factionName: string,
	factionAffinity: FactionAffinity,
): OrgDefinitionSpec {
	return ORG_SPEC_REGISTRY.find((entry) => entry.match(factionName, factionAffinity))?.org ?? DEFAULT_ORG_SPEC;
}