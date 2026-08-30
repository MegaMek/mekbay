// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    mekFallDamageGroups,
    resolveMekFallArmorDamage,
    resolveMekFallDamage,
    resolveMekFallHitLocation,
    resolveMekFallOrientation,
    resolveMekStructureDamage,
} from './mek-fall-rules';

describe('direct Mek falling rules', () => {
    it('keeps Core facing while Total Warfare rotates to the rolled side', () => {
        expect(resolveMekFallOrientation('core-2026', 1)).toEqual(jasmine.objectContaining({
            facingOffset: 0, hitArc: 'rear',
        }));
        expect(resolveMekFallOrientation('core-2026', 6)).toEqual(jasmine.objectContaining({
            facingOffset: 0, hitArc: 'front',
        }));
        expect(resolveMekFallOrientation('total-warfare', 4)).toEqual(jasmine.objectContaining({
            facingOffset: 3, hitArc: 'rear',
        }));
    });

    it('uses ruleset-specific water damage and independent five-point groups', () => {
        expect(resolveMekFallDamage('core-2026', 50, 0, 1)).toEqual({
            surfaceDamage: 0, waterDamage: 5, totalDamage: 5,
        });
        expect(resolveMekFallDamage('total-warfare', 50, 2, 1)).toEqual({
            surfaceDamage: 7, waterDamage: 5, totalDamage: 12,
        });
        expect(mekFallDamageGroups(12)).toEqual([5, 5, 2]);
    });

    it('resolves typed biped and tripod hit-location cells', () => {
        expect(resolveMekFallHitLocation('biped', 'rear', 12)).toEqual(jasmine.objectContaining({
            location: 'HD', rear: true,
        }));
        expect(resolveMekFallHitLocation('tripod', 'front', 5)).toEqual(jasmine.objectContaining({
            location: null, tripodLegModifier: 0,
        }));
        expect(resolveMekFallHitLocation('tripod', 'front', 5, 6)).toEqual(jasmine.objectContaining({
            location: 'LL', adjustedTripodLegRoll: 6,
        }));
    });

    it('applies special fall armor and composite structure rules', () => {
        expect(resolveMekFallArmorDamage('core-2026', 5, 10, 'IMPACT_RESISTANT'))
            .toEqual({ armorDamage: 2, remainingDamage: 0, appliedDamage: 2 });
        expect(resolveMekFallArmorDamage('total-warfare', 5, 10, 'IMPACT_RESISTANT'))
            .toEqual({ armorDamage: 4, remainingDamage: 0, appliedDamage: 4 });
        expect(resolveMekFallArmorDamage('core-2026', 5, 2, 'REFLECTIVE'))
            .toEqual({ armorDamage: 2, remainingDamage: 4, appliedDamage: 2 });
        expect(resolveMekStructureDamage(3, 5, 'composite'))
            .toEqual({ internalDamage: 5, overflowDamage: 0 });
    });
});
