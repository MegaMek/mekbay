import type { UnitComponent } from '../models/units.model';
import { calculateWeightedMaxRange, getMaxRangeFromComponents } from './unit-range.util';

function createComponent(overrides: Partial<UnitComponent>): UnitComponent {
    return {
        id: 'weapon',
        q: 1,
        n: 'Weapon',
        t: 'E',
        p: 1,
        l: 'RA',
        ...overrides,
    };
}

describe('unit-range.util', () => {
    it('calculates max range and rounds weighted max range to an existing bracket', () => {
        const components = [
            createComponent({ id: 'a', n: 'Weapon A', md: '10', r: '3/5/10' }),
            createComponent({ id: 'b', n: 'Weapon B', md: '10', r: '3/6/8' }),
            createComponent({ id: 'c', n: 'Weapon C', md: '2', r: '8/16/24' }),
        ];

        expect(getMaxRangeFromComponents(components)).toBe(24);
        expect(calculateWeightedMaxRange({ subtype: 'BattleMek', internal: 5, comp: components })).toBe(10);
    });

    it('uses the average numeric damage for variable-damage weapons', () => {
        const components = [
            createComponent({ id: 'a', n: 'Weapon A', md: '5', r: '3/6/9' }),
            createComponent({ id: 'b', n: 'Weapon B', md: '2', q: 2, r: '8/16/24' }),
            createComponent({ id: 'c', n: 'Weapon C', md: 'variable', r: '4/8/12' }),
        ];

        expect(calculateWeightedMaxRange({ subtype: 'BattleMek', internal: 5, comp: components })).toBe(12);
    });

    it('applies battle armor squad scaling when weighting squad-mounted weapons', () => {
        const components = [
            createComponent({ id: 'a', n: 'Squad Weapon', md: '2', p: 0, l: 'RT', r: '2/4/6' }),
            createComponent({ id: 'b', n: 'Support Weapon', md: '6', p: 0, l: 'SSW', r: '4/8/12' }),
        ];

        expect(calculateWeightedMaxRange({ subtype: 'Battle Armor', internal: 4, comp: components })).toBe(6);
    });

    it('rounds up when the next bracket is closer', () => {
        const components = [
            createComponent({ id: 'a', n: 'Weapon A', md: '1', r: '3/5/10' }),
            createComponent({ id: 'b', n: 'Weapon B', md: '3', r: '8/16/24' }),
        ];

        expect(calculateWeightedMaxRange({ subtype: 'BattleMek', internal: 5, comp: components })).toBe(24);
    });
});