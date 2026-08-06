// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { MountedEquipment } from '../models/mounted-equipment.model';
import { Equipment, type AmmoEquipment } from '../models/equipment.model';
import { ArtemisVHandler } from './artemis-v.handler';
import { EquipmentFlag } from '../models/equipment-flags.type';
import { AmmoMunitionFlag } from '../models/ammo-munition-flags.type';

function owner(unavailableEntry?: MountedEquipment, jammed = false) {
    return {
        rules: { computeEntryState: (candidate: MountedEquipment) => ({ isDamaged: candidate === unavailableEntry || candidate.committedDestroyed(), isDisabled: false, hitMod: 0 }) },
        getCondition: (condition: string) => condition === 'jammed' && jammed
    } as never;
}

function entry(flags: EquipmentFlag[] = [], destroyed = false): MountedEquipment {
    return new MountedEquipment({
        owner: owner(),
        id: flags.join('-') || 'entry',
        name: 'Entry',
        equipment: new Equipment({ id: 'entry', name: 'Entry', type: 'misc', flags }),
        destroyed
    });
}

function ammo(munitionTypes: AmmoMunitionFlag[] = []): AmmoEquipment {
    return {
        shortName: 'Test Ammo',
        hasMunitionType: (munitionType: AmmoMunitionFlag) => munitionTypes.includes(munitionType)
    } as AmmoEquipment;
}

describe('ArtemisVHandler', () => {
    const handler = new ArtemisVHandler();

    it('applies the Artemis V bonus when linked to a launcher using Artemis V-capable ammo', () => {
        expect(handler.getToHitAdjustments(entry(['F_WEAPON_ENHANCEMENT', 'F_ARTEMIS_V']), { parent: entry(['F_ARTEMIS_COMPATIBLE']), selectedAmmo: ammo(['M_ARTEMIS_V_CAPABLE']) })).toEqual([{
            kind: 'add', label: 'Entry', modifier: -1, weakened: false
        }]);
    });

    it('no Artemis V hit modifier bonus when selected ammo is not Artemis V-capable', () => {
        expect(handler.getToHitAdjustments(entry(['F_WEAPON_ENHANCEMENT', 'F_ARTEMIS_V']), { parent: entry(['F_ARTEMIS_COMPATIBLE']), selectedAmmo: ammo(['M_ARTEMIS_CAPABLE']) })).toEqual([{
            kind: 'add', label: 'Incompatible Ammo (Test Ammo)', modifier: 0, weakened: true
        }]);
        expect(handler.getToHitAdjustments(entry(['F_WEAPON_ENHANCEMENT', 'F_ARTEMIS_V']), { parent: entry(['F_ARTEMIS_COMPATIBLE']), selectedAmmo: null })).toEqual([{
            kind: 'add', label: 'Artemis V Ammo Not Selected', modifier: 0, weakened: true
        }]);
    });

    it('no Artemis V hit modifier bonus when the linked enhancement is unavailable', () => {
        const artemis = entry(['F_WEAPON_ENHANCEMENT', 'F_ARTEMIS_V']);
        artemis.owner = owner(artemis);

        expect(handler.getToHitAdjustments(artemis, { parent: entry(['F_ARTEMIS_COMPATIBLE']), selectedAmmo: ammo(['M_ARTEMIS_V_CAPABLE']) })).toEqual([{
            kind: 'add', label: 'Entry Destroyed', modifier: 0, weakened: true
        }]);
    });

    it('does not apply the Artemis V bonus when the unit is jammed', () => {
        const artemis = entry(['F_WEAPON_ENHANCEMENT', 'F_ARTEMIS_V']);
        artemis.owner = owner(undefined, true);

        expect(handler.getToHitAdjustments(artemis, { parent: entry(['F_ARTEMIS_COMPATIBLE']), selectedAmmo: ammo(['M_ARTEMIS_V_CAPABLE']) })).toEqual([{
            kind: 'add', label: 'Unit Jammed', modifier: 0, weakened: true
        }]);
    });

    it('does not apply a modifier to a launcher that is not Artemis-compatible', () => {
        expect(handler.getToHitAdjustments(
            entry(['F_WEAPON_ENHANCEMENT', 'F_ARTEMIS_V']),
            { parent: entry(), selectedAmmo: ammo(['M_ARTEMIS_V_CAPABLE']) }
        )).toEqual([]);
    });

    it('does not apply a modifier when Artemis V is not linked to a launcher', () => {
        expect(handler.getToHitAdjustments(
            entry(['F_WEAPON_ENHANCEMENT', 'F_ARTEMIS_V']),
            { selectedAmmo: ammo(['M_ARTEMIS_V_CAPABLE']) }
        )).toEqual([]);
    });
});