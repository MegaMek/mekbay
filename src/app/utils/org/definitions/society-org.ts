import { DEFAULT_ORG_RULE_REGISTRY } from '../org-facts.util';
import type {
    OrgComposedCountRule,
    OrgDefinitionSpec,
    OrgLeafCountRule,
} from '../org-types';

export const SOCIETY_UN: OrgLeafCountRule = {
    kind: 'leaf-count',
    type: 'Un',
    modifiers: { '': 1 },
    tier: 0,
    unitSelector: 'all',
    pointModel: 'fixed',
};

export const SOCIETY_TREY: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Trey',
    modifiers: { '': 3 },
    tier: 0.8,
    childRoles: [{ role: 'un', matches: ['Un'] }],
    childBucketBy: 'promotionBasic',
};

export const SOCIETY_SEPT: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Sept',
    modifiers: { '': 7 },
    tier: 1.6,
    childRoles: [{ role: 'un', matches: ['Un'] }],
    childBucketBy: 'promotionBasic',
};

export const SOCIETY_CORE_ORG: OrgDefinitionSpec = {
    rules: [
        SOCIETY_UN,
        SOCIETY_TREY,
        SOCIETY_SEPT,
    ],
    registry: DEFAULT_ORG_RULE_REGISTRY,
    distanceFactor: 0.2,
    minDistance: 2,
    groupDistanceFactor: 0.5,
    groupMinDistance: 1,
};
