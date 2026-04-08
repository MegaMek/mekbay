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
import type { Unit } from "./units.model";

export type {
    RemoteLoadForceEntry,
    RemoteLoadForceGroup,
    RemoteLoadForceUnit,
} from './remote-load-force-entry.model';

/*
 * Author: Drake
 * Description: Lightweight interface used to show summary of saved forces in load dialog 
 */
export interface LoadForceUnit {
    unit: Unit | undefined;
    alias?: string;
    destroyed: boolean;
    skill?: number;
    gunnery?: number;
    piloting?: number;
    commander?: boolean;
}

export function getLoadForceUnitPilotStats(loadForceUnit: LoadForceUnit, gameSystem: GameSystem): string {
    if (gameSystem === GameSystem.ALPHA_STRIKE) {
        return `${loadForceUnit.skill ?? loadForceUnit.gunnery ?? 4}`;
    }

    const gunnery = loadForceUnit.gunnery ?? loadForceUnit.skill ?? 4;
    if (loadForceUnit.unit?.type === 'ProtoMek') {
        return `${gunnery}`;
    }

    const piloting = loadForceUnit.piloting ?? 5;
    return `${gunnery}/${piloting}`;
}

export interface LoadForceGroup {
    name?: string;
    formationId?: string;
    force?: LoadForceEntry;
    units: LoadForceUnit[];
}

export class LoadForceEntry {
    instanceId: string;
    timestamp: string;
    type: GameSystem;
    owned: boolean;
    cloud: boolean;
    local: boolean;
    missing: boolean;
    name: string;
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