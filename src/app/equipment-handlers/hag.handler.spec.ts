import { MiscEquipment, WeaponEquipment, type WeaponType } from '../models/equipment.model';
import { MountedEquipment, MountedWeapon } from '../models/mounted-equipment.model';
import type { HandlerContext } from '../services/equipment-interaction-registry.service';
import { INVENTORY_CONTROL_MODE_STATE } from '../utils/inventory-control.util';
import { HAG_FLAK_MODE, HAG_STANDARD_MODE, HagHandler, selectedHagMode } from './hag.handler';

function owner() {
    return {
        setInventoryEntry: jasmine.createSpy('setInventoryEntry'),
        rules: {
            computeEntryState: () => ({ isDamaged: false, isDisabled: false, hitMod: 0 })
        }
    } as never;
}

function hag(mode?: string): MountedWeapon {
    return new MountedWeapon({
        owner: owner(),
        id: 'CLHAG20',
        name: 'HAG/20',
        states: mode ? new Map([[INVENTORY_CONTROL_MODE_STATE, mode]]) : undefined,
        equipment: new WeaponEquipment({
            id: 'CLHAG20',
            name: 'HAG/20',
            type: 'weapon',
            flags: ['F_HAG', 'F_BALLISTIC', 'F_DIRECT_FIRE', 'F_EXPLOSIVE'],
            weapon: {
                ammoType: 'HAG',
                damage: 'cluster',
                rackSize: 20,
                ranges: [8, 16, 24, 32]
            }
        })
    });
}

function context(): HandlerContext {
    return {} as HandlerContext;
}

describe('HagHandler', () => {
    const handler = new HagHandler();

    it('offers STD and FLAK modes and defaults invalid state to STD', () => {
        const entry = hag('invalid');

        expect(selectedHagMode(entry)).toBe(HAG_STANDARD_MODE);
        expect(handler.getChoices(entry, context())).toEqual([jasmine.objectContaining({
            label: 'Mode',
            value: HAG_STANDARD_MODE,
            displayType: 'dropdown',
            choices: [
                { label: 'STD', value: HAG_STANDARD_MODE },
                { label: 'FLAK', value: HAG_FLAK_MODE }
            ]
        })]);
    });

    it('persists the selected mode through the inventory-control state', () => {
        const entry = hag();

        expect(handler.handleSelection(entry, { label: 'FLAK', value: HAG_FLAK_MODE }, context())).toBeTrue();

        expect(entry.states.get(INVENTORY_CONTROL_MODE_STATE)).toBe(HAG_FLAK_MODE);
        expect(entry.owner.setInventoryEntry).toHaveBeenCalledWith(entry);
    });

    it('keeps DB only in STD and replaces it with F in FLAK', () => {
        const baseTypes = new Set<WeaponType>(['C', 'DB', 'F', 'X']);

        expect(handler.applyInventoryControlWeaponTypes(hag(HAG_STANDARD_MODE), baseTypes, context()))
            .toEqual(new Set<WeaponType>(['C', 'DB', 'X']));
        expect(handler.applyInventoryControlWeaponTypes(hag(HAG_FLAK_MODE), baseTypes, context()))
            .toEqual(new Set<WeaponType>(['C', 'F', 'X']));
        expect(baseTypes).toEqual(new Set<WeaponType>(['C', 'DB', 'F', 'X']));
    });

    it('adds a -1 to-hit adjustment only in FLAK mode', () => {
        expect(handler.getToHitAdjustments(hag(HAG_STANDARD_MODE), {}, context())).toEqual([]);
        expect(handler.getToHitAdjustments(hag(HAG_FLAK_MODE), {}, context()))
            .toEqual([{ kind: 'add', value: -1 }]);
    });

    it('requires both the F_HAG registry flag and weapon equipment', () => {
        const hagMisc = new MountedEquipment({
            owner: owner(),
            id: 'misc-hag',
            name: 'Misc HAG',
            equipment: new MiscEquipment({ id: 'misc-hag', name: 'Misc HAG', type: 'misc', flags: ['F_HAG'] })
        });

        expect(handler.applicableTo(hag())).toBeTrue();
        expect(handler.applicableTo(hagMisc)).toBeFalse();
        expect(handler.flags).toEqual(['F_HAG']);
    });
});
