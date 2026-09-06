// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { MultiStateSelection } from '../components/multi-select-dropdown/multi-select-dropdown.component';
import type { UnitSummary } from '../models/unit-summary.model';
import type { UnitSearchIndexService } from '../services/unit-search-index.service';
import { compileASSpecialSelections, unitMatchesASSpecialSelections } from './as-special-filter.util';
import { getProperty, getUnitCountableFilterData } from './unit-search-shared.util';

type OptionIndex = Pick<UnitSearchIndexService,
    'getDropdownOptionUniverse' | 'getIndexedUnitIds' | 'getIndexedASSpecials'>;

/** Available co-selections must satisfy every AND and no NOT selection. ORs do not constrain them. */
export function collectConstrainedMultistateAvailabilityNames(
    filterKey: string,
    units: readonly UnitSummary[],
    selection: MultiStateSelection,
    isCountableFilter: boolean,
    index: OptionIndex,
): Set<string> | null {
    const andEntries = Object.entries(selection).filter(([, selected]) => selected.state === 'and');
    const excludedNames = Array.from(new Set(Object.entries(selection)
        .filter(([, selected]) => selected.state === 'not')
        .map(([name]) => name.toLowerCase())));
    if (andEntries.length === 0 && excludedNames.length === 0) return null;

    if (!isCountableFilter) {
        const universe = index.getDropdownOptionUniverse(filterKey).map(option => option.name);
        if (universe.length > 0) {
            return collectIndexedNames(
                filterKey, units, selection, andEntries.map(([name]) => name), excludedNames, universe, index,
            );
        }
    }

    const requiredCounts = Array.from(new Map(andEntries
        .map(([name, selected]) => [name.toLowerCase(), selected.count] as const)));
    const availableNames = new Set<string>();
    for (const unit of units) {
        if (isCountableFilter) {
            const data = getUnitCountableFilterData(unit, filterKey);
            if (!data || excludedNames.some(name => data.names.has(name))
                || requiredCounts.some(([name, count]) => (data.counts.get(name) || 0) < count)) {
                continue;
            }
            for (const name of data.names) availableNames.add(name);
        } else {
            const value = getProperty(unit, filterKey);
            const names = new Map<string, string>();
            for (const item of Array.isArray(value) ? value : [value]) {
                if (item == null || item === '') continue;
                const original = String(item);
                const normalized = original.toLowerCase();
                if (!names.has(normalized)) names.set(normalized, original);
            }
            if (excludedNames.some(name => names.has(name))
                || requiredCounts.some(([name]) => !names.has(name))) {
                continue;
            }
            for (const original of names.values()) availableNames.add(original);
        }
    }
    return availableNames;
}

function collectIndexedNames(
    filterKey: string,
    units: readonly UnitSummary[],
    selection: MultiStateSelection,
    requiredNames: readonly string[],
    excludedNames: readonly string[],
    universe: readonly string[],
    index: OptionIndex,
): Set<string> {
    const contextIds = new Set(units.map(unit => unit.uuid));
    let candidates = contextIds;
    if (requiredNames.length > 0) {
        const firstMatches = index.getIndexedUnitIds(filterKey, requiredNames[0]);
        if (!firstMatches) return new Set();
        candidates = new Set();
        const [smaller, larger] = firstMatches.size < contextIds.size
            ? [firstMatches, contextIds] : [contextIds, firstMatches];
        for (const id of smaller) {
            if (larger.has(id)) candidates.add(id);
        }
    }
    for (const name of requiredNames.slice(1)) {
        const matchingIds = index.getIndexedUnitIds(filterKey, name);
        if (!matchingIds) return new Set();
        for (const id of candidates) {
            if (!matchingIds.has(id)) candidates.delete(id);
        }
    }
    if (candidates.size === 0) return new Set();

    if (filterKey === 'as.specials') {
        // The name index narrows candidates; ability ranges and numeric thresholds still need evaluation.
        const constraints = compileASSpecialSelections(Object.values(selection)
            .filter(selected => selected.state === 'and' || selected.state === 'not'));
        const unitsById = new Map(units.map(unit => [unit.uuid, unit]));
        for (const id of candidates) {
            const unit = unitsById.get(id)!;
            if (!unitMatchesASSpecialSelections(
                getProperty(unit, filterKey), constraints, index.getIndexedASSpecials(id),
            )) {
                candidates.delete(id);
            }
        }
    } else {
        for (const excluded of excludedNames) {
            const name = universe.find(candidate => candidate.toLowerCase() === excluded);
            if (!name) continue;
            const excludedIds = index.getIndexedUnitIds(filterKey, name);
            if (!excludedIds) continue;
            for (const id of candidates) {
                if (excludedIds.has(id)) candidates.delete(id);
            }
        }
    }

    const availableNames = new Set<string>();
    if (candidates.size === 0) return availableNames;
    for (const name of universe) {
        const ids = index.getIndexedUnitIds(filterKey, name);
        if (!ids) continue;
        const [smaller, larger] = ids.size < candidates.size ? [ids, candidates] : [candidates, ids];
        for (const id of smaller) {
            if (larger.has(id)) {
                availableNames.add(name);
                break;
            }
        }
    }
    return availableNames;
}
