import type { Unit } from '../models/units.model';
import { DEFAULT_GUNNERY_SKILL, DEFAULT_PILOTING_SKILL } from '../models/crew-member.model';
import type { FilterState } from '../services/unit-search-filters.model';
import { buildUnitSearchQueryParameters, parseAndValidateCompactFiltersFromUrl } from './unit-search-url-filters.util';
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
        getExternalDropdownValues: () => {
            return [];
        },
        units: [] as readonly Unit[],
        getProperty: () => undefined,
    };
}

describe('unit search URL filters', () => {
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
            restrictionListsParam: null,
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
            restrictionListsParam: null,
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
            restrictionListsParam: null,
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

    it('includes active restriction list refs in query params', () => {
        const queryParameters = buildUnitSearchQueryParameters({
            searchText: '',
            filterState: {},
            semanticKeys: new Set<string>(),
            selectedSort: '',
            selectedSortDirection: 'asc',
            expanded: false,
            gunnery: DEFAULT_GUNNERY_SKILL,
            piloting: DEFAULT_PILOTING_SKILL,
            bvLimit: 0,
            publicTagsParam: null,
            restrictionListsParam: 'custom-local-profile',
        });

        expect(queryParameters.rl).toBe('custom-local-profile');
    });
});