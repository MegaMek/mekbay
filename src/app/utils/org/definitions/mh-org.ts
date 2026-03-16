import { DEFAULT_ORG_RULE_REGISTRY } from '../org-facts.util';
import type {
    OrgCIFormationRule,
    OrgComposedCountRule,
    OrgDefinitionSpec,
    OrgLeafCountRule,
} from '../org-types';

export const MH_CONTUBERNIUM_NON_INFANTRY: OrgLeafCountRule = {
    kind: 'leaf-count',
    type: 'Contubernium',
    tag: 'non-infantry',
    modifiers: { '': 1 },
    commandRank: 'Miles probatus',
    tier: 0,
    unitSelector: 'nonConventionalInfantry',
    pointModel: 'fixed',
};

export const MH_CONTUBERNIUM_INFANTRY: OrgCIFormationRule = {
    kind: 'ci-formation',
    type: 'Contubernium',
    fragmentType: 'Contubernium',
    fragmentTier: 0,
    modifiers: { '': 1 },
    unitSelector: 'CI',
    commandRank: 'Miles probatus',
    tier: 0,
    entries: [
        { moveClass: 'foot', troopers: 10, counts: { '': 1 } },
        { moveClass: 'motorized', troopers: 10, counts: { '': 1 } },
        { moveClass: 'scuba', troopers: 10, counts: { '': 1 } },
        { moveClass: 'jump', troopers: 10, counts: { '': 1 } },
        { moveClass: 'mechanized-vtol', troopers: 5, counts: { '': 1 } },
        { moveClass: 'mechanized-hover', troopers: 5, counts: { '': 1 } },
        { moveClass: 'mechanized-wheeled', troopers: 5, counts: { '': 1 } },
        { moveClass: 'mechanized-tracked', troopers: 5, counts: { '': 1 } },
        { moveClass: 'mechanized-submarine', troopers: 5, counts: { '': 1 } },
    ],
};

export const MH_CENTURY_NON_INFANTRY: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Century',
    modifiers: { '': 5 },
    commandRank: 'Centurion',
    tier: 1,
    childRoles: [{ matches: ['Contubernium'], requiredTagsAll: ['non-infantry'] }],
    childBucketBy: 'promotionBasic',
};

export const MH_CENTURY_INFANTRY: OrgCIFormationRule = {
    kind: 'ci-formation',
    type: 'Century',
    fragmentType: 'Contubernium',
    fragmentTier: 0,
    modifiers: { '': 10 },
    unitSelector: 'CI',
    commandRank: 'Centurion',
    tier: 1,
    entries: [
        { moveClass: 'foot', troopers: 10, counts: { '': 10 } },
        { moveClass: 'motorized', troopers: 10, counts: { '': 10 } },
        { moveClass: 'scuba', troopers: 10, counts: { '': 10 } },
        { moveClass: 'jump', troopers: 10, counts: { '': 5 } },
        { moveClass: 'mechanized-vtol', troopers: 5, counts: { '': 4 } },
        { moveClass: 'mechanized-hover', troopers: 5, counts: { '': 4 } },
        { moveClass: 'mechanized-wheeled', troopers: 5, counts: { '': 4 } },
        { moveClass: 'mechanized-tracked', troopers: 5, counts: { '': 4 } },
        { moveClass: 'mechanized-submarine', troopers: 5, counts: { '': 4 } },
    ],
};

export const MH_MANIPLE: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Maniple',
    modifiers: { '': 2 },
    commandRank: 'Principes',
    tier: 2,
    childRoles: [{ matches: ['Century'] }],
    childBucketBy: 'promotionBasic',
};

export const MH_COHORT: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Cohort',
    modifiers: { '': 3 },
    commandRank: 'Legatus',
    tier: 3,
    childRoles: [{ matches: ['Maniple'] }],
    childBucketBy: 'promotionBasic',
};

export const MH_LEGION: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Legion',
    modifiers: { '': 4 },
    commandRank: 'General',
    tier: 4,
    childRoles: [{ matches: ['Cohort'] }],
    childBucketBy: 'promotionBasic',
};

export const MH_CORE_ORG: OrgDefinitionSpec = {
    rules: [
        MH_CONTUBERNIUM_NON_INFANTRY,
        MH_CONTUBERNIUM_INFANTRY,
        MH_CENTURY_NON_INFANTRY,
        MH_CENTURY_INFANTRY,
        MH_MANIPLE,
        MH_COHORT,
        MH_LEGION,
    ],
    registry: DEFAULT_ORG_RULE_REGISTRY,
    distanceFactor: 0.2,
    minDistance: 2,
    groupDistanceFactor: 0.5,
    groupMinDistance: 1,
};
