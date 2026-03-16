import { createOrgRuleRegistry } from '../org-facts.util';
import type {
    OrgComposedCountRule,
    OrgDefinitionSpec,
    OrgLeafCountRule,
    OrgLeafPatternRule,
    OrgSelectorName,
    UnitFacts,
} from '../org-types';

const SOCIETY_FALLBACK_SELECTOR = 'societyFallback' as OrgSelectorName;

const SOCIETY_RULE_REGISTRY = createOrgRuleRegistry({
    unitSelectors: {
        [SOCIETY_FALLBACK_SELECTOR]: (facts: UnitFacts) => {
            const unitType = facts.unit.as.TP;
            return unitType !== 'BA'
                && unitType !== 'CI'
                && unitType !== 'PM'
                && unitType !== 'CV'
                && unitType !== 'AF';
        },
    },
});

export const SOCIETY_BA_UN: OrgLeafPatternRule = {
    kind: 'leaf-pattern',
    type: 'Un',
    modifiers: { '': 1 },
    tier: 0,
    unitSelector: 'BA',
    bucketBy: 'infantryTroopers',
    patterns: [
        {
            copySize: 1,
            demands: { 'BA:3': 1 },
        },
    ],
};

export const SOCIETY_CI_UN: OrgLeafPatternRule = {
    kind: 'leaf-pattern',
    type: 'Un',
    modifiers: { '': 1 },
    tier: 0,
    unitSelector: 'CI',
    bucketBy: 'infantryTroopers',
    patterns: [
        {
            copySize: 1,
            demands: { 'CI:75': 1 },
        },
    ],
};

export const SOCIETY_PM_UN: OrgLeafCountRule = {
    kind: 'leaf-count',
    type: 'Un',
    modifiers: { '': 3 },
    tier: 0,
    unitSelector: 'PM',
    pointModel: 'fixed',
};

export const SOCIETY_CV_UN: OrgLeafCountRule = {
    kind: 'leaf-count',
    type: 'Un',
    modifiers: { '': 7 },
    tier: 0,
    unitSelector: 'CV',
    pointModel: 'fixed',
};

export const SOCIETY_AF_UN: OrgLeafCountRule = {
    kind: 'leaf-count',
    type: 'Un',
    modifiers: { '': 3 },
    tier: 0,
    unitSelector: 'AF',
    pointModel: 'fixed',
};

export const SOCIETY_FALLBACK_UN: OrgLeafCountRule = {
    kind: 'leaf-count',
    type: 'Un',
    modifiers: { '': 1 },
    tier: 0,
    unitSelector: SOCIETY_FALLBACK_SELECTOR,
    pointModel: 'fixed',
};

export const SOCIETY_TREY: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Trey',
    modifiers: { '': 3 },
    tier: 0.8,
    childRoles: [{ matches: ['Un'] }],
    childBucketBy: 'promotionBasic',
};

export const SOCIETY_SEPT: OrgComposedCountRule = {
    kind: 'composed-count',
    type: 'Sept',
    modifiers: { '': 7 },
    tier: 1.6,
    childRoles: [{ matches: ['Un'] }],
    childBucketBy: 'promotionBasic',
};

export const SOCIETY_CORE_ORG: OrgDefinitionSpec = {
    rules: [
        SOCIETY_BA_UN,
        SOCIETY_CI_UN,
        SOCIETY_PM_UN,
        SOCIETY_CV_UN,
        SOCIETY_AF_UN,
        SOCIETY_FALLBACK_UN,
        SOCIETY_TREY,
        SOCIETY_SEPT,
    ],
    registry: SOCIETY_RULE_REGISTRY,
    distanceFactor: 0.2,
    minDistance: 2,
    groupDistanceFactor: 0.5,
    groupMinDistance: 1,
};
