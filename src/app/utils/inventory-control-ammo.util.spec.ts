// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AmmoEquipment, WeaponEquipment } from '../models/equipment.model';
import { EquipmentRegistry } from '../models/equipment-lookup';
import { MountedAmmo, MountedWeapon } from '../models/mounted-equipment.model';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import { createEmptyUnit } from '../testing/unit-test-helpers';
import { getInventoryControlAmmoProfileId, getInventoryControlModeAmmoSummary, resolveInventoryControlSelectedAmmoOption, type InventoryControlAmmoOption } from './inventory-control.util';

describe('inventory-control ammo selection', () => {
    it('uses stable source order when no choice is persisted', () => {
        const first = option('standard:first', 'Standard', 1);
        const second = option('standard:second', 'Standard', 10);

        expect(resolveInventoryControlSelectedAmmoOption([first, second])).toBe(first);
    });

    it('uses the stable first profile when another profile is the only one with remaining shots', () => {
        const depletedStandard = option('standard:first', 'Standard', 0);
        const usablePrecision = option('precision:first', 'Precision', 10);

        expect(resolveInventoryControlSelectedAmmoOption([depletedStandard, usablePrecision]))
            .toBe(depletedStandard);
    });

    it('fails over to a usable bin of the same munition', () => {
        const depleted = option('standard:first', 'Standard', 0);
        const sameMunition = option('standard:second', 'Standard', 2);
        const otherMunition = option('precision:first', 'Precision', 10);

        expect(resolveInventoryControlSelectedAmmoOption(
            [depleted, otherMunition, sameMunition],
            depleted.profileId,
            depleted.id,
        )).toBe(sameMunition);
    });

    it('keeps an explicit depleted munition when no same-munition bin is usable', () => {
        const depleted = option('standard:first', 'Standard', 0);
        const otherMunition = option('precision:first', 'Precision', 10);

        expect(resolveInventoryControlSelectedAmmoOption(
            [depleted, otherMunition],
            depleted.profileId,
            depleted.id,
        )).toBe(depleted);
    });

    it('keeps the only option even when destroyed', () => {
        const destroyed = { ...option('standard:first', 'Standard', 0), destroyed: true, disabled: true };

        expect(resolveInventoryControlSelectedAmmoOption(
            [destroyed],
            destroyed.profileId,
            destroyed.id,
        )).toBe(destroyed);
    });

    it('keeps the selected profile when its preferred source disappears', () => {
        const movedSource = option('standard:new-location', 'Standard', 4);
        const otherMunition = option('precision:first', 'Precision', 10);

        expect(resolveInventoryControlSelectedAmmoOption(
            [otherMunition, movedSource],
            movedSource.profileId,
            'standard:removed-location',
        )).toBe(movedSource);
    });

    it('does not substitute another source profile for an authoritative selected profile', () => {
        const depletedStandard = option('standard:first', 'Standard', 0);
        const usablePrecision = option('precision:first', 'Precision', 10);

        expect(resolveInventoryControlSelectedAmmoOption(
            [depletedStandard, usablePrecision],
            'removed-profile',
            'removed-source',
        )).toBeUndefined();
    });

    it('uses identical profile keys for equivalent ammo regardless of source identity', () => {
        const first = option('standard:left', 'Standard', 1);
        const second = option('standard:right', 'Standard', 10);

        expect(getInventoryControlAmmoProfileId(first.ammo!))
            .toBe(getInventoryControlAmmoProfileId(second.ammo!));
    });

    it('resolves options from snapshot profile IDs without inspecting ammo definitions', () => {
        const depleted = option('standard:first', 'Standard', 0);
        const usable = option('standard:second', 'Standard', 10);
        const depletedIterationCount = countMunitionIterations(depleted.ammo!);
        const usableIterationCount = countMunitionIterations(usable.ammo!);

        expect(resolveInventoryControlSelectedAmmoOption(
            [depleted, usable],
            depleted.profileId,
            depleted.id,
        )).toBe(usable);
        expect(depletedIterationCount()).toBe(0);
        expect(usableIterationCount()).toBe(0);
    });

    it('uses one stable profile for multiple bins sharing an ammo definition', () => {
        const weapon = new WeaponEquipment({
            id: 'AC5', name: 'AC/5', type: 'weapon',
            weapon: { ammoType: 'AC', rackSize: 5, damage: 5 }
        });
        const ammo = new AmmoEquipment({
            id: 'AC5 Ammo', name: 'AC/5 Ammo', type: 'ammo',
            ammo: { type: 'AC', rackSize: 5, shots: 20, munitionType: ['M_STANDARD'] }
        });
        const inventory: Array<MountedWeapon | MountedAmmo> = [];
        const owner = {
            getInventory: () => inventory,
            getCritSlots: () => [],
            getEquipmentStatus: () => 'available' as const,
            isEquipmentOperational: () => true,
        } as unknown as CBTForceUnit;
        const mountedWeapon = new MountedWeapon({ owner, id: 'ac5', name: weapon.name, equipment: weapon });
        inventory.push(
            mountedWeapon,
            new MountedAmmo({ owner, id: 'ammo:left', name: ammo.name, equipment: ammo, totalAmmo: 20 }),
            new MountedAmmo({ owner, id: 'ammo:right', name: ammo.name, equipment: ammo, totalAmmo: 20 }),
        );
        const summary = getInventoryControlModeAmmoSummary(
            mountedWeapon,
            new EquipmentRegistry({ [ammo.internalName]: ammo }),
            {},
            null,
        );

        expect(summary.options[0].profileId).toBe('AC5 Ammo||M_STANDARD');
    });

    it('sorts and normalizes fields when creating an ammo profile ID', () => {
        const ammo = new AmmoEquipment({
            id: 'Standard',
            name: 'Standard',
            type: 'ammo',
            ammo: {
                type: 'AC',
                shots: 10,
                subMunition: ' Artemis ',
                munitionType: ['M_STANDARD', 'M_CLUSTER']
            }
        });

        expect(getInventoryControlAmmoProfileId(ammo)).toBe('Standard|artemis|M_CLUSTER,M_STANDARD');
    });

    it('handles null and undefined submunition data', () => {
        for (const subMunition of [null, undefined]) {
            const ammo = option('standard:missing-submunition', 'Standard', 1).ammo!;
            (ammo.ammo as { subMunition: string | null | undefined }).subMunition = subMunition;

            expect(getInventoryControlAmmoProfileId(ammo)).toBe('Standard||');
        }
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
            isEquipmentOperational: () => true
        } as unknown as CBTForceUnit;
        const mounted = new MountedWeapon({ owner, id: weapon.id, name: weapon.name, equipment: weapon });

        const summary = getInventoryControlModeAmmoSummary(mounted, new EquipmentRegistry({ [ammo.id]: ammo }), {}, null);

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
            getUnit: () => createEmptyUnit({ subtype: 'Battle Armor' }),
            getEquipmentStatus: () => 'available' as const,
            isEquipmentOperational: () => true,
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

        const summary = getInventoryControlModeAmmoSummary(mountedWeapon, new EquipmentRegistry({
            [standard.internalName]: standard,
            [incendiary.internalName]: incendiary,
        }));

        expect(summary).toEqual(jasmine.objectContaining({ tracksAmmo: true, remaining: 1, total: 1 }));
        expect(summary.options).toEqual([jasmine.objectContaining({
            id: `inventory:${intrinsicAmmo.id}`,
            ammo: incendiary,
            total: 1,
        })]);
    });
});

function option(id: string, internalName: string, remaining: number): InventoryControlAmmoOption {
    const ammo = new AmmoEquipment({
        id: internalName,
        name: internalName,
        type: 'ammo',
        ammo: { type: 'AC', shots: 10 }
    });
    return {
        id,
        profileId: getInventoryControlAmmoProfileId(ammo),
        label: internalName,
        ammo,
        remaining,
        total: 10,
        destroyed: false,
        disabled: false
    };
}

function countMunitionIterations(ammo: AmmoEquipment): () => number {
    const originalIterator = ammo.munitionType[Symbol.iterator].bind(ammo.munitionType);
    let count = 0;
    Object.defineProperty(ammo.munitionType, Symbol.iterator, {
        configurable: true,
        value: () => {
            count++;
            return originalIterator();
        }
    });
    return () => count;
}
