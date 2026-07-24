import { AmmoEquipment, WeaponEquipment } from '../models/equipment.model';
import { MountedAmmo, MountedWeapon } from '../models/mounted-equipment.model';
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

    it('does not synthesize ammo for an unmaterialized one-shot weapon', () => {
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

        expect(summary).toEqual({ tracksAmmo: true, remaining: 0, total: 0, options: [] });
    });

    it('uses a materialized intrinsic round as a normal ammo option', () => {
        const weapon = new WeaponEquipment({
            id: 'ISBALRM5OS', name: 'LRM 5 (OS)', type: 'weapon', flags: ['F_ONE_SHOT', 'F_BA_WEAPON'],
            weapon: { ammoType: 'LRM', rackSize: 5, damage: 'cluster' },
        });
        const standard = new AmmoEquipment({
            id: 'IS BA Ammo LRM-5', name: 'BA LRM 5 Ammo', type: 'ammo', flags: ['F_BATTLEARMOR'],
            ammo: { type: 'LRM', rackSize: 5, shots: 1, munitionType: ['M_STANDARD'] },
        });
        const incendiary = new AmmoEquipment({
            id: 'IS BA Ammo LRM-5 w/ Incendiary', name: 'BA LRM 5 Incendiary Ammo', type: 'ammo', flags: ['F_BATTLEARMOR'],
            ammo: { type: 'LRM', rackSize: 5, shots: 1, munitionType: ['M_STANDARD', 'M_INCENDIARY_LRM'] },
        });
        const inventory: Array<MountedWeapon | MountedAmmo> = [];
        const owner = {
            getInventory: () => inventory,
            getCritSlots: () => [],
            isEquipmentUnavailable: () => false,
        } as unknown as CBTForceUnit;
        const mountedWeapon = new MountedWeapon({ owner, id: 'lrm-os', name: weapon.internalName, equipment: weapon });
        const intrinsicAmmo = new MountedAmmo({
            owner,
            id: 'lrm-os:intrinsic-one-shot-ammo',
            name: standard.internalName,
            equipment: standard,
            parent: mountedWeapon,
            totalAmmo: 1,
            intrinsicOneShotAmmo: true,
        });
        intrinsicAmmo.ammo = incendiary.internalName;
        mountedWeapon.linkedWith = [intrinsicAmmo];
        inventory.push(mountedWeapon, intrinsicAmmo);

        const summary = getInventoryControlModeAmmoSummary(mountedWeapon, {
            [standard.internalName]: standard,
            [incendiary.internalName]: incendiary,
        });

        expect(summary).toEqual(jasmine.objectContaining({ tracksAmmo: true, remaining: 1, total: 1 }));
        expect(summary.options).toEqual([jasmine.objectContaining({
            id: `inventory:${intrinsicAmmo.id}`,
            ammo: incendiary,
            total: 1,
        })]);
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
