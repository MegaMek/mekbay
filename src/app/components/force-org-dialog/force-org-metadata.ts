// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { LoadForceEntry } from '../../models/load-force-entry.model';
import { GameSystem } from '../../models/common.model';
import type { Era } from '../../models/eras.model';
import type { Faction, FactionId } from '../../models/factions.model';
import type { GroupSizeResult, OrgSizeResult } from '../../utils/org/org-types';
import { getOrgFromForce, getOrgFromForceCollection } from '../../utils/org/org-namer.util';

export interface PreviewOrgExtras {
    targetGroupId: string;
    entries: LoadForceEntry[];
    childGroupResults?: GroupSizeResult[];
}

export interface OrgGroupMetadata {
    descendants: LoadForceEntry[];
    org: OrgSizeResult;
    totals: string;
    factionId: FactionId | undefined;
    value: number;
}

interface FactionVote { factionId: FactionId | undefined; value: number }

/** Positive BV wins; zero-value collections use entity counts. Ties keep insertion order. */
function dominantFactionId(votes: readonly FactionVote[]): FactionId | undefined {
    const values = new Map<FactionId, number>();
    const counts = new Map<FactionId, number>();
    for (const { factionId, value } of votes) {
        if (factionId === undefined) continue;
        values.set(factionId, (values.get(factionId) ?? 0) + value);
        counts.set(factionId, (counts.get(factionId) ?? 0) + 1);
    }
    let bestValue = -1;
    let bestId: FactionId | undefined;
    for (const [id, value] of values) {
        if (value > bestValue) { bestValue = value; bestId = id; }
    }
    if (bestValue > 0) return bestId;
    let maxCount = 0;
    for (const [id, count] of counts) {
        if (count > maxCount) { maxCount = count; bestId = id; }
    }
    return bestId;
}

/** Metadata for a new group preview, before it has a place in the hierarchy. */
export function deriveCollectionMetadata(
    entries: LoadForceEntry[], factions: readonly Faction[], eras: readonly Era[], childGroups?: GroupSizeResult[],
) {
    const factionId = dominantFactionId(entries.map(force => ({ factionId: force.faction?.id, value: getForceValue(force) })));
    const org = getOrgFromForceCollection(entries, factions.find(faction => faction.id === factionId),
        deriveCollectionEra(entries, eras), childGroups, { displayTierCutoff: 0 });
    return { orgName: org.name, totals: formatTotals(entries), factionId };
}

/**
 * Derive each group once, bottom-up. Only hierarchy and force data are read, so moving
 * cards cannot invalidate naming. Child groups contribute one faction vote each.
 */
export function deriveOrganizationMetadata(
    groups: ReadonlyMap<string, { parentGroupId: string | null }>,
    placed: readonly { force: LoadForceEntry; groupId: string | null }[],
    factions: readonly Faction[],
    eras: readonly Era[],
    preview?: PreviewOrgExtras,
) {
    const children = new Map<string, string[]>();
    const directForces = new Map<string | null, LoadForceEntry[]>();
    for (const [id, group] of groups) {
        if (group.parentGroupId === null) continue;
        const siblings = children.get(group.parentGroupId);
        if (siblings) siblings.push(id);
        else children.set(group.parentGroupId, [id]);
    }
    for (const { force, groupId } of placed) {
        const entries = directForces.get(groupId);
        if (entries) entries.push(force);
        else directForces.set(groupId, [force]);
    }
    const previewAncestors = new Set<string>();
    let parentId: string | null = preview?.targetGroupId ?? null;
    while (parentId && !previewAncestors.has(parentId)) {
        previewAncestors.add(parentId);
        parentId = groups.get(parentId)?.parentGroupId ?? null;
    }
    const factionsById = new Map(factions.map(faction => [faction.id, faction]));
    const forceOrgs = new Map<LoadForceEntry, readonly GroupSizeResult[]>();
    const forceValues = new Map<LoadForceEntry, number>();
    const valueOf = (force: LoadForceEntry): number => {
        let value = forceValues.get(force);
        if (value === undefined) {
            value = getForceValue(force);
            forceValues.set(force, value);
        }
        return value;
    };
    const metadata = new Map<string, OrgGroupMetadata>();
    // Base descendant order remains direct forces then child groups, even in previews.
    const baseDescendants = new Map<string, LoadForceEntry[]>();
    const resolve = (id: string): OrgGroupMetadata => {
        const existing = metadata.get(id);
        if (existing) return existing;
        const direct = directForces.get(id) ?? [];
        const descendants = [...direct];
        const votes: FactionVote[] = direct.map(force => ({ factionId: force.faction?.id, value: valueOf(force) }));
        if (preview?.targetGroupId === id) {
            votes.push(...preview.entries.map(force => ({ factionId: force.faction?.id, value: valueOf(force) })));
        }
        const childResults: GroupSizeResult[] = [];
        const childEntryIds = new Set<string>();
        for (const childId of children.get(id) ?? []) {
            const child = resolve(childId);
            descendants.push(...baseDescendants.get(childId)!);
            votes.push({ factionId: child.factionId, value: child.value });
            if (child.descendants.length === 0) continue;
            for (const entry of child.descendants) childEntryIds.add(entry.instanceId);
            childResults.push(...child.org.groups);
        }
        baseDescendants.set(id, descendants);
        // Extras were historically appended to each ancestor, rather than inserted
        // amongst that ancestor's child groups. Preserve ordering and shadow copies.
        const entries = preview && previewAncestors.has(id) ? [...descendants, ...preview.entries] : descendants;
        if (preview?.targetGroupId === id && preview.childGroupResults?.length) {
            for (const entry of preview.entries) childEntryIds.add(entry.instanceId);
            childResults.push(...preview.childGroupResults);
        }
        for (const entry of entries) {
            // A shadow copy already represented by a child contributes to totals,
            // but the child supplies its organizational naming result.
            if (childEntryIds.has(entry.instanceId)) continue;
            let results = forceOrgs.get(entry);
            if (!results) {
                results = getOrgFromForce(entry, { displayOnlyTopLevel: true }).groups;
                forceOrgs.set(entry, results);
            }
            childResults.push(...results);
        }
        const factionId = dominantFactionId(votes);
        const result: OrgGroupMetadata = {
            descendants: entries,
            factionId,
            value: entries.reduce((sum, entry) => sum + valueOf(entry), 0),
            org: getOrgFromForceCollection(entries, factionId === undefined ? undefined : factionsById.get(factionId),
                deriveCollectionEra(entries, eras), childResults, { displayTierCutoff: 0 }),
            totals: formatTotals(entries),
        };
        metadata.set(id, result);
        return result;
    };
    const organizationVotes: FactionVote[] = [];
    for (const [id, group] of groups) {
        const result = resolve(id);
        if (group.parentGroupId === null) organizationVotes.push({ factionId: result.factionId, value: result.value });
    }
    for (const force of directForces.get(null) ?? []) {
        organizationVotes.push({ factionId: force.faction?.id, value: valueOf(force) });
    }
    return { groups: metadata, factionId: dominantFactionId(organizationVotes) };
}

/** Compute total BV and PV for a force, preferring saved values over unit-derived sums.
 *  Only sums BV for CBT forces and PV for Alpha Strike forces. */
function computeForceUnitTotals(force: LoadForceEntry): { totalBv: number; totalPv: number } {
    const isAS = force.type === GameSystem.AS;
    if (isAS && typeof force.pv === 'number') {
        return { totalBv: 0, totalPv: force.pv };
    }
    if (!isAS && typeof force.bv === 'number') {
        return { totalBv: force.bv, totalPv: 0 };
    }

    let totalBv = 0, totalPv = 0;
    for (const g of force.groups ?? []) {
        for (const ue of g.units ?? []) {
            if (ue.unit) {
                if (isAS) {
                    totalPv += ue.unit.as.PV ?? 0;
                } else {
                    totalBv += ue.unit.bv ?? 0;
                }
            }
        }
    }
    return { totalBv, totalPv };
}

/** Get the dominance value for a force by summing unit.bv (common scale across game systems). */
function getForceValue(force: LoadForceEntry): number {
    let total = 0;
    for (const g of force.groups ?? []) {
        for (const ue of g.units ?? []) {
            if (ue.unit) total += ue.unit.bv ?? 0;
        }
    }
    return total;
}

/** Format BV/PV totals for a set of entries as a display string. */
function formatTotals(entries: readonly LoadForceEntry[]): string {
    let totalBv = 0, totalPv = 0;
    for (const e of entries) {
        const t = computeForceUnitTotals(e);
        totalBv += t.totalBv;
        totalPv += t.totalPv;
    }
    const parts: string[] = [];
    if (totalBv > 0) parts.push(`BV: ${totalBv.toLocaleString()}`);
    if (totalPv > 0) parts.push(`PV: ${totalPv.toLocaleString()}`);
    return parts.join(' · ');
}

export function deriveCollectionEra(entries: readonly LoadForceEntry[], eras: readonly Era[]): Era | null {
    if (eras.length === 0) {
        return null;
    }

    let referenceYear: number | null = null;
    for (const entry of entries) {
        const entryReferenceYear = entry.era?.years.from ?? getLatestEntryUnitYear(entry);
        if (entryReferenceYear === null) {
            continue;
        }
        referenceYear = referenceYear === null ? entryReferenceYear : Math.max(referenceYear, entryReferenceYear);
    }

    if (referenceYear === null) {
        return null;
    }

    return eras.find((era) => {
        const from = era.years.from ?? Number.NEGATIVE_INFINITY;
        const to = era.years.to ?? Number.POSITIVE_INFINITY;
        return from <= referenceYear && referenceYear <= to;
    }) ?? eras[eras.length - 1] ?? null;
}

function getLatestEntryUnitYear(entry: LoadForceEntry): number | null {
    let latestYear = Number.NEGATIVE_INFINITY;
    for (const group of entry.groups) {
        for (const unitEntry of group.units) {
            const year = unitEntry.unit?.year;
            if (year !== undefined) {
                latestYear = Math.max(latestYear, year);
            }
        }
    }

    return Number.isFinite(latestYear) ? latestYear : null;
}



