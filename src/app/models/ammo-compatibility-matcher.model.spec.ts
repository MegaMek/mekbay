// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { AmmoEquipment, WeaponEquipment } from './equipment.model';
import type { AmmoMunitionFlag } from './ammo-munition-flags.type';
import type { EquipmentFlag } from './equipment-flags.type';
import {
    createAmmoCompatibilityMatch,
    matchesAmmoCompatibility,
} from './ammo-compatibility-matcher.model';

function weapon(ammoType: 'ATM' | 'MML', rackSize = 6): WeaponEquipment {
    return new WeaponEquipment({
        id: `${ammoType}${rackSize}`,
        name: `${ammoType} ${rackSize}`,
        type: 'weapon',
        weapon: { ammoType, rackSize },
    });
}

function ammo(input: {
    readonly id: string;
    readonly name: string;
    readonly ammoType: 'ATM' | 'MML';
    readonly rackSize?: number;
    readonly flags?: readonly EquipmentFlag[];
    readonly munitionTypes?: readonly AmmoMunitionFlag[];
}): AmmoEquipment {
    return new AmmoEquipment({
        id: input.id,
        name: input.name,
        shortName: input.name,
        type: 'ammo',
        flags: [...(input.flags ?? [])],
        ammo: {
            type: input.ammoType,
            rackSize: input.rackSize ?? 6,
            shots: 10,
            munitionType: [...(input.munitionTypes ?? [])],
        },
    });
}

function match(
    weaponProfile: WeaponEquipment,
    ammoProfile: AmmoEquipment,
    selectedMode?: string | null,
): boolean | null {
    return matchesAmmoCompatibility(createAmmoCompatibilityMatch({
        weapon: weaponProfile,
        ammo: ammoProfile,
        selectedMode,
    }));
}

describe('ammo compatibility matcher', () => {
    it('keeps ATM explicit, default, rack, and munition decisions detached from mounts', () => {
        const atm = weapon('ATM');
        const standard = ammo({ id: 'standard', name: 'ATM 6 Ammo', ammoType: 'ATM', munitionTypes: ['M_STANDARD'] });
        const explosive = ammo({ id: 'he', name: 'ATM 6 HE Ammo', ammoType: 'ATM', munitionTypes: ['M_HIGH_EXPLOSIVE'] });
        const imp = ammo({ id: 'imp', name: 'IATM 6 IMP Ammo', ammoType: 'ATM', munitionTypes: ['M_IATM_IMP'] });
        const wrongRack = ammo({ id: 'rack', name: 'ATM 5 Ammo', ammoType: 'ATM', rackSize: 5, munitionTypes: ['M_STANDARD'] });

        expect(match(atm, standard, null)).toBeTrue();
        expect(match(atm, standard, 'not-a-mode')).toBeTrue();
        expect(match(atm, explosive, 'High Explosive')).toBeTrue();
        expect(match(atm, imp, 'High Explosive')).toBeFalse();
        expect(match(atm, wrongRack, 'Standard')).toBeFalse();
    });

    it('reuses canonical MML classification for loadout facts', () => {
        const mml = weapon('MML', 9);
        const lrm = ammo({
            id: 'lrm', name: 'MML 9 SRM Ammo', ammoType: 'MML', flags: ['F_MML_LRM'], rackSize: 9,
        });
        const loadout = Object.freeze({ munitionKey: lrm.id, capacity: 10, equipment: lrm });

        expect(match(mml, lrm, 'LRM')).toBeTrue();
        expect(match(mml, loadout.equipment, 'LRM')).toBeTrue();
        expect(match(mml, lrm, 'SRM')).toBeFalse();
        expect(match(mml, lrm, null)).toBeFalse();
    });

    it('returns null for weapons outside the closed ATM/MML families', () => {
        const laser = new WeaponEquipment({ id: 'laser', name: 'Laser', type: 'weapon' });
        const standard = ammo({ id: 'standard', name: 'ATM 6 Ammo', ammoType: 'ATM', munitionTypes: ['M_STANDARD'] });
        expect(matchesAmmoCompatibility(createAmmoCompatibilityMatch({ weapon: laser, ammo: standard })))
            .toBeNull();
    });
});
