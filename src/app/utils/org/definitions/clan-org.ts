import { DEFAULT_ORG_RULE_REGISTRY } from '../org-facts.util';
import type {
    OrgCIFormationRule,
    OrgComposedCountRule,
    OrgComposedPatternRule,
    OrgDefinitionSpec,
    OrgLeafCountRule,
} from '../org-types';
import {
    TRANSPORT_AF_CARRIER_BUCKETS,
    TRANSPORT_AF_OMNI_CARRIER_BUCKETS,
    TRANSPORT_BA_MEC_BUCKETS,
    TRANSPORT_BA_QUALIFIED_BUCKETS,
    TRANSPORT_BM_CARRIER_BUCKETS,
    TRANSPORT_BM_OMNI_CARRIER_BUCKETS,
    TRANSPORT_CV_CARRIER_BUCKETS,
    TRANSPORT_CV_OMNI_CARRIER_BUCKETS,
    TRANSPORT_NON_AF_NOVA_BUCKETS,
    TRANSPORT_NON_BM_NOVA_BUCKETS,
    TRANSPORT_NON_CV_NOVA_BUCKETS,
} from './common';

export const CLAN_POINT: OrgLeafCountRule = {
    kind: 'leaf-count',
    type: 'Point',
    modifiers: { '': 1 },
    commandRank: 'Point Commander',
    tier: 0,
    unitSelector: ['BM', 'IM', 'PM', 'BA', 'SC', 'WS', 'SS', 'JS', 'DA', 'DS', 'BD'],
    pointModel: 'fixed',
};

export const CLAN_CV_POINT: OrgLeafCountRule = {
    kind: 'leaf-count',
    type: 'Point',
    modifiers: { '': 2 },
    commandRank: 'Point Commander',
    tier: 0,
    unitSelector: ['CV', 'SV', 'AF', 'CF'],
    bucketBy: 'moveType',
    pointModel: 'fixed',
};

export const CLAN_CI_POINT: OrgCIFormationRule = {
    kind: 'ci-formation',
    type: 'Point',
    fragmentType: 'Squad',
    fragmentTier: 0,
    modifiers: { '': 5 },
    unitSelector: 'CI',
    commandRank: 'Point Commander',
    tier: 0,
    entries: [
        { moveClass: 'foot', troopers: 5, counts: { '': 5 } },
        { moveClass: 'motorized', troopers: 5, counts: { '': 5 } },
        { moveClass: 'scuba', troopers: 5, counts: { '': 5 } },
        { moveClass: 'jump', troopers: 5, counts: { '': 4 } },
        { moveClass: 'mechanized-vtol', troopers: 5, counts: { '': 4 } },
        { moveClass: 'mechanized-hover', troopers: 5, counts: { '': 4 } },
        { moveClass: 'mechanized-wheeled', troopers: 5, counts: { '': 4 } },
        { moveClass: 'mechanized-tracked', troopers: 5, counts: { '': 4 } },
        { moveClass: 'mechanized-submarine', troopers: 5, counts: { '': 4 } },
    ],
};

export const CLAN_STAR: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Star',
    modifiers: {
        'Half ': 2,
        'Short ': 3,
        'Under-Strength ': 4,
        '': 5,
        'Reinforced ': 6,
        'Fortified ': 7,
    },
    commandRank: 'Star Commander',
    tier: 1,
    childRoles: [{ matches: ['Point'] }],
    childBucketBy: 'promotionBasic',
};

export const CLAN_NOVA: OrgComposedPatternRule = {
    kind: 'composed-pattern',
    type: 'Nova',
    countsAs: 'Star',
    modifiers: { '': 2 },
    commandRank: 'Nova Commander',
    tier: 1.9,
    childRoles: [
        { matches: ['Star'], min: 1, max: 1, onlyUnitTypes: ['BA'] },
        { matches: ['Star'], min: 1, max: 1, onlyUnitTypes: ['BM', 'CV', 'AF', 'CF'] },
    ],
    bucketBy: 'transport',
    patterns: [
        {
            copySize: 10,
            bucketGroups: {
                carrier: TRANSPORT_BM_CARRIER_BUCKETS,
                carrierOmni: TRANSPORT_BM_OMNI_CARRIER_BUCKETS,
                qualifiedBa: TRANSPORT_BA_QUALIFIED_BUCKETS,
                mecBa: TRANSPORT_BA_MEC_BUCKETS,
                invalid: TRANSPORT_NON_BM_NOVA_BUCKETS,
            },
            minSums: { carrier: 5, qualifiedBa: 5 },
            maxSums: { carrier: 5, qualifiedBa: 5, invalid: 0 },
            constraints: [{ left: 'sum:mecBa', op: '<=', right: 'sum:carrierOmni' }],
        },
        {
            copySize: 15,
            bucketGroups: {
                carrier: TRANSPORT_CV_CARRIER_BUCKETS,
                carrierOmni: TRANSPORT_CV_OMNI_CARRIER_BUCKETS,
                qualifiedBa: TRANSPORT_BA_QUALIFIED_BUCKETS,
                mecBa: TRANSPORT_BA_MEC_BUCKETS,
                invalid: TRANSPORT_NON_CV_NOVA_BUCKETS,
            },
            minSums: { carrier: 10, qualifiedBa: 5 },
            maxSums: { carrier: 10, qualifiedBa: 5, invalid: 0 },
            constraints: [{ left: 'sum:mecBa', op: '<=', right: 'sum:carrierOmni' }],
        },
        {
            copySize: 15,
            bucketGroups: {
                carrier: TRANSPORT_AF_CARRIER_BUCKETS,
                carrierOmni: TRANSPORT_AF_OMNI_CARRIER_BUCKETS,
                qualifiedBa: TRANSPORT_BA_QUALIFIED_BUCKETS,
                mecBa: TRANSPORT_BA_MEC_BUCKETS,
                invalid: TRANSPORT_NON_AF_NOVA_BUCKETS,
            },
            minSums: { carrier: 10, qualifiedBa: 5 },
            maxSums: { carrier: 10, qualifiedBa: 5, invalid: 0 },
            constraints: [{ left: 'sum:mecBa', op: '<=', right: 'sum:carrierOmni' }],
        },
    ],
};

export const CLAN_BINARY: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Binary',
    modifiers: { '': 2 },
    commandRank: 'Star Captain',
    tier: 1.8,
    childRoles: [{ matches: ['Star'] }],
    childBucketBy: 'promotionBasic',
};

export const CLAN_TRINARY: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Trinary',
    modifiers: { '': 3 },
    commandRank: 'Star Captain',
    tier: 2,
    childRoles: [{ matches: ['Star'] }],
    childBucketBy: 'promotionBasic',
    alternativeCompositions: [
        {
            modifiers: { '': 2 },
            childRoles: [
                { matches: ['Binary'], min: 1 },
                { matches: ['Star'], min: 1 },
            ],
            childBucketBy: 'promotionBasic',
        },
    ],
};

export const CLAN_SUPERNOVA_BINARY: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Supernova Binary',
    countsAs: 'Binary',
    modifiers: { '': 2 },
    commandRank: 'Nova Captain',
    tier: 2.1,
    childRoles: [{ matches: ['Nova'] }],
    childBucketBy: 'promotionBasic',
};

export const CLAN_SUPERNOVA_TRINARY: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Supernova Trinary',
    countsAs: 'Trinary',
    modifiers: { '': 3 },
    commandRank: 'Nova Captain',
    tier: 2.5,
    childRoles: [{ matches: ['Nova'] }],
    childBucketBy: 'promotionBasic',
    alternativeCompositions: [
        {
            modifiers: { '': 2 },
            childRoles: [
                { matches: ['Supernova Binary'], min: 1 },
                { matches: ['Nova'], min: 1 },
            ],
            childBucketBy: 'promotionBasic',
        },
    ],
};

export const CLAN_CLUSTER: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Cluster',
    modifiers: { 'Under-Strength ': 2, '': 3, 'Reinforced ': 4, 'Strong ': 5 },
    commandRank: 'Star Colonel',
    tier: 3,
    childRoles: [{ matches: ['Binary', 'Trinary'] }],
    childBucketBy: 'promotionBasic',
};

export const CLAN_GALAXY: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Galaxy',
    modifiers: { 'Under-Strength ': 2, '': 3, 'Reinforced ': 4, 'Strong ': 5 },
    commandRank: 'Galaxy Commander',
    tier: 4,
    childRoles: [{ matches: ['Cluster'] }],
    childBucketBy: 'promotionBasic',
};

export const CLAN_CORE_ORG: OrgDefinitionSpec = {
    rules: [
        CLAN_NOVA,
        CLAN_SUPERNOVA_BINARY,
        CLAN_SUPERNOVA_TRINARY,
        CLAN_CI_POINT,
        CLAN_CV_POINT,
        CLAN_POINT,
        CLAN_STAR,
        CLAN_BINARY,
        CLAN_TRINARY,
        CLAN_CLUSTER,
        CLAN_GALAXY,
    ],
    registry: DEFAULT_ORG_RULE_REGISTRY,
    distanceFactor: 0.2,
    minDistance: 2,
    groupDistanceFactor: 0.25,
    groupMinDistance: 1,
};
