// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { GameSystem } from "./common.model";
import type { Era } from './eras.model';
import type { Faction } from './factions.model';
import type { ForceEntryResolver } from './force-entry-resolver.model';
import {
    createForcePreviewEntry,
    createForcePreviewEntryFromSerializedForce,
    type ForcePreviewEntry,
    type ForcePreviewGroup,
    type ForcePreviewUnit,
} from './force-preview.model';
import type { SerializedForce } from './force-serialization';
import type { RemoteLoadForceEntry } from './remote-load-force-entry.model';

export type {
    RemoteLoadForceEntry,
    RemoteLoadForceGroup,
    RemoteLoadForceUnit,
} from './remote-load-force-entry.model';

/*
 * Description: Preview-compatible unit data used by saved force entries.
 */
export type LoadForceUnit = ForcePreviewUnit;

export function createLoadForceEntry(
    raw: RemoteLoadForceEntry,
    resolver: ForceEntryResolver,
    options: { cloud?: boolean; local?: boolean } = {},
): LoadForceEntry {
    return new LoadForceEntry(createForcePreviewEntry(raw, resolver, options));
}

export function createLoadForceEntryFromSerializedForce(
    raw: SerializedForce,
    resolver: ForceEntryResolver,
    options: { cloud?: boolean; local?: boolean } = {},
): LoadForceEntry {
    return new LoadForceEntry(createForcePreviewEntryFromSerializedForce(raw, resolver, options));
}

export interface LoadForceGroup extends Omit<ForcePreviewGroup, 'force'> {
    force?: LoadForceEntry;
}

export class LoadForceEntry implements ForcePreviewEntry {
    persistenceVersion: 1 | 2;
    instanceId: string;
    timestamp: string;
    type: GameSystem;
    owned: boolean;
    cloud: boolean;
    local: boolean;
    missing: boolean;
    name: string;
    note?: string;
    tags?: string[];
    faction: Faction | null;
    era: Era | null;
    bv?: number;
    pv?: number;
    reserveCount?: number;
    groups: LoadForceGroup[];
    _searchText?: string; // for internal searching use only, not persisted

    constructor(data: Partial<LoadForceEntry>) {
        this.persistenceVersion = data.persistenceVersion ?? 2;
        this.instanceId = data.instanceId ?? '';
        this.timestamp = data.timestamp ?? '';
        this.type = data.type ?? GameSystem.CBT;
        this.owned = data.owned ?? true;
        this.cloud = data.cloud ?? false;
        this.local = data.local ?? false;
        this.missing = data.missing ?? false;
        this.name = data.name ?? '';
        this.note = data.note || undefined;
        this.tags = data.tags?.length ? [...data.tags] : undefined;
        this.faction = data.faction ?? null;
        this.era = data.era ?? null;
        this.bv = data.bv ?? undefined;
        this.pv = data.pv ?? undefined;
        this.reserveCount = data.reserveCount ?? 0;
        this.groups = data.groups ?? [];
        for (const group of this.groups) {
            group.force = this;
        }
    }
}
