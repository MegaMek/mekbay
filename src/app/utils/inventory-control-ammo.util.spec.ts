import { AmmoEquipment, WeaponEquipment } from '../models/equipment.model';
import { MountedWeapon } from '../models/mounted-equipment.model';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import { getInventoryControlModeAmmoSummary, resolveInventoryControlSelectedAmmoOption, type InventoryControlAmmoOption } from './inventory-control.util';

describe('inventory-control ammo selection', () => {
    it('uses stable source order when no choice is persisted', () => {
        const first = option('standard:first', 'Standard', 1);
        const second = option('standard:second', 'Standard', 10);

        expect(resolveInventoryControlSelectedAmmoOption([first, second])).toBe(first);
    });

    it('fails over to a usable bin of the same munition', () => {
        const depleted = option('standard:first', 'Standard', 0);
        const sameMunition = option('standard:second', 'Standard', 2);
        const otherMunition = option('precision:first', 'Precision', 10);

        expect(resolveInventoryControlSelectedAmmoOption(
            [depleted, otherMunition, sameMunition],
            depleted.id
        )).toBe(sameMunition);
    });

    it('keeps an explicit depleted munition when no same-munition bin is usable', () => {
        const depleted = option('standard:first', 'Standard', 0);
        const otherMunition = option('precision:first', 'Precision', 10);

        expect(resolveInventoryControlSelectedAmmoOption([depleted, otherMunition], depleted.id)).toBe(depleted);
    });

    it('keeps the only option even when destroyed', () => {
        const destroyed = { ...option('standard:first', 'Standard', 0), destroyed: true, disabled: true };

        expect(resolveInventoryControlSelectedAmmoOption([destroyed], destroyed.id)).toBe(destroyed);
    });

    it('attaches catalog ammo to a built-in one-shot option without mounted ammo', () => {
        const weapon = new WeaponEquipment({
            id: 'BAMineLauncher', name: 'Pop-up Mine', type: 'weapon', flags: ['F_ONE_SHOT'],
            weapon: { ammoType: 'MINE', rackSize: 1, damage: 'special' }
        });
        const ammo = new AmmoEquipment({
            id: 'BA-Mine Launcher Ammo', name: 'Pop-up Mine Ammo', type: 'ammo',
            ammo: { type: 'MINE', rackSize: 1, damagePerShot: 4, munitionType: ['M_STANDARD'] }
        });
        const owner = {
            getCritSlots: () => [],
            getInventory: () => [],
            isEquipmentUnavailable: () => false
        } as unknown as CBTForceUnit;
        const mounted = new MountedWeapon({ owner, id: weapon.id, name: weapon.name, equipment: weapon });

        const summary = getInventoryControlModeAmmoSummary(mounted, { [ammo.id]: ammo }, {}, null);

        expect(summary).toEqual(jasmine.objectContaining({ tracksAmmo: true, remaining: 1, total: 1 }));
        expect(summary.options[0].ammo).toBe(ammo);
    });
});

function option(id: string, internalName: string, remaining: number): InventoryControlAmmoOption {
    return {
        id,
        label: internalName,
        ammo: new AmmoEquipment({
            id: internalName,
            name: internalName,
            type: 'ammo',
            ammo: { type: 'AC', shots: 10 }
        }),
        remaining,
        total: 10,
        destroyed: false,
        disabled: false
    };
}
