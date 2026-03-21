import { sortAvailableDropdownOptions, sortDropdownOptionObjects } from './unit-search-dropdown-sort.util';

describe('unit-search-dropdown-sort', () => {
    it('applies predefined wildcard groups with natural ordering', () => {
        const result = sortAvailableDropdownOptions(
            ['Ultra Light 10', 'Medium', 'Ultra Light 2', 'Heavy'],
            ['Ultra Light*', 'Medium', 'Heavy'],
        );

        expect(result).toEqual(['Ultra Light 2', 'Ultra Light 10', 'Medium', 'Heavy']);
    });

    it('reorders option objects without dropping payload fields', () => {
        const result = sortDropdownOptionObjects(
            [
                { name: 'Option 10', available: true },
                { name: 'Option 2', available: false },
            ],
            ['Option*'],
        );

        expect(result).toEqual([
            { name: 'Option 2', available: false },
            { name: 'Option 10', available: true },
        ]);
    });
});