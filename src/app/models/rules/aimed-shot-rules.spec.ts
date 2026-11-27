// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    aimedShot,
    aimedShotDice,
    aimedShotIgnoresComputer,
    aimedShotKind,
    aimedShotStrikes,
    type AimedShotTarget,
    type AimedShotWeapon,
} from './aimed-shot-rules';

describe('aimed shot rules', () => {
    const laser: AimedShotWeapon = { types: ['DE'], singleHit: true, computerAided: false };
    const aided: AimedShotWeapon = { ...laser, computerAided: true };
    const pulse: AimedShotWeapon = { types: ['P'], singleHit: true, computerAided: true };
    const mek: AimedShotTarget = { unitType: 'mek-biped', immobile: false, indirectFire: false, partialCover: false };
    const immobile: AimedShotTarget = { ...mek, immobile: true };

    it('aims at an immobile target with any single-hit weapon, and at a mobile one only with a targeting computer', () => {
        expect(aimedShotKind('total-warfare', laser, immobile)).toBe('immobile');
        expect(aimedShotKind('core-2026', laser, mek)).toBeNull();
        expect(aimedShotKind('core-2026', aided, mek)).toBe('targeting-computer');
        // TW p. 143, Core p. 200: pulse weapons never aim with the computer, but may at an immobile target.
        expect(aimedShotKind('total-warfare', pulse, mek)).toBeNull();
        expect(aimedShotKind('total-warfare', pulse, immobile)).toBe('immobile');
    });

    it('forbids area-effect, cluster and flak weapons, bursts and indirect fire', () => {
        for (const type of ['AE', 'C', 'F'] as const) {
            expect(aimedShotKind('total-warfare', { ...aided, types: ['DB', type] }, immobile)).toBeNull();
        }
        expect(aimedShotKind('total-warfare', { ...laser, singleHit: false }, immobile)).toBeNull();
        expect(aimedShotKind('total-warfare', laser, { ...immobile, indirectFire: true })).toBeNull();
    });

    it('aims at vehicles only in Total Warfare, and at no other unit', () => {
        const vehicle = { ...immobile, unitType: 'vehicle' as const };
        expect(aimedShotKind('total-warfare', laser, vehicle)).toBe('immobile');
        expect(aimedShotKind('core-2026', laser, vehicle)).toBeNull();
        expect(aimedShotKind('total-warfare', laser, { ...immobile, unitType: 'battle-armor' })).toBeNull();
        expect(aimedShotKind('total-warfare', laser, { ...immobile, unitType: 'building' })).toBeNull();
    });

    it('takes the head only of an immobile target, and no leg behind partial cover', () => {
        expect(aimedShot('core-2026', aided, immobile, 'HD')).toEqual({ kind: 'immobile', location: 'HD', head: true });
        expect(aimedShot('core-2026', aided, mek, 'HD')).toBeNull();
        expect(aimedShot('core-2026', aided, mek, 'LA')).toEqual({ kind: 'targeting-computer', location: 'LA', head: false });
        const covered = { ...immobile, partialCover: true };
        expect(aimedShot('total-warfare', laser, covered, 'RL')).toBeNull();
        expect(aimedShot('total-warfare', laser, { ...covered, unitType: 'mek-quad' }, 'FLL')).toBeNull();
        expect(aimedShot('total-warfare', laser, covered, 'RA')).not.toBeNull();
    });

    it('keeps the targeting computer only for a non-pulse shot at an immobile target below the head', () => {
        expect(aimedShotIgnoresComputer(aimedShot('core-2026', aided, immobile, 'CT')!, aided)).toBeFalse();
        expect(aimedShotIgnoresComputer(aimedShot('core-2026', aided, immobile, 'HD')!, aided)).toBeTrue();
        expect(aimedShotIgnoresComputer(aimedShot('core-2026', aided, mek, 'CT')!, aided)).toBeTrue();
        expect(aimedShotIgnoresComputer(aimedShot('core-2026', pulse, immobile, 'CT')!, pulse)).toBeTrue();
    });

    it('strikes the named location on 6-8 of 2D6 in Total Warfare and 4+ on 1D6 in Core', () => {
        expect(aimedShotDice('total-warfare')).toBe(2);
        expect(aimedShotDice('core-2026')).toBe(1);
        expect([[2, 3], [3, 3], [3, 4], [4, 4], [4, 5]].map(aimedShotStrikes)).toEqual([false, true, true, true, false]);
        expect([[3], [4], [6]].map(aimedShotStrikes)).toEqual([false, true, true]);
    });
});
