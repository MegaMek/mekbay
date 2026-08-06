// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { FactionId } from "./factions.model";

/*
 *
 * Models for saved Organizations: force org-chart layouts
 * with groups, positions, and zoom state.
 */

/** A placed force card on the organization canvas. */
export interface OrgPlacedForce {
    /** Stable placement ID for this card on the canvas */
    placementId?: string;
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
    factionId?: FactionId;
    /** Placed forces with positions and group membership */
    forces: OrgPlacedForce[];
    /** Organizational groups */
    groups: OrgGroupData[];
}

/**
 * Organization returned when loading an org for display.
 * `owned` is transient client metadata and must not be sent back on save.
 */
export interface LoadedOrganization extends SerializedOrganization {
    owned?: boolean;
}

/**
 * Enriched organization entry used for display in the load dialog.
 */
export class LoadOrganizationEntry {
    organizationId: string;
    name: string;
    timestamp: number;
    factionId?: FactionId;
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
