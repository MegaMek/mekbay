// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { LoadForceEntry } from '../../models/load-force-entry.model';
import { sanitizeForceTags } from '../../models/force-serialization';
import { GameSystem } from '../../models/common.model';
import { getOrgFromForce } from '../../utils/org/org-namer.util';
import { naturalCompare } from '../../utils/sort.util';

export const SIDEBAR_FILTER_ALL = 'all';
export const SIDEBAR_FILTER_UNTAGGED = 'untagged';
const SIDEBAR_TAG_FILTER_PREFIX = 'tag:';
export interface SidebarTagRecord { id: string; label: string; count: number }
interface SidebarFactionFilterOption { id: number; name: string; img?: string; count: number }
interface SidebarEraFilterOption { id: number; name: string; img?: string; count: number; startYear: number }

/** Count tags once per force, retaining the first spelling for their labels. */
export function countSidebarFilters(forces: readonly LoadForceEntry[]) {
    const counts = new Map<string, number>([
        [SIDEBAR_FILTER_ALL, forces.length], [GameSystem.CBT, 0], [GameSystem.AS, 0], [SIDEBAR_FILTER_UNTAGGED, 0],
    ]);
    const labels = new Map<string, string>();
    for (const force of forces) {
        const type = force.type || GameSystem.CBT;
        counts.set(type, (counts.get(type) ?? 0) + 1);
        const tags = getForceTags(force);
        if (tags.length === 0) {
            counts.set(SIDEBAR_FILTER_UNTAGGED, (counts.get(SIDEBAR_FILTER_UNTAGGED) ?? 0) + 1);
        }
        const seen = new Set<string>();
        for (const tag of tags) {
            const id = getSidebarTagFilterId(tag);
            if (seen.has(id)) continue;
            seen.add(id);
            if (!labels.has(id)) labels.set(id, tag);
            counts.set(id, (counts.get(id) ?? 0) + 1);
        }
    }
    return { counts, labels };
}

export function buildSidebarTags(labels: ReadonlyMap<string, string>, counts: ReadonlyMap<string, number>): SidebarTagRecord[] {
    return Array.from(labels, ([id, label]) => ({ id, label, count: counts.get(id) ?? 0 }))
        .sort((a, b) => naturalCompare(a.label, b.label));
}

export function sortForces(items: LoadForceEntry[], sortKey: string, sortDir: 'asc' | 'desc'): LoadForceEntry[] {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...items].sort((a, b) => {
        switch (sortKey) {
            case 'name':
                return dir * naturalCompare(a.name || '', b.name || '');
            case 'value': {
                const aVal = (a.type === GameSystem.AS) ? (a.pv ?? 0) : (a.bv ?? 0);
                const bVal = (b.type === GameSystem.AS) ? (b.pv ?? 0) : (b.bv ?? 0);
                return dir * (aVal - bVal);
            }
            case 'faction': {
                const aFaction = a.faction?.name ?? '';
                const bFaction = b.faction?.name ?? '';
                return dir * naturalCompare(aFaction, bFaction);
            }
            case 'size': {
                const aSize = a.groups ? a.groups.reduce((sum, g) => sum + (g.units?.length || 0), 0) : 0;
                const bSize = b.groups ? b.groups.reduce((sum, g) => sum + (g.units?.length || 0), 0) : 0;
                return dir * (aSize - bSize);
            }
            case 'timestamp':
            default:
                return dir * ((a.timestamp || '').localeCompare(b.timestamp || ''));
        }
    });
}

export function computeSearchText(force: LoadForceEntry): string {
    let s = '';
    const orgName = getOrgFromForce(force).name;

    if (force.name) s += force.name + ' ';
    if (force.note) s += force.note + ' ';
    if (force.tags?.length) s += getForceTags(force).join(' ') + ' ';
    if (force.faction?.name) s += force.faction.name + ' ';
    if (force.era?.name) s += force.era.name + ' ';
    if (orgName) s += orgName + ' ';
    for (const g of (force.groups || [])) {
        if (g.name) s += g.name + ' ';
        for (const ue of (g.units || [])) {
            if (ue.alias) s += ue.alias + ' ';
            if (ue.unit) {
                if (ue.unit.model) s += ue.unit.model + ' ';
                if (ue.unit.chassis) s += ue.unit.chassis + ' ';
            }
        }
    }
    return s.trim().toLowerCase();
}

export function matchesSidebarSearch(force: LoadForceEntry, tokens: readonly string[]): boolean {
    if (tokens.length === 0) {
        return true;
    }

    const hay = force._searchText || '';
    return tokens.every(t => hay.indexOf(t) !== -1);
}

export function matchesSidebarFilter(force: LoadForceEntry, filter: string): boolean {
    const forceTags = getForceTags(force);

    switch (filter) {
        case SIDEBAR_FILTER_ALL:
            return true;
        case GameSystem.CBT:
            return (force.type || GameSystem.CBT) === GameSystem.CBT;
        case GameSystem.AS:
            return (force.type || GameSystem.CBT) === GameSystem.AS;
        case SIDEBAR_FILTER_UNTAGGED:
            return forceTags.length === 0;
        default:
            return forceTags.some(tag => getSidebarTagFilterId(tag) === filter);
    }
}

export function matchesSidebarFactionFilter(force: LoadForceEntry, filter: number | null): boolean {
    return filter == null || force.faction?.id === filter;
}

export function matchesSidebarEraFilter(force: LoadForceEntry, filter: number | null): boolean {
    return filter == null || force.era?.id === filter;
}

export function buildSidebarFactionOptions(forces: readonly LoadForceEntry[]): SidebarFactionFilterOption[] {
    const options = new Map<number, SidebarFactionFilterOption>();
    for (const force of forces) {
        const faction = force.faction;
        if (!faction) continue;
        const existing = options.get(faction.id);
        if (existing) {
            existing.count += 1;
            continue;
        }
        options.set(faction.id, {
            id: faction.id,
            name: faction.name,
            img: faction.img,
            count: 1,
        });
    }
    return Array.from(options.values())
        .sort((a, b) => naturalCompare(a.name, b.name) || a.id - b.id);
}

export function buildSidebarEraOptions(forces: readonly LoadForceEntry[]): SidebarEraFilterOption[] {
    const options = new Map<number, SidebarEraFilterOption>();
    for (const force of forces) {
        const era = force.era;
        if (!era) continue;
        const existing = options.get(era.id);
        if (existing) {
            existing.count += 1;
            continue;
        }
        options.set(era.id, {
            id: era.id,
            name: era.name,
            img: era.img ?? era.icon,
            count: 1,
            startYear: era.years.from ?? Number.NEGATIVE_INFINITY,
        });
    }
    return Array.from(options.values())
        .sort((a, b) => a.startYear - b.startYear || naturalCompare(a.name, b.name) || a.id - b.id);
}

function getSidebarTagFilterId(tag: string): string {
    return `${SIDEBAR_TAG_FILTER_PREFIX}${tag.toLocaleLowerCase()}`;
}

function getForceTags(force: LoadForceEntry): string[] {
    return sanitizeForceTags(force.tags ?? []);
}

