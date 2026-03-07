/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
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

/*
 * Author: Drake
 *
 * Models for saved Organizations: force org-chart layouts
 * with groups, positions, and zoom state.
 */

/** A placed force card on the organization canvas. */
export interface OrgPlacedForce {
    /** Force instance ID */
    instanceId: string;
    x: number;
    y: number;
    zIndex: number;
    /** Group this force belongs to (null if ungrouped) */
    groupId: string | null;
}

/** An organizational group containing forces or other groups. */
export interface OrgGroupData {
    id: string;
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    zIndex: number;
    parentGroupId: string | null;
    anchorX: number;
    anchorY: number;
}

/** Serialized organization stored locally and on the server. */
export interface SerializedOrganization {
    /** Unique organization ID */
    organizationId: string;
    /** User-given name */
    name: string;
    /** Timestamp when the organization was last saved */
    timestamp: number;
    /** Dominant faction ID across all placed forces */
    factionId?: number;
    /** Placed forces with positions and group membership */
    forces: OrgPlacedForce[];
    /** Organizational groups */
    groups: OrgGroupData[];
}

/**
 * Enriched organization entry used for display in the load dialog.
 */
export class LoadOrganizationEntry {
    organizationId: string;
    name: string;
    timestamp: number;
    factionId?: number;
    forceCount: number;
    groupCount: number;
    cloud: boolean;
    local: boolean;
    owned: boolean;

    constructor(data: Partial<LoadOrganizationEntry>) {
        this.organizationId = data.organizationId ?? '';
        this.name = data.name ?? '';
        this.timestamp = data.timestamp ?? 0;
        this.factionId = data.factionId;
        this.forceCount = data.forceCount ?? 0;
        this.groupCount = data.groupCount ?? 0;
        this.cloud = data.cloud ?? false;
        this.local = data.local ?? false;
        this.owned = data.owned ?? true;
    }
}
