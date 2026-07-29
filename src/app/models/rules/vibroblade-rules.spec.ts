import { EquipmentFlag } from '../equipment-flags.type';
import { Equipment, type EquipmentRawData } from '../equipment.model';
import { getVibrobladeHeat, getVibrobladeProfile } from './vibroblade-rules';

function equipment(type: EquipmentRawData['type'], flags: EquipmentFlag[]): Equipment {
    return new Equipment({ id: flags.join('-'), name: 'Test Equipment', type, flags });
}

describe('vibroblade rules', () => {
    it('returns the active damage and heat for every Vibroblade size', () => {
        const profiles = [
            ['S_VIBRO_SMALL', 7, 3],
            ['S_VIBRO_MEDIUM', 10, 5],
            ['S_VIBRO_LARGE', 14, 7],
        ] as const;

        for (const [size, activeDamage, activeHeat] of profiles) {
            const blade = equipment('misc', ['F_CLUB', size]);
            expect(getVibrobladeProfile(blade)).withContext(size).toEqual({
                activeDamage,
                activeHeat,
            });
            expect(getVibrobladeHeat(blade)).withContext(size).toBe(activeHeat);
        }
    });

    it('rejects clubs without a Vibroblade size and size flags without club semantics', () => {
        expect(getVibrobladeProfile(equipment('misc', ['F_CLUB', 'S_HATCHET']))).toBeNull();
        expect(getVibrobladeProfile(equipment('misc', ['S_VIBRO_SMALL']))).toBeNull();
    });

    it('uses the largest profile when malformed data contains multiple size flags', () => {
        const malformed = equipment('misc', [
            'F_CLUB', 'S_VIBRO_SMALL', 'S_VIBRO_MEDIUM', 'S_VIBRO_LARGE',
        ]);

        expect(getVibrobladeProfile(malformed)?.activeDamage).toBe(14);
        expect(getVibrobladeHeat(malformed)).toBe(7);
    });
});