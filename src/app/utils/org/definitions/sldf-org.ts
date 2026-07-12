import { DEFAULT_ORG_RULE_REGISTRY } from '../org-facts.util';
import type {
    OrgComposedCountRule,
    OrgDefinition,
    OrgLeafCountRule,
} from '../org-types';
import {
    IS_FLIGHT,
    IS_SQUADRON,
    IS_WING,
    IS_PLATOON,
    IS_UNIT,
    IS_LANCE,
    IS_AIR_LANCE,
    IS_COMPANY,
    IS_BATTALION,
    IS_REGIMENT,
    IS_BRIGADE,
} from './is-org';

export const SLDF_LANCE: OrgLeafCountRule = {
    ...IS_LANCE,
    unitSelector: ['BM', 'IM'],
};

export const SLDF_PLATOON: OrgLeafCountRule = {
    ...IS_LANCE,
    type: 'Platoon',
    countsAs: 'Lance',
    unitSelector: ['CV', 'SV'],
};

export const SLDF_BATTALION: OrgComposedCountRule = {
    ...IS_BATTALION,
    childRoles: [{ matches: ['Company', 'Squadron'] }],
};

export const SLDF_REGIMENT: OrgComposedCountRule = {
    ...IS_REGIMENT,
    childRoles: [{ matches: ['Battalion', 'Group'] }],
};

export const SLDF_BRIGADE: OrgComposedCountRule = {
    ...IS_BRIGADE,
    commandRank: 'Lieutenant General',
    childRoles: [{ matches: ['Regiment', 'Wing'] }],
};

export const SLDF_DIVISION: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Division',
    modifiers: { 'Under-Strength ': 2, '': 3, 'Reinforced ': 4 },
    commandRank: 'Major General',
    tier: 6,
    childRoles: [{ matches: ['Brigade'] }],
    childBucketBy: 'promotionBasic',
};

export const SLDF_CORPS: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Corps',
    modifiers: { 'Under-Strength ': 2, '': 3, 'Reinforced ': 4 },
    commandRank: 'Major General',
    tier: 7,
    childRoles: [{ matches: ['Division'] }],
    childBucketBy: 'promotionBasic',
};

export const SLDF_ARMY: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Army',
    modifiers: { 'Under-Strength ': 2, '': 3, 'Reinforced ': 4 },
    commandRank: 'General',
    tier: 8,
    childRoles: [{ matches: ['Corps'] }],
    childBucketBy: 'promotionBasic',
};

export const SLDF_ARMY_GROUP: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Army Group',
    modifiers: { 'Under-Strength ': 2, '': 3, 'Reinforced ': 4 },
    commandRank: 'General',
    tier: 9,
    childRoles: [{ matches: ['Army'] }],
    childBucketBy: 'promotionBasic',
};

export const SLDF_GROUP: OrgComposedCountRule = {
    ...IS_WING,
    type: 'Group',
    childRoles: [{ matches: ['Squadron'], onlyUnitTypes: ['AF', 'CF'] }],
};

export const SLDF_WING: OrgComposedCountRule = {
    ...IS_REGIMENT,
    type: 'Wing',
    countsAs: 'Regiment',
    childRoles: [{ matches: ['Group'] }],
};

export const SLDF_FLOTILLA: OrgLeafCountRule = {
    kind: 'leaf-count',
    type: 'Flotilla',
    priority: 1,
    modifiers: { '': 2, 'Reinforced ': 3 },
    commandRank: 'Commodore',
    tier: 1,
    unitSelector: ['DA', 'DS', 'JS', 'WS'],
    pointModel: 'fixed',
};

export const SLDF_NAVAL_DIVISION: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Naval Division',
    modifiers: { 'Under-Strength ': 2, '': 3, 'Reinforced ': 4 },
    commandRank: 'Rear Admiral',
    tier: 2,
    childRoles: [{ matches: ['Flotilla'] }],
    childBucketBy: 'promotionBasic',
};

export const SLDF_NAVAL_SQUADRON: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Naval Squadron',
    modifiers: { 'Under-Strength ': 2, '': 3, 'Reinforced ': 4 },
    commandRank: 'Vice Admiral',
    tier: 3,
    childRoles: [{ matches: ['Naval Division'] }],
    childBucketBy: 'promotionBasic',
};

export const SLDF_FLEET: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Fleet',
    modifiers: { 'Under-Strength ': 2, '': 3, 'Reinforced ': 4 },
    commandRank: 'Admiral',
    tier: 4,
    childRoles: [{ matches: ['Naval Squadron'] }],
    childBucketBy: 'promotionBasic',
};

export const SLDF_CORE_ORG: OrgDefinition = {
    rules: [
        IS_UNIT,
        IS_FLIGHT,
        IS_SQUADRON,
        SLDF_GROUP,
        SLDF_WING,
        IS_PLATOON,
        SLDF_LANCE,
        SLDF_PLATOON,
        IS_AIR_LANCE,
        IS_COMPANY,
        SLDF_BATTALION,
        SLDF_REGIMENT,
        SLDF_BRIGADE,
        SLDF_DIVISION,
        SLDF_CORPS,
        SLDF_ARMY,
        SLDF_ARMY_GROUP,
        SLDF_FLOTILLA,
        SLDF_NAVAL_DIVISION,
        SLDF_NAVAL_SQUADRON,
        SLDF_FLEET
    ],
    registry: DEFAULT_ORG_RULE_REGISTRY,
    distanceFactor: 0.2,
    minDistance: 2,
    groupDistanceFactor: 0.25,
    groupMinDistance: 1,
};