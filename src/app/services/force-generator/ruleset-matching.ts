// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type {
    MegaMekRulesetForceNode,
    MegaMekRulesetRecord,
    MegaMekRulesetWhen,
} from '../../models/megamek/rulesets.model';
import { pickWeightedRandomEntry } from './weighted-selection';

export interface RulesetMatchContext {
    year?: number;
    unitType?: string;
    weightClass?: string;
    role?: string;
    motive?: string;
    echelon?: string;
    factionKey?: string;
    augmented?: boolean;
    topLevel?: boolean;
    flags?: readonly string[];
}

export interface ForceNodeSelection {
    forceNode?: MegaMekRulesetForceNode;
    matchContext: RulesetMatchContext;
}

type ForceNodeSelectionMode = 'first' | 'weighted';

export function normalizeRulesetToken(value: string): string {
    return value.trim().toLowerCase();
}

export function getPositiveRulesetValues(values: readonly string[] | undefined): string[] {
    return (values ?? []).filter((value) => !value.startsWith('!'));
}

function getFirstPositiveRulesetValue(values: readonly string[] | undefined): string | undefined {
    return getPositiveRulesetValues(values)[0];
}

export function resolvePreferredForceNode(
    rulesetChain: readonly MegaMekRulesetRecord[],
    matchContext: RulesetMatchContext,
    selectionMode: ForceNodeSelectionMode,
): ForceNodeSelection {
    const contexts = matchContext.echelon
        ? [matchContext, { ...matchContext, echelon: undefined }]
        : [matchContext];

    // Exhaust exact matches throughout the inheritance chain before relaxing unit preferences.
    // Only then retry without the requested echelon.
    for (const context of contexts) {
        for (const matcher of [matchesRulesetWhen, matchesRulesetStructure]) {
            const forceNode = selectMatchingForceNode(rulesetChain, context, matcher, selectionMode);
            if (forceNode) {
                return { forceNode, matchContext: deriveForceNodeMatchContext(context, forceNode) };
            }
        }
    }

    return { matchContext };
}

function getIndexedForceNodes(ruleset: MegaMekRulesetRecord, echelon: string | undefined): MegaMekRulesetForceNode[] {
    const indexedForceNodes = echelon
        ? (ruleset.indexes.forceIndexesByEchelon[echelon] ?? [])
            .map((index) => ruleset.forces[index])
            .filter((forceNode): forceNode is MegaMekRulesetForceNode => forceNode !== undefined)
        : ruleset.forces;

    return indexedForceNodes.length > 0 ? indexedForceNodes : ruleset.forces;
}

function selectMatchingForceNode(
    rulesetChain: readonly MegaMekRulesetRecord[],
    matchContext: RulesetMatchContext,
    matcher: (when: MegaMekRulesetWhen | undefined, matchContext: RulesetMatchContext) => boolean,
    selectionMode: ForceNodeSelectionMode,
): MegaMekRulesetForceNode | undefined {
    for (const ruleset of rulesetChain) {
        const forceNodes = getIndexedForceNodes(ruleset, matchContext.echelon);
        if (selectionMode === 'first') {
            const matchingForceNode = forceNodes.find((forceNode) => matcher(forceNode.when, matchContext));
            if (matchingForceNode) {
                return matchingForceNode;
            }
            continue;
        }

        const matchingForceNodes = forceNodes.filter((forceNode) => matcher(forceNode.when, matchContext));
        if (matchingForceNodes.length > 0) {
            return pickWeightedRandomEntry(matchingForceNodes, (forceNode) => forceNode.weight ?? 1);
        }
    }

    return undefined;
}

function matchesRulesetStructure(
    when: MegaMekRulesetWhen | undefined,
    matchContext: RulesetMatchContext,
): boolean {
    if (!when) {
        return true;
    }

    const fromYear = when.fromYear;
    if (fromYear !== undefined && (matchContext.year === undefined || matchContext.year < fromYear)) {
        return false;
    }

    const toYear = when.toYear;
    if (toYear !== undefined && (matchContext.year === undefined || matchContext.year > toYear)) {
        return false;
    }

    if (!matchesRulesetStringValues(when.factions ?? [], matchContext.factionKey)) {
        return false;
    }
    if (!matchesRulesetStringValues(when.unitTypes ?? [], matchContext.unitType)) {
        return false;
    }

    const topLevel = when.topLevel;
    if (topLevel !== undefined && topLevel !== (matchContext.topLevel ?? false)) {
        return false;
    }

    const augmented = when.augmented;
    if (augmented !== undefined && augmented !== (matchContext.augmented ?? false)) {
        return false;
    }

    const echelons = when.echelons ?? [];
    if (echelons.length > 0) {
        const matchedEchelon = echelons.some((echelonNode) => {
            const echelon = echelonNode.code;
            if (!echelon || !matchContext.echelon) {
                return false;
            }

            const requiredAugmented = echelonNode.augmented;
            return echelon === matchContext.echelon
                && (requiredAugmented === undefined || requiredAugmented === (matchContext.augmented ?? false));
        });
        if (!matchedEchelon) {
            return false;
        }
    }

    return true;
}

function deriveForceNodeMatchContext(
    matchContext: RulesetMatchContext,
    forceNode: MegaMekRulesetForceNode,
): RulesetMatchContext {
    return {
        ...matchContext,
        unitType: getFirstPositiveRulesetValue(forceNode.when?.unitTypes) ?? matchContext.unitType,
        weightClass: getFirstPositiveRulesetValue(forceNode.when?.weightClasses) ?? matchContext.weightClass,
        role: getFirstPositiveRulesetValue(forceNode.when?.roles) ?? matchContext.role,
        motive: getFirstPositiveRulesetValue(forceNode.when?.motives) ?? matchContext.motive,
        echelon: forceNode.echelon?.code ?? matchContext.echelon,
        augmented: forceNode.echelon?.augmented ?? forceNode.when?.augmented ?? matchContext.augmented,
    };
}

export function findMatchingForceNode(
    rulesetChain: readonly MegaMekRulesetRecord[],
    matchContext: RulesetMatchContext,
): MegaMekRulesetForceNode | undefined {
    // Child lookup requires the node's actual echelon; top-level selection above can derive it.
    for (const ruleset of rulesetChain) {
        const forceNodes = getIndexedForceNodes(ruleset, matchContext.echelon);
        for (const forceNode of forceNodes) {
            if (matchContext.echelon && forceNode.echelon?.code !== matchContext.echelon) {
                continue;
            }

            if (matchesRulesetWhen(forceNode.when, matchContext)) {
                return forceNode;
            }
        }
    }

    if (!matchContext.echelon) {
        return undefined;
    }

    const fallbackContext = { ...matchContext, echelon: undefined };
    for (const ruleset of rulesetChain) {
        const forceNodes = ruleset.forces;
        for (const forceNode of forceNodes) {
            if (matchesRulesetWhen(forceNode.when, fallbackContext)) {
                return forceNode;
            }
        }
    }

    return undefined;
}

export function matchesRulesetWhen(when: MegaMekRulesetWhen | undefined, matchContext: RulesetMatchContext): boolean {
    if (!when) {
        return true;
    }

    return matchesRulesetStructure(when, matchContext)
        && matchesRulesetStringValues(when.weightClasses ?? [], matchContext.weightClass)
        && matchesRulesetStringValues(when.roles ?? [], matchContext.role)
        && matchesRulesetStringValues(when.motives ?? [], matchContext.motive)
        && matchesRulesetFlags(when.flags ?? [], matchContext.flags ?? []);
}

function matchesRulesetStringValues(values: readonly string[], candidateValue: string | undefined): boolean {
    if (values.length === 0) {
        return true;
    }

    const positiveValues = values.filter((value) => !value.startsWith('!')).map((value) => normalizeRulesetToken(value));
    const negativeValues = values.filter((value) => value.startsWith('!')).map((value) => normalizeRulesetToken(value.slice(1)));

    if (!candidateValue) {
        return positiveValues.length === 0;
    }

    const normalizedCandidate = normalizeRulesetToken(candidateValue);
    if (negativeValues.includes(normalizedCandidate)) {
        return false;
    }

    return positiveValues.length === 0 || positiveValues.includes(normalizedCandidate);
}

function matchesRulesetFlags(values: readonly string[], flags: readonly string[]): boolean {
    if (values.length === 0) {
        return true;
    }

    const normalizedFlags = new Set(flags.map((flag) => normalizeRulesetToken(flag)));
    const positiveValues = values.filter((value) => !value.startsWith('!')).map((value) => normalizeRulesetToken(value));
    const negativeValues = values.filter((value) => value.startsWith('!')).map((value) => normalizeRulesetToken(value.slice(1)));

    for (const negativeValue of negativeValues) {
        if (normalizedFlags.has(negativeValue)) {
            return false;
        }
    }

    return positiveValues.length === 0 || positiveValues.some((value) => normalizedFlags.has(value));
}
