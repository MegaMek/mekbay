import { AmmoEquipment } from '../models/equipment.model';
import { getWeaponTypeCSSClass } from './equipment.util';

describe('getWeaponTypeCSSClass', () => {
    it('uses ammo category color classes for ammo equipment', () => {
        const ammo = new AmmoEquipment({
            id: 'AC Ammo',
            name: 'AC Ammo',
            type: 'ammo',
            ammo: { type: 'AC' }
        });

        expect(ammo.category).toBe('Ballistic');
        expect(getWeaponTypeCSSClass('X', ammo)).toBe('ammo ballistic');
    });

    it('uses ammo-specific classes for ammo-only categories', () => {
        const ammo = new AmmoEquipment({
            id: 'Inferno Bomb',
            name: 'Inferno Bomb',
            type: 'ammo',
            ammo: { type: 'BOMB', category: 'Bomb' }
        });

        expect(getWeaponTypeCSSClass('X', ammo)).toBe('ammo ammo-bomb');
    });

    it('falls back to special ammo styling without equipment data', () => {
        expect(getWeaponTypeCSSClass('X')).toBe('ammo ammo-special');
    });
});
