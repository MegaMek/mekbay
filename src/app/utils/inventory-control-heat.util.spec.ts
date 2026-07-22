import { MiscEquipment, WeaponEquipment } from '../models/equipment.model';
import { MountedEquipment } from '../models/mounted-equipment.model';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import { formatInventoryControlHeat, resolveInventoryControlHeat, resolveInventoryControlHeatEffect } from './inventory-control-heat.util';

describe('inventory-control heat resolution', () => {
    it('resolves model heat and applies typed effects once', () => {
        const entry = weapon(3);
        const applyHeatEffects = jasmine.createSpy('applyHeatEffects').and.returnValue({ value: 5, weakened: true });

        expect(resolveInventoryControlHeat(entry, { applyHeatEffects })).toBe(5);
        expect(resolveInventoryControlHeatEffect(entry, { applyHeatEffects })).toEqual({ value: 5, weakened: true });
        expect(applyHeatEffects).toHaveBeenCalledWith(entry, { value: 3, weakened: false });
    });

    it('clamps negative effects and rejects non-finite effects', () => {
        expect(resolveInventoryControlHeat(weapon(3), { applyHeatEffects: () => ({ value: -1, weakened: false }) })).toBe(0);
        expect(resolveInventoryControlHeat(weapon(3), { applyHeatEffects: () => ({ value: Number.NaN, weakened: false }) })).toBeNull();
    });

    it('returns null for non-weapon equipment', () => {
        const entry = new MountedEquipment({
            owner: {} as CBTForceUnit,
            id: 'misc',
            name: 'Misc',
            equipment: new MiscEquipment({ id: 'misc', name: 'Misc', type: 'misc' })
        });

        expect(resolveInventoryControlHeat(entry)).toBeNull();
    });

    it('returns null when mounted equipment data is missing', () => {
        const entry = new MountedEquipment({
            owner: {} as CBTForceUnit,
            id: 'missing',
            name: 'Missing'
        });

        expect(resolveInventoryControlHeat(entry)).toBeNull();
    });

    it('accepts zero heat from equipment data', () => {
        expect(resolveInventoryControlHeat(weapon(0))).toBe(0);
    });

    it('formats integer, fractional, and typed suffixed heat without presentation parsing', () => {
        expect(formatInventoryControlHeat(0)).toBe('—');
        expect(formatInventoryControlHeat(5)).toBe('5');
        expect(formatInventoryControlHeat(2.5)).toBe('2.5');
        expect(formatInventoryControlHeat(2, '*')).toBe('2*');
        expect(formatInventoryControlHeat(1, '', 6)).toBe('1');
        expect(formatInventoryControlHeat(2, '*', 2)).toBe('2*');
    });
});

function weapon(heat: number): MountedEquipment {
    const equipment = new WeaponEquipment({
        id: 'laser',
        name: 'Laser',
        type: 'weapon',
        weapon: { heat }
    });
    return new MountedEquipment({
        owner: {} as CBTForceUnit,
        id: equipment.id,
        name: equipment.name,
        equipment
    });
}