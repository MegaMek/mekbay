// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { UnitSummary } from '../models/unit-summary.model';
import { DEFAULT_GUNNERY_SKILL, DEFAULT_PILOTING_SKILL } from '../models/crew-member.model';
import type { FilterState } from '../services/unit-search-filters.model';
import { buildUnitSearchQueryParameters, parseAndValidateCompactFiltersFromUrl, parseUnitSearchScalarUrlState, parseUnitSearchViewMode, resolveInitialUnitSearchViewMode } from './unit-search-url-filters.util';
import type { UnitSearchDropdownValuesDependencies } from './unit-search-dropdown-values.util';

const SPECIAL = 'TUR(2/3/3,IF2,LRM1/2/2)';

function createDropdownDependencies(): UnitSearchDropdownValuesDependencies {
    return {
        getDropdownOptionUniverse: (filterKey: string) => {
            if (filterKey === 'as.specials') {
                return [SPECIAL, 'TAG'];
            }

            if (filterKey === 'era') {
                return ['Succession Wars', 'Jihad'];
            }

            if (filterKey === '_techBaseDisplay') {
                return ['Inner Sphere', 'Clan', 'Mixed (Inner Sphere)', 'Mixed (Clan)'];
            }

            return [];
        },
        getExternalDropdownValues: (filterKey: string) => {
            return [];
        },
        units: [] as readonly UnitSummary[],
        getProperty: () => undefined,
    };
}

describe('unit search URL filters', () => {
    it('parses only supported view modes', () => {
        expect(parseUnitSearchViewMode('list')).toBe('list');
        expect(parseUnitSearchViewMode('card')).toBe('card');
        expect(parseUnitSearchViewMode('chassis')).toBe('chassis');
        expect(parseUnitSearchViewMode('table')).toBe('table');
        expect(parseUnitSearchViewMode('grid')).toBeNull();
        expect(parseUnitSearchViewMode(null)).toBeNull();
    });

    it('keeps table view dormant unless expansion is explicit', () => {
        const dormant = parseUnitSearchScalarUrlState(new URLSearchParams('view=table'));
        const expanded = parseUnitSearchScalarUrlState(
            new URLSearchParams('view=table&expanded=true'),
        );

        expect(dormant.viewMode).toBe('table');
        expect(dormant.expanded).toBeFalse();
        expect(expanded.viewMode).toBe('table');
        expect(expanded.expanded).toBeTrue();
    });

    it('does not let search state implicitly activate dormant table view', () => {
        const parsed = parseUnitSearchScalarUrlState(
            new URLSearchParams('q=atlas&view=table'),
        );

        expect(parsed.viewMode).toBe('table');
        expect(parsed.expanded).toBeFalse();
    });

    it('normalizes legacy tech-base sort keys from URLs', () => {
        expect(parseUnitSearchScalarUrlState(new URLSearchParams('sort=tech')).sortKey)
            .toBe('_techBaseDisplay');
        expect(parseUnitSearchScalarUrlState(new URLSearchParams('sort=techBase')).sortKey)
            .toBe('_techBaseDisplay');
        expect(parseUnitSearchScalarUrlState(new URLSearchParams('sort=_techBaseDisplay')).sortKey)
            .toBe('_techBaseDisplay');
    });

    it('reads public, legacy, and internal tech filter keys but emits only the public alias', () => {
        for (const key of ['tech', 'techBase', '_techBaseDisplay']) {
            const parsed = parseAndValidateCompactFiltersFromUrl(
                `${key}:"Mixed (Clan)"`,
                createDropdownDependencies(),
            );

            expect(parsed['_techBaseDisplay']).toEqual({
                value: ['Mixed (Clan)'],
                interactedWith: true,
            });
            expect(parsed['techBase']).toBeUndefined();
            expect(parsed['tech']).toBeUndefined();
        }

        const filterState: FilterState = {
            _techBaseDisplay: {
                value: ['Mixed (Clan)'],
                interactedWith: true,
            },
        };

        const queryParameters = buildUnitSearchQueryParameters({
            searchText: '',
            filterState,
            semanticKeys: new Set<string>(),
            selectedSort: '_techBaseDisplay',
            selectedSortDirection: 'asc',
            expanded: false,
            gunnery: DEFAULT_GUNNERY_SKILL,
            piloting: DEFAULT_PILOTING_SKILL,
            bvLimit: 0,
            publicTagsParam: null,
        });

        expect(queryParameters.filters).toBe('tech:Mixed (Clan)');
        expect(queryParameters.sort).toBe('tech');
    });

    it('requires explicit expansion to activate table view from a URL', () => {
        expect(resolveInitialUnitSearchViewMode(
            new URLSearchParams('view=table'),
            'card',
        )).toBe('list');
        expect(resolveInitialUnitSearchViewMode(
            new URLSearchParams('view=table&expanded=true'),
            'card',
        )).toBe('table');
    });

    it('restores the persisted view for clean startup URLs', () => {
        expect(resolveInitialUnitSearchViewMode(new URLSearchParams(), 'chassis')).toBe('chassis');
        expect(resolveInitialUnitSearchViewMode(new URLSearchParams('sort=name'), 'card')).toBe('card');
    });

    it('keeps legacy search URLs deterministic when they omit view', () => {
        expect(resolveInitialUnitSearchViewMode(new URLSearchParams('q=atlas'), 'card')).toBe('list');
        expect(resolveInitialUnitSearchViewMode(new URLSearchParams('filters=type:BM'), 'chassis')).toBe('list');
        expect(resolveInitialUnitSearchViewMode(new URLSearchParams('q='), 'table')).toBe('list');
    });

    it('uses compact list as the active mode for saved force URLs', () => {
        const params = new URLSearchParams('instance=force-1&sel=unit-2');

        expect(resolveInitialUnitSearchViewMode(params, 'table')).toBe('list');
        expect(parseUnitSearchScalarUrlState(params).expanded).toBeFalse();
    });

    it('uses compact list as the active mode for inline force URLs', () => {
        expect(resolveInitialUnitSearchViewMode(
            new URLSearchParams('units=Atlas AS7-D'),
            'table',
        )).toBe('list');
        expect(resolveInitialUnitSearchViewMode(
            new URLSearchParams('mul_ids=16'),
            'table',
        )).toBe('list');
    });

    it('uses compact list as the active mode for operation URLs', () => {
        expect(resolveInitialUnitSearchViewMode(
            new URLSearchParams('operation=operation-1'),
            'table',
        )).toBe('list');
    });

    it('honors an explicitly expanded table view on a force URL', () => {
        const params = new URLSearchParams('instance=force-1&view=table&expanded=true');

        expect(resolveInitialUnitSearchViewMode(params, 'list')).toBe('table');
    });

    it('does not treat a selection without a force as force state', () => {
        expect(resolveInitialUnitSearchViewMode(
            new URLSearchParams('sel=unit-2'),
            'chassis',
        )).toBe('chassis');
    });

    it('serializes non-default views and omits list view', () => {
        const baseArgs = {
            searchText: '',
            filterState: {},
            semanticKeys: new Set<string>(),
            selectedSort: '',
            selectedSortDirection: 'asc' as const,
            expanded: false,
            gunnery: DEFAULT_GUNNERY_SKILL,
            piloting: DEFAULT_PILOTING_SKILL,
            bvLimit: 0,
            publicTagsParam: null,
        };

        expect(buildUnitSearchQueryParameters({ ...baseArgs, viewMode: 'list' }).view).toBeNull();
        expect(buildUnitSearchQueryParameters({ ...baseArgs, viewMode: 'card' }).view).toBe('card');
        expect(buildUnitSearchQueryParameters({ ...baseArgs, viewMode: 'chassis' }).view).toBe('chassis');
        expect(buildUnitSearchQueryParameters({ ...baseArgs, viewMode: 'list' })).toEqual(jasmine.objectContaining({
            view: null,
            expanded: null,
        }));
        expect(buildUnitSearchQueryParameters({ ...baseArgs, viewMode: 'table', expanded: true })).toEqual(jasmine.objectContaining({
            view: 'table',
            expanded: 'true',
        }));
    });

    it('defaults to no budget mode and ignores a bare legacy BV limit', () => {
        const parsed = parseUnitSearchScalarUrlState(new URLSearchParams('bvLimit=5000'));

        expect(parsed.budgetMode).toBeNull();
        expect(parsed.bvLimit).toBeNull();
    });

    it('round-trips explicit Force BV Limit mode', () => {
        const args = {
            searchText: '',
            filterState: {},
            semanticKeys: new Set<string>(),
            selectedSort: '',
            selectedSortDirection: 'asc' as const,
            expanded: false,
            gunnery: DEFAULT_GUNNERY_SKILL,
            piloting: DEFAULT_PILOTING_SKILL,
            bvLimit: 5000,
            budgetMode: 'force-limit' as const,
            publicTagsParam: null,
        };

        const query = buildUnitSearchQueryParameters(args);
        expect(query.bvMode).toBe('limit');
        expect(query.bvLimit).toBe(5000);

        const parsed = parseUnitSearchScalarUrlState(new URLSearchParams('bvMode=limit&bvLimit=5000'));
        expect(parsed.budgetMode).toBe('force-limit');
        expect(parsed.bvLimit).toBe(5000);
    });

    it('serializes a selected Force BV Limit mode even without a positive limit', () => {
        const query = buildUnitSearchQueryParameters({
            searchText: '',
            filterState: {},
            semanticKeys: new Set<string>(),
            selectedSort: '',
            selectedSortDirection: 'asc',
            expanded: false,
            gunnery: DEFAULT_GUNNERY_SKILL,
            piloting: DEFAULT_PILOTING_SKILL,
            bvLimit: 0,
            budgetMode: 'force-limit',
            publicTagsParam: null,
        });

        expect(query.bvMode).toBe('limit');
        expect(query.bvLimit).toBeNull();
    });

    it('round-trips BV normalization with required max delta', () => {
        const query = buildUnitSearchQueryParameters({
            searchText: '',
            filterState: {},
            semanticKeys: new Set<string>(),
            selectedSort: '',
            selectedSortDirection: 'asc',
            expanded: false,
            gunnery: DEFAULT_GUNNERY_SKILL,
            piloting: DEFAULT_PILOTING_SKILL,
            bvLimit: 0,
            budgetMode: 'bv-normalization',
            bvNormalization: {
                targetBv: { min: 1000, max: 2000 },
                gunnery: { min: 2, max: 4 },
                piloting: { min: 2, max: 5 },
                maxDelta: 1,
            },
            publicTagsParam: null,
        });

        expect(query).toEqual(jasmine.objectContaining({
            bvMode: 'normalize',
            bvMin: 1000,
            bvMax: 2000,
            gMin: 2,
            gMax: 4,
            pMin: 2,
            pMax: 5,
            maxDelta: 1,
        }));

        const parsed = parseUnitSearchScalarUrlState(new URLSearchParams(
            'bvMode=normalize&bvMin=1000&bvMax=2000&gMin=2&gMax=4&pMin=2&pMax=5&maxDelta=1',
        ));
        expect(parsed.budgetMode).toBe('bv-normalization');
        expect(parsed.bvNormalization).toEqual({
            targetBv: { min: 1000, max: 2000 },
            gunnery: { min: 2, max: 4 },
            piloting: { min: 2, max: 5 },
            maxDelta: 1,
        });
    });

    it('defaults missing normalization max delta to eight and rejects invalid values', () => {
        const baseQuery = 'bvMode=normalize&bvMin=1000&bvMax=2000&gMin=2&gMax=4&pMin=2&pMax=5';

        const parsedWithoutDelta = parseUnitSearchScalarUrlState(new URLSearchParams(baseQuery));
        expect(parsedWithoutDelta.budgetMode).toBe('bv-normalization');
        expect(parsedWithoutDelta.bvNormalization?.maxDelta).toBe(8);
        for (const maxDelta of ['-1', '9', '1.5', 'invalid']) {
            expect(parseUnitSearchScalarUrlState(new URLSearchParams(`${baseQuery}&maxDelta=${maxDelta}`)).budgetMode)
                .withContext(maxDelta)
                .toBeNull();
        }
    });

    it('preserves zero max delta in normalization URLs', () => {
        const parsed = parseUnitSearchScalarUrlState(new URLSearchParams(
            'bvMode=normalize&bvMin=1000&bvMax=2000&gMin=2&gMax=4&pMin=2&pMax=5&maxDelta=0',
        ));

        expect(parsed.bvNormalization?.maxDelta).toBe(0);
    });

    it('round-trips PV normalization including boundary values', () => {
        const query = buildUnitSearchQueryParameters({
            searchText: '',
            filterState: {},
            semanticKeys: new Set<string>(),
            selectedSort: '',
            selectedSortDirection: 'asc',
            expanded: false,
            gunnery: DEFAULT_GUNNERY_SKILL,
            piloting: DEFAULT_PILOTING_SKILL,
            bvLimit: 0,
            budgetMode: 'pv-normalization',
            pvNormalization: {
                targetPv: { min: 0, max: 9999 },
                skill: { min: 0, max: 8 },
            },
            publicTagsParam: null,
        });

        expect(query).toEqual(jasmine.objectContaining({
            bvMode: null,
            pvMode: 'normalize',
            pvMin: 0,
            pvMax: 9999,
            skillMin: 0,
            skillMax: 8,
        }));

        const parsed = parseUnitSearchScalarUrlState(new URLSearchParams(
            'pvMode=normalize&pvMin=0&pvMax=9999&skillMin=0&skillMax=8',
        ));
        expect(parsed.budgetMode).toBe('pv-normalization');
        expect(parsed.pvNormalization).toEqual({
            targetPv: { min: 0, max: 9999 },
            skill: { min: 0, max: 8 },
        });
        expect(parsed.bvNormalization).toBeNull();
    });

    it('rejects malformed PV normalization URL ranges', () => {
        const invalidQueries = [
            'pvMode=normalize&pvMin=2&pvMax=1&skillMin=0&skillMax=8',
            'pvMode=normalize&pvMin=-1&pvMax=1&skillMin=0&skillMax=8',
            'pvMode=normalize&pvMin=0&pvMax=10000&skillMin=0&skillMax=8',
            'pvMode=normalize&pvMin=0&pvMax=1&skillMin=5&skillMax=4',
            'pvMode=normalize&pvMin=0&pvMax=1&skillMin=0&skillMax=9',
            'pvMode=normalize&pvMin=0.5&pvMax=1&skillMin=0&skillMax=8',
        ];

        for (const query of invalidQueries) {
            const parsed = parseUnitSearchScalarUrlState(new URLSearchParams(query));
            expect(parsed.budgetMode).withContext(query).toBeNull();
            expect(parsed.pvNormalization).withContext(query).toBeNull();
        }
    });

    it('rejects conflicting explicit budget modes', () => {
        const bvNormalization = 'bvMode=normalize&bvMin=1000&bvMax=2000&gMin=2&gMax=4&pMin=2&pMax=5';
        const pvNormalization = 'pvMode=normalize&pvMin=20&pvMax=30&skillMin=3&skillMax=5';

        for (const query of [
            `${bvNormalization}&${pvNormalization}`,
            `${pvNormalization}&${bvNormalization}`,
            `bvMode=limit&bvLimit=5000&${pvNormalization}`,
        ]) {
            const parsed = parseUnitSearchScalarUrlState(new URLSearchParams(query));
            expect(parsed.budgetMode).withContext(query).toBeNull();
            expect(parsed.bvNormalization).withContext(query).toBeNull();
            expect(parsed.pvNormalization).withContext(query).toBeNull();
            expect(parsed.bvLimit).withContext(query).toBeNull();
        }
    });

    it('omits retained budget values when no mode is selected', () => {
        const query = buildUnitSearchQueryParameters({
            searchText: '',
            filterState: {},
            semanticKeys: new Set<string>(),
            selectedSort: '',
            selectedSortDirection: 'asc',
            expanded: false,
            gunnery: DEFAULT_GUNNERY_SKILL,
            piloting: DEFAULT_PILOTING_SKILL,
            bvLimit: 5000,
            budgetMode: null,
            publicTagsParam: null,
        });

        expect(query.bvMode).toBeNull();
        expect(query.bvLimit).toBeNull();
    });

    it('falls back to no mode for unknown or malformed normalization modes', () => {
        expect(parseUnitSearchScalarUrlState(new URLSearchParams('bvMode=unknown')).budgetMode).toBeNull();
        expect(parseUnitSearchScalarUrlState(new URLSearchParams(
            'bvMode=normalize&bvMin=1000&bvMax=2000&gMin=4&gMax=3&pMin=5&pMax=5',
        )).budgetMode).toBeNull();
    });

    it('round-trips boolean filters in compact filters', () => {
        const filterState: FilterState = {
            canon: {
                value: 'or',
                interactedWith: true,
            },
            published: {
                value: 'not',
                interactedWith: true,
            },
        };

        const queryParameters = buildUnitSearchQueryParameters({
            searchText: '',
            filterState,
            semanticKeys: new Set<string>(),
            selectedSort: '',
            selectedSortDirection: 'asc',
            expanded: false,
            gunnery: DEFAULT_GUNNERY_SKILL,
            piloting: DEFAULT_PILOTING_SKILL,
            bvLimit: 0,
            publicTagsParam: null,
        });

        expect(queryParameters.filters).toBe('canon:yes|published:no');

        const parsed = parseAndValidateCompactFiltersFromUrl(
            queryParameters.filters!,
            createDropdownDependencies(),
        );

        expect(parsed).toEqual(filterState);
    });

    it('quotes separator-heavy dropdown values when building filters params', () => {
        const filterState: FilterState = {
            'as.specials': {
                value: {
                    [SPECIAL]: { name: SPECIAL, state: 'or', count: 1 },
                },
                interactedWith: true,
            },
        };

        const queryParameters = buildUnitSearchQueryParameters({
            searchText: '',
            filterState,
            semanticKeys: new Set<string>(),
            selectedSort: '',
            selectedSortDirection: 'asc',
            expanded: false,
            gunnery: DEFAULT_GUNNERY_SKILL,
            piloting: DEFAULT_PILOTING_SKILL,
            bvLimit: 0,
            publicTagsParam: null,
        });

        expect(queryParameters.filters).toBe(`as.specials:"${SPECIAL}"`);
    });

    it('preserves legacy unquoted single dropdown values containing commas', () => {
        const parsed = parseAndValidateCompactFiltersFromUrl(
            `as.specials:${SPECIAL}`,
            createDropdownDependencies(),
        );

        expect(parsed['as.specials']).toEqual({
            value: {
                [SPECIAL]: { name: SPECIAL, state: 'or', count: 1 },
            },
            interactedWith: true,
        });
    });

    it('round-trips quoted multistate dropdown values with commas', () => {
        const filterState: FilterState = {
            'as.specials': {
                value: {
                    [SPECIAL]: { name: SPECIAL, state: 'or', count: 1 },
                    TAG: { name: 'TAG', state: 'not', count: 1 },
                },
                interactedWith: true,
            },
        };

        const queryParameters = buildUnitSearchQueryParameters({
            searchText: '',
            filterState,
            semanticKeys: new Set<string>(),
            selectedSort: '',
            selectedSortDirection: 'asc',
            expanded: false,
            gunnery: DEFAULT_GUNNERY_SKILL,
            piloting: DEFAULT_PILOTING_SKILL,
            bvLimit: 0,
            publicTagsParam: null,
        });

        const parsed = parseAndValidateCompactFiltersFromUrl(
            queryParameters.filters!,
            createDropdownDependencies(),
        );

        expect(parsed['as.specials']).toEqual({
            value: {
                [SPECIAL]: { name: SPECIAL, state: 'or', count: 1 },
                TAG: { name: 'TAG', state: 'not', count: 1 },
            },
            interactedWith: true,
        });
    });

    it('round-trips multistate era dropdown values in compact filters', () => {
        const filterState: FilterState = {
            era: {
                value: {
                    'Succession Wars': { name: 'Succession Wars', state: 'or', count: 1 },
                    Jihad: { name: 'Jihad', state: 'and', count: 1 },
                },
                interactedWith: true,
            },
        };

        const queryParameters = buildUnitSearchQueryParameters({
            searchText: '',
            filterState,
            semanticKeys: new Set<string>(),
            selectedSort: '',
            selectedSortDirection: 'asc',
            expanded: false,
            gunnery: DEFAULT_GUNNERY_SKILL,
            piloting: DEFAULT_PILOTING_SKILL,
            bvLimit: 0,
            publicTagsParam: null,
        });

        const parsed = parseAndValidateCompactFiltersFromUrl(
            queryParameters.filters!,
            createDropdownDependencies(),
        );

        expect(parsed['era']).toEqual({
            value: {
                'Succession Wars': { name: 'Succession Wars', state: 'or', count: 1 },
                Jihad: { name: 'Jihad', state: 'and', count: 1 },
            },
            interactedWith: true,
        });
    });
});
