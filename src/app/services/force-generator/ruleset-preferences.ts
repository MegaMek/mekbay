// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type {
    MegaMekRulesetAssign,
    MegaMekRulesetForceNode,
    MegaMekRulesetOptionGroup,
    MegaMekRulesetSubforceNode,
    MegaMekRulesetWhen,
} from '../../models/megamek/rulesets.model';
import type { OrgType } from '../../utils/org/org-types';
import { getPositiveRulesetValues, matchesRulesetWhen, normalizeRulesetToken, type RulesetMatchContext } from './ruleset-matching';
import { pickWeightedRandomEntry } from './weighted-selection';

interface RulesetCandidate {
    megaMekUnitType: string;
    megaMekWeightClass?: string;
    role?: string;
    motive?: string;
}

interface RulesetPreferenceSource {
    unitTypes?: string[];
    weightClasses?: string[];
    roles?: string[];
    motives?: string[];
}

export interface RulesetTemplate {
    unitTypes: Set<string>;
    weightClasses: Set<string>;
    roles: Set<string>;
    motives: Set<string>;
}

export interface RulesetProfile {
    selectedEchelon?: string;
    preferredOrgType?: OrgType;
    preferredUnitCount?: number;
    requiredUnitTypes: Set<string>;
    preferredUnitTypes: Set<string>;
    preferredWeightClasses: Set<string>;
    preferredRoles: Set<string>;
    preferredMotives: Set<string>;
    templates: RulesetTemplate[];
    explanationNotes: string[];
}

export function applyForceNodeToProfile(
    profile: RulesetProfile,
    forceNode: MegaMekRulesetForceNode,
    matchContext: RulesetMatchContext,
): void {
    addRulesetValues(profile.requiredUnitTypes, getPositiveRulesetValues(forceNode.when?.unitTypes));
    mergeRulesetWhenIntoProfile(profile, forceNode.when);
    mergeRulesetNodeIntoProfile(profile, forceNode.assign);
    mergeRulesetGroupIntoProfile(profile, forceNode.unitType, matchContext);
    mergeRulesetGroupIntoProfile(profile, forceNode.weightClass, matchContext);
    mergeRulesetGroupIntoProfile(profile, forceNode.role, matchContext);
    mergeRulesetGroupIntoProfile(profile, forceNode.motive, matchContext);

    for (const ruleGroup of forceNode.ruleGroup ?? []) {
        if (!matchesRulesetWhen(ruleGroup.when, matchContext)) {
            continue;
        }

        mergeRulesetGroupIntoProfile(profile, ruleGroup.unitType, matchContext);
        mergeRulesetGroupIntoProfile(profile, ruleGroup.weightClass, matchContext);
        mergeRulesetGroupIntoProfile(profile, ruleGroup.role, matchContext);
        mergeRulesetGroupIntoProfile(profile, ruleGroup.motive, matchContext);
    }
}

function mergeRulesetGroupIntoProfile(
    profile: RulesetProfile,
    groupNode: MegaMekRulesetOptionGroup | undefined,
    matchContext: RulesetMatchContext,
): void {
    if (!groupNode || !matchesRulesetWhen(groupNode.when, matchContext)) {
        return;
    }

    mergeRulesetNodeIntoProfile(profile, groupNode);

    const matchingOptions = (groupNode.options ?? [])
        .filter((option) => matchesRulesetWhen(option.when, matchContext));
    if (matchingOptions.length === 0) {
        return;
    }

    const selectedOption = pickWeightedRandomEntry(matchingOptions, (option) => (option.weight ?? 1));
    mergeRulesetWhenIntoProfile(profile, selectedOption.when);
    mergeRulesetNodeIntoProfile(profile, selectedOption);
    mergeRulesetNodeIntoProfile(profile, selectedOption.assign);
}

function mergeRulesetWhenIntoProfile(
    profile: RulesetProfile,
    when: MegaMekRulesetWhen | undefined,
): void {
    if (!when) {
        return;
    }

    addRulesetValues(profile.preferredUnitTypes, getPositiveRulesetValues(when.unitTypes));
    addRulesetValues(profile.preferredWeightClasses, getPositiveRulesetValues(when.weightClasses));
    addRulesetValues(profile.preferredRoles, getPositiveRulesetValues(when.roles));
    addRulesetValues(profile.preferredMotives, getPositiveRulesetValues(when.motives));
}

export function mergeRulesetNodeIntoProfile(
    profile: RulesetProfile,
    node: (RulesetPreferenceSource & { assign?: MegaMekRulesetAssign }) | MegaMekRulesetAssign | undefined,
): void {
    if (!node) {
        return;
    }

    addRulesetValues(profile.preferredUnitTypes, node.unitTypes ?? []);
    addRulesetValues(profile.preferredWeightClasses, node.weightClasses ?? []);
    addRulesetValues(profile.preferredRoles, node.roles ?? []);
    addRulesetValues(profile.preferredMotives, node.motives ?? []);
}

export function createRulesetTemplate(node: MegaMekRulesetSubforceNode): RulesetTemplate | null {
    const template: RulesetTemplate = {
        unitTypes: new Set<string>(),
        weightClasses: new Set<string>(),
        roles: new Set<string>(),
        motives: new Set<string>(),
    };

    addRulesetValues(template.unitTypes, node.unitTypes ?? []);
    addRulesetValues(template.weightClasses, node.weightClasses ?? []);
    addRulesetValues(template.roles, node.roles ?? []);
    addRulesetValues(template.motives, node.motives ?? []);

    const assignedNode = node.assign;
    addRulesetValues(template.unitTypes, assignedNode?.unitTypes ?? []);
    addRulesetValues(template.weightClasses, assignedNode?.weightClasses ?? []);
    addRulesetValues(template.roles, assignedNode?.roles ?? []);
    addRulesetValues(template.motives, assignedNode?.motives ?? []);

    return template.unitTypes.size > 0 || template.weightClasses.size > 0 || template.roles.size > 0 || template.motives.size > 0
        ? template
        : null;
}

export function addRulesetValues(target: Set<string>, values: readonly string[]): void {
    for (const value of values) {
        target.add(normalizeRulesetToken(value));
    }
}

export function getRulesetMatchReasons(
    candidate: RulesetCandidate,
    profile: RulesetProfile | null,
): string[] {
    if (!profile) {
        return [];
    }

    const reasons: string[] = [];
    if (profile.preferredUnitTypes.has(normalizeRulesetToken(candidate.megaMekUnitType))) {
        reasons.push(`unit type ${candidate.megaMekUnitType}`);
    }
    if (candidate.megaMekWeightClass && profile.preferredWeightClasses.has(normalizeRulesetToken(candidate.megaMekWeightClass))) {
        reasons.push(`weight ${candidate.megaMekWeightClass}`);
    }
    if (candidate.role && profile.preferredRoles.has(normalizeRulesetToken(candidate.role))) {
        reasons.push(`role ${candidate.role}`);
    }
    if (candidate.motive && profile.preferredMotives.has(normalizeRulesetToken(candidate.motive))) {
        reasons.push(`motive ${candidate.motive}`);
    }

    for (const template of profile.templates) {
        if (
            template.unitTypes.has(normalizeRulesetToken(candidate.megaMekUnitType))
            || (candidate.megaMekWeightClass && template.weightClasses.has(normalizeRulesetToken(candidate.megaMekWeightClass)))
            || (candidate.role && template.roles.has(normalizeRulesetToken(candidate.role)))
            || (candidate.motive && template.motives.has(normalizeRulesetToken(candidate.motive)))
        ) {
            reasons.push('matched a child template');
            break;
        }
    }

    return reasons.slice(0, 3);
}

export function getRulesetMatchScore(
    candidate: RulesetCandidate,
    profile: RulesetProfile | null,
): number {
    if (!profile) {
        return 1;
    }

    let score = 1;
    score *= getPreferredValueScore(profile.preferredUnitTypes, candidate.megaMekUnitType, 1.6, 0.75);
    score *= getPreferredValueScore(profile.preferredWeightClasses, candidate.megaMekWeightClass, 1.3, 0.9);
    score *= getPreferredValueScore(profile.preferredRoles, candidate.role, 1.2, 0.95);
    score *= getPreferredValueScore(profile.preferredMotives, candidate.motive, 1.1, 0.98);

    let templateScore = 1;
    for (const template of profile.templates) {
        let nextTemplateScore = 1;
        let constrained = false;

        if (template.unitTypes.size > 0) {
            constrained = true;
            nextTemplateScore *= template.unitTypes.has(normalizeRulesetToken(candidate.megaMekUnitType)) ? 1.5 : 0.8;
        }
        if (template.weightClasses.size > 0 && candidate.megaMekWeightClass) {
            constrained = true;
            nextTemplateScore *= template.weightClasses.has(normalizeRulesetToken(candidate.megaMekWeightClass)) ? 1.25 : 0.9;
        }
        if (template.roles.size > 0 && candidate.role) {
            constrained = true;
            nextTemplateScore *= template.roles.has(normalizeRulesetToken(candidate.role)) ? 1.15 : 0.95;
        }
        if (template.motives.size > 0 && candidate.motive) {
            constrained = true;
            nextTemplateScore *= template.motives.has(normalizeRulesetToken(candidate.motive)) ? 1.05 : 0.98;
        }

        if (constrained) {
            templateScore = Math.max(templateScore, nextTemplateScore);
        }
    }

    return Math.max(0.05, score * templateScore);
}

function getPreferredValueScore(
    preferredValues: ReadonlySet<string>,
    candidateValue: string | undefined,
    matchScore: number,
    mismatchScore: number,
): number {
    if (preferredValues.size === 0 || !candidateValue) {
        return 1;
    }

    return preferredValues.has(normalizeRulesetToken(candidateValue)) ? matchScore : mismatchScore;
}
