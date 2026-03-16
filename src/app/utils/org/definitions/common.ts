import type {
	BuiltInTransportBucketValue,
	CIMoveClass,
	OrgComposedCountRule,
	OrgLeafPatternRule,
	OrgType,
	UnitFactTag,
} from '../org-types';

export const TRANSPORT_BA_ALL_BUCKETS = ['BA', 'BA:mec', 'BA:xmec', 'BA:mec+xmec'] as const satisfies readonly BuiltInTransportBucketValue[];
export const TRANSPORT_BA_QUALIFIED_BUCKETS = ['BA:mec', 'BA:xmec', 'BA:mec+xmec'] as const satisfies readonly BuiltInTransportBucketValue[];
export const TRANSPORT_BA_MEC_BUCKETS = ['BA:mec', 'BA:mec+xmec'] as const satisfies readonly BuiltInTransportBucketValue[];
export const TRANSPORT_BA_XMEC_BUCKETS = ['BA:xmec', 'BA:mec+xmec'] as const satisfies readonly BuiltInTransportBucketValue[];
export const TRANSPORT_BM_CARRIER_BUCKETS = ['BM', 'BM:omni'] as const satisfies readonly BuiltInTransportBucketValue[];
export const TRANSPORT_BM_OMNI_CARRIER_BUCKETS = ['BM:omni'] as const satisfies readonly BuiltInTransportBucketValue[];
export const TRANSPORT_CV_CARRIER_BUCKETS = ['CV', 'CV:omni'] as const satisfies readonly BuiltInTransportBucketValue[];
export const TRANSPORT_CV_OMNI_CARRIER_BUCKETS = ['CV:omni'] as const satisfies readonly BuiltInTransportBucketValue[];
export const TRANSPORT_AF_CARRIER_BUCKETS = ['AF', 'AF:omni'] as const satisfies readonly BuiltInTransportBucketValue[];
export const TRANSPORT_AF_OMNI_CARRIER_BUCKETS = ['AF:omni'] as const satisfies readonly BuiltInTransportBucketValue[];
export const TRANSPORT_NON_BM_NOVA_BUCKETS = ['CV', 'CV:omni', 'AF', 'AF:omni', 'BA'] as const satisfies readonly BuiltInTransportBucketValue[];
export const TRANSPORT_NON_CV_NOVA_BUCKETS = ['BM', 'BM:omni', 'AF', 'AF:omni', 'BA'] as const satisfies readonly BuiltInTransportBucketValue[];
export const TRANSPORT_NON_AF_NOVA_BUCKETS = ['BM', 'BM:omni', 'CV', 'CV:omni', 'BA'] as const satisfies readonly BuiltInTransportBucketValue[];
export const INFANTRY_BA_TROOPER_BUCKETS = { prefix: 'BA:' } as const;
export const INFANTRY_CI_TROOPER_BUCKETS = { prefix: 'CI:' } as const;

export interface CISquadEntry {
	readonly moveClass: CIMoveClass;
	readonly troopers: number;
}

export interface CIFormationEntry {
	readonly moveClass: CIMoveClass;
	readonly counts: Readonly<Record<string, number>>;
}

interface ExactCISquadRuleOptions {
	readonly type?: OrgType;
	readonly countsAs?: OrgType;
	readonly priority?: number;
	readonly commandRank?: string;
	readonly tier: number;
	readonly entries: readonly CISquadEntry[];
}

interface ExactCIComposedRuleOptions {
	readonly type: OrgType;
	readonly countsAs?: OrgType;
	readonly priority?: number;
	readonly commandRank?: string;
	readonly tier: number;
	readonly entries: readonly CIFormationEntry[];
	readonly childType?: OrgType;
}

function getCIMoveClassTag(moveClass: CIMoveClass): UnitFactTag {
	return `ci:${moveClass}` as UnitFactTag;
}

function getSortedModifierCounts(counts: Readonly<Record<string, number>>): Array<[string, number]> {
	return Object.entries(counts).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
}

function getModifierCountKey(counts: Readonly<Record<string, number>>): string {
	return JSON.stringify(getSortedModifierCounts(counts));
}

export function createExactCISquadRule(options: ExactCISquadRuleOptions): OrgLeafPatternRule {
	return {
		kind: 'leaf-pattern',
		type: options.type ?? 'Squad',
		countsAs: options.countsAs,
		priority: options.priority,
		modifiers: { '': 1 },
		commandRank: options.commandRank,
		tier: options.tier,
		unitSelector: 'CI',
		bucketBy: 'ciMoveClassTroopers',
		patterns: options.entries.map((entry) => ({
			copySize: 1,
			demands: {
				[`CI:${entry.moveClass}:${entry.troopers}`]: 1,
			},
		})),
	};
}

export function createExactCIComposedRule(options: ExactCIComposedRuleOptions): OrgComposedCountRule {
	const groupedEntries = new Map<string, CIFormationEntry[]>();

	for (const entry of options.entries) {
		const countKey = getModifierCountKey(entry.counts);
		const existing = groupedEntries.get(countKey);
		if (existing) {
			existing.push(entry);
			continue;
		}
		groupedEntries.set(countKey, [entry]);
	}

	const configurations = Array.from(groupedEntries.values()).map((entries) => {
		const counts = Object.fromEntries(getSortedModifierCounts(entries[0].counts));
		const requiredUnitTagsAny = entries.map((entry) => getCIMoveClassTag(entry.moveClass));

		return {
			modifiers: counts,
			childRoles: [
				{
					matches: [options.childType ?? 'Squad'],
					min: Math.min(...Object.values(counts)),
					onlyUnitTypes: ['CI'] as const,
					requiredUnitTagsAny,
				},
			],
		};
	}).sort((left, right) => {
		const leftMin = Math.min(...Object.values(left.modifiers));
		const rightMin = Math.min(...Object.values(right.modifiers));
		return leftMin - rightMin;
	});

	const [primary, ...alternatives] = configurations;

	if (!primary) {
		throw new Error(`Exact CI composed rule ${options.type} requires at least one table entry.`);
	}

	return {
		kind: 'composed-count',
		type: options.type,
		countsAs: options.countsAs,
		priority: options.priority,
		modifiers: primary.modifiers,
		commandRank: options.commandRank,
		tier: options.tier,
		childRoles: primary.childRoles,
		childBucketBy: 'promotionBasic',
		childMatchBucketBy: 'ciMoveClass',
		alternativeCompositions: alternatives.map((configuration) => ({
			modifiers: configuration.modifiers,
			childRoles: configuration.childRoles,
			childBucketBy: 'promotionBasic',
			childMatchBucketBy: 'ciMoveClass',
		})),
	};
}