import { MiscEquipment, WeaponEquipment } from './equipment.model';
import { getMountedOneShotConsumed, MountedEquipment, MountedWeapon } from './mounted-equipment.model';

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
describe('MountedEquipment physical classification', () => {
    it('classifies intrinsic physical attacks', () => {
        const entry = new MountedEquipment({
            owner: null as never,
            id: 'punch',
            name: 'Punch',
            intrinsicPhysicalAttack: true,
        });

        expect(entry.isIntrinsicPhysicalAttack()).toBeTrue();
        expect(entry.isPhysicalWeapon()).toBeTrue();
    });

    it('classifies mounted physical equipment without treating it as intrinsic', () => {
        const entry = new MountedEquipment({
            owner: null as never,
            id: 'hatchet',
            name: 'Hatchet',
            equipment: new MiscEquipment({
                id: 'hatchet', name: 'Hatchet', type: 'misc', flags: ['F_CLUB', 'S_HATCHET'],
            }),
        });

        expect(entry.isIntrinsicPhysicalAttack()).toBeFalse();
        expect(entry.isPhysicalWeapon()).toBeTrue();
    });

    it('rejects ordinary equipment', () => {
        const entry = new MountedEquipment({
            owner: null as never,
            id: 'laser',
            name: 'Laser',
            equipment: new WeaponEquipment({
                id: 'laser', name: 'Laser', type: 'weapon', flags: ['F_ENERGY'],
                weapon: { ammoType: 'NA', damage: 5 },
            }),
        });

        expect(entry.isIntrinsicPhysicalAttack()).toBeFalse();
        expect(entry.isPhysicalWeapon()).toBeFalse();
    });

    it('normalizes ranged and physical weapon equipment to semantic runtime types', () => {
        const ranged = new WeaponEquipment({
            id: 'laser', name: 'Laser', type: 'weapon', flags: ['F_ENERGY'],
            weapon: { ammoType: 'NA', damage: 5 },
        });
        const physical = new WeaponEquipment({
            id: 'hatchet', name: 'Hatchet', type: 'weapon', flags: ['F_CLUB', 'S_HATCHET'],
        });

        expect(MountedEquipment.from({ owner: null as never, id: 'laser', name: 'Laser', equipment: ranged }))
            .toBeInstanceOf(MountedWeapon);
        const physicalEntry = MountedEquipment.from({
            owner: null as never, id: 'hatchet', name: 'Hatchet', equipment: physical,
        });
        expect(physicalEntry).not.toBeInstanceOf(MountedWeapon);
        expect(physicalEntry.isPhysicalWeapon()).toBeTrue();
    });
});

describe('MountedEquipment action availability', () => {
    it('delegates action availability to its owning unit', () => {
        const owner = jasmine.createSpyObj('CBTForceUnit', ['isEquipmentActionUnavailable']);
        owner.rules = {
            computeEntryState: () => ({ isDamaged: false, isDisabled: false, hitMod: 0 })
        };
        const entry = new MountedEquipment({ owner, id: 'laser', name: 'Laser' });
        owner.isEquipmentActionUnavailable.and.returnValue(false);

        expect(entry.isActionUnavailable()).toBeFalse();
        expect(owner.isEquipmentActionUnavailable).toHaveBeenCalledOnceWith(entry);

        owner.isEquipmentActionUnavailable.calls.reset();
        owner.isEquipmentActionUnavailable.and.returnValue(true);

        expect(entry.isActionUnavailable()).toBeTrue();
        expect(owner.isEquipmentActionUnavailable).toHaveBeenCalledOnceWith(entry);
    });

    it('is action-unavailable when structurally unavailable without consulting its owner', () => {
        const owner = jasmine.createSpyObj('CBTForceUnit', ['isEquipmentActionUnavailable']);
        owner.rules = {
            computeEntryState: () => ({ isDamaged: true, isDisabled: false, hitMod: 0 })
        };
        const entry = new MountedEquipment({ owner, id: 'laser', name: 'Laser' });

        expect(entry.isUnavailable()).toBeTrue();
        expect(entry.isActionUnavailable()).toBeTrue();
        expect(owner.isEquipmentActionUnavailable).not.toHaveBeenCalled();
    });
});

describe('MountedEquipment relationships', () => {
    const owner = {} as never;
    const entry = (id: string, entryOwner = owner) => new MountedEquipment({
        owner: entryOwner,
        id,
        name: id,
    });

    it('maintains reciprocal links when replacing and reparenting children', () => {
        const firstParent = entry('first-parent');
        const secondParent = entry('second-parent');
        const child = entry('child');
        const removed = entry('removed');
        firstParent.setLinkedEquipment([child, child, removed]);

        expect(firstParent.linkedWith).toEqual([child, removed]);
        expect(child.parent).toBe(firstParent);

        secondParent.setLinkedEquipment([child]);
        expect(firstParent.linkedWith).toEqual([removed]);
        expect(secondParent.linkedWith).toEqual([child]);
        expect(child.parent).toBe(secondParent);

        secondParent.setLinkedEquipment([]);
        expect(child.parent).toBeNull();
    });

    it('rejects self-links and cycles without partial mutation', () => {
        const parent = entry('parent');
        const child = entry('child');
        parent.setLinkedEquipment([child]);

        expect(() => parent.setLinkedEquipment([parent])).toThrowError('Equipment cannot link to itself');
        expect(() => child.setLinkedEquipment([parent])).toThrowError('Equipment links cannot contain cycles');
        expect(parent.linkedWith).toEqual([child]);
        expect(child.parent).toBe(parent);
    });

    it('detaches a child from its parent reciprocally', () => {
        const parent = entry('parent');
        const child = entry('child');
        parent.setLinkedEquipment([child]);

        child.detachFromParent();

        expect(parent.linkedWith).toEqual([]);
        expect(child.parent).toBeNull();
    });
});

