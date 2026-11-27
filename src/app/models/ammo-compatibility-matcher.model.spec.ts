// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { AmmoEquipment, WeaponEquipment } from './equipment.model';
import type { AmmoMunitionFlag } from './ammo-munition-flags.type';
import type { EquipmentFlag } from './equipment-flags.type';
import {
    createAmmoCompatibilityMatch,
    matchesAmmoCompatibility,
} from './ammo-compatibility-matcher.model';
import { ATM_IMPROVED_MAGNETIC_PULSE_PROFILE } from './ammo-weapon-profile.model';
import { expectedInventoryModes } from './runtime/component-inventory-mode';

function weapon(ammoType: 'ATM' | 'IATM' | 'MML', rackSize = 6): WeaponEquipment {
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
    readonly ammoType: 'ATM' | 'IATM' | 'MML';
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

    it('fires Improved Magnetic Pulse missiles from an iATM only, in their own mode (IO:AE p. 61)', () => {
        const imp = ATM_IMPROVED_MAGNETIC_PULSE_PROFILE.displayName;
        const iatm = weapon('IATM', 3);
        const impAmmo = ammo({ id: 'imp', name: 'iATM 3 IMP Ammo', ammoType: 'IATM', rackSize: 3, munitionTypes: ['M_IATM_IMP'] });
        const standard = ammo({ id: 'standard', name: 'iATM 3 Ammo', ammoType: 'IATM', rackSize: 3, munitionTypes: ['M_STANDARD'] });

        expect(expectedInventoryModes('IATM')).toContain(imp);
        expect(expectedInventoryModes('ATM')).not.toContain(imp);
        expect(match(iatm, impAmmo, imp)).toBeTrue();
        expect(match(iatm, impAmmo, 'High Explosive')).toBeFalse();
        expect(match(iatm, standard, imp)).toBeFalse();
        expect(match(weapon('ATM', 3), impAmmo, imp)).toBeFalse();
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
