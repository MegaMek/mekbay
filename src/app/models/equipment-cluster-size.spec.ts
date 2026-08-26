// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AmmoEquipment, WeaponEquipment } from './equipment.model';

describe('WeaponEquipment cluster size', () => {
    it('uses the ammunition profile without clamping it to the weapon rack size', () => {
        const weapon = new WeaponEquipment({
            id: 'ISMML3',
            name: 'MML 3',
            type: 'weapon',
            flags: ['F_MISSILE', 'F_MML'],
            weapon: { ammoType: 'MML', damage: 'cluster', rackSize: 3 },
        });
        const ammunition = new AmmoEquipment({
            id: 'MML3LRMAmmo',
            name: 'MML 3 LRM Ammo',
            type: 'ammo',
            flags: ['F_MML_LRM'],
            ammo: { type: 'MML', rackSize: 3, damagePerShot: 1 },
        });

        expect(weapon.getClusterSize(ammunition)).toBe(5);
    });
});
