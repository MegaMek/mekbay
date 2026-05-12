/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import type {
    MegaMekRulesetEchelonToken,
    MegaMekRulesetPredicateExpressionKey,
    MegaMekRulesetWhen,
} from '../models/megamek/rulesets.model';

export interface MegaMekRulesetPredicateContext {
    year?: number;
    unitType?: string | null;
    weightClass?: string | null;
    rating?: string | null;
    echelon?: string | null;
    formation?: string | null;
    role?: string | null;
    roles?: readonly string[];
    motive?: string | null;
    motives?: readonly string[];
    augmented?: boolean;
    topLevel?: boolean;
    name?: string | null;
    factionKey?: string | null;
    flags?: readonly string[];
    index?: number | string | null;
}

export function matchesMegaMekRulesetWhen(
    when: MegaMekRulesetWhen | undefined,
    context: MegaMekRulesetPredicateContext,
): boolean {
    if (!when) {
        return true;
    }

    const expressionKeys = new Set<string>();
    const expressionEntries = Object.entries(when.expressions ?? {});
    for (const [key, expression] of expressionEntries) {
        if (typeof expression !== 'string') {
            return false;
        }

        expressionKeys.add(key);
        if (!matchesMegaMekRulesetExpression(key as MegaMekRulesetPredicateExpressionKey, expression, context)) {
            return false;
        }
    }

    return matchesNormalizedRulesetWhen(when, context, expressionKeys);
}

export function matchesMegaMekRulesetStringExpression(
    value: string | null | undefined,
    expression: string,
): boolean {
    if (expression.length === 0) {
        return value === undefined || value === null || value.length === 0;
    }

    if (expression.startsWith('!')) {
        return !matchesMegaMekRulesetStringExpression(value, expression.replace(/^!/u, ''));
    }

    const candidateValue = value ?? 'null';
    for (const andTerm of expression.split(',')) {
        const matchedOrTerm = andTerm.split('|').some((orTerm) => orTerm === candidateValue);
        if (!matchedOrTerm) {
            return false;
        }
    }

    return true;
}

export function matchesMegaMekRulesetCollectionExpression(
    values: readonly string[],
    expression: string,
): boolean {
    if (expression.length === 0) {
        return values.length === 0;
    }

    if (expression.startsWith('!')) {
        return !matchesMegaMekRulesetCollectionExpression(values, expression.replace(/^!/u, ''));
    }

    for (const andTerm of expression.split(',')) {
        const matchedOrTerm = andTerm.split('|').some((orTerm) => values.includes(orTerm));
        if (!matchedOrTerm) {
            return false;
        }
    }

    return true;
}

export function matchesMegaMekRulesetDateExpression(
    year: number | undefined,
    expression: string,
): boolean {
    if (year === undefined || !Number.isFinite(year)) {
        return false;
    }

    for (const andTerm of expression.split('+')) {
        const matchedOrTerm = andTerm.split('|').some((orTerm) => matchesDateRange(year, orTerm));
        if (!matchedOrTerm) {
            return false;
        }
    }

    return true;
}

function matchesMegaMekRulesetExpression(
    key: MegaMekRulesetPredicateExpressionKey,
    expression: string,
    context: MegaMekRulesetPredicateContext,
): boolean {
    const normalizedExpression = normalizeRulesetExpression(key, expression);

    switch (key) {
        case 'ifUnitType':
            return matchesMegaMekRulesetStringExpression(context.unitType, normalizedExpression);
        case 'ifWeightClass':
            return matchesMegaMekRulesetStringExpression(context.weightClass, normalizedExpression);
        case 'ifRating':
            return matchesMegaMekRulesetStringExpression(context.rating, normalizedExpression);
        case 'ifEschelon':
            return matchesMegaMekRulesetStringExpression(context.echelon, normalizedExpression);
        case 'ifFormation':
            return matchesMegaMekRulesetStringExpression(context.formation, normalizedExpression);
        case 'ifRole':
            return matchesMegaMekRulesetCollectionExpression(getContextCollection(context.roles, context.role), normalizedExpression);
        case 'ifMotive':
            return matchesMegaMekRulesetCollectionExpression(getContextCollection(context.motives, context.motive), normalizedExpression);
        case 'ifAugmented':
            return (normalizedExpression === '1') === (context.augmented ?? false);
        case 'ifDateBetween':
        case 'ifYearBetween':
            return matchesMegaMekRulesetDateExpression(context.year, normalizedExpression);
        case 'ifTopLevel':
            return (normalizedExpression === '1') === (context.topLevel ?? false);
        case 'ifName':
            return matchesMegaMekRulesetNameExpression(context.name, normalizedExpression);
        case 'ifFaction':
            return matchesMegaMekRulesetStringExpression(context.factionKey, normalizedExpression);
        case 'ifFlags':
            return matchesMegaMekRulesetCollectionExpression(context.flags ?? [], normalizedExpression);
        case 'ifIndex':
            return matchesMegaMekRulesetStringExpression(context.index === undefined || context.index === null ? undefined : String(context.index), normalizedExpression);
        default:
            return false;
    }
}

function normalizeRulesetExpression(
    key: MegaMekRulesetPredicateExpressionKey,
    expression: string,
): string {
    if (key !== 'ifEschelon') {
        return expression;
    }

    return expression.replace(/%([A-Z_]+)%([+\-^])?/gu, (_match, code: string, suffix: string | undefined) => {
        return `${code}${suffix ?? ''}`;
    });
}

function matchesMegaMekRulesetNameExpression(
    name: string | null | undefined,
    expression: string,
): boolean {
    if (expression.startsWith('!')) {
        return name === undefined || name === null || !matchesMegaMekRulesetStringExpression(name, expression.split('!').join(''));
    }

    return name !== undefined && name !== null && matchesMegaMekRulesetStringExpression(name, expression);
}

function matchesDateRange(year: number, expression: string): boolean {
    if (!expression.includes(',')) {
        return false;
    }

    const [fromYearExpression, toYearExpression] = splitFirst(expression, ',');
    const fromYear = parseOptionalYear(fromYearExpression);
    const toYear = parseOptionalYear(toYearExpression);

    if (fromYearExpression.length > 0 && fromYear === undefined) {
        return false;
    }
    if (toYearExpression.length > 0 && toYear === undefined) {
        return false;
    }

    return (fromYear === undefined || year >= fromYear)
        && (toYear === undefined || year <= toYear);
}

function splitFirst(value: string, delimiter: string): [string, string] {
    const delimiterIndex = value.indexOf(delimiter);
    if (delimiterIndex === -1) {
        return [value, ''];
    }

    return [value.slice(0, delimiterIndex), value.slice(delimiterIndex + delimiter.length)];
}

function parseOptionalYear(value: string): number | undefined {
    if (value.length === 0) {
        return undefined;
    }

    const parsedYear = Number(value);
    return Number.isInteger(parsedYear) ? parsedYear : undefined;
}

function getContextCollection(
    values: readonly string[] | undefined,
    value: string | null | undefined,
): string[] {
    if (values) {
        return [...values];
    }

    return value === undefined || value === null ? [] : [value];
}

function matchesNormalizedRulesetWhen(
    when: MegaMekRulesetWhen,
    context: MegaMekRulesetPredicateContext,
    expressionKeys: ReadonlySet<string>,
): boolean {
    if (!expressionKeys.has('ifDateBetween') && !expressionKeys.has('ifYearBetween')) {
        const fromYear = when.fromYear;
        if (fromYear !== undefined && (context.year === undefined || context.year < fromYear)) {
            return false;
        }

        const toYear = when.toYear;
        if (toYear !== undefined && (context.year === undefined || context.year > toYear)) {
            return false;
        }
    }

    if (!matchesNormalizedStringValues(when.unitTypes, context.unitType, expressionKeys, 'ifUnitType')) {
        return false;
    }
    if (!matchesNormalizedStringValues(when.weightClasses, context.weightClass, expressionKeys, 'ifWeightClass')) {
        return false;
    }
    if (!matchesNormalizedStringValues(when.ratings, context.rating, expressionKeys, 'ifRating')) {
        return false;
    }
    if (!matchesNormalizedStringValues(when.formations, context.formation, expressionKeys, 'ifFormation')) {
        return false;
    }
    if (!matchesNormalizedStringValues(when.roles, context.role, expressionKeys, 'ifRole')) {
        return false;
    }
    if (!matchesNormalizedStringValues(when.motives, context.motive, expressionKeys, 'ifMotive')) {
        return false;
    }
    if (!matchesNormalizedStringValues(when.factions, context.factionKey, expressionKeys, 'ifFaction')) {
        return false;
    }
    if (!matchesNormalizedStringValues(when.names, context.name, expressionKeys, 'ifName')) {
        return false;
    }
    if (!matchesNormalizedStringValues(when.indexes, context.index === undefined || context.index === null ? undefined : String(context.index), expressionKeys, 'ifIndex')) {
        return false;
    }

    if (!expressionKeys.has('ifTopLevel') && when.topLevel !== undefined && when.topLevel !== (context.topLevel ?? false)) {
        return false;
    }

    if (!expressionKeys.has('ifAugmented') && when.augmented !== undefined && when.augmented !== (context.augmented ?? false)) {
        return false;
    }

    if (!expressionKeys.has('ifFlags') && !matchesNormalizedCollectionValues(when.flags, context.flags ?? [])) {
        return false;
    }

    if (!expressionKeys.has('ifEschelon') && !matchesNormalizedEchelons(when.echelons, context)) {
        return false;
    }

    return true;
}

function matchesNormalizedStringValues(
    values: readonly string[] | undefined,
    candidateValue: string | null | undefined,
    expressionKeys: ReadonlySet<string>,
    expressionKey: MegaMekRulesetPredicateExpressionKey,
): boolean {
    if (expressionKeys.has(expressionKey)) {
        return true;
    }

    const normalizedValues = values ?? [];
    if (normalizedValues.length === 0) {
        return true;
    }

    const positiveValues = normalizedValues
        .filter((value) => !value.startsWith('!'))
        .map((value) => normalizeRulesetPredicateToken(value));
    const negativeValues = normalizedValues
        .filter((value) => value.startsWith('!'))
        .map((value) => normalizeRulesetPredicateToken(value.slice(1)));

    const normalizedCandidate = normalizeRulesetPredicateToken(candidateValue ?? 'null');
    if (negativeValues.includes(normalizedCandidate)) {
        return false;
    }

    return positiveValues.length === 0 || positiveValues.includes(normalizedCandidate);
}

function matchesNormalizedCollectionValues(
    values: readonly string[] | undefined,
    candidates: readonly string[],
): boolean {
    const normalizedValues = values ?? [];
    if (normalizedValues.length === 0) {
        return true;
    }

    const normalizedCandidates = new Set(candidates.map((candidate) => normalizeRulesetPredicateToken(candidate)));
    const positiveValues = normalizedValues
        .filter((value) => !value.startsWith('!'))
        .map((value) => normalizeRulesetPredicateToken(value));
    const negativeValues = normalizedValues
        .filter((value) => value.startsWith('!'))
        .map((value) => normalizeRulesetPredicateToken(value.slice(1)));

    for (const negativeValue of negativeValues) {
        if (normalizedCandidates.has(negativeValue)) {
            return false;
        }
    }

    return positiveValues.length === 0 || positiveValues.some((value) => normalizedCandidates.has(value));
}

function matchesNormalizedEchelons(
    echelons: readonly MegaMekRulesetEchelonToken[] | undefined,
    context: MegaMekRulesetPredicateContext,
): boolean {
    if (!echelons || echelons.length === 0) {
        return true;
    }

    return echelons.some((echelonNode) => {
        if (!echelonNode.code || !context.echelon) {
            return false;
        }

        return echelonNode.code === context.echelon
            && (echelonNode.augmented === undefined || echelonNode.augmented === (context.augmented ?? false));
    });
}

function normalizeRulesetPredicateToken(value: string): string {
    return value.trim().toLowerCase();
}