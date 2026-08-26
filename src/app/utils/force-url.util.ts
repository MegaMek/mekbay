// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ASForceUnit } from '../models/as-force-unit.model';
import { CBTForce } from '../models/cbt-force.model';
import type { GameSystem } from '../models/common.model';
import { DEFAULT_GUNNERY_SKILL, DEFAULT_PILOTING_SKILL } from '../models/crew.model';
import type { FactionId } from '../models/factions.model';
import type { ForceSlot } from '../models/force-slot.model';
import type { Force } from '../models/force.model';
import type { UnitSummary } from '../models/unit-summary.model';

export interface UrlParseLogger { warn(message: string): void; }

export interface ForceQueryParams {
    readonly gs: GameSystem | null;
    readonly units: string | null;
    readonly name: string | null;
    readonly instance: string | null;
    readonly operation: string | null;
    readonly factionId: FactionId | null;
    readonly eraId: number | null;
}

export interface UnitShareLinks { readonly httpsUrl: string; readonly appUrl: string; }
export type ForceUrlUnitLookupMode = 'name' | 'mulId';

export interface ParsedForceUrlUnit {
    readonly summary: UnitSummary;
    readonly gunnerySkill?: number;
    readonly pilotingSkill?: number;
}

export interface ParsedForceUrlGroup {
    readonly name: string | null;
    readonly formationId: string | null;
    readonly units: readonly ParsedForceUrlUnit[];
}

export function buildUnitShareLinks(origin: string, pathname: string, gameSystem: GameSystem, unitName: string, tab: string): UnitShareLinks {
    const params = new URLSearchParams({ gs: gameSystem, shareUnit: unitName, tab });
    return { httpsUrl: `${origin}${pathname}?${params.toString()}`, appUrl: `web+mekbay://share?${params.toString()}` };
}

export function buildForceQueryParams(force: Force | null): ForceQueryParams {
    if (!force) return emptyQueryParams();
    const groups = encodeForceGroups(force);
    return {
        gs: force.gameSystem,
        units: groups.length > 0 ? groups.join('|') : null,
        name: groups.length > 0 ? force.name || null : null,
        instance: force.instanceId() || null,
        operation: null,
        factionId: force.faction()?.id ?? null,
        eraId: force.era()?.id ?? null,
    };
}

export function buildMultiForceQueryParams(slots: readonly ForceSlot[]): ForceQueryParams {
    if (slots.length === 0) return emptyQueryParams();
    const ids: string[] = [];
    let unsaved: Force | null = null;
    for (const slot of slots) {
        const id = slot.force.instanceId();
        if (id) ids.push(slot.alignment === 'enemy' ? `enemy:${id}` : id);
        else if (!unsaved) unsaved = slot.force;
    }
    const groups = unsaved ? encodeForceGroups(unsaved) : [];
    return {
        gs: unsaved?.gameSystem ?? null,
        units: groups.length > 0 ? groups.join('|') : null,
        name: groups.length > 0 ? unsaved?.name || null : null,
        instance: ids.length > 0 ? ids.join(',') : null,
        operation: null,
        factionId: unsaved?.faction()?.id ?? null,
        eraId: unsaved?.era()?.id ?? null,
    };
}

/** Pure decoder. Runtime creation belongs exclusively to ForceUnitAdmissionService. */
export function parseForceUrl(
    unitsParam: string,
    allUnits: readonly UnitSummary[],
    logger?: UrlParseLogger,
    lookupMode: ForceUrlUnitLookupMode = 'name',
): readonly ParsedForceUrlGroup[] {
    const lookup = new Map<string, UnitSummary>();
    for (const unit of allUnits) {
        const key = lookupMode === 'mulId' ? String(unit.id) : unit.name.toLowerCase();
        if (!lookup.has(key)) lookup.set(key, unit);
    }
    const sourceGroups = unitsParam.includes('|') || unitsParam.includes('~') ? unitsParam.split('|') : [unitsParam];
    const result: ParsedForceUrlGroup[] = [];
    for (const source of sourceGroups) {
        if (!source.trim()) continue;
        const separator = source.indexOf('~');
        const prefix = separator >= 0 ? source.slice(0, separator) : '';
        const unitText = separator >= 0 ? source.slice(separator + 1) : source;
        const [rawName = '', rawFormation = ''] = prefix.includes(';') ? prefix.split(';', 2) : [prefix, ''];
        const units: ParsedForceUrlUnit[] = [];
        for (const encoded of unitText.split(',')) {
            if (!encoded.trim()) continue;
            const parts = encoded.split(':');
            const key = lookupMode === 'mulId' ? parts[0] : parts[0].toLowerCase();
            const summary = lookup.get(key);
            if (!summary) {
                logger?.warn(`Unit with ${lookupMode === 'mulId' ? 'MUL ID' : 'name'} "${parts[0]}" not found in data`);
                continue;
            }
            const gunnery = parseOptionalSkill(parts[1]);
            const piloting = parseOptionalSkill(parts[2]);
            units.push(Object.freeze({
                summary,
                ...(gunnery === undefined ? {} : { gunnerySkill: gunnery }),
                ...(piloting === undefined ? {} : { pilotingSkill: piloting }),
            }));
        }
        result.push(Object.freeze({ name: rawName || null, formationId: rawFormation || null, units: Object.freeze(units) }));
    }
    return Object.freeze(result);
}

function encodeForceGroups(force: Force): string[] {
    if (force instanceof CBTForce) {
        const roster = force.queryCanonicalRoster();
        if (roster.kind !== 'available') return [];
        return roster.snapshot.structural.groups.flatMap(group => {
            const rows = roster.snapshot.structural.members.filter(member => member.groupId === group.groupId).flatMap(member => {
                const sheet = force.getMekRecordSheetSnapshot(member.instanceId);
                if (!sheet) return [];
                const pilot = sheet.crew[0];
                let text = sheet.identity.displayName;
                if (pilot && (pilot.gunnery !== DEFAULT_GUNNERY_SKILL || pilot.piloting !== DEFAULT_PILOTING_SKILL)) text += `:${pilot.gunnery}:${pilot.piloting}`;
                return [text];
            });
            if (rows.length === 0) return [];
            const prefix = group.formationId ? `${group.name ?? ''};${group.formationId}` : group.name ?? '';
            return [prefix ? `${prefix}~${rows.join(',')}` : rows.join(',')];
        });
    }
    return force.groups().filter(group => group.units().length > 0).map(group => {
        const rows = group.units().map(unit => {
            let text = unit.getSummary().name;
            if (unit instanceof ASForceUnit && unit.pilotSkill() !== DEFAULT_GUNNERY_SKILL) text += `:${unit.pilotSkill()}`;
            return text;
        });
        const formationId = group.activeFormation()?.id ?? '';
        const name = group.name() || '';
        const prefix = formationId ? `${name};${formationId}` : name;
        return prefix ? `${prefix}~${rows.join(',')}` : rows.join(',');
    });
}

function parseOptionalSkill(value: string | undefined): number | undefined {
    if (value === undefined) return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function emptyQueryParams(): ForceQueryParams {
    return { gs: null, units: null, name: null, instance: null, operation: null, factionId: null, eraId: null };
}
