// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable } from '@angular/core';

import { ERA_DEFINITIONS } from '../data/era-definitions';
import type { Era } from '../models/eras.model';
import type { MULFaction } from '../models/mulfactions.model';

export interface PreparedEraIndex {
    readonly eras: Era[];
    readonly eraNameMap: ReadonlyMap<string, Era>;
    readonly eraIdMap: ReadonlyMap<number, Era>;
}

@Injectable({ providedIn: 'root' })
export class EraIndexService {
    private eras: Era[];
    private eraNameMap: ReadonlyMap<string, Era>;
    private eraIdMap: ReadonlyMap<number, Era>;

    public constructor() {
        const initial = this.prepareFromFactions([]);
        this.eras = initial.eras;
        this.eraNameMap = initial.eraNameMap;
        this.eraIdMap = initial.eraIdMap;
    }

    public getEras(): Era[] {
        return this.eras;
    }

    public getEraByName(name: string): Era | undefined {
        return this.eraNameMap.get(name);
    }

    public getEraById(id: number): Era | undefined {
        return this.eraIdMap.get(id);
    }

    /** Builds reverse era memberships from the authoritative faction catalog. */
    public prepareFromFactions(factions: readonly MULFaction[]): PreparedEraIndex {
        const eras = ERA_DEFINITIONS.map<Era>((definition) => ({
            ...definition,
            years: { ...definition.years },
            factions: new Set<number>(),
            units: new Set<number>(),
        }));
        const eraIdMap = new Map(eras.map(era => [era.id, era]));

        for (const faction of factions) {
            for (const [rawEraId, unitIds] of Object.entries(faction.eras)) {
                const eraId = Number(rawEraId);
                const era = eraIdMap.get(eraId);
                if (!era) {
                    throw new Error(`Faction ${faction.id} references unknown era ${rawEraId}`);
                }

                let hasUnits = false;
                for (const unitId of unitIds) {
                    if (!Number.isSafeInteger(unitId)) {
                        throw new Error(
                            `Faction ${faction.id} has an invalid unit ID in era ${eraId}`,
                        );
                    }
                    (era.units as Set<number>).add(unitId);
                    hasUnits = true;
                }
                if (hasUnits) {
                    (era.factions as Set<number>).add(faction.id);
                }
            }
        }

        return Object.freeze({
            eras,
            eraNameMap: new Map(eras.map(era => [era.name, era])),
            eraIdMap,
        });
    }

    public commitPreparedIndex(candidate: PreparedEraIndex): void {
        this.eras = candidate.eras;
        this.eraNameMap = candidate.eraNameMap;
        this.eraIdMap = candidate.eraIdMap;
    }
}
