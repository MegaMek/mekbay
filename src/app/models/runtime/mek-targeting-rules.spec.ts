// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { AmmoEquipment, WeaponEquipment, type AmmoType } from '../equipment.model';
import type { AmmoMunitionFlag } from '../ammo-munition-flags.type';
import type { EquipmentFlag } from '../equipment-flags.type';
import {
    TARGET_BOMBAST_SECONDARY_REASON,
    TARGET_NARC_BUILDING_REASON,
    TARGET_NARC_INFANTRY_REASON,
    TARGET_TAG_INFANTRY_REASON,
    TARGET_THUNDER_TERRAIN_REASON,
    TARGET_WATER_LAYER_REASON,
    weaponTargetDisabledReason,
} from './mek-targeting-rules';

function weapon(flags: EquipmentFlag[], ammoType: AmmoType = 'NA'): WeaponEquipment {
    return new WeaponEquipment({
        id: flags.join('-') || 'weapon',
        name: 'Weapon',
        type: 'weapon',
        flags,
        weapon: { ammoType, rackSize: ammoType === 'NA' ? 0 : 10, ranges: [7, 14, 21, 28] },
    });
}

function ammo(munitionType: AmmoMunitionFlag[] = []): AmmoEquipment {
    return new AmmoEquipment({
        id: `ammo-${munitionType.join('-')}`,
        name: 'Ammo',
        type: 'ammo',
        ammo: { type: 'LRM', rackSize: 10, shots: 12, munitionType },
    });
}

describe('direct V2 Mek target rules', () => {
    it('restricts Thunder ammunition to terrain regardless of a manual TN override', () => {
        const launcher = weapon(['F_INDIRECT_FIRE'], 'LRM');
        const thunder = ammo(['M_THUNDER']);
        expect(weaponTargetDisabledReason(
            launcher, thunder, 'core-2026',
            { unitType: 'mek-biped', manualTnOverride: true }, false,
        )).toBe(TARGET_THUNDER_TERRAIN_REASON);
        expect(weaponTargetDisabledReason(
            launcher, thunder, 'core-2026', { unitType: 'terrain' }, false,
        )).toBeNull();
    });

    it('applies Total Warfare TAG, NARC, and Bombast restrictions only where its rules require them', () => {
        expect(weaponTargetDisabledReason(
            weapon(['F_TAG']), null, 'total-warfare', { unitType: 'infantry' }, false,
        )).toBe(TARGET_TAG_INFANTRY_REASON);
        expect(weaponTargetDisabledReason(
            weapon(['F_NARC']), null, 'total-warfare', { unitType: 'battle-armor' }, false,
        )).toBe(TARGET_NARC_INFANTRY_REASON);
        expect(weaponTargetDisabledReason(
            weapon(['F_NARC']), null, 'total-warfare',
            { unitType: 'mek-biped', calculator: { buildingCover: 'building-1' } }, false,
        )).toBe(TARGET_NARC_BUILDING_REASON);
        expect(weaponTargetDisabledReason(
            weapon(['F_BOMBAST_LASER']), null, 'total-warfare',
            { unitType: 'mek-biped', calculator: { secondaryTarget: true } }, false,
        )).toBe(TARGET_BOMBAST_SECONDARY_REASON);
        expect(weaponTargetDisabledReason(
            weapon(['F_TAG']), null, 'core-2026', { unitType: 'infantry' }, false,
        )).toBeNull();
    });

    it('keeps weapons and targets in the same water layer', () => {
        expect(weaponTargetDisabledReason(
            weapon(['F_DIRECT_FIRE']), null, 'core-2026',
            { unitType: 'mek-biped', calculator: { waterDepth: 'underwater-depth-2' } }, false,
        )).toBe(TARGET_WATER_LAYER_REASON);
        expect(weaponTargetDisabledReason(
            weapon(['F_DIRECT_FIRE']), null, 'core-2026',
            { unitType: 'mek-biped', calculator: {} }, true,
        )).toBe(TARGET_WATER_LAYER_REASON);
    });
});
