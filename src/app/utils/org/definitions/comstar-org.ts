import { DEFAULT_ORG_RULE_REGISTRY } from '../org-facts.util';
import type {
    OrgCIFormationRule,
    OrgComposedCountRule,
    OrgDefinition,
    OrgLeafCountRule,
    OrgLeafPatternRule,
} from '../org-types';
import {
    TRANSPORT_BA_ALL_BUCKETS,
    TRANSPORT_BA_MEC_BUCKETS,
    TRANSPORT_BA_QUALIFIED_BUCKETS,
    TRANSPORT_BA_XMEC_BUCKETS,
    TRANSPORT_BM_CARRIER_BUCKETS,
    TRANSPORT_BM_OMNI_CARRIER_BUCKETS,
} from './common';

export const COMSTAR_LEVEL_I: OrgLeafCountRule = {
    kind: 'leaf-count',
    type: 'Level I',
    modifiers: { '': 1 },
    commandRank: 'Acolyte',
    tier: 0,
    unitSelector: 'nonConventionalInfantry',
    pointModel: 'fixed',
};

export const COMSTAR_LEVEL_I_FROM_SQUADS: OrgCIFormationRule = {
    kind: 'ci-formation',
    type: 'Level I',
    fragmentType: 'Squad',
    fragmentTier: 0,
    modifiers: { 'Demi-': 3, '': 6 },
    unitSelector: 'CI',
    commandRank: 'Acolyte',
    tier: 0,
    requireRegularForPromotion: true,
    entries: [
        { moveClass: 'foot', troopers: 6, counts: { 'Demi-': 3, '': 6 } },
        { moveClass: 'motorized', troopers: 6, counts: { 'Demi-': 3, '': 6 } },
        { moveClass: 'scuba', troopers: 6, counts: { 'Demi-': 3, '': 6 } },
        { moveClass: 'jump', troopers: 6, counts: { '': 5 } },
        { moveClass: 'mechanized-vtol', troopers: 5, counts: { '': 4 } },
        { moveClass: 'mechanized-hover', troopers: 5, counts: { '': 4 } },
        { moveClass: 'mechanized-wheeled', troopers: 6, counts: { '': 4 } },
        { moveClass: 'mechanized-tracked', troopers: 6, counts: { '': 4 } },
        { moveClass: 'mechanized-submarine', troopers: 6, counts: { '': 4 } },
    ],
};

export const COMSTAR_LEVEL_II: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Level II',
    modifiers: {
        'Thin ': 2,
        'Half ': 3,
        'Short ': 4,
        'Under-Strength ': 5,
        '': 6,
        'Reinforced ': 7,
        'Fortified ': 8,
        'Heavy ': 9,
    },
    commandRank: 'Adept',
    tier: 1,
    childRoles: [{ matches: ['Level I'] }],
    childBucketBy: 'promotionBasic',
};

export const COMSTAR_CHOIR: OrgLeafPatternRule = {
    kind: 'leaf-pattern',
    type: 'Choir',
    priority: 1,
    countsAs: 'Level II',
    modifiers: { '': 12 },
    commandRank: 'Adept',
    tier: 1.6,
    unitSelector: ['BM', 'BA'],
    bucketBy: 'transport',
    patterns: [
        {
            copySize: 12,
            matchMode: 'score',
            bucketGroups: {
                bm: TRANSPORT_BM_CARRIER_BUCKETS,
                bmOmni: TRANSPORT_BM_OMNI_CARRIER_BUCKETS,
                ba: TRANSPORT_BA_ALL_BUCKETS,
                qualifiedBa: TRANSPORT_BA_QUALIFIED_BUCKETS,
                baMec: TRANSPORT_BA_MEC_BUCKETS,
                baXmec: TRANSPORT_BA_XMEC_BUCKETS,
            },
            minSums: { bm: 1, ba: 1, qualifiedBa: 1 },
            constraints: [
                { left: 'sum:qualifiedBa', op: '=', right: 'sum:ba' },
                { left: 'sum:baMec', op: '<=', right: 'sum:bmOmni' },
                { left: 'sum:baXmec', op: '<=', right: 'sum:bm' },
            ],
            scoreTerms: [
                { kind: 'target', ref: 'bm', target: 6 },
                { kind: 'target', ref: 'ba', target: 6 },
            ],
        },
    ],
};

export const COMSTAR_LEVEL_III: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Level III',
    modifiers: { 'Under-Strength ': 5, '': 6, 'Reinforced ': 7 },
    commandRank: 'Adept (Demi-Precentor)',
    tier: 2,
    childRoles: [{ matches: ['Level II'] }],
    childBucketBy: 'promotionBasic',
};

export const COMSTAR_LEVEL_IV: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Level IV',
    modifiers: { 'Under-Strength ': 5, '': 6, 'Reinforced ': 7 },
    commandRank: 'Precentor',
    tier: 3,
    childRoles: [{ matches: ['Level III'] }],
    childBucketBy: 'promotionBasic',
};

export const COMSTAR_LEVEL_V: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Level V',
    modifiers: { 'Under-Strength ': 5, '': 6, 'Reinforced ': 7 },
    commandRank: 'Precentor',
    tier: 4,
    childRoles: [{ matches: ['Level IV'] }],
    childBucketBy: 'promotionBasic',
};

export const COMSTAR_LEVEL_VI: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Level VI',
    modifiers: { 'Under-Strength ': 2, '': 6, 'Reinforced ': 12 },
    commandRank: 'Precentor Martial',
    tier: 5,
    dynamicTier: 1,
    childRoles: [{ matches: ['Level V'] }],
    childBucketBy: 'promotionBasic',
};

export const COMSTAR_CORE_ORG: OrgDefinition = {
    rules: [
        COMSTAR_LEVEL_I,
        COMSTAR_LEVEL_I_FROM_SQUADS,
        COMSTAR_LEVEL_II,
        COMSTAR_CHOIR,
        COMSTAR_LEVEL_III,
        COMSTAR_LEVEL_IV,
        COMSTAR_LEVEL_V,
        COMSTAR_LEVEL_VI,
    ],
    registry: DEFAULT_ORG_RULE_REGISTRY,
    distanceFactor: 0.2,
    minDistance: 2,
    groupDistanceFactor: 0.25,
    groupMinDistance: 1,
};
