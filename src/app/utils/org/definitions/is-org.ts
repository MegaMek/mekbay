import { DEFAULT_ORG_RULE_REGISTRY } from '../org-facts.util';
import type {
    OrgComposedCountRule,
    OrgDefinitionSpec,
    OrgLeafCountRule,
    OrgLeafPatternRule,
} from '../org-types';
import {
    createExactCIComposedRule,
    createExactCISquadRule,
    INFANTRY_BA_TROOPER_BUCKETS,
} from './common';

export const IS_FLIGHT: OrgLeafCountRule = {
    kind: 'leaf-count',
    type: 'Flight',
    priority: 1,
    modifiers: { 'Under-Strength ': 1, '': 2, 'Reinforced ': 3 },
    commandRank: 'Lieutenant',
    tier: 1,
    unitSelector: 'flightEligible',
    bucketBy: 'flightType',
    pointModel: 'fixed',
};

export const IS_SQUADRON: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Squadron',
    modifiers: { 'Under-Strength ': 2, '': 3, 'Reinforced ': 4 },
    commandRank: 'Captain',
    tier: 2,
    childRoles: [{ matches: ['Flight'] }],
    childBucketBy: 'promotionBasic',
};

export const IS_WING: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Wing',
    modifiers: { 'Under-Strength ': 2, '': 3, 'Reinforced ': 4 },
    commandRank: 'Major',
    tier: 4,
    childRoles: [{ matches: ['Squadron'] }],
    childBucketBy: 'promotionBasic',
};

export const IS_BA_SQUAD: OrgLeafPatternRule = {
    kind: 'leaf-pattern',
    type: 'Squad',
    modifiers: { '': 1 },
    commandRank: 'Sergeant',
    tier: 0,
    unitSelector: 'BA',
    bucketBy: 'infantryTroopers',
    patterns: [
        {
            copySize: 1,
            matchMode: 'score',
            bucketGroups: {
                baTroopers: INFANTRY_BA_TROOPER_BUCKETS,
            },
            demands: { baTroopers: 1 },
            scoreTerms: [
                { kind: 'numeric-target', ref: 'baTroopers', target: 4, divisor: 4 },
            ],
        },
    ],
};

export const IS_SQUAD: OrgLeafPatternRule = createExactCISquadRule({
    type: 'Squad',
    commandRank: 'Sergeant',
    tier: 0,
    entries: [
        { moveClass: 'foot', troopers: 7 },
        { moveClass: 'scuba', troopers: 7 },
        { moveClass: 'motorized', troopers: 7 },
        { moveClass: 'jump', troopers: 7 },
        { moveClass: 'mechanized-vtol', troopers: 5 },
        { moveClass: 'mechanized-hover', troopers: 5 },
        { moveClass: 'mechanized-wheeled', troopers: 6 },
        { moveClass: 'mechanized-tracked', troopers: 7 },
        { moveClass: 'mechanized-submarine', troopers: 5 },
    ],
});

export const IS_PLATOON: OrgComposedCountRule = createExactCIComposedRule({
    type: 'Platoon',
    countsAs: 'Lance',
    priority: 1,
    commandRank: 'Lieutenant',
    tier: 1,
    entries: [
        { moveClass: 'foot', counts: { '': 4 } },
        { moveClass: 'motorized', counts: { '': 4 } },
        { moveClass: 'scuba', counts: { '': 4 } },
        { moveClass: 'jump', counts: { '': 3 } },
        { moveClass: 'mechanized-vtol', counts: { '': 4 } },
        { moveClass: 'mechanized-hover', counts: { '': 4 } },
        { moveClass: 'mechanized-wheeled', counts: { '': 4 } },
        { moveClass: 'mechanized-tracked', counts: { '': 4 } },
        { moveClass: 'mechanized-submarine', counts: { '': 4 } },
    ],
});

export const IS_AIR_LANCE: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Air Lance',
    priority: 1,
    countsAs: 'Lance',
    modifiers: { '': 2 },
    commandRank: 'Lieutenant',
    tier: 1.5,
    childRoles: [
        { matches: ['Flight'], min: 1 },
        { matches: ['Lance'], min: 1, onlyUnitTypes: ['BM'] },
    ],
    childBucketBy: 'promotionWithUnitKinds',
};

export const IS_SINGLE: OrgLeafCountRule = {
    kind: 'leaf-count',
    type: 'Single',
    priority: -1,
    modifiers: { '': 1 },
    tier: 0,
    unitSelector: 'nonConventionalInfantry',
    pointModel: 'fixed',
};

export const IS_LANCE: OrgLeafCountRule = {
    kind: 'leaf-count',
    type: 'Lance',
    modifiers: { 'Short ': 2, 'Under-Strength ': 3, '': 4, 'Reinforced ': 5, 'Fortified ': 6 },
    commandRank: 'Lieutenant',
    tier: 1,
    unitSelector: 'nonConventionalInfantry',
    pointModel: 'fixed',
};

export const IS_COMPANY: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Company',
    modifiers: { 'Under-Strength ': { count: 2, tier: 1.5 }, '': 3, 'Reinforced ': 4 },
    commandRank: 'Captain',
    tier: 2,
    dynamicTier: 1,
    childRoles: [{ matches: ['Lance', 'Flight'] }],
    childBucketBy: 'promotionBasic',
};

export const IS_BATTALION: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Battalion',
    modifiers: { 'Under-Strength ': 2, '': 3, 'Reinforced ': 4 },
    commandRank: 'Major',
    tier: 3,
    dynamicTier: 1,
    childRoles: [{ matches: ['Company', 'Squadron'] }],
    childBucketBy: 'promotionBasic',
};

export const IS_REGIMENT: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Regiment',
    modifiers: { 'Under-Strength ': 2, '': 3, 'Reinforced ': 4, 'Strong ': 5 },
    commandRank: 'Colonel',
    tier: 4,
    dynamicTier: 1,
    childRoles: [{ matches: ['Battalion', 'Wing'] }],
    childBucketBy: 'promotionBasic',
};

export const IS_BRIGADE: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Brigade',
    modifiers: { 'Under-Strength ': 2, '': 3, 'Reinforced ': 4 },
    commandRank: 'General',
    tier: 5,
    dynamicTier: 1,
    childRoles: [{ matches: ['Regiment'] }],
    childBucketBy: 'promotionBasic',
};

export const IS_CORE_ORG: OrgDefinitionSpec = {
    rules: [
        IS_FLIGHT,
        IS_SQUADRON,
        IS_WING,
        IS_BA_SQUAD,
        IS_SQUAD,
        IS_PLATOON,
        IS_SINGLE,
        IS_LANCE,
        IS_AIR_LANCE,
        IS_COMPANY,
        IS_BATTALION,
        IS_REGIMENT,
        IS_BRIGADE,
    ],
    registry: DEFAULT_ORG_RULE_REGISTRY,
    distanceFactor: 0.2,
    minDistance: 2,
    groupDistanceFactor: 0.25,
    groupMinDistance: 1,
};
