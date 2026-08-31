// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { MultiStateOption, MultiStateSelection } from '../components/multi-select-dropdown/multi-select-dropdown.component';
import { AS_MOVEMENT_MODE_DISPLAY_NAMES, type SearchTelemetryStage } from '../services/unit-search-filters.model';
import type { UnitSearchRecord } from './unit-search-worker-protocol.util';

export interface UnitComponentData {
    names: Set<string>;
    counts: Map<string, number>;
}

const unitComponentCache = new WeakMap<UnitSearchRecord, UnitComponentData>();

export function getMergedTags(unit: UnitSearchRecord): string[] {
    if ('_searchTags' in unit) return [...unit._searchTags];

    const merged = new Set<string>();
    for (const entry of unit._chassisTags ?? []) merged.add(entry.tag);
    for (const entry of unit._nameTags ?? []) merged.add(entry.tag);
    for (const publicTag of unit._publicTags ?? []) merged.add(publicTag.tag);
    return Array.from(merged);
}

function normalizeSourceValues(value: readonly string[] | null | undefined): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const result: string[] = [];
    const seen = new Set<string>();

    for (const entry of value) {
        if (typeof entry !== 'string') {
            continue;
        }

        const source = entry.trim();
        const sourceKey = source.toLowerCase();
        if (!source || sourceKey === 'none' || seen.has(sourceKey)) {
            continue;
        }

        seen.add(sourceKey);
        result.push(source);
    }

    return result;
}

export function getUnitSourceFilterValues(
    unit: Pick<UnitSearchRecord, 'source' | 'published'>,
): string[] {
    const sources = normalizeSourceValues(unit.source);
    const published = normalizeSourceValues(unit.published);

    if (published.length === 0) {
        return sources;
    }

    const merged = new Map<string, string>();
    for (const source of sources) {
        merged.set(source.toLowerCase(), source);
    }
    for (const source of published) {
        merged.set(source.toLowerCase(), source);
    }

    return Array.from(merged.values());
}

function normalizeRulesRefBucket(values: unknown): string[] {
    if (!Array.isArray(values)) {
        return [];
    }

    return Array.from(new Set(
        values
            .filter((value): value is string => typeof value === 'string')
            .map(value => value.trim().toLowerCase())
            .filter(value => value.length > 0),
    ));
}

const BASE_RULE_BOOK_KEYS = new Set(['tw', 'tm', 'bmm', 'core']);

function normalizeUnitRulesRefBuckets(values: unknown): string[][] {
    if (!Array.isArray(values) || values.length === 0) {
        return [];
    }

    // Accept the former flat representation while existing force/search state migrates.
    if (values.every(value => typeof value === 'string')) {
        const bucket = normalizeRulesRefBucket(values);
        return bucket.length > 0 ? [bucket] : [];
    }

    return values
        .map(normalizeRulesRefBucket)
        .filter(bucket => bucket.length > 0);
}

/** Return whether one alternative unit rules-reference bucket is covered by the selection. */
export function unitMatchesRulesRefsSelection(unitRulesRefs: unknown, selectedRulesRefs: readonly string[]): boolean {
    const selectedRefs = new Set(normalizeRulesRefBucket(selectedRulesRefs));
    if (selectedRefs.size === 0) {
        return true;
    }

    const buckets = normalizeUnitRulesRefBuckets(unitRulesRefs);
    if (Array.from(selectedRefs).some(rulesRef => BASE_RULE_BOOK_KEYS.has(rulesRef))) {
        return buckets.some(bucket => bucket.every(rulesRef => selectedRefs.has(rulesRef)));
    }

    return buckets.some(bucket => {
        const nonBaseBooks = bucket.filter(rulesRef => !BASE_RULE_BOOK_KEYS.has(rulesRef));
        return nonBaseBooks.length > 0 && nonBaseBooks.every(rulesRef => selectedRefs.has(rulesRef));
    });
}

export function getProperty(obj: UnitSearchRecord, key?: string): unknown {
    if (!key) return undefined;
    if (key === '_tags') {
        return getMergedTags(obj);
    }
    if (key === 'source') {
        return getUnitSourceFilterValues(obj);
    }
    if (key === 'weaponType') {
        return obj._weaponTypes ?? [];
    }
    if (key === 'as._motive') {
        const mvm = obj.as?.MVm;
        if (!mvm) return [];

        const result: string[] = [];
        for (const mode of Object.keys(AS_MOVEMENT_MODE_DISPLAY_NAMES)) {
            if (mode in mvm) {
                result.push(AS_MOVEMENT_MODE_DISPLAY_NAMES[mode]);
            }
        }
        for (const mode of Object.keys(mvm)) {
            if (!(mode in AS_MOVEMENT_MODE_DISPLAY_NAMES)) {
                result.push(mode);
            }
        }
        return result;
    }
    if (key === 'as._mv') {
        const mvm = obj.as?.MVm;
        if (!mvm) return 0;
        const values = Object.values(mvm);
        return values.length > 0 ? Math.max(...values) : 0;
    }
    if (key.indexOf('.') === -1) return readProperty(obj, key);
    const parts = key.split('.');
    let cur: unknown = obj;
    for (const part of parts) {
        cur = readProperty(cur, part);
        if (cur === undefined) return undefined;
    }
    return cur;
}

function readProperty(value: unknown, key: string): unknown {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
        return undefined;
    }
    return (value as Readonly<Record<string, unknown>>)[key];
}

export function getNowMs(): number {
    return globalThis.performance?.now?.() ?? Date.now();
}

function isMultiState(value: unknown): value is MultiStateOption['state'] {
    return value === false || value === 'or' || value === 'and' || value === 'not';
}

export function normalizeMultiStateSelection(value: unknown): MultiStateSelection {
    if (!value) {
        return {};
    }

    if (Array.isArray(value)) {
        const selection: MultiStateSelection = {};
        for (const entry of value) {
            if (typeof entry !== 'string' || entry.length === 0) {
                continue;
            }

            selection[entry] = {
                name: entry,
                state: 'or',
                count: 1,
            };
        }
        return selection;
    }

    if (typeof value !== 'object') {
        return {};
    }

    const selection: MultiStateSelection = {};
    for (const [rawName, rawOption] of Object.entries(value as Record<string, unknown>)) {
        if (!rawOption || typeof rawOption !== 'object') {
            continue;
        }

        const option = rawOption as Partial<MultiStateOption>;
        const name = typeof option.name === 'string' && option.name.length > 0 ? option.name : rawName;
        if (!name) {
            continue;
        }

        const minimumValues = Array.isArray(option.minimumValues)
            ? option.minimumValues.map(value => (
                typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
            ))
            : undefined;
        const optionWithoutMinimumValues = { ...option };
        delete optionWithoutMinimumValues.minimumValues;

        selection[name] = {
            ...optionWithoutMinimumValues,
            name,
            state: isMultiState(option.state) ? option.state : false,
            count: typeof option.count === 'number' && Number.isFinite(option.count) && option.count > 0
                ? option.count
                : 1,
            ...(minimumValues?.some(value => value !== null) ? { minimumValues } : {}),
        };
    }

    return selection;
}

export function getSelectedPositiveDropdownNames(value: unknown): string[] {
    if (Array.isArray(value)) {
        return Array.from(new Set(
            value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0),
        ));
    }

    return Array.from(new Set(
        Object.values(normalizeMultiStateSelection(value))
            .filter((option) => option.state === 'or' || option.state === 'and')
            .map((option) => option.name),
    ));
}

function isAlphaNumericChar(char: string | undefined): boolean {
    if (!char) {
        return false;
    }

    const code = char.charCodeAt(0);
    return (code >= 48 && code <= 57)
        || (code >= 65 && code <= 90)
        || (code >= 97 && code <= 122);
}

export function isEmbeddedApostrophe(text: string, index: number): boolean {
    return text[index] === '\''
        && isAlphaNumericChar(text[index - 1])
        && isAlphaNumericChar(text[index + 1]);
}

export function hasUnclosedQuote(text: string): boolean {
    let activeQuote: '"' | '\'' | null = null;

    for (let index = 0; index < text.length; index++) {
        const char = text[index];
        if (char === '\\') {
            index++;
            continue;
        }

        if (activeQuote) {
            if (char === activeQuote && (char !== '\'' || !isEmbeddedApostrophe(text, index))) {
                activeQuote = null;
            }
            continue;
        }

        if (char === '"' || (char === '\'' && !isEmbeddedApostrophe(text, index))) {
            activeQuote = char;
        }
    }

    return activeQuote !== null;
}

export function isCommittedSemanticToken(token: { rawText: string; operator: string }): boolean {
    const operatorIndex = token.rawText.indexOf(token.operator);
    if (operatorIndex === -1) {
        return true;
    }

    const rawValueText = token.rawText.slice(operatorIndex + token.operator.length);
    if (!rawValueText || rawValueText.endsWith(',')) {
        return false;
    }

    return !hasUnclosedQuote(rawValueText);
}

export function getUnitComponentData(unit: UnitSearchRecord): UnitComponentData {
    let cached = unitComponentCache.get(unit);
    if (!cached) {
        const names = new Set<string>();
        const counts = new Map<string, number>();

        if ('comp' in unit) {
            for (const component of unit.comp) {
                const name = component.n.toLowerCase();
                names.add(name);
                counts.set(name, (counts.get(name) || 0) + component.q);
            }
        } else {
            for (const [name, count] of Object.entries(unit._componentNameCounts)) {
                names.add(name);
                counts.set(name, count);
            }
        }

        cached = { names, counts };
        unitComponentCache.set(unit, cached);
    }

    return cached;
}

export function getUnitCountableFilterData(
    unit: UnitSearchRecord,
    filterKey: string,
): UnitComponentData | null {
    if (filterKey === 'componentName') {
        return getUnitComponentData(unit);
    }

    if (filterKey !== 'weaponType') {
        return null;
    }

    const names = new Set<string>();
    const counts = new Map<string, number>();

    for (const [weaponType, count] of Object.entries(unit._weaponTypeCounts ?? {})) {
        if (typeof count !== 'number' || count <= 0) {
            continue;
        }

        const normalizedWeaponType = weaponType.toLowerCase();
        names.add(normalizedWeaponType);
        counts.set(normalizedWeaponType, count);
    }

    return { names, counts };
}

export function checkQuantityConstraint(
    unitCount: number,
    count: number,
    operator?: string,
    countMax?: number,
    includeRanges?: [number, number][],
    excludeRanges?: [number, number][],
): boolean {
    if (includeRanges || excludeRanges) {
        if (excludeRanges) {
            for (const [min, max] of excludeRanges) {
                if (unitCount >= min && unitCount <= max) {
                    return false;
                }
            }
        }

        if (includeRanges && includeRanges.length > 0) {
            for (const [min, max] of includeRanges) {
                if (unitCount >= min && unitCount <= max) {
                    return true;
                }
            }
            return false;
        }

        return unitCount >= 1;
    }

    if (!operator) {
        return unitCount >= count;
    }

    if (countMax !== undefined) {
        const inRange = unitCount >= count && unitCount <= countMax;
        return operator === '!=' ? !inRange : inRange;
    }

    switch (operator) {
        case '=':
            return unitCount === count;
        case '!=':
            return unitCount !== count;
        case '>':
            return unitCount > count;
        case '>=':
            return unitCount >= count;
        case '<':
            return unitCount < count;
        case '<=':
            return unitCount <= count;
        default:
            return unitCount >= count;
    }
}

export function measureStage<T>(
    stages: SearchTelemetryStage[],
    name: string,
    inputCount: number | undefined,
    work: () => T,
    outputCount?: (value: T) => number | undefined,
): T {
    const startedAt = getNowMs();
    const value = work();
    const stage: SearchTelemetryStage = {
        name,
        durationMs: getNowMs() - startedAt,
    };

    if (inputCount !== undefined) {
        stage.inputCount = inputCount;
    }

    const resolvedOutputCount = outputCount?.(value);
    if (resolvedOutputCount !== undefined) {
        stage.outputCount = resolvedOutputCount;
    }

    stages.push(stage);
    return value;
}
