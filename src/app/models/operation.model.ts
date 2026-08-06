// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { ForceAlignment } from './force-slot.model';
import type { GameSystem } from './common.model';
import { FactionId } from './factions.model';

/*
 * Description: Models for saved Operations: a snapshot of multiple forces
 *              loaded together with their alignments.
 */

/**
 * A single force reference within an operation.
 * Stores only the essential IDs needed to reconstruct the composition.
 */
export interface OperationForceRef {
    /** Force instance ID */
    instanceId: string;
    /** Alignment when the operation was saved */
    alignment: ForceAlignment;
    /** Force timestamp at time of operation save (for freshness comparison) */
    timestamp: string;
}

/**
 * Serialized operation stored locally and on the server.
 */
export interface SerializedOperation {
    /** Unique operation ID */
    operationId: string;
    /** User-given name for the operation */
    name: string;
    /** Optional note / description */
    note?: string;
    /** Timestamp when the operation was saved */
    timestamp: number;
    /** Force references that make up this operation */
    forces: OperationForceRef[];
}

/**
 * Enriched force info returned by the server (includes joined data).
 * Optional fields may be absent if the force no longer exists.
 */
export interface OperationForceInfo {
    instanceId: string;
    alignment: ForceAlignment;
    /** Timestamp from the operation save */
    timestamp: string;
    /** Force name: from server join, may be missing if force was deleted */
    name?: string;
    /** Game system type: from server join */
    type?: GameSystem;
    /** Faction ID: from server join */
    factionId?: FactionId;
    eraId?: number;
    /** BV: from server join */
    bv?: number;
    /** PV: from server join */
    pv?: number;
    /** Timestamp of the force on the server (may be newer than operation save) */
    forceTimestamp?: string;
    /** Whether the force still exists on the server */
    exists?: boolean;
}

/**
 * Enriched operation entry used for display in the load dialog.
 * Combines the base operation data with resolved force metadata.
 */
export class LoadOperationEntry {
    operationId: string;
    name: string;
    note?: string;
    timestamp: number;
    forces: OperationForceInfo[];
    cloud: boolean;
    local: boolean;
    owned: boolean;
    /** Timestamp from local storage (0 if not found locally) */
    localTimestamp: number;
    /** Timestamp from cloud (0 if cloud wasn't reached or entry not found) */
    cloudTimestamp: number;

    constructor(data: Partial<LoadOperationEntry>) {
        this.operationId = data.operationId ?? '';
        this.name = data.name ?? '';
        this.note = data.note ?? '';
        this.timestamp = data.timestamp ?? 0;
        this.forces = data.forces ?? [];
        this.cloud = data.cloud ?? false;
        this.local = data.local ?? false;
        this.owned = data.owned ?? true;
        this.localTimestamp = data.localTimestamp ?? 0;
        this.cloudTimestamp = data.cloudTimestamp ?? 0;
    }

    /** Force infos grouped by alignment */
    get friendlyForces(): OperationForceInfo[] {
        return this.forces.filter(f => f.alignment === 'friendly');
    }

    get enemyForces(): OperationForceInfo[] {
        return this.forces.filter(f => f.alignment === 'enemy');
    }

    /** Unique game system types across all forces */
    get gameTypes(): GameSystem[] {
        const types = new Set<GameSystem>();
        for (const f of this.forces) {
            if (f.type) types.add(f.type);
        }
        return Array.from(types);
    }

    /** Sum of BV for a given alignment */
    bvForAlignment(alignment: ForceAlignment): number {
        return this.forces
            .filter(f => f.alignment === alignment)
            .reduce((sum, f) => sum + (f.bv ?? 0), 0);
    }

    /** Sum of PV for a given alignment */
    pvForAlignment(alignment: ForceAlignment): number {
        return this.forces
            .filter(f => f.alignment === alignment)
            .reduce((sum, f) => sum + (f.pv ?? 0), 0);
    }
}
