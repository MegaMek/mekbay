// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
    getRulesRefBadgeGroups,
    getRulesRefBuckets,
    shouldShowAdjustedPilotSkills
} from './unit-details-general-tab.component';

describe('UnitDetailsGeneralTabComponent', () => {
    describe('getRulesRefBuckets', () => {
        it('preserves alternative buckets and their book order', () => {
            expect(getRulesRefBuckets([['Core'], ['TW', 'IO:AUE']]))
                .toEqual([['Core'], ['TW', 'IO:AUE']]);
        });

        it('removes duplicate and empty references and buckets', () => {
            expect(getRulesRefBuckets([['Core', 'Core', ''], [], ['TW']]))
                .toEqual([['Core'], ['TW']]);
        });

        it('accepts the previous flat data form as one bucket', () => {
            expect(getRulesRefBuckets(['Core', 'IO:AUE']))
                .toEqual([['Core', 'IO:AUE']]);
        });
    });

    describe('getRulesRefBadgeGroups', () => {
        it('groups base alternatives with identical non-base requirements', () => {
            expect(getRulesRefBadgeGroups([
                ['TO:AUE', 'TW'],
                ['Core'],
                ['BMM'],
                ['TM', 'TO:AUE'],
            ])).toEqual([
                [{ label: 'BMM/Core', isBase: true }],
                [
                    { label: 'TM/TW', isBase: true },
                    { label: 'TO:AUE', isBase: false },
                ],
            ]);
        });

        it('sorts alternatives by book count and badges by type then name', () => {
            expect(getRulesRefBadgeGroups([
                ['ZZ', 'TW', 'AA'],
                ['IO:AE'],
            ])).toEqual([
                [{ label: 'IO:AE', isBase: false }],
                [
                    { label: 'TW', isBase: true },
                    { label: 'AA', isBase: false },
                    { label: 'ZZ', isBase: false },
                ],
            ]);
        });

        it('keeps base books joined by plus when the same bucket requires them together', () => {
            expect(getRulesRefBadgeGroups([['TW', 'TO:AUE', 'TM']])).toEqual([[
                { label: 'TM', isBase: true },
                { label: 'TW', isBase: true },
                { label: 'TO:AUE', isBase: false },
            ]]);
        });

        it('factors shared base books before merging the remaining alternatives', () => {
            expect(getRulesRefBadgeGroups([
                ['BMM', 'TM', 'IO:AE'],
                ['BMM', 'TW', 'IO:AE'],
            ])).toEqual([[
                { label: 'BMM', isBase: true },
                { label: 'TM/TW', isBase: true },
                { label: 'IO:AE', isBase: false },
            ]]);
        });
    });

    describe('shouldShowAdjustedPilotSkills', () => {
        it('shows skills when adjusted BV differs from base BV', () => {
            expect(shouldShowAdjustedPilotSkills(1200, 1000, 3, 4)).toBeTrue();
        });

        it('hides skills when adjusted BV equals base BV', () => {
            expect(shouldShowAdjustedPilotSkills(1000, 1000, 4, 5)).toBeFalse();
        });

        it('hides skills when BV or skill data is unavailable or invalid', () => {
            expect(shouldShowAdjustedPilotSkills(null, 1000, 3, 4)).toBeFalse();
            expect(shouldShowAdjustedPilotSkills(Number.NaN, 1000, 3, 4)).toBeFalse();
            expect(shouldShowAdjustedPilotSkills(1200, 1000, undefined, 4)).toBeFalse();
            expect(shouldShowAdjustedPilotSkills(1200, 1000, 3, undefined)).toBeFalse();
        });
    });
});
