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

	it('pluralizes Element fragments without x-prefix notation', () => {
		const result = getOrgFromResolvedGroups([
			createGroup({ name: '4 Elements', type: 'Element', tier: -1, count: 4, isFragment: true }),
		]);

		expect(result.name).toBe('4 Elements');
	});

	it('keeps Point ahead of inferior Element fragments in mixed display', () => {
		const result = getOrgFromResolvedGroups([
			createGroup({ name: 'Point', type: 'Point', tier: 0 }),
			createGroup({ name: '3 Elements', type: 'Element', tier: -1, count: 3, isFragment: true }),
		]);

		expect(result.name).toBe('Point + 3 Elements');
	});

	it('keeps Point as the top-level name over inferior Element fragments', () => {
		const result = getOrgFromResolvedGroups(
			[
				createGroup({ name: 'Point', type: 'Point', tier: 0 }),
				createGroup({ name: '3 Elements', type: 'Element', tier: -1, count: 3, isFragment: true }),
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