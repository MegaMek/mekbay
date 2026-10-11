// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { Era } from '../models/eras.model';
import type { Faction } from '../models/factions.model';
import { MULFACTION_EXTINCT, MULFACTION_NONE } from '../models/mulfactions.model';
import type { UnitSummary } from '../models/unit-summary.model';
import { isUnitIntroducedByEra } from './unit-introduction.util';

type UnitUuid = UnitSummary['uuid'];
type AvailabilityUnit = { uuid: UnitUuid; mul1id: number | null; year: number };
const EMPTY_MEMBERSHIP: ReadonlySet<UnitUuid> = new Set<UnitUuid>();

/** Resolves external MUL references once; every runtime membership contains unit UUIDs. */
export class MulAvailabilityIndex {
    private readonly eraUnits = new Map<number, Set<UnitUuid>>();
    private readonly factionEraUnits = new Map<number, Map<number, Set<UnitUuid>>>();
    private readonly factionUnits = new Map<number, Set<UnitUuid>>();
    private readonly factionEras = new Map<number, Set<number>>();
    private readonly eraIdsByName = new Map<string, number>();
    private readonly factionIdsByName = new Map<string, number>();

    constructor(units: readonly AvailabilityUnit[], eras: readonly Era[], factions: readonly Faction[]) {
        const unitsByMulId = new Map<number, UnitUuid[]>();
        for (const unit of units) {
            if (unit.mul1id === null || !(unit.mul1id >= 1)) continue;
            const matches = unitsByMulId.get(unit.mul1id) ?? [];
            matches.push(unit.uuid);
            unitsByMulId.set(unit.mul1id, matches);
        }
        const assignedUnits = new Set<UnitUuid>();
        for (const faction of factions) {
            this.factionIdsByName.set(faction.name, faction.id);
            if (faction.id === MULFACTION_NONE) continue;
            const memberships = new Map<number, Set<UnitUuid>>();
            const factionEras = new Set<number>();
            for (const [eraId, referenceIds] of Object.entries(faction.eras)) {
                const members = new Set<UnitUuid>();
                for (const referenceId of referenceIds) {
                    if (referenceId >= 1) factionEras.add(Number(eraId));
                    for (const uuid of unitsByMulId.get(referenceId) ?? []) {
                        members.add(uuid);
                        assignedUnits.add(uuid);
                    }
                }
                memberships.set(Number(eraId), members);
            }
            this.factionEraUnits.set(faction.id, memberships);
            this.factionEras.set(faction.id, factionEras);
        }

        const noneUnits = units.filter(unit => !assignedUnits.has(unit.uuid));
        const noneMemberships = new Map<number, Set<UnitUuid>>();
        if (factions.some(faction => faction.id === MULFACTION_NONE)) {
            this.factionEraUnits.set(MULFACTION_NONE, noneMemberships);
            this.factionEras.set(MULFACTION_NONE, new Set<number>());
        }
        for (const era of eras) {
            this.eraIdsByName.set(era.name, era.id);
            const members = new Set<UnitUuid>();
            for (const referenceId of era.units) {
                for (const uuid of unitsByMulId.get(referenceId) ?? []) {
                    if (assignedUnits.has(uuid) || !this.factionEraUnits.has(MULFACTION_NONE)) members.add(uuid);
                }
            }
            if (this.factionEraUnits.has(MULFACTION_NONE)) {
                const noneMembers = new Set<UnitUuid>();
                for (const unit of noneUnits) {
                    if (isUnitIntroducedByEra(unit, era)) {
                        noneMembers.add(unit.uuid);
                        members.add(unit.uuid);
                    }
                }
                noneMemberships.set(era.id, noneMembers);
                if (noneMembers.size) this.factionEras.get(MULFACTION_NONE)!.add(era.id);
            }
            for (const uuid of this.getFactionEraUnitUuids(MULFACTION_EXTINCT, era.id)) members.delete(uuid);
            this.eraUnits.set(era.id, members);
        }
        // Build each all-era union once for this catalog, never during per-unit filtering.
        for (const [factionId, memberships] of this.factionEraUnits) {
            const members = new Set<UnitUuid>();
            for (const eraMembers of memberships.values()) {
                for (const uuid of eraMembers) members.add(uuid);
            }
            this.factionUnits.set(factionId, members);
        }
    }

    getEraUnitUuids(eraId: number): ReadonlySet<UnitUuid> {
        return this.eraUnits.get(eraId) ?? EMPTY_MEMBERSHIP;
    }

    factionExistsInEra(factionId: number, eraId: number): boolean {
        return this.factionEras.get(factionId)?.has(eraId) ?? false;
    }

    getFactionEraUnitUuids(factionId: number, eraId: number): ReadonlySet<UnitUuid> {
        return this.factionEraUnits.get(factionId)?.get(eraId) ?? EMPTY_MEMBERSHIP;
    }

    getFactionUnitUuids(factionId: number, eraIds?: ReadonlySet<number>): ReadonlySet<UnitUuid> {
        if (!eraIds) return this.factionUnits.get(factionId) ?? EMPTY_MEMBERSHIP;
        if (eraIds.size === 1) return this.getFactionEraUnitUuids(factionId, eraIds.values().next().value!);
        const result = new Set<UnitUuid>();
        for (const eraId of eraIds) {
            for (const uuid of this.getFactionEraUnitUuids(factionId, eraId)) result.add(uuid);
        }
        return result;
    }

    unitBelongsToFaction(uuid: UnitUuid, factionId: number, eraIds?: ReadonlySet<number>): boolean {
        if (!eraIds) return this.getFactionUnitUuids(factionId).has(uuid);
        for (const eraId of eraIds) {
            if (this.getFactionEraUnitUuids(factionId, eraId).has(uuid)) return true;
        }
        return false;
    }

    unitBelongsToNamedFactionEra(uuid: UnitUuid, eraNames: readonly string[], factionNames: readonly string[]): boolean {
        for (const eraName of eraNames) {
            const eraId = this.eraIdsByName.get(eraName);
            if (eraId === undefined) continue;
            for (const factionName of factionNames) {
                const factionId = this.factionIdsByName.get(factionName);
                if (factionId !== undefined && this.getFactionEraUnitUuids(factionId, eraId).has(uuid)) return true;
            }
        }
        return false;
    }

    getNamedFactionEraUnitUuids(eraNames: readonly string[], factionNames: readonly string[]): Set<UnitUuid> {
        const result = new Set<UnitUuid>();
        for (const eraName of eraNames) {
            const eraId = this.eraIdsByName.get(eraName);
            if (eraId === undefined) continue;
            for (const factionName of factionNames) {
                const factionId = this.factionIdsByName.get(factionName);
                if (factionId === undefined) continue;
                for (const uuid of this.getFactionEraUnitUuids(factionId, eraId)) result.add(uuid);
            }
        }
        return result;
    }
}
