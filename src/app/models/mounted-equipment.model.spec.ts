import { WeaponEquipment } from './equipment.model';
import { getMountedOneShotConsumed, MountedEquipment } from './mounted-equipment.model';

describe('mounted one-shot accounting', () => {
    const oneShotWeapon = new WeaponEquipment({
        id: 'OneShotWeapon',
        name: 'One-Shot Weapon',
        type: 'weapon',
        flags: ['F_ONE_SHOT'],
        weapon: { ammoType: 'AC', rackSize: 2 },
    });

    it('uses the weapon model capacity and clamps consumed rounds', () => {
        const entry = new MountedEquipment({
            owner: null as never,
            id: 'OneShotWeapon@RA#0',
            name: oneShotWeapon.internalName,
            equipment: oneShotWeapon,
            consumed: 4,
        });

        expect(getMountedOneShotConsumed(entry)).toBe(1);
    });

    it('uses critical-slot consumption before direct inventory state', () => {
        const entry = new MountedEquipment({
            owner: null as never,
            id: 'OneShotWeapon@RA#0',
            name: oneShotWeapon.internalName,
            equipment: oneShotWeapon,
            consumed: 0,
            critSlots: [{ id: 'slot', consumed: 1 }],
        });

        expect(getMountedOneShotConsumed(entry)).toBe(1);
    });

    it('returns zero for non-one-shot equipment', () => {
        const entry = new MountedEquipment({
            owner: null as never,
            id: 'Unknown@RA#0',
            name: 'Unknown',
        });

        expect(getMountedOneShotConsumed(entry)).toBe(0);
    });
});