/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
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

import type { Unit } from '../models/units.model';
import { AS_MOVEMENT_MODE_DISPLAY_NAMES, type SearchTelemetryStage } from '../services/unit-search-filters.model';

export interface UnitComponentData {
    names: Set<string>;
    counts: Map<string, number>;
}

const unitComponentCache = new WeakMap<Unit, UnitComponentData>();

export function getMergedTags(unit: Unit): string[] {
    const merged = new Set<string>();
    for (const tag of unit._chassisTags ?? []) merged.add(tag);
    for (const tag of unit._nameTags ?? []) merged.add(tag);
    for (const publicTag of unit._publicTags ?? []) merged.add(publicTag.tag);
    return Array.from(merged);
}

export function getProperty(obj: any, key?: string) {
    if (!obj || !key) return undefined;
    if (key === '_tags') {
        return getMergedTags(obj as Unit);
    }
    if (key === 'as._motive') {
        const mvm = (obj as Unit).as?.MVm;
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
        const mvm = (obj as Unit).as?.MVm;
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

function hasUnclosedQuote(text: string): boolean {
    let activeQuote: '"' | '\'' | null = null;

    for (let index = 0; index < text.length; index++) {
        const char = text[index];
        if (char === '\\') {
            index++;
            continue;
        }

        if (activeQuote) {
            if (char === activeQuote) {
                activeQuote = null;
            }
            continue;
        }

        if (char === '"' || char === '\'') {
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

export function getUnitComponentData(unit: Unit): UnitComponentData {
    let cached = unitComponentCache.get(unit);
    if (!cached) {
        const names = new Set<string>();
        const counts = new Map<string, number>();

        for (const component of unit.comp) {
            const name = component.n.toLowerCase();
            names.add(name);
            counts.set(name, (counts.get(name) || 0) + component.q);
        }

        cached = { names, counts };
        unitComponentCache.set(unit, cached);
    }

    return cached;
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