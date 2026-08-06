import { projectRuleModifiers, sortPSRModifiers, type UnitRuleModifier } from './unit-type-rules';

describe('sortPSRModifiers', () => {
    it('places negative modifiers first and sorts each group by displayed reason', () => {
        const modifiers = [
            { reason: 'Zeta', pilotCheck: 2 },
            { reason: 'Bravo', pilotCheck: -1 },
            { reason: 'Alpha', pilotCheck: 1 },
            { reason: 'Ignored reason', modifierReason: 'Alpha bonus', pilotCheck: -2 },
        ];

        expect(sortPSRModifiers(modifiers).map(modifier => modifier.reason)).toEqual([
            'Ignored reason',
            'Bravo',
            'Alpha',
            'Zeta',
        ]);
    });
});

describe('projectRuleModifiers', () => {
    const modifiers: UnitRuleModifier[] = [
        { label: 'Ranged', values: { ranged: 1 } },
        { label: 'Physical and PSR', values: { physical: 2, psr: 3 }, weakened: true },
        { label: 'All', values: { ranged: 4, physical: 5, psr: 6 } },
        { label: 'Lost bonus', values: { ranged: 0 }, weakened: true },
    ];

    it('projects only modifiers declared for a domain', () => {
        expect(projectRuleModifiers(modifiers, 'physical')).toEqual([
            { label: 'Physical and PSR', modifier: 2, weakened: true },
            { label: 'All', modifier: 5 },
        ]);
        expect(projectRuleModifiers(modifiers, 'psr')).toEqual([
            { label: 'Physical and PSR', modifier: 3, weakened: true },
            { label: 'All', modifier: 6 },
        ]);
    });

    it('preserves zero-value weakened modifiers', () => {
        expect(projectRuleModifiers(modifiers, 'ranged')).toEqual([
            { label: 'Ranged', modifier: 1 },
            { label: 'All', modifier: 4 },
            { label: 'Lost bonus', modifier: 0, weakened: true },
        ]);
    });
});