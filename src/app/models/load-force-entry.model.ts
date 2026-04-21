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
import type {
    RemoteLoadForceEntry,
    RemoteLoadForceGroup,
    RemoteLoadForceUnit,
} from './remote-load-force-entry.model';

export type {
    RemoteLoadForceEntry,
    RemoteLoadForceGroup,
    RemoteLoadForceUnit,
} from './remote-load-force-entry.model';

/*
 * Author: Drake
 * Description: Preview-compatible unit data used by saved force entries.
 */
export type LoadForceUnit = ForcePreviewUnit;

function cloneLoadForceGroups(groups: readonly ForcePreviewGroup[]): LoadForceGroup[] {
    return groups.map((group) => ({
        name: group.name,
        formationId: group.formationId,
        units: group.units.map((unit) => ({ ...unit })),
    }));
}

export function createLoadForceEntry(
    raw: RemoteLoadForceEntry,
    resolver: ForceEntryResolver,
    options: { cloud?: boolean; local?: boolean } = {},
): LoadForceEntry {
    const previewEntry = createForcePreviewEntry(raw, resolver, options);
    return new LoadForceEntry({
        ...previewEntry,
        groups: cloneLoadForceGroups(previewEntry.groups),
    });
}

export function createLoadForceEntryFromSerializedForce(
    raw: SerializedForce,
    resolver: ForceEntryResolver,
    options: { cloud?: boolean; local?: boolean } = {},
): LoadForceEntry {
    const previewEntry = createForcePreviewEntryFromSerializedForce(raw, resolver, options);
    return new LoadForceEntry({
        ...previewEntry,
        groups: cloneLoadForceGroups(previewEntry.groups),
    });
}

export interface LoadForceGroup extends Omit<ForcePreviewGroup, 'force'> {
    force?: LoadForceEntry;
}

export class LoadForceEntry implements ForcePreviewEntry {
    instanceId: string;
    timestamp: string;
    type: GameSystem;
    owned: boolean;
    cloud: boolean;
    local: boolean;
    missing: boolean;
    name: string;
    note?: string;
    faction: Faction | null;
    era: Era | null;
    bv?: number;
    pv?: number;
    groups: LoadForceGroup[];
    _searchText?: string; // for internal searching use only, not persisted

    constructor(data: Partial<LoadForceEntry>) {
        this.instanceId = data.instanceId ?? '';
        this.timestamp = data.timestamp ?? '';
        this.type = data.type ?? GameSystem.CLASSIC;
        this.owned = data.owned ?? true;
        this.cloud = data.cloud ?? false;
        this.local = data.local ?? false;
        this.missing = data.missing ?? false;
        this.name = data.name ?? '';
        this.note = data.note || undefined;
        this.faction = data.faction ?? null;
        this.era = data.era ?? null;
        this.bv = data.bv ?? undefined;
        this.pv = data.pv ?? undefined;
        this.groups = data.groups ?? [];
        for (const group of this.groups) {
            group.force = this;
        }
    }
}