import type { Faction } from '../../models/factions.model';
import { getOrgFromForceCollection, getOrgFromResolvedGroups } from './org-namer.util';
import { getAggregatedTier, getDynamicTierForModifier } from './org-tier.util';
import { resolveFromGroups } from './org-solver.util';
import type { GroupSizeResult } from './org-types';

describe('org-namer.util', () => {
	const innerSphereFaction: Faction = {
		id: 1,
		name: 'Federated Suns',
		group: 'Inner Sphere',
		img: '',
		eras: {},
	};

	function createGroup(overrides: Partial<GroupSizeResult>): GroupSizeResult {
		return {
			name: 'Group',
			type: null,
			modifierKey: '',
			countsAsType: null,
			tier: 0,
			...overrides,
		};
	}

	it('sorts repeated display buckets by their aggregated tier', () => {
		const result = getOrgFromResolvedGroups([
			createGroup({ name: 'Brigade', type: 'Brigade', tier: 3.5 }),
			createGroup({ name: 'Squadron', type: 'Squadron', tier: 2 }),
			createGroup({ name: 'Sept', type: 'Sept', tier: 1.6, count: 7 }),
			createGroup({ name: 'Sept', type: 'Sept', tier: 1.6, count: 7 }),
		]);

		expect(result.name).toBe('14x Sept + Brigade + Squadron');
		expect(result.tier).toBeCloseTo(getAggregatedTier([
			3.5,
			2,
			...Array.from({ length: 14 }, () => 1.6),
		]), 2);
	});

	it('uses aggregated bucket tiers for top-level-only display', () => {
		const result = getOrgFromResolvedGroups(
			[
				createGroup({ name: 'Brigade', type: 'Brigade', tier: 3.5 }),
				createGroup({ name: 'Sept', type: 'Sept', tier: 1.6, count: 7 }),
				createGroup({ name: 'Sept', type: 'Sept', tier: 1.6, count: 7 }),
			],
			{ displayOnlyTopLevel: true },
		);

		expect(result.name).toBe('14x Sept+');
		expect(result.tier).toBeCloseTo(getAggregatedTier(Array.from({ length: 14 }, () => 1.6)), 2);
	});

	it('pluralizes Unit fragments without x-prefix notation', () => {
		const result = getOrgFromResolvedGroups([
			createGroup({ name: '4 Units', type: 'Unit', tier: -1, count: 4, isFragment: true }),
		]);

		expect(result.name).toBe('4 Units');
	});

	it('keeps higher-tier groups ahead of repeated zero-tier buckets', () => {
		const result = getOrgFromResolvedGroups([
			createGroup({ name: 'Reinforced Lance', type: 'Lance', modifierKey: 'Reinforced ', tier: 1 }),
			...Array.from({ length: 4 }, () => createGroup({ name: 'Unit', type: 'Unit', tier: 0 })),
		]);

		expect(result.name).toBe('Reinforced Lance + 4 Units');
	});

	it('does not let repeated zero-tier buckets cross a display cutoff', () => {
		const result = getOrgFromResolvedGroups(
			[
				createGroup({ name: 'Reinforced Lance', type: 'Lance', modifierKey: 'Reinforced ', tier: 1 }),
				...Array.from({ length: 4 }, () => createGroup({ name: 'Unit', type: 'Unit', tier: 0 })),
			],
			{ displayTierCutoff: 0.5 },
		);

		expect(result.name).toBe('Reinforced Lance+');
		expect(result.tier).toBe(1);
	});

	it('keeps Point ahead of inferior Unit fragments in mixed display', () => {
		const result = getOrgFromResolvedGroups([
			createGroup({ name: 'Point', type: 'Point', tier: 0 }),
			createGroup({ name: '3 Units', type: 'Unit', tier: -1, count: 3, isFragment: true }),
		]);

		expect(result.name).toBe('Point + 3 Units');
	});

	it('filters negative-tier fragments from mixed display when a minimum display tier is provided', () => {
		const result = getOrgFromResolvedGroups(
			[
				createGroup({ name: 'Point', type: 'Point', tier: 0 }),
				createGroup({ name: '3 Units', type: 'Unit', tier: -1, count: 3, isFragment: true }),
			],
			{ displayTierCutoff: 0 },
		);

		expect(result.name).toBe('Point+');
		expect(result.tier).toBe(0);
	});

	it('does not cut when all display buckets are already at or above the cutoff', () => {
		const result = getOrgFromResolvedGroups(
			[
				createGroup({ name: 'Point', type: 'Point', tier: 0 }),
				createGroup({ name: 'Star', type: 'Star', tier: 1 }),
			],
			{ displayTierCutoff: 0 },
		);

		expect(result.name).toBe('Star + Point');
	});

	it('does not cut when all display buckets are below the cutoff', () => {
		const result = getOrgFromResolvedGroups(
			[
				createGroup({ name: '3 Units', type: 'Unit', tier: -1, count: 3, isFragment: true }),
				createGroup({ name: '2 Units', type: 'Unit', tier: -0.5, count: 2, isFragment: true }),
			],
			{ displayTierCutoff: 0 },
		);

		expect(result.name).toBe('2 Units + 3 Units');
	});

	it('keeps a single negative-tier fragment when it is the only display bucket', () => {
		const result = getOrgFromResolvedGroups(
			[
				createGroup({ name: '4 Units', type: 'Unit', tier: -1, count: 4, isFragment: true }),
			],
			{ displayTierCutoff: 0 },
		);

		expect(result.name).toBe('4 Units');
		expect(result.tier).toBe(-1);
	});

	it('keeps Point as the top-level name over inferior Unit fragments', () => {
		const result = getOrgFromResolvedGroups(
			[
				createGroup({ name: 'Point', type: 'Point', tier: 0 }),
				createGroup({ name: '3 Units', type: 'Unit', tier: -1, count: 3, isFragment: true }),
			],
			{ displayOnlyTopLevel: true },
		);

		expect(result.name).toBe('Point+');
	});

	it('uses solver output for collection aggregation instead of naming-time bucket promotion', () => {
		const underStrengthBattalionTier = getDynamicTierForModifier(3, 3, 2, 1);
		const battalions = Array.from({ length: 5 }, () => createGroup({
			name: 'Under-Strength Battalion',
			type: 'Battalion',
			modifierKey: 'Under-Strength ',
			tier: underStrengthBattalionTier,
		}));
		const promoted = resolveFromGroups(battalions, innerSphereFaction, null, true);
		const result = getOrgFromForceCollection([], innerSphereFaction, null, battalions);

		expect(promoted.length).toBe(1);
		expect(promoted[0].type).toBe('Regiment');
		expect(result.name).toBe(promoted[0].name);
		expect(result.groups).toEqual(promoted);
	});
});