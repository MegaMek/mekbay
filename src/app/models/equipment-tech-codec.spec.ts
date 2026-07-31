import { approx } from './entity/types/tech';
import { decodeEquipmentTechData } from './equipment-tech-codec';

describe('equipment technology codec', () => {
    it('decodes wire-format technology dates', () => {
        expect(decodeEquipmentTechData({
            base: 'IS',
            rating: 'E',
            level: 'Standard',
            availability: { sl: 'X', sw: 'X', clan: 'E', da: 'D' },
            advancement: {
                is: { prototype: '~3055', production: '3067', common: '3072' },
            },
        })).toEqual({
            base: 'IS',
            rating: 'E',
            level: 'Standard',
            availability: { sl: 'X', sw: 'X', clan: 'E', da: 'D' },
            advancement: {
                is: {
                    prototype: approx(3055),
                    production: 3067,
                    common: 3072,
                    extinct: undefined,
                    reintroduced: undefined,
                },
                clan: undefined,
            },
        });
    });
});
