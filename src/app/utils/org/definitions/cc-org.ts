import { DEFAULT_ORG_RULE_REGISTRY } from '../org-facts.util';
import type {
    OrgComposedCountRule,
    OrgDefinitionSpec,
    OrgLeafPatternRule,
    OrgLeafCountRule,
} from '../org-types';
import {
    IS_BA_PLATOON,
    IS_BATTALION,
    IS_BA_SQUAD,
    IS_COMPANY,
    IS_LANCE,
    IS_PLATOON,
    IS_REGIMENT,
    IS_BRIGADE,
    IS_UNIT,
} from './is-org';
import {
    TRANSPORT_BA_ALL_BUCKETS,
    TRANSPORT_BA_MEC_BUCKETS,
    TRANSPORT_BA_QUALIFIED_BUCKETS,
    TRANSPORT_BM_CARRIER_BUCKETS,
    TRANSPORT_BM_OMNI_CARRIER_BUCKETS,
    TRANSPORT_CV_CARRIER_BUCKETS,
    TRANSPORT_CV_OMNI_CARRIER_BUCKETS,
} from './common';

export const CC_ELEMENT: OrgLeafCountRule = {
    kind: 'leaf-count',
    type: 'Element',
    priority: 1,
    modifiers: { 'Under-Strength ': 1, '': 2 },
    commandRank: 'Lieutenant',
    tier: 1,
    unitSelector: 'flightEligible',
    bucketBy: 'flightType',
    pointModel: 'fixed',
};

export const CC_TRIPLE: OrgLeafCountRule = {
    kind: 'leaf-count',
    type: 'Triple',
    priority: 1,
    modifiers: { '': 3 },
    commandRank: 'Lieutenant',
    tier: 1,
    unitSelector: 'flightEligible',
    bucketBy: 'flightType',
    pointModel: 'fixed',
};

export const CC_SQUADRON_ELEMENT: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Squadron',
    modifiers: { 'Under-Strength ': 2, '': 3, 'Reinforced ': 4 },
    commandRank: 'Captain',
    tier: 2,
    childRoles: [{ matches: ['Element'] }],
    childBucketBy: 'promotionBasic',
};

export const CC_SQUADRON_TRIPLE: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Squadron',
    modifiers: { '': 2, 'Reinforced ': 3 },
    commandRank: 'Captain',
    tier: 2,
    childRoles: [{ matches: ['Triple'] }],
    childBucketBy: 'promotionBasic',
};

export const CC_FLIGHT: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Flight',
    modifiers: { '': 2, 'Reinforced ': 3 },
    commandRank: 'Major',
    tier: 3.1,
    childRoles: [{ matches: ['Squadron'] }],    
    childBucketBy: 'promotionBasic',
};

export const CC_WING: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Wing',
    modifiers: { 'Under-Strength ': 3, '': 4, 'Reinforced ': 5 },
    commandRank: 'Lieutenant Colonel',
    tier: 3.5,
    childRoles: [
        { matches: ['Flight'], min: 2 },
        { matches: ['Element', 'Triple'], min: 1, max: 1 },
    ],
    childBucketBy: 'promotionBasic',
};

export const CC_FLEET_REGIMENT: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Fleet Regiment',
    modifiers: { 'Under-Strength ': 4, '': 5, 'Reinforced ': 6 },
    commandRank: 'Colonel',
    tier: 3.9,
    childRoles: [
        { matches: ['Wing'], min: 2 },
        { matches: ['Element', 'Triple'], min: 2, max: 2 },
    ],
    childBucketBy: 'promotionBasic',
};

export const CC_AUGMENTED_LANCE: OrgLeafPatternRule = {
    kind: 'leaf-pattern',
    type: 'Augmented Lance',
    priority: 1,
    countsAs: 'Lance',
    modifiers: { '': 6 },
    commandRank: 'Lieutenant',
    tier: 1.05,
    unitSelector: ['BM', 'CV', 'BA'],
    bucketBy: 'transport',
    patterns: [
        {
            copySize: 6,
            matchMode: 'score',
            bucketGroups: {
                carrier: TRANSPORT_BM_CARRIER_BUCKETS,
                other: TRANSPORT_CV_CARRIER_BUCKETS,
                ba: TRANSPORT_BA_ALL_BUCKETS,
            },
            scoreTerms: [
                { kind: 'target', ref: 'carrier', target: 4 },
                { kind: 'target', ref: 'other', target: 2 },
                { kind: 'target', ref: 'ba', target: 0 },
            ],
        },
        {
            copySize: 6,
            matchMode: 'score',
            bucketGroups: {
                carrier: TRANSPORT_CV_CARRIER_BUCKETS,
                other: TRANSPORT_BM_CARRIER_BUCKETS,
                ba: TRANSPORT_BA_ALL_BUCKETS,
            },
            scoreTerms: [
                { kind: 'target', ref: 'carrier', target: 4 },
                { kind: 'target', ref: 'other', target: 2 },
                { kind: 'target', ref: 'ba', target: 0 },
            ],
        },
        {
            copySize: 6,
            matchMode: 'score',
            bucketGroups: {
                carrier: TRANSPORT_BM_CARRIER_BUCKETS,
                other: TRANSPORT_CV_CARRIER_BUCKETS,
                carrierOmni: TRANSPORT_BM_OMNI_CARRIER_BUCKETS,
                ba: TRANSPORT_BA_ALL_BUCKETS,
                qualifiedBa: TRANSPORT_BA_QUALIFIED_BUCKETS,
                baMec: TRANSPORT_BA_MEC_BUCKETS,
            },
            scoreTerms: [
                { kind: 'target', ref: 'carrier', target: 4 },
                { kind: 'target', ref: 'other', target: 0 },
                { kind: 'target', ref: 'qualifiedBa', target: 2 },
                { kind: 'positive-diff', left: 'ba', right: 'qualifiedBa' },
                { kind: 'positive-diff', left: 'baMec', right: 'carrierOmni' },
            ],
        },
        {
            copySize: 6,
            matchMode: 'score',
            bucketGroups: {
                carrier: TRANSPORT_CV_CARRIER_BUCKETS,
                other: TRANSPORT_BM_CARRIER_BUCKETS,
                carrierOmni: TRANSPORT_CV_OMNI_CARRIER_BUCKETS,
                ba: TRANSPORT_BA_ALL_BUCKETS,
                qualifiedBa: TRANSPORT_BA_QUALIFIED_BUCKETS,
                baMec: TRANSPORT_BA_MEC_BUCKETS,
            },
            scoreTerms: [
                { kind: 'target', ref: 'carrier', target: 4 },
                { kind: 'target', ref: 'other', target: 0 },
                { kind: 'target', ref: 'qualifiedBa', target: 4 },
                { kind: 'positive-diff', left: 'ba', right: 'qualifiedBa' },
                { kind: 'positive-diff', left: 'baMec', right: 'carrierOmni' },
            ],
        },
    ],
};

export const CC_AUGMENTED_COMPANY: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Augmented Company',
    priority: 1,
    countsAs: 'Company',
    modifiers: { '': 2, 'Reinforced ': 3 },
    commandRank: 'Captain',
    tier: IS_COMPANY.tier + 0.01,
    childRoles: [{ matches: ['Augmented Lance'] }],
    childBucketBy: 'promotionBasic',
};

export const CC_AUGMENTED_BATTALION: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Augmented Battalion',
    priority: 1,
    countsAs: 'Battalion',
    modifiers: { 'Under-Strength ': 3, '': 4, 'Reinforced ': 5 },
    commandRank: 'Major',
    tier: IS_BATTALION.tier + 0.01,
    childRoles: [{ matches: ['Augmented Company'] }],
    childBucketBy: 'promotionBasic',
};

export const CC_AUGMENTED_REGIMENT: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Augmented Regiment',
    countsAs: 'Regiment',
    modifiers: { 'Under-Strength ': 3, '': 4, 'Reinforced ': 5 },
    commandRank: 'General',
    tier: IS_REGIMENT.tier + 0.01,
    childRoles: [
        { matches: ['Augmented Battalion'], min: 1 },
        { matches: ['Augmented Battalion', 'Battalion', 'Wing'] },
    ],
    childBucketBy: 'promotionBasic',
};

export const CC_CORE_ORG: OrgDefinitionSpec = {
    rules: [
        CC_ELEMENT,
        CC_TRIPLE,
        CC_SQUADRON_ELEMENT,
        CC_SQUADRON_TRIPLE,
        CC_FLIGHT,
        CC_WING,
        CC_FLEET_REGIMENT,
        IS_BA_SQUAD,
        IS_BA_PLATOON,
        IS_PLATOON,
        IS_UNIT,
        IS_LANCE,
        IS_COMPANY,
        IS_BATTALION,
        IS_REGIMENT,
        IS_BRIGADE,
        CC_AUGMENTED_LANCE,
        CC_AUGMENTED_COMPANY,
        CC_AUGMENTED_BATTALION,
        CC_AUGMENTED_REGIMENT,
    ],
    registry: DEFAULT_ORG_RULE_REGISTRY,
    distanceFactor: 0.2,
    minDistance: 2,
    groupDistanceFactor: 0.25,
    groupMinDistance: 1,
};