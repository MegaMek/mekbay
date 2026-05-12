import {
    formationInheritsParentEffects,
    formationNameMatchesGroupName,
    getFormationDropdownDisplayName,
    getFormationNameMatchStrings,
    resolveFormationGameSystemText,
    type FormationTypeDefinition,
} from './formation-type.model';
import { GameSystem } from '../models/common.model';

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

describe('getFormationDropdownDisplayName', () => {
    it('adds an Aero suffix for squadron dropdown options', () => {
        expect(getFormationDropdownDisplayName(createFormation({ id: 'fire-support-squadron', name: 'Fire Support' })))
            .toBe('Fire Support [Aero]');
        expect(getFormationDropdownDisplayName(createFormation({ id: 'interceptor-squadron', name: 'Interceptor' })))
            .toBe('Interceptor [Aero]');
    });

    it('leaves non-squadron dropdown options unchanged', () => {
        expect(getFormationDropdownDisplayName(createFormation({ id: 'fire-support-lance', name: 'Fire Support' })))
            .toBe('Fire Support');
    });
});

describe('formationInheritsParentEffects', () => {
    it('defaults to false when inheritParentEffects is omitted', () => {
        expect(formationInheritsParentEffects(createFormation())).toBeFalse();
    });

    it('returns true only when inheritParentEffects is explicitly enabled', () => {
        expect(formationInheritsParentEffects(createFormation({ inheritParentEffects: true }))).toBeTrue();
    });
});

describe('resolveFormationGameSystemText', () => {
    it('returns static text unchanged', () => {
        expect(resolveFormationGameSystemText('Static bonus text.', GameSystem.ALPHA_STRIKE))
            .toBe('Static bonus text.');
    });

    it('resolves callback text using the provided game system', () => {
        const text = resolveFormationGameSystemText(
            gameSystem => gameSystem === GameSystem.ALPHA_STRIKE ? 'Alpha Strike bonus.' : 'Classic bonus.',
            GameSystem.CLASSIC,
        );

        expect(text).toBe('Classic bonus.');
    });
});