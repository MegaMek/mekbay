import type { Unit } from '../models/units.model';
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

            return [];
        },
        getExternalDropdownValues: (filterKey: string) => {
            return [];
        },
        units: [] as readonly Unit[],
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

    it('treats table view as expanded without requiring a redundant expanded parameter', () => {
        const parsed = parseUnitSearchScalarUrlState(new URLSearchParams('view=table'));

        expect(parsed.viewMode).toBe('table');
        expect(parsed.expanded).toBeTrue();
    });

    it('prefers an explicit valid URL view over the persisted preference', () => {
        expect(resolveInitialUnitSearchViewMode(new URLSearchParams('view=table'), 'card')).toBe('table');
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
        expect(buildUnitSearchQueryParameters({ ...baseArgs, viewMode: 'table', expanded: true })).toEqual(jasmine.objectContaining({
            view: 'table',
            expanded: null,
        }));
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