// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    mekCriticalLocationMatrix,
    mekDamageLocationOrder,
} from './mek-location-layout.util';

describe('Mek location layout', () => {
    it('provides the canonical biped critical matrix and damage order', () => {
        expect(mekCriticalLocationMatrix('Biped')).toEqual([
            ['LA', 'HD', 'RA'],
            ['LT', 'CT', 'RT'],
            ['LL', null, 'RL'],
        ]);
        expect(mekDamageLocationOrder('biped')).toEqual([
            'HD', 'LA', 'LL', 'LT', 'CT', 'RT', 'RL', 'RA',
        ]);
    });

    it('provides the canonical tripod critical matrix and damage order', () => {
        expect(mekCriticalLocationMatrix('tripod')).toEqual([
            ['LA', 'HD', 'RA'],
            ['LT', 'CT', 'RT'],
            ['LL', 'CL', 'RL'],
        ]);
        expect(mekDamageLocationOrder('Tripod')).toEqual([
            'HD', 'LA', 'LL', 'LT', 'CT', 'CL', 'RT', 'RL', 'RA',
        ]);
    });

    it('provides the canonical quad critical matrix and damage order', () => {
        expect(mekCriticalLocationMatrix('QuadVee')).toEqual([
            ['FLL', 'HD', 'FRL'],
            ['LT', 'CT', 'RT'],
            ['RLL', null, 'RRL'],
        ]);
        expect(mekDamageLocationOrder('quad')).toEqual([
            'HD', 'FLL', 'RLL', 'LT', 'CT', 'RT', 'RRL', 'FRL',
        ]);
    });
});
