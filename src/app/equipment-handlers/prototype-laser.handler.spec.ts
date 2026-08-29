// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { WeaponEquipment } from '../models/equipment.model';
import { EMPTY_EQUIPMENT_REGISTRY } from '../models/equipment-lookup';
import { MountedWeapon } from '../models/mounted-equipment.model';
import { createHandlerQueryContext } from '../services/equipment-interaction-registry.service';
import { createTestEquipmentOwner } from '../testing/unit-test-helpers';
import { PrototypeLaserHandler } from './prototype-laser.handler';

function fixture(internalName: string, type: 'Mek' | 'Aero' = 'Mek') {
    const addFiredHeat = jasmine.createSpy('addFiredHeat');
    const { owner } = createTestEquipmentOwner({ unit: { type } });
    const heat = { current: 0, previous: 0, next: undefined as number | undefined };
    const setHeat = jasmine.createSpy('setHeat').and.callFake((value: number) => heat.next = value);
    Object.assign(owner, {
        getHeat: () => heat,
        setHeat,
        turnState: () => ({ addFiredHeat }),
    });
    const equipment = new WeaponEquipment({
        id: internalName,
        name: internalName,
        type: 'weapon',
        weapon: { heat: 10, damage: 10, ranges: [5, 10, 15, 20], ammoType: 'NA' },
    });
    const mounted = new MountedWeapon({
        owner,
        id: internalName,
        name: equipment.name,
        equipment,
    });
    return { mounted, addFiredHeat, setHeat };
}

describe('PrototypeLaserHandler', () => {
    const handler = new PrototypeLaserHandler();
    const context = createHandlerQueryContext(EMPTY_EQUIPMENT_REGISTRY);

    it('marks ground prototype heat as variable and rolls the extra heat after firing', () => {
        const medium = fixture('ISMediumPulseLaserPrototype');
        spyOn(Math, 'random').and.returnValue(5 / 6);

        expect(handler.applicableTo(medium.mounted)).toBeTrue();
        expect(handler.applyInventoryControlHeatEffects(
            medium.mounted,
            { value: 10, weakened: false },
            context,
        )).toEqual({ value: 10, weakened: false, suffix: '*' });

        handler.afterInventoryControlFire(medium.mounted);
        expect(medium.addFiredHeat).toHaveBeenCalledOnceWith(6);
        expect(medium.setHeat).not.toHaveBeenCalled();
    });

    it('adds random ground prototype heat to an existing manual heat target', () => {
        const medium = fixture('ISMediumPulseLaserPrototype');
        medium.mounted.owner.setHeat(14);
        medium.setHeat.calls.reset();
        spyOn(Math, 'random').and.returnValue(5 / 6);

        handler.afterInventoryControlFire(medium.mounted);

        expect(medium.addFiredHeat).toHaveBeenCalledOnceWith(6);
        expect(medium.setHeat).toHaveBeenCalledOnceWith(20);
    });

    it('uses 1D3 extra heat for the small prototype pulse laser', () => {
        const small = fixture('ISSmallPulseLaserPrototype');
        spyOn(Math, 'random').and.returnValue(5 / 6);

        handler.afterInventoryControlFire(small.mounted);
        expect(small.addFiredHeat).toHaveBeenCalledOnceWith(3);
    });

    it('uses maximum extra heat for aerospace firing without a random post-fire roll', () => {
        const aero = fixture('ISERLargeLaserPrototype', 'Aero');

        expect(handler.applyInventoryControlHeatEffects(
            aero.mounted,
            { value: 12, weakened: false },
            context,
        )).toEqual({ value: 18, weakened: false });
        handler.afterInventoryControlFire(aero.mounted);
        expect(aero.addFiredHeat).not.toHaveBeenCalled();
    });

    it('does not claim ordinary lasers', () => {
        expect(handler.applicableTo(fixture('ISMediumLaser').mounted)).toBeFalse();
    });
});
