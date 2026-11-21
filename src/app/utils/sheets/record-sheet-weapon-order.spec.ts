// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestSupportTankEntity, TestTankEntity } from '../../models/entity/testing/test-entities';
import { addTestEquipment } from '../../models/entity/testing/test-mounted-equipment';
import { MiscEquipment, WeaponEquipment } from '../../models/equipment.model';
import { vehicleHasChargeAttack } from '../../models/rules/vehicle-runtime-rules';
import { recordSheetFeatures } from './record-sheet-features';
import { recordSheetInventoryMountName } from './record-sheet-inventory-equipment';
import { recordSheetInventoryWeaponMounts } from './record-sheet-svg-rendering';

const ids = (mounts: readonly { readonly mountId: string }[]) => mounts.map(mount => mount.mountId);

const weapon = (id: string, ranges: readonly number[], heat = 1) => new WeaponEquipment({
    id, name: id, shortName: id, type: 'weapon', weapon: { heat, damage: 5, ranges: [...ranges] },
});

describe('record-sheet weapon order', () => {
    it('ranks by long, then medium, then short range, then heat, as MegaMek does', () => {
        const entity = new TestTankEntity();
        const pulse = addTestEquipment(entity, weapon('Medium Pulse Laser', [2, 4, 6], 4), { location: 'Front' });
        const arrow = addTestEquipment(entity, weapon('Arrow IV', [1, 2, 8], 10), { location: 'Front' });
        const hot = addTestEquipment(entity, weapon('Hot Laser', [2, 4, 6], 6), { location: 'Front' });

        // Arrow IV's long 8 beats the pulse laser's 6, though its short range is shorter (Pilum)
        expect(ids(recordSheetInventoryWeaponMounts(entity))).toEqual(ids([arrow, hot, pulse]));
    });

    it('lists body-mounted weapons after equal ones elsewhere, as MegaMek loads them', () => {
        const entity = new TestTankEntity();
        const body = addTestEquipment(entity, weapon('Body Laser', [3, 6, 9]), { location: 'Body' });
        const front = addTestEquipment(entity, weapon('Front Laser', [3, 6, 9]), { location: 'Front' });

        expect(ids(recordSheetInventoryWeaponMounts(entity))).toEqual(ids([front, body]));
    });
});

describe('vehicle record-sheet details', () => {
    it('prints chassis mods as one entry first, then fire control and seats, as MegaMekLab does', () => {
        const entity = new TestSupportTankEntity();
        for (const name of ['Armored Chassis', 'Off-Road']) {
            addTestEquipment(entity, new MiscEquipment({
                id: name, name, shortName: name, type: 'misc', flags: ['F_CHASSIS_MODIFICATION'],
            }), { location: 'Body' });
        }
        addTestEquipment(entity, new MiscEquipment({
            id: 'Advanced Fire Control', name: 'Advanced Fire Control', type: 'misc', flags: ['F_ADVANCED_FIRE_CONTROL'],
        }), { location: 'Body' });
        entity.transporters.set([
            { id: 'seats', kind: 'bay', configuration: { type: 'standard-seats' }, capacity: 4, doors: 0, bayNumber: 0, omni: false },
        ]);

        expect(recordSheetFeatures(entity))
            .toEqual(['Armored Chassis, Off-Road Chassis Mods', 'Advanced Fire Control', '4 Standard Seats']);
    });

    it('keeps cargo in the unit features search uses while the sheet prints it in its Cargo block', () => {
        const entity = new TestSupportTankEntity();
        entity.transporters.set([
            { id: 'cargo', kind: 'bay', configuration: { type: 'cargo' }, capacity: 2, doors: 1, bayNumber: 1, omni: false },
        ]);

        expect(entity.entityFeatures()).toContain('Bay: Cargo');
        expect(recordSheetFeatures(entity)).toEqual([]);
    });

    it('names a MASH by its short name and theaters', () => {
        const entity = new TestSupportTankEntity();
        const mash = addTestEquipment(entity, new MiscEquipment({
            id: 'MASH Equipment', name: 'MASH Equipment', shortName: 'MASH', type: 'misc',
            flags: ['F_MASH', 'F_VARIABLE_SIZE'],
        }), { location: 'Body', size: 1 });

        expect(recordSheetInventoryMountName(entity, mash)).toBe('MASH (1 theater)');
    });

    it('lets no trailer or airship charge (TW pp. 148, 205)', () => {
        const tank = new TestTankEntity();
        expect(vehicleHasChargeAttack(tank)).toBeTrue();
        tank.isTrailer.set(true);
        expect(vehicleHasChargeAttack(tank)).toBeFalse();

        const airship = new TestSupportTankEntity();
        airship.motiveType.set('Airship');
        expect(vehicleHasChargeAttack(airship)).toBeFalse();
    });
});
