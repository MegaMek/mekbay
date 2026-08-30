// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

/**
 * Pure parsing and matching helpers for the Alpha Strike specials search field.
 *
 * Keep the grammar here: the index, main-thread filter kernel, semantic AST
 * evaluator, and search worker all need to interpret specials identically.
 */

export type ASSpecialSelectionState = false | 'or' | 'and' | 'not';

export interface ASSpecialMinimumSelection {
    name: string;
    state: ASSpecialSelectionState;
    minimumValues?: readonly (number | null)[];
}

export interface ASSpecialSlotValue {
    /** Original normalized value. `0*` is significant for exact matching. */
    text: string;
    /** Numeric ordering value. Alpha Strike's `0*` ranks between 0 and 1. */
    rank: number;
}

export interface ASSpecialOccurrence {
    /** Canonical dropdown/index token, such as AC, IF, TAG, or TUR. */
    token: string;
    /** Numeric parameters in their displayed order; `null` is a `-` slot. */
    values: readonly (ASSpecialSlotValue | null)[];
    /** Original ability text used to preserve legacy semantic matching. */
    rawText: string;
    /** Whether this is an actual top-level `as.specials` entry. */
    topLevel: boolean;
}

/**
 * Structural representation shared by search indexing and ability lookup.
 * Only TUR owns child abilities; parentheses on BIM/LAM-style abilities are
 * parameters and remain on the node itself.
 */
export interface ASSpecialAbilityNode {
    /** Original ability text, trimmed but otherwise unchanged. */
    rawText: string;
    /** Text used to resolve the ability definition (the composite head for TUR). */
    lookupText: string;
    /** Canonical dropdown/index token. */
    token: string;
    /** Numeric parameters, including schema-defined implicit values. */
    values: readonly (ASSpecialSlotValue | null)[];
    /** TUR damage text, when present. */
    turretDamage?: string;
    /** Nested TUR abilities. */
    children: readonly ASSpecialAbilityNode[];
}

export interface ParsedASSpecials {
    topLevelValues: readonly string[];
    abilities: readonly ASSpecialAbilityNode[];
    occurrences: readonly ASSpecialOccurrence[];
}

type SpecialSlotOperator = '=' | '!=' | '>' | '<' | '>=' | '<=';

type SpecialSlotMatcher =
    | { type: 'any' }
    | { type: 'missing' }
    | { type: 'comparison'; operator: SpecialSlotOperator; value: ASSpecialSlotValue }
    | { type: 'set'; values: readonly ASSpecialSlotValue[] };

type SpecialQueryToken =
    | { type: 'literal'; text: string }
    | { type: 'slot'; matcher: SpecialSlotMatcher };

type SpecialTargetToken =
    | { type: 'literal'; text: string }
    | { type: 'slot'; value: ASSpecialSlotValue | null };

interface ParsedSpecialQuery {
    tokens: SpecialQueryToken[];
}

const SPECIAL_EXPLICIT_NUMERIC_QUERY_PATTERN = /(?:>=|<=|!=|>|<|=)\s*-?\d|\[[^\]]+\]/;
const DAMAGE_VALUE_PATTERN = /^(?:-|0\*|\d+(?:\.\d+)?)(?:\/(?:-|0\*|\d+(?:\.\d+)?))+$/i;
interface ASSpecialTokenSchema {
    /** Digits are part of the ability name, not numeric parameters. */
    literalDigits?: boolean;
    /** Values supplied by the rules when the card omits the numeric suffix. */
    implicitValues?: readonly number[];
    /** Contextual minimum input labels. */
    fieldLabels?: readonly string[];
}

/**
 * The small set of filter-specific exceptions to the general specials grammar.
 * Keep them here so parsing, indexing, matching, and UI metadata cannot drift.
 */
const AS_SPECIAL_TOKEN_SCHEMAS = new Map<string, ASSpecialTokenSchema>([
    ['AC', { fieldLabels: ['S', 'M', 'L', 'E'] }],
    ['AT', { fieldLabels: ['Cap', 'Doors'] }],
    ['BHJ2', { literalDigits: true }],
    ['BHJ3', { literalDigits: true }],
    ['C3BSM', { implicitValues: [1] }],
    ['C3M', { implicitValues: [1] }],
    ['CK', { fieldLabels: ['Cap', 'Doors'] }],
    ['CNARC', { implicitValues: [1] }],
    ['CT', { fieldLabels: ['Cap', 'Doors'] }],
    ['FLK', { fieldLabels: ['S', 'M', 'L', 'E'] }],
    ['HT', { fieldLabels: ['S', 'M', 'L', 'E'] }],
    ['IATM', { fieldLabels: ['S', 'M', 'L', 'E'] }],
    ['INARC', { implicitValues: [1] }],
    ['LAM', { fieldLabels: ['Ground', 'Aero'] }],
    ['LRM', { fieldLabels: ['S', 'M', 'L', 'E'] }],
    ['MFB', { implicitValues: [1] }],
    ['MT', { fieldLabels: ['Cap', 'Doors'] }],
    ['NC3', { literalDigits: true }],
    ['PT', { fieldLabels: ['Cap', 'Doors'] }],
    ['REAR', { fieldLabels: ['S', 'M', 'L', 'E'] }],
    ['SDS-C', { fieldLabels: ['S', 'M', 'L', 'E'] }],
    ['SDS-CM', { fieldLabels: ['S', 'M', 'L', 'E'] }],
    ['SDS-SC', { fieldLabels: ['S', 'M', 'L', 'E'] }],
    ['SNARC', { implicitValues: [1] }],
    ['SRM', { fieldLabels: ['S', 'M', 'L', 'E'] }],
    ['ST', { fieldLabels: ['Cap', 'Doors'] }],
    ['TOR', { fieldLabels: ['S', 'M', 'L', 'E'] }],
    ['TUR', { fieldLabels: ['S', 'M', 'L', 'E'] }],
    ['VTH', { fieldLabels: ['Cap', 'Doors'] }],
    ['VTM', { fieldLabels: ['Cap', 'Doors'] }],
    ['VTS', { fieldLabels: ['Cap', 'Doors'] }],
]);

const parsedSpecialQueryCache = new Map<string, ParsedSpecialQuery | null>();
const parsedAbilityCache = new Map<string, ASSpecialAbilityNode | null>();
const parsedTopLevelValueCache = new Map<string, ParsedASSpecials>();
const parsedSpecialCollectionCache = new Map<string, ParsedASSpecials>();

function normalizeSpecialText(value: string): string {
    return value.replace(/\s+/g, '').toUpperCase();
}

export function splitASSpecialArguments(content: string): string[] {
    const result: string[] = [];
    let current = '';
    let depth = 0;

    for (const char of content) {
        if (char === '(') {
            depth++;
            current += char;
            continue;
        }

        if (char === ')') {
            depth--;
            current += char;
            continue;
        }

        if (char === ',' && depth === 0) {
            if (current.trim()) {
                result.push(current.trim());
            }
            current = '';
            continue;
        }

        current += char;
    }

    if (current.trim()) {
        result.push(current.trim());
    }

    return result;
}

export function isASSpecialDamageValue(value: string): boolean {
    return DAMAGE_VALUE_PATTERN.test(normalizeSpecialText(value));
}

/**
 * Return the stable ability token from a concrete value or numeric query.
 * Digits embedded in C3 names, artillery types, and the BHJ2/BHJ3 abilities
 * are names rather than parameters and are deliberately retained.
 */
export function getASSpecialToken(value: string): string | null {
    const text = normalizeSpecialText(value);
    if (!text) {
        return null;
    }

    if (AS_SPECIAL_TOKEN_SCHEMAS.get(text)?.literalDigits) {
        return text;
    }

    // Artillery type digits belong to the token. Accept both card syntax
    // (`ARTCM5-1`) and the contextual formatter syntax (`ARTCM5>=1`).
    const artilleryMatch = text.match(/^(ART[A-Z0-9]+?)(?=-(?:0\*|\d)|>=|<=|!=|>|<|=|\/|\*|\[|$)/);
    if (artilleryMatch) {
        return artilleryMatch[1];
    }

    if (text.startsWith('C3')) {
        const c3Match = text.match(/^C3[A-Z]+/);
        if (c3Match) {
            return c3Match[0];
        }
    }

    const prefixMatch = text.match(/^[A-Z]+(?:-[A-Z]+)*/);
    if (!prefixMatch) {
        return null;
    }

    // `-O` marks a one-shot variant; it does not describe another ability.
    return prefixMatch[0].endsWith('-O')
        ? prefixMatch[0].slice(0, -2)
        : prefixMatch[0];
}

function parseSpecialSlotValue(text: string, start: number): { value: ASSpecialSlotValue; end: number } | null {
    const match = text.slice(start).match(/^-?\d+(?:\.\d+)?/);
    if (!match) {
        return null;
    }

    const numericValue = Number(match[0]);
    if (!Number.isFinite(numericValue)) {
        return null;
    }

    const end = start + match[0].length;
    if (match[0] === '0' && text[end] === '*') {
        return { value: { text: '0*', rank: 0.5 }, end: end + 1 };
    }

    return { value: { text: match[0], rank: numericValue }, end };
}

function parseConcreteSlotValue(text: string): ASSpecialSlotValue | null {
    if (text === '0*') {
        return { text, rank: 0.5 };
    }

    const rank = Number(text);
    return Number.isFinite(rank) ? { text, rank } : null;
}

function extractOccurrenceValues(text: string, token: string): readonly (ASSpecialSlotValue | null)[] {
    const normalized = normalizeSpecialText(text);
    const parameterText = normalized.startsWith(token) ? normalized.slice(token.length) : normalized;

    if (isASSpecialDamageValue(parameterText)) {
        return parameterText.split('/').map(part => (
            part === '-' ? null : parseConcreteSlotValue(part)
        ));
    }

    const values: ASSpecialSlotValue[] = [];
    for (const match of parameterText.matchAll(/0\*|\d+(?:\.\d+)?/g)) {
        const value = parseConcreteSlotValue(match[0]);
        if (value) {
            values.push(value);
        }
    }
    if (values.length > 0) {
        return values;
    }

    return (AS_SPECIAL_TOKEN_SCHEMAS.get(token)?.implicitValues ?? []).map(value => ({
        text: String(value),
        rank: value,
    }));
}

/** Parse one ability into the structural AST used everywhere else. */
export function parseASSpecialAbility(value: string): ASSpecialAbilityNode | null {
    const cached = parsedAbilityCache.get(value);
    if (cached !== undefined) {
        return cached;
    }

    const trimmedValue = value.trim();
    if (!trimmedValue) {
        parsedAbilityCache.set(value, null);
        return null;
    }

    const compositeMatch = trimmedValue.match(/^([^()]+?)\s*\((.*)\)$/i);
    const lookupText = compositeMatch?.[1].trim() ?? trimmedValue;
    const token = getASSpecialToken(lookupText) ?? normalizeSpecialText(lookupText);

    if (compositeMatch && token === 'TUR') {
        const parts = splitASSpecialArguments(compositeMatch[2]);
        const turretDamage = parts.find(isASSpecialDamageValue);
        const node: ASSpecialAbilityNode = {
            rawText: trimmedValue,
            lookupText,
            token: 'TUR',
            values: turretDamage ? extractOccurrenceValues(turretDamage, '') : [],
            ...(turretDamage ? { turretDamage: turretDamage.trim() } : {}),
            children: parts
                .filter(part => !isASSpecialDamageValue(part))
                .map(parseASSpecialAbility)
                .filter((child): child is ASSpecialAbilityNode => child !== null),
        };
        parsedAbilityCache.set(value, node);
        return node;
    }

    const node: ASSpecialAbilityNode = {
        rawText: trimmedValue,
        lookupText,
        token,
        values: extractOccurrenceValues(trimmedValue, token),
        children: [],
    };
    parsedAbilityCache.set(value, node);
    return node;
}

function flattenASSpecialAbility(node: ASSpecialAbilityNode, topLevel: boolean): ASSpecialOccurrence[] {
    return [
        {
            token: node.token,
            values: node.values,
            rawText: node.rawText,
            topLevel,
        },
        ...node.children.flatMap(child => flattenASSpecialAbility(child, false)),
    ];
}

function parseTopLevelValue(value: string): ParsedASSpecials {
    const cached = parsedTopLevelValueCache.get(value);
    if (cached) {
        return cached;
    }

    const topLevelValues = splitASSpecialArguments(value);
    const abilities = topLevelValues
        .map(parseASSpecialAbility)
        .filter((ability): ability is ASSpecialAbilityNode => ability !== null);
    const parsed: ParsedASSpecials = {
        topLevelValues,
        abilities,
        occurrences: abilities.flatMap(ability => flattenASSpecialAbility(ability, true)),
    };
    parsedTopLevelValueCache.set(value, parsed);
    return parsed;
}

/** Parse top-level and TUR-contained specials once per raw value/array. */
export function parseASSpecials(unitValue: unknown): ParsedASSpecials {
    if (unitValue == null) {
        return { topLevelValues: [], abilities: [], occurrences: [] };
    }

    if (Array.isArray(unitValue)) {
        const values = unitValue.map(value => String(value));
        const cacheKey = values.join('\u0000');
        const cached = parsedSpecialCollectionCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        const parts = values.map(value => parseTopLevelValue(value));
        const parsed: ParsedASSpecials = {
            topLevelValues: parts.flatMap(part => part.topLevelValues),
            abilities: parts.flatMap(part => part.abilities),
            occurrences: parts.flatMap(part => part.occurrences),
        };
        parsedSpecialCollectionCache.set(cacheKey, parsed);
        return parsed;
    }

    return parseTopLevelValue(String(unitValue));
}

/** Build the per-unit parsed tuple index used by both sync and worker search. */
export function buildASSpecialsByUnitIndex<T>(
    units: readonly T[],
    getUnitId: (unit: T) => string,
    getSpecials: (unit: T) => unknown,
): Map<string, ParsedASSpecials> {
    const index = new Map<string, ParsedASSpecials>();
    for (const unit of units) {
        index.set(getUnitId(unit), parseASSpecials(getSpecials(unit)));
    }
    return index;
}

export function getASSpecialMinimumFieldLabels(token: string, count: number): readonly string[] {
    if (count <= 0) {
        return [];
    }

    const schemaLabels = AS_SPECIAL_TOKEN_SCHEMAS.get(token)?.fieldLabels;
    if (schemaLabels) {
        return schemaLabels.slice(0, count);
    }

    return count === 1
        ? ['']
        : Array.from({ length: count }, (_, index) => `#${index + 1}`);
}

export function isASSpecialNumericQuery(value: string): boolean {
    const normalized = normalizeSpecialText(value);
    if (SPECIAL_EXPLICIT_NUMERIC_QUERY_PATTERN.test(normalized) || normalized.includes('0*')) {
        return true;
    }

    if (normalized.includes('*')) {
        return false;
    }

    return /-?\d/.test(normalized);
}

function flushSpecialLiteral<T extends SpecialQueryToken | SpecialTargetToken>(tokens: T[], literal: string): void {
    if (literal) {
        tokens.push({ type: 'literal', text: literal } as T);
    }
}

function readSpecialSlotOperator(text: string, start: number): { operator: SpecialSlotOperator; end: number } | null {
    const twoCharOperator = text.slice(start, start + 2);
    if (twoCharOperator === '>=' || twoCharOperator === '<=' || twoCharOperator === '!=') {
        return { operator: twoCharOperator, end: start + 2 };
    }

    const oneCharOperator = text[start];
    if (oneCharOperator === '>' || oneCharOperator === '<' || oneCharOperator === '=') {
        return { operator: oneCharOperator, end: start + 1 };
    }

    return null;
}

function parseSpecialNumberSet(text: string, start: number): { values: ASSpecialSlotValue[]; end: number } | null {
    if (text[start] !== '[') {
        return null;
    }

    const end = text.indexOf(']', start + 1);
    if (end === -1) {
        return null;
    }

    const values: ASSpecialSlotValue[] = [];
    for (const part of text.slice(start + 1, end).split(',')) {
        const trimmedPart = part.trim();
        const slotValue = parseSpecialSlotValue(trimmedPart, 0);
        if (!trimmedPart || !slotValue || slotValue.end !== trimmedPart.length) {
            return null;
        }
        values.push(slotValue.value);
    }

    return values.length > 0 ? { values, end: end + 1 } : null;
}

function isMissingSpecialSlot(text: string, index: number): boolean {
    if (text[index] !== '-') {
        return false;
    }

    const previous = index === 0 ? '' : text[index - 1];
    const next = index + 1 >= text.length ? '' : text[index + 1];
    const hasSlotBoundaryBefore = index === 0 || previous === '/' || previous === '(' || previous === ',';
    const hasSlotBoundaryAfter = index + 1 >= text.length || next === '/' || next === ')' || next === ',';
    return hasSlotBoundaryBefore && hasSlotBoundaryAfter;
}

function parseSpecialQuery(value: string): ParsedSpecialQuery | null {
    if (!isASSpecialNumericQuery(value)) {
        return null;
    }

    const cached = parsedSpecialQueryCache.get(value);
    if (cached !== undefined) {
        return cached;
    }

    const text = normalizeSpecialText(value);
    const tokens: SpecialQueryToken[] = [];
    let literal = '';
    let index = 0;

    while (index < text.length) {
        const set = parseSpecialNumberSet(text, index);
        if (set) {
            flushSpecialLiteral(tokens, literal);
            literal = '';
            tokens.push({ type: 'slot', matcher: { type: 'set', values: set.values } });
            index = set.end;
            continue;
        }

        const operator = readSpecialSlotOperator(text, index);
        if (operator) {
            const slotValue = parseSpecialSlotValue(text, operator.end);
            if (!slotValue) {
                parsedSpecialQueryCache.set(value, null);
                return null;
            }

            flushSpecialLiteral(tokens, literal);
            literal = '';
            tokens.push({
                type: 'slot',
                matcher: { type: 'comparison', operator: operator.operator, value: slotValue.value },
            });
            index = slotValue.end;
            continue;
        }

        if (text[index] === '*') {
            flushSpecialLiteral(tokens, literal);
            literal = '';
            tokens.push({ type: 'slot', matcher: { type: 'any' } });
            index++;
            continue;
        }

        if (isMissingSpecialSlot(text, index)) {
            flushSpecialLiteral(tokens, literal);
            literal = '';
            tokens.push({ type: 'slot', matcher: { type: 'missing' } });
            index++;
            continue;
        }

        const slotValue = parseSpecialSlotValue(text, index);
        if (slotValue) {
            flushSpecialLiteral(tokens, literal);
            literal = '';
            tokens.push({
                type: 'slot',
                matcher: { type: 'comparison', operator: '=', value: slotValue.value },
            });
            index = slotValue.end;
            continue;
        }

        literal += text[index];
        index++;
    }

    flushSpecialLiteral(tokens, literal);
    const parsed = tokens.some(token => token.type === 'slot') ? { tokens } : null;
    parsedSpecialQueryCache.set(value, parsed);
    return parsed;
}

function parseSpecialTarget(value: string): SpecialTargetToken[] {
    const text = normalizeSpecialText(value);
    const tokens: SpecialTargetToken[] = [];
    let literal = '';
    let index = 0;

    while (index < text.length) {
        if (isMissingSpecialSlot(text, index)) {
            flushSpecialLiteral(tokens, literal);
            literal = '';
            tokens.push({ type: 'slot', value: null });
            index++;
            continue;
        }

        const slotValue = parseSpecialSlotValue(text, index);
        if (slotValue) {
            flushSpecialLiteral(tokens, literal);
            literal = '';
            tokens.push({ type: 'slot', value: slotValue.value });
            index = slotValue.end;
            continue;
        }

        literal += text[index];
        index++;
    }

    flushSpecialLiteral(tokens, literal);
    return tokens;
}

function specialSlotValuesEqual(left: ASSpecialSlotValue, right: ASSpecialSlotValue): boolean {
    if (left.text === '0*' || right.text === '0*') {
        return left.text === right.text;
    }
    return left.rank === right.rank;
}

function compareSpecialSlotValues(left: ASSpecialSlotValue, right: ASSpecialSlotValue, operator: SpecialSlotOperator): boolean {
    switch (operator) {
        case '=': return specialSlotValuesEqual(left, right);
        case '!=': return !specialSlotValuesEqual(left, right);
        case '>': return left.rank > right.rank;
        case '<': return left.rank < right.rank;
        case '>=': return left.rank >= right.rank;
        case '<=': return left.rank <= right.rank;
    }
}

function specialSlotMatches(slotValue: ASSpecialSlotValue | null, matcher: SpecialSlotMatcher): boolean {
    if (matcher.type === 'any') {
        return true;
    }
    if (matcher.type === 'missing') {
        return slotValue === null;
    }
    if (slotValue === null) {
        return false;
    }
    if (matcher.type === 'set') {
        return matcher.values.some(value => specialSlotValuesEqual(value, slotValue));
    }
    return compareSpecialSlotValues(slotValue, matcher.value, matcher.operator);
}

function hasOnlyTrailingSpecialSlots(tokens: SpecialTargetToken[], start: number): boolean {
    let index = start;
    while (index < tokens.length) {
        const separator = tokens[index];
        if (separator?.type !== 'literal' || separator.text !== '/') {
            return false;
        }
        index++;
        if (tokens[index]?.type !== 'slot') {
            return false;
        }
        index++;
    }
    return true;
}

function legacyNumericQueryMatches(value: string, query: ParsedSpecialQuery): boolean {
    const targetTokens = parseSpecialTarget(value);
    let targetIndex = 0;

    for (const queryToken of query.tokens) {
        const targetToken = targetTokens[targetIndex];
        if (!targetToken) {
            return false;
        }

        if (queryToken.type === 'literal') {
            if (targetToken.type !== 'literal' || targetToken.text !== queryToken.text) {
                return false;
            }
        } else if (targetToken.type !== 'slot' || !specialSlotMatches(targetToken.value, queryToken.matcher)) {
            return false;
        }
        targetIndex++;
    }

    return targetIndex === targetTokens.length || hasOnlyTrailingSpecialSlots(targetTokens, targetIndex);
}

function parseAbstractSlotMatcher(part: string): SpecialSlotMatcher | null {
    if (part === '*') {
        return { type: 'any' };
    }
    if (part === '-') {
        return { type: 'missing' };
    }

    const set = parseSpecialNumberSet(part, 0);
    if (set?.end === part.length) {
        return { type: 'set', values: set.values };
    }

    const operator = readSpecialSlotOperator(part, 0);
    const slotValue = parseSpecialSlotValue(part, operator?.end ?? 0);
    if (!slotValue || slotValue.end !== part.length) {
        return null;
    }

    return {
        type: 'comparison',
        operator: operator?.operator ?? '=',
        value: slotValue.value,
    };
}

function parseAbstractSlotMatchers(value: string, token: string): SpecialSlotMatcher[] | null {
    const text = normalizeSpecialText(value);
    if (!text.startsWith(token)) {
        return null;
    }

    const suffix = text.slice(token.length);
    if (!suffix || suffix.startsWith('(')) {
        return suffix ? null : [];
    }

    const matchers: SpecialSlotMatcher[] = [];
    for (const part of suffix.split('/')) {
        const matcher = parseAbstractSlotMatcher(part);
        if (!matcher) {
            return null;
        }
        matchers.push(matcher);
    }
    return matchers;
}

function occurrenceMatchesQuery(occurrence: ASSpecialOccurrence, queryValue: string): boolean {
    const normalizedQuery = normalizeSpecialText(queryValue);
    if (normalizedQuery === occurrence.token) {
        return true;
    }

    const abstractMatchers = parseAbstractSlotMatchers(queryValue, occurrence.token);
    if (abstractMatchers && abstractMatchers.length > 0 && abstractMatchers.length <= occurrence.values.length) {
        if (abstractMatchers.every((matcher, index) => specialSlotMatches(occurrence.values[index] ?? null, matcher))) {
            return true;
        }
    }

    const numericQuery = parseSpecialQuery(queryValue);
    if (numericQuery) {
        return legacyNumericQueryMatches(occurrence.rawText, numericQuery);
    }

    if (queryValue.includes('*')) {
        const escaped = queryValue.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
        return new RegExp(`^${escaped}$`, 'i').test(occurrence.rawText);
    }

    return normalizeSpecialText(occurrence.rawText) === normalizedQuery;
}

export type ASSpecialSemanticOperator = '=' | '==' | '!=' | '&=' | '>' | '<' | '>=' | '<=';

/** Shared evaluator used by both direct AST execution and UI-state filtering. */
export function evaluateASSpecialsFilter(
    unitValue: unknown,
    operator: ASSpecialSemanticOperator,
    values: readonly string[],
    parsedSpecials?: ParsedASSpecials,
): boolean {
    const parsed = parsedSpecials ?? parseASSpecials(unitValue);

    if (parsed.occurrences.length === 0) {
        return operator === '!=';
    }

    if (operator === '&=') {
        return values.every(value => parsed.occurrences.some(occurrence => occurrenceMatchesQuery(occurrence, value)));
    }

    if (operator === '==') {
        const topLevelOccurrences = parsed.occurrences.filter(occurrence => occurrence.topLevel);
        return topLevelOccurrences.length > 0 && topLevelOccurrences.every(occurrence => (
            values.some(value => occurrenceMatchesQuery(occurrence, value))
        ));
    }

    for (const value of values) {
        const matches = parsed.occurrences.some(occurrence => occurrenceMatchesQuery(occurrence, value));
        if (operator === '!=') {
            if (matches) {
                return false;
            }
        } else if (matches) {
            return true;
        }
    }

    return operator === '!=';
}

function formatMinimumValue(value: number): string {
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}

/** Convert contextual UI minima into the canonical semantic slot query. */
export function formatASSpecialMinimumQuery(
    token: string,
    minimumValues: readonly (number | null)[] | undefined,
): string {
    if (!minimumValues || minimumValues.length === 0) {
        return token;
    }

    let lastValueIndex = -1;
    for (let index = 0; index < minimumValues.length; index++) {
        if (minimumValues[index] !== null && minimumValues[index] !== undefined) {
            lastValueIndex = index;
        }
    }
    if (lastValueIndex === -1) {
        return token;
    }

    const slots = minimumValues.slice(0, lastValueIndex + 1).map(value => (
        value === null || value === undefined ? '*' : `>=${formatMinimumValue(value)}`
    ));
    return token + slots.join('/');
}

/**
 * Parse the simple `>=`/wildcard form emitted by the contextual UI. Other
 * numeric semantic expressions remain semantic-only and retain exact behavior.
 */
export function parseASSpecialMinimumQuery(value: string): { token: string; minimumValues: (number | null)[] } | null {
    const token = getASSpecialToken(value);
    if (!token) {
        return null;
    }

    const normalized = normalizeSpecialText(value);
    if (normalized === token) {
        return { token, minimumValues: [] };
    }

    const matchers = parseAbstractSlotMatchers(value, token);
    if (!matchers || matchers.length === 0) {
        return null;
    }

    const minimumValues: (number | null)[] = [];
    for (const matcher of matchers) {
        if (matcher.type === 'any') {
            minimumValues.push(null);
        } else if (matcher.type === 'comparison' && matcher.operator === '>=') {
            minimumValues.push(matcher.value.rank);
        } else {
            return null;
        }
    }

    return minimumValues.some(value => value !== null)
        ? { token, minimumValues }
        : null;
}

/**
 * Build a safe token-posting prefilter for positive specials selections.
 * Numeric constraints are deliberately checked later against the tuple index;
 * this only removes units that cannot contain the requested ability token.
 */
export function buildIndexedASSpecialSelectionCandidates<T>(
    selections: readonly Pick<ASSpecialMinimumSelection, 'name' | 'state'>[],
    getIndexedUnitIds: (token: string) => ReadonlySet<T> | undefined,
): Set<T> | null {
    const resolve = (name: string): Set<T> | null => {
        if (name.includes('*') && !isASSpecialNumericQuery(name)) {
            return null;
        }

        const token = getASSpecialToken(name);
        if (!token) {
            return null;
        }

        const indexedUnitIds = getIndexedUnitIds(token);
        return indexedUnitIds === undefined ? null : new Set(indexedUnitIds);
    };

    let andCandidates: Set<T> | null = null;
    for (const selection of selections) {
        if (selection.state !== 'and') {
            continue;
        }

        const candidates = resolve(selection.name);
        if (candidates === null) {
            // Other resolved AND clauses are still a safe prefilter.
            continue;
        }

        if (andCandidates === null) {
            andCandidates = candidates;
            continue;
        }

        for (const unitId of andCandidates) {
            if (!candidates.has(unitId)) {
                andCandidates.delete(unitId);
            }
        }
    }

    const orSelections = selections.filter(selection => selection.state === 'or');
    if (orSelections.length === 0) {
        return andCandidates;
    }

    const orCandidates = new Set<T>();
    for (const selection of orSelections) {
        const candidates = resolve(selection.name);
        if (candidates === null) {
            // An unresolved OR branch may match outside all resolved postings.
            return andCandidates;
        }
        for (const unitId of candidates) {
            orCandidates.add(unitId);
        }
    }

    if (andCandidates === null) {
        return orCandidates;
    }

    for (const unitId of andCandidates) {
        if (!orCandidates.has(unitId)) {
            andCandidates.delete(unitId);
        }
    }
    return andCandidates;
}

export function unitMatchesASSpecialSelections(
    unitValue: unknown,
    selections: readonly ASSpecialMinimumSelection[],
    parsedSpecials?: ParsedASSpecials,
): boolean {
    const activeSelections = selections.filter(selection => selection.state !== false);
    const orSelections = activeSelections.filter(selection => selection.state === 'or');
    const andSelections = activeSelections.filter(selection => selection.state === 'and');
    const notSelections = activeSelections.filter(selection => selection.state === 'not');
    const queryFor = (selection: ASSpecialMinimumSelection) => (
        formatASSpecialMinimumQuery(selection.name, selection.minimumValues)
    );

    if (notSelections.some(selection => evaluateASSpecialsFilter(unitValue, '=', [queryFor(selection)], parsedSpecials))) {
        return false;
    }
    if (andSelections.some(selection => !evaluateASSpecialsFilter(unitValue, '=', [queryFor(selection)], parsedSpecials))) {
        return false;
    }
    if (orSelections.length > 0 && !orSelections.some(selection => (
        evaluateASSpecialsFilter(unitValue, '=', [queryFor(selection)], parsedSpecials)
    ))) {
        return false;
    }
    return true;
}
