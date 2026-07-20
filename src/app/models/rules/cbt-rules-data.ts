/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 */

import type { Options } from '../options.model';

export type CBTRulesId = Options['CBTRules'];

export interface CBTRulesData {
    readonly physicalBaseHitModifiers: Readonly<Record<string, number | 'Vs'>>;
    readonly mascSequenceLabels: readonly string[];
    readonly targeting: {
        readonly skidding: boolean;
        readonly secondaryTargetSideBack: boolean;
        readonly largeTarget: boolean;
        readonly artilleryFlatRangeModifier: number | null;
    };
}

export const CORE_2026_RULES_DATA: CBTRulesData = {
    physicalBaseHitModifiers: {
        punch: -1,
        kick: -1,
        'kick [talons]': -1,
        club: -1,
        push: -1,
        frenzy: 0,
        charge: 'Vs',
        'death from above': 'Vs',
        'dfa [talons]': 'Vs',
        'airmech ram': 'Vs',
    },
    mascSequenceLabels: ['3+', '5+', '7+', '10+', '11+'],
    targeting: {
        skidding: false,
        secondaryTargetSideBack: false,
        largeTarget: true,
        artilleryFlatRangeModifier: 4
    },
};

export const TW_RULES_DATA: CBTRulesData = {
    physicalBaseHitModifiers: {
        ...CORE_2026_RULES_DATA.physicalBaseHitModifiers,
        punch: 0,
        kick: -2,
        'kick [talons]': -2,
    },
    mascSequenceLabels: ['3+', '5+', '7+', '11+', '!!'],
    targeting: {
        skidding: true,
        secondaryTargetSideBack: true,
        largeTarget: false,
        artilleryFlatRangeModifier: null
    },
};

export function resolveCBTRulesData(rulesId: CBTRulesId): CBTRulesData {
    return rulesId === 'tw' ? TW_RULES_DATA : CORE_2026_RULES_DATA;
}
