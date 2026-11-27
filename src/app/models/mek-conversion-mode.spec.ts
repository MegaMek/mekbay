// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBipedMekEntity, TestLamEntity, TestQuadVeeEntity } from './entity/testing/test-entities';
import {
    isMekConvertedMode,
    mekChoosesAirborne,
    mekConversionModes,
    mekConvertedMotiveLabel,
    mekConvertedMotiveModes,
    mekConvertedMovementPoints,
} from './mek-conversion-mode';

describe('Mek conversion modes', () => {
    it('gives a Standard LAM three modes, a Bimodal LAM two, a QuadVee two, and any other Mek none', () => {
        const lam = new TestLamEntity();
        expect(mekConversionModes(lam)).toEqual(['mek', 'airmek', 'fighter']);
        lam.lamType.set('Bimodal');
        expect(mekConversionModes(lam)).toEqual(['mek', 'fighter']);
        expect(mekConversionModes(new TestQuadVeeEntity())).toEqual(['mek', 'vehicle']);
        expect(mekConversionModes(new TestBipedMekEntity())).toEqual([]);
    });

    it('lets only an AirMech and a fighter choose between the ground and the air', () => {
        expect(['mek', 'airmek', 'fighter', 'vehicle'].map(mode => mekChoosesAirborne(mode as 'mek')))
            .toEqual([false, true, true, false]);
    });

    it('recognises only the converted modes as stored values', () => {
        expect(['airmek', 'fighter', 'vehicle'].every(isMekConvertedMode)).toBeTrue();
        expect(['mek', 'submarine', undefined, 1].some(isMekConvertedMode)).toBeFalse();
    });

    it('converts BattleMech MP as Interstellar Operations: Alternate Eras p. 102 does', () => {
        // A 3/5/3 LAM: the AirMech walks 1 and runs 2, cruises 9 and flanks 14; the fighter has thrust 3/5.
        expect(mekConvertedMovementPoints('airmek', false, 3, 3)).toEqual({ walkMp: 1, runMp: 2 });
        expect(mekConvertedMovementPoints('airmek', true, 3, 3)).toEqual({ walkMp: 9, runMp: 14 });
        expect(mekConvertedMovementPoints('fighter', true, 3, 3)).toEqual({ walkMp: 3, runMp: 5 });
        // A landed fighter taxis at half its Safe Thrust and has no Maximum Thrust.
        expect(mekConvertedMovementPoints('fighter', false, 3, 3)).toEqual({ walkMp: 1, runMp: 0 });
        // Walking MP x 0.33 rounds up: 6 walks 2, 7 walks 3.
        expect(mekConvertedMovementPoints('airmek', false, 6, 0).walkMp).toBe(2);
        expect(mekConvertedMovementPoints('airmek', false, 7, 0).walkMp).toBe(3);
        // Lost jump jets ground the AirMech and the fighter alike.
        expect(mekConvertedMovementPoints('airmek', true, 5, 0)).toEqual({ walkMp: 0, runMp: 0 });
    });

    it('offers each mode its own movement under its own names', () => {
        expect(mekConvertedMotiveModes('airmek', false)).toEqual(['stationary', 'walk', 'run']);
        expect(mekConvertedMotiveModes('airmek', true)).toEqual(['walk', 'run']);
        expect(mekConvertedMotiveModes('fighter', true)).toEqual(['walk', 'run']);
        expect(mekConvertedMotiveModes('fighter', false)).toEqual(['stationary', 'walk']);
        expect(mekConvertedMotiveModes('vehicle', false)).toEqual(['stationary', 'walk', 'run']);
        expect(['walk', 'run'].map(motive => mekConvertedMotiveLabel('airmek', false, motive as 'walk')))
            .toEqual(['Walk', 'Run']);
        expect(['walk', 'run'].map(motive => mekConvertedMotiveLabel('airmek', true, motive as 'walk')))
            .toEqual(['Cruise', 'Flank']);
        expect(['walk', 'run'].map(motive => mekConvertedMotiveLabel('vehicle', false, motive as 'walk')))
            .toEqual(['Cruise', 'Flank']);
        expect(['walk', 'run'].map(motive => mekConvertedMotiveLabel('fighter', false, motive as 'walk')))
            .toEqual(['Safe Thrust', 'Max Thrust']);
    });
});
