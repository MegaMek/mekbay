// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { WeaponEquipment, type AmmoType } from '../models/equipment.model';
import { formatRecordSheetWeaponDamageText } from './record-sheet-weapon-info.util';

describe('record-sheet weapon info', () => {
    it('matches MegaMekLab missile, autocannon, and energy notation', () => {
        const lrm = weapon('LRM', ['F_MISSILE'], 'LRM');
        const ac = weapon('AC', ['F_BALLISTIC', 'F_DIRECT_FIRE'], 'AC');
        const laser = weapon('Laser', ['F_ENERGY', 'F_DIRECT_FIRE'], 'NA');

        expect(formatRecordSheetWeaponDamageText(lrm, '1/Msl [C5,M,S]'))
            .toBe('1/Msl [M,C,S]');
        expect(formatRecordSheetWeaponDamageText(lrm, ''))
            .toBe('[M,C,S]');
        expect(formatRecordSheetWeaponDamageText(ac, '20 [DB,S]'))
            .toBe('20 [DB,S]');
        expect(formatRecordSheetWeaponDamageText(laser, '5 [AI,DE,H]'))
            .toBe('5 [DE,H,AI]');
    });

    it('uses the historical rapid-fire and LB-X abbreviations', () => {
        expect(formatRecordSheetWeaponDamageText(
            weapon('Ultra', ['F_BALLISTIC', 'F_DIRECT_FIRE'], 'AC_ULTRA'),
            '5/Sht [DB,R2,S]',
        )).toBe('5/Sht [DB,R/C]');
        expect(formatRecordSheetWeaponDamageText(
            weapon('LBX', ['F_BALLISTIC', 'F_DIRECT_FIRE'], 'AC_LBX'),
            '10 [C5,DB,S]',
        )).toBe('10 [DB,C/F/S]');
    });
});

function weapon(
    id: string,
    flags: ConstructorParameters<typeof WeaponEquipment>[0]['flags'],
    ammoType: AmmoType,
): WeaponEquipment {
    return new WeaponEquipment({
        id,
        name: id,
        type: 'weapon',
        flags,
        weapon: { ammoType, damage: 5 },
    });
}
