// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { MultiStateOption, MultiStateSelection } from '../components/multi-select-dropdown/multi-select-dropdown.component';
import type { UnitSummary } from '../models/unit-summary.model';
import { AS_MOVEMENT_MODE_DISPLAY_NAMES, type SearchTelemetryStage } from '../services/unit-search-filters.model';
import {
    MM_DATA_UNIT_PROVIDER_ID,
    type UnitProviderId,
} from '../services/unit-catalog/unit-catalog.types';

type SearchIdentityUnit = Pick<UnitSummary, 'uuid'> & { readonly provider?: UnitProviderId };
type CompactSearchUnit = UnitSummary & {
    readonly _componentNameCounts?: Readonly<Record<string, number>>;
    readonly _searchTags?: readonly string[];
};

/**
 * Collision-free search/index identity. Unit names remain presentation data and
 * may legitimately be shared by and custom providers.
 *
 * The length-prefixed representation matches the canonical catalog design-key
 * encoding while still admitting legacy/test Units whose UUID predates UUIDv7.
 */
export function getUnitSearchIdentityKey(unit: SearchIdentityUnit): string {
    const provider = unit.provider ?? MM_DATA_UNIT_PROVIDER_ID;
    return `${provider.length}:${provider}${unit.uuid.length}:${unit.uuid}`;
}

export interface UnitComponentData {
    names: Set<string>;
    counts: Map<string, number>;
}

const unitComponentCache = new WeakMap<UnitSummary, UnitComponentData>();

export function getMergedTags(unit: UnitSummary): string[] {
    const projected = (unit as CompactSearchUnit)._searchTags;
    if (projected) return [...projected];

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

export function getUnitSourceFilterValues(unit: Pick<UnitSummary, 'source' | 'published'>): string[] {
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

export function getProperty(obj: any, key?: string) {
    if (!obj || !key) return undefined;
    if (key === '_tags') {
        return getMergedTags(obj as UnitSummary);
    }
    if (key === 'source') {
        return getUnitSourceFilterValues(obj as UnitSummary);
    }
    if (key === 'weaponType') {
        return (obj as UnitSummary)._weaponTypes ?? [];
    }
    if (key === 'as._motive') {
        const mvm = (obj as UnitSummary).as?.MVm;
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
        const mvm = (obj as UnitSummary).as?.MVm;
        if (!mvm) return 0;
        const values = Object.values(mvm);
        return values.length > 0 ? Math.max(...values) : 0;
    }
    if (key.indexOf('.') === -1) return obj[key];
    const parts = key.split('.');
    let cur = obj;
    for (const part of parts) {
        if (cur == null) return undefined;
        cur = cur[part];
    }
    return cur;
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

        selection[name] = {
            ...option,
            name,
            state: isMultiState(option.state) ? option.state : false,
            count: typeof option.count === 'number' && Number.isFinite(option.count) && option.count > 0
                ? option.count
                : 1,
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

export function getUnitComponentData(unit: UnitSummary): UnitComponentData {
    let cached = unitComponentCache.get(unit);
    if (!cached) {
        const names = new Set<string>();
        const counts = new Map<string, number>();

        const projectedCounts = (unit as CompactSearchUnit)._componentNameCounts;
        if (projectedCounts) {
            for (const [name, count] of Object.entries(projectedCounts)) {
                names.add(name);
                counts.set(name, count);
            }
        } else {
            for (const component of unit.comp) {
                const name = component.n.toLowerCase();
                names.add(name);
                counts.set(name, (counts.get(name) || 0) + component.q);
            }
        }

        cached = { names, counts };
        unitComponentCache.set(unit, cached);
    }

    return cached;
}

export function getUnitCountableFilterData(unit: UnitSummary, filterKey: string): UnitComponentData | null {
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
