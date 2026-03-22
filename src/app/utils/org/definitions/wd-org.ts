import { ASUnitTypeCode } from '../../../models/units.model';
import { DEFAULT_ORG_RULE_REGISTRY } from '../org-facts.util';
import type {
    OrgComposedCountRule,
    OrgComposedPatternRule,
    OrgDefinitionSpec,
    OrgLeafCountRule,
} from '../org-types';
import {
    CLAN_CLUSTER,
    CLAN_NOVA,
    CLAN_POINT,
    CLAN_CV_POINT,
    CLAN_SUPERNOVA_BINARY,
    CLAN_SUPERNOVA_TRINARY,
} from './clan-org';
import {
    IS_FLIGHT,
    IS_PLATOON,
    IS_BA_SQUAD,
    IS_BA_PLATOON,
    IS_REGIMENT,
    IS_SINGLE,
    IS_SQUADRON,
    IS_WING,
} from './is-org';

export const WD_SINGLE: OrgLeafCountRule = {
    ... IS_SINGLE,
    commandRank: 'Sergeant',
};

export const WD_POINT: OrgLeafCountRule = {
    ... CLAN_POINT,
    commandRank: 'Sergeant',
};

export const WD_CV_POINT: OrgLeafCountRule = {
    ...CLAN_CV_POINT,
    commandRank: 'Sergeant',
};

export const WD_NOVA: OrgComposedPatternRule = {
    ...CLAN_NOVA,
    commandRank: 'Lieutenant',
};

export const WD_SUPERNOVA_BINARY: OrgComposedCountRule = {
    ...CLAN_SUPERNOVA_BINARY,
    commandRank: 'Captain',
};

export const WD_SUPERNOVA_TRINARY: OrgComposedCountRule = {
    ...CLAN_SUPERNOVA_TRINARY,
    commandRank: 'Captain',
};

export const WD_LANCE: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Lance',
    modifiers: { 'Short ': 2, 'Under-Strength ': 3, '': 4, 'Reinforced ': 5, 'Fortified ': 6 },
    commandRank: 'Lieutenant',
    tier: 1,
    childRoles: [{ matches: ['Single'] }],
    childBucketBy: 'promotionWithUnitKinds',
};

export const WD_STAR: OrgComposedCountRule = {
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
    commandRank: 'Lieutenant',
    tier: 1,
    childRoles: [{ matches: ['Point'] }],
    childBucketBy: 'promotionWithUnitKinds',
};

export const WD_BINARY: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Binary',
    countsAs: 'Company',
    modifiers: { '': 2 },
    commandRank: 'Captain',
    tier: 1.8,
    childRoles: [{ matches: ['Star'] }],
    childBucketBy: 'promotionBasic',
};

export const WD_TRINARY: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Trinary',
    countsAs: 'Company',
    modifiers: { '': 3 },
    commandRank: 'Captain',
    tier: 2,
    childRoles: [{ matches: ['Star'] }],
    childBucketBy: 'promotionBasic',
};

export const WD_CLUSTER: OrgComposedCountRule = {
    ...CLAN_CLUSTER,
    priority: 1,
    countsAs: 'Battalion',
    commandRank: 'Major',
    childRoles: [{ matches: ['Binary', 'Trinary'] }],
};

export const WD_COMPANY: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Company',
    modifiers: { 'Under-Strength ': { count: 2, tier: 1.5 }, '': 3, 'Reinforced ': 4 },
    commandRank: 'Captain',
    tier: 2,
    dynamicTier: 1,
    childRoles: [
        { matches: ['Lance'], min: 1 },
        { matches: ['Lance', 'Star'] },
    ],
    childBucketBy: 'promotionBasic',
};

export const WD_BATTALION: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Battalion',
    modifiers: { 'Under-Strength ': 2, '': 3, 'Reinforced ': 4 },
    commandRank: 'Major',
    tier: 3,
    dynamicTier: 1,
    childRoles: [
        { matches: ['Company'], min: 1 },
        { matches: ['Company', 'Binary', 'Trinary'] },
    ],
    childBucketBy: 'promotionBasic',
};

export const WD_CORE_ORG: OrgDefinitionSpec = {
    rules: [
        IS_FLIGHT,
        IS_SQUADRON,
        IS_WING,
        IS_PLATOON,
        IS_BA_SQUAD,
        IS_BA_PLATOON,
        WD_NOVA,
        WD_SUPERNOVA_BINARY,
        WD_SUPERNOVA_TRINARY,
        WD_CV_POINT,
        WD_POINT,
        WD_SINGLE,
        WD_LANCE,
        WD_STAR,
        WD_BINARY,
        WD_TRINARY,
        WD_CLUSTER,
        WD_COMPANY,
        WD_BATTALION,
        IS_REGIMENT,
    ],
    registry: DEFAULT_ORG_RULE_REGISTRY,
    distanceFactor: 0.2,
    minDistance: 2,
    groupDistanceFactor: 0.25,
    groupMinDistance: 1,
};
