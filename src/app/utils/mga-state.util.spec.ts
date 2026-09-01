// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { WeaponEquipment } from '../models/equipment.model';
import { MountedEquipment } from '../models/mounted-equipment.model';
import { createTestEquipmentOwner } from '../testing/unit-test-helpers';
import { machineGunArrayMembers, reconcileMachineGunArrayLinks } from './mga-state.util';

function equipment(id: string, flags: ('F_MG' | 'F_MGA')[], rackSize: number): WeaponEquipment {
    return new WeaponEquipment({
        id,
        name: id,
        type: 'weapon',
        flags,
        weapon: { ammoType: rackSize === 1 ? 'MG_LIGHT' : rackSize === 3 ? 'MG_HEAVY' : 'MG', rackSize },
    });
}

function mounted(
    owner: ReturnType<typeof createTestEquipmentOwner>['owner'],
    id: string,
    type: WeaponEquipment,
    location = 'LT',
): MountedEquipment {
    return new MountedEquipment({
        owner,
        id,
        name: type.name,
        equipment: type,
        locations: new Set([location]),
    });
}

describe('MGA state utilities', () => {
    it('infers flat same-location, same-type members and caps each array at four', () => {
        const { owner } = createTestEquipmentOwner();
        const arrayType = equipment('MGA', ['F_MGA'], 2);
        const gunType = equipment('MG', ['F_MG'], 2);
        const firstArray = mounted(owner, 'array-1', arrayType);
        const secondArray = mounted(owner, 'array-2', arrayType);
        const guns = Array.from({ length: 6 }, (_, index) => mounted(owner, `gun-${index + 1}`, gunType));
        const wrongLocation = mounted(owner, 'wrong-location', gunType, 'RT');
        const wrongType = mounted(owner, 'wrong-type', equipment('Light MG', ['F_MG'], 1));

        reconcileMachineGunArrayLinks([
            guns[0], firstArray, guns[1], guns[2], guns[3],
            secondArray, guns[4], guns[5], wrongLocation, wrongType,
        ]);

        expect(machineGunArrayMembers(firstArray)).toEqual(guns.slice(0, 4));
        expect(machineGunArrayMembers(secondArray)).toEqual(guns.slice(4));
        expect(wrongLocation.parent).toBeFalsy();
        expect(wrongType.parent).toBeFalsy();
    });

    it('preserves explicit bay membership instead of greedily replacing it', () => {
        const { owner } = createTestEquipmentOwner();
        const arrayType = equipment('MGA', ['F_MGA'], 2);
        const gunType = equipment('MG', ['F_MG'], 2);
        const array = mounted(owner, 'array', arrayType);
        const first = mounted(owner, 'first', gunType);
        const explicit = mounted(owner, 'explicit', gunType);
        array.setLinkedEquipment([explicit]);

        reconcileMachineGunArrayLinks([first, array, explicit]);

        expect(machineGunArrayMembers(array)).toEqual([explicit]);
        expect(first.parent).toBeFalsy();
    });

    it('uses critical-slot boundaries to separate multiple flat arrays in one location', () => {
        const { owner } = createTestEquipmentOwner();
        const arrayType = equipment('MGA', ['F_MGA'], 2);
        const gunType = equipment('MG', ['F_MG'], 2);
        const makeMounted = (id: string, type: WeaponEquipment) => new MountedEquipment({
            owner,
            id,
            name: type.name,
            equipment: type,
            locations: new Set(['LT']),
        });
        const guns = Array.from({ length: 6 }, (_, index) => makeMounted(`gun-${index + 1}`, gunType));
        const firstArray = makeMounted('array-1', arrayType);
        const secondArray = makeMounted('array-2', arrayType);
        Object.assign(owner, {
            getCritSlots: () => [
                ...guns.slice(0, 3).map((gun, slot) => ({ id: gun.id, loc: 'LT', slot })),
                { id: firstArray.id, loc: 'LT', slot: 3 },
                ...guns.slice(3).map((gun, index) => ({ id: gun.id, loc: 'LT', slot: index + 4 })),
                { id: secondArray.id, loc: 'LT', slot: 7 },
            ],
        });

        reconcileMachineGunArrayLinks([...guns, firstArray, secondArray]);

        expect(machineGunArrayMembers(firstArray)).toEqual(guns.slice(0, 3));
        expect(machineGunArrayMembers(secondArray)).toEqual(guns.slice(3));
    });
});
