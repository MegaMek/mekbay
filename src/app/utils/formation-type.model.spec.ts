import {
    formationNameMatchesGroupName,
    getFormationNameMatchStrings,
    type FormationTypeDefinition,
} from './formation-type.model';

function createFormation(overrides: Partial<FormationTypeDefinition> = {}): FormationTypeDefinition {
    return {
        id: 'test-formation',
        name: 'Light Striker/Cavalry',
        description: 'Test formation.',
        minUnits: 3,
        ...overrides,
    };
}

describe('formationNameMatchesGroupName', () => {
    it('matches the display name as a whole phrase regardless of case', () => {
        const formation = createFormation();

        expect(formationNameMatchesGroupName(formation, '2nd LIGHT STRIKER/CAVALRY company')).toBeTrue();
    });

    it('matches configured aliases as whole phrases', () => {
        const formation = createFormation({
            nameAliases: ['Light Striker', 'Light Cavalry'],
        });

        expect(formationNameMatchesGroupName(formation, '2nd light striker company')).toBeTrue();
        expect(formationNameMatchesGroupName(formation, '2nd Light Cavalry Company')).toBeTrue();
    });

    it('rejects partial word matches', () => {
        const formation = createFormation({
            name: 'Striker/Cavalry',
            nameAliases: ['Striker', 'Cavalry'],
        });

        expect(formationNameMatchesGroupName(formation, 'Heavy Strikers')).toBeFalse();
        expect(formationNameMatchesGroupName(formation, '5th Cavalryman Detachment')).toBeFalse();
    });

    it('escapes punctuation in formation names', () => {
        const formation = createFormation({
            name: 'Anti-\'Mech',
        });

        expect(formationNameMatchesGroupName(formation, 'Urban anti-\'mech company')).toBeTrue();
    });
});

describe('getFormationNameMatchStrings', () => {
    it('includes the primary name and deduplicated aliases', () => {
        const formation = createFormation({
            nameAliases: ['Light Striker', 'Light Cavalry', 'Light Striker'],
        });

        expect(getFormationNameMatchStrings(formation)).toEqual([
            'Light Striker/Cavalry',
            'Light Striker',
            'Light Cavalry',
        ]);
    });
});