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
    type WeaponTargetSubject,
} from './weapon-target-policy';

function weapon(
    flags: EquipmentFlag[],
    ammoType: AmmoType = 'NA',
    selectedAmmo: AmmoEquipment | null = null,
    underwater = false,
): WeaponTargetSubject {
    return {
        weapon: new WeaponEquipment({
            id: flags.join('-') || 'weapon',
            name: 'Weapon',
            type: 'weapon',
            flags,
            weapon: { ammoType, rackSize: ammoType === 'NA' ? 0 : 10, ranges: [7, 14, 21, 28] },
        }),
        selectedAmmo,
        underwater,
    };
}

function ammo(munitionType: AmmoMunitionFlag[] = []): AmmoEquipment {
    return new AmmoEquipment({
        id: `ammo-${munitionType.join('-')}`,
        name: 'Ammo',
        type: 'ammo',
        ammo: { type: 'LRM', rackSize: 10, shots: 12, munitionType },
    });
}

describe('weapon target policy', () => {
    it('restricts Thunder ammunition to terrain regardless of a manual TN override', () => {
        const launcher = weapon(['F_INDIRECT_FIRE'], 'LRM', ammo(['M_THUNDER']));
        expect(weaponTargetDisabledReason(launcher, 'core-2026', {
            unitType: 'mek-biped',
            local: { manualTnOverride: { kind: 'user-manual', modifier: 2 } },
        })).toBe(TARGET_THUNDER_TERRAIN_REASON);
        expect(weaponTargetDisabledReason(launcher, 'core-2026', { unitType: 'terrain' })).toBeNull();
    });

    it('applies Total Warfare TAG, NARC, and Bombast restrictions only where its rules require them', () => {
        expect(weaponTargetDisabledReason(
            weapon(['F_TAG']), 'total-warfare', { unitType: 'infantry' },
        )).toBe(TARGET_TAG_INFANTRY_REASON);
        expect(weaponTargetDisabledReason(
            weapon(['F_NARC']), 'total-warfare', { unitType: 'battle-armor' },
        )).toBe(TARGET_NARC_INFANTRY_REASON);
        expect(weaponTargetDisabledReason(
            weapon(['F_NARC']), 'total-warfare',
            { unitType: 'mek-biped', calculator: { buildingCover: 'building-1' } },
        )).toBe(TARGET_NARC_BUILDING_REASON);
        expect(weaponTargetDisabledReason(
            weapon(['F_BOMBAST_LASER']), 'total-warfare',
            { unitType: 'mek-biped', local: { calculator: { secondaryTarget: true } } },
        )).toBe(TARGET_BOMBAST_SECONDARY_REASON);
        expect(weaponTargetDisabledReason(
            weapon(['F_TAG']), 'core-2026', { unitType: 'infantry' },
        )).toBeNull();
    });

    it('keeps weapons and targets in the same water layer', () => {
        expect(weaponTargetDisabledReason(
            weapon(['F_DIRECT_FIRE']), 'core-2026',
            { unitType: 'mek-biped', calculator: { waterDepth: 'underwater-depth-2' } },
        )).toBe(TARGET_WATER_LAYER_REASON);
        expect(weaponTargetDisabledReason(
            weapon(['F_DIRECT_FIRE'], 'NA', null, true), 'core-2026',
            { unitType: 'mek-biped', local: { calculator: { partialCover: true } } },
        )).toBe(TARGET_WATER_LAYER_REASON);
    });
});
