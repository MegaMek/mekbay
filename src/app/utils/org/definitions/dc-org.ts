import { DEFAULT_ORG_RULE_REGISTRY } from '../org-facts.util';
import type {
    OrgComposedCountRule,
    OrgDefinitionSpec,
    OrgLeafCountRule,
} from '../org-types';
import {
    IS_BA_PLATOON,
    IS_BATTALION,
    IS_BA_SQUAD,
    IS_COMPANY,
    IS_LANCE,
    IS_AIR_LANCE,
    IS_PLATOON,
    IS_REGIMENT,
    IS_BRIGADE,
    IS_UNIT,
} from './is-org';

export const DC_LANCE: OrgLeafCountRule = {
    kind: 'leaf-count',
    type: 'Lance',
    priority: 1,
    modifiers: { '': 2, 'Reinforced ': 3 },
    commandRank: 'Lieutenant',
    tier: 1,
    unitSelector: 'flightEligible',
    bucketBy: 'flightType',
    pointModel: 'fixed',
};

export const DC_FLIGHT: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Flight',
    modifiers: { 'Under-Strength ': 2, '': 3, 'Reinforced ': 4 },
    commandRank: 'Captain',
    tier: 2,
    childRoles: [{ matches: ['Lance'], onlyUnitTypes: ['AF'] }],
    childBucketBy: 'promotionBasic',
};

export const DC_COMPANY: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Company',
    modifiers: { '': 2, 'Reinforced ': 3 },
    commandRank: 'Captain',
    tier: 2.5,
    childRoles: [{ matches: ['Flight'] }],
    childBucketBy: 'promotionBasic',
};

export const DC_WING: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Wing',
    modifiers: { 'Under-Strength ': 2, '': 3, 'Reinforced ': 4 },
    commandRank: 'Major',
    tier: 3.5,
    childRoles: [{ matches: ['Company'], onlyUnitTypes: ['AF'] }],    
    childBucketBy: 'promotionBasic',
};

export const DC_CORE_ORG: OrgDefinitionSpec = {
    rules: [
        DC_LANCE,
        DC_FLIGHT,
        DC_COMPANY,
        DC_WING,
        IS_BA_SQUAD,
        IS_BA_PLATOON,
        IS_PLATOON,
        IS_UNIT,
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