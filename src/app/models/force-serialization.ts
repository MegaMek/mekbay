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

import { Equipment } from './equipment.model';
import { Sanitizer } from '../utils/sanitizer.util';
import { ForceUnit } from './force-unit.model';
import { GameSystem } from './common.model';
import { CBTForceUnit } from './cbt-force-unit.model';
import { ASCustomPilotAbility } from './as-abilities.model';
import { C3NetworkType } from './c3-network.model';

export interface LocationData {
    armor?: number;
    internal?: number;
}

export interface HeatProfile {
    current: number;
    next?: number;
    previous: number;
    heatsinksOff?: number;
}

export interface SerializedForce {
    version: number;
    timestamp: string;
    instanceId: string;
    type: GameSystem;
    name: string;
    nameLock?: boolean;
    bv?: number;
    pv?: number;
    owned?: boolean;
    groups?: SerializedGroup[];
    c3Networks?: SerializedC3NetworkGroup[];
}

export interface CBTSerializedForce extends SerializedForce {
    groups?: CBTSerializedGroup[];
}

export interface ASSerializedForce extends SerializedForce {
    groups?: ASSerializedGroup[];
}

export interface SerializedGroup {
    id: string;
    name: string;
    nameLock?: boolean;
    color?: string;
    units: SerializedUnit[];
}

export interface CBTSerializedGroup extends SerializedGroup {
    units: CBTSerializedUnit[];
}

export interface ASSerializedGroup extends SerializedGroup {
    units: ASSerializedUnit[];
}
export interface SerializedUnit {
    id: string;
    unit: string; // Unit name
    model?: string;
    chassis?: string;
    alias?: string;
    state: SerializedState;
}
export interface ASSerializedUnit extends SerializedUnit {
    state: ASSerializedState;
    skill: number;
    abilities: (string | ASCustomPilotAbility)[]; // Array of ability IDs or custom abilities
}

export interface CBTSerializedUnit extends SerializedUnit {
    state: CBTSerializedState;
}
export interface SerializedState {
    modified: boolean;
    destroyed: boolean;
    shutdown: boolean;
    /** Position in the C3 network visual editor */
    c3Position?: { x: number; y: number };
}

/** 
 * A C3 network group - either peer-based or master/slave hierarchy.
 * 
 * Rules:
 * - Peers (C3i, Naval, Nova): Units connect equally, limit is C3_NETWORK_LIMITS[type]
 * - C3 Master/Slave: Master component has up to 3 children (all slaves OR all masters, not mixed)
 * - Max depth is 2: Master -> SubMaster -> children (those children can't have more)
 * - A master with no children connected to another master is stored as a slave (not a sub-network)
 */
export interface SerializedC3NetworkGroup {
    /** Unique network ID */
    id: string;
    /** Network type */
    type: C3NetworkType;
    /** Assigned color for visualization */
    color: string;
    
    // ===== For peer networks (C3i, Naval, Nova) =====
    /** All peer unit IDs in this network */
    peerIds?: string[];
    
    // ===== For C3 master/slave networks =====
    /** The master unit ID */
    masterId?: string;
    /** Which C3 master component on the unit (for multi-master units) */
    masterCompIndex?: number;
    /** 
     * Child unit IDs directly under this master's component.
     * Can be slaves or masters (acting as slaves if they have no children).
     * For masters, includes "unitId:compIndex" format to identify which component.
     */
    members?: string[];
}

export interface ASSerializedState extends SerializedState {
    /** Heat as [committed, pendingDelta]. pendingDelta of 0 means no pending change. */
    heat: [number, number];
    /** Armor as [committed, pendingDelta]. Positive = damage, negative = heal. */
    armor: [number, number];
    /** Internal as [committed, pendingDelta]. Positive = damage, negative = heal. */
    internal: [number, number];
    /** 
     * Array of committed critical hits with timestamps for ordering.
     */
    crits: ASCriticalHit[];
    /**
     * Array of pending critical hit changes.
     * Positive timestamp = pending damage, negative timestamp = pending heal.
     */
    pCrits: ASCriticalHit[];
    /**
     * Consumed ability counts. Key is ability originalText, value is [committed, pendingDelta].
     * Example: { "BOMB4": [2, 1] } means 2 bombs used, 1 more pending.
     */
    consumed?: Record<string, [number, number]>;
    /**
     * Exhausted abilities. Array of ability originalText values.
     * [committed[], pendingExhaust[], pendingRestore[]]
     */
    exhausted?: [string[], string[], string[]];
}

/**
 * Represents a single critical hit with timestamp for ordering effects.
 */
export interface ASCriticalHit {
    /** The critical type key ('engine', 'weapons', 'motive', ...) */
    key: string;
    /** Timestamp when this hit was applied (for ordering effects). Negative = pending heal. */
    timestamp: number;
}

export interface CBTSerializedState extends SerializedState {
    crew: any[]; // Serialized CrewMember objects
    crits: CriticalSlot[];
    locations: Record<string, LocationData>;
    heat: HeatProfile;
    inventory?: SerializedInventory[];
}
export interface SerializedInventory {
    id: string;
    destroyed?: boolean;
    states?: { name: string; value: string }[];
    consumed?: number;
    ammo?: string;
    totalAmmo?: number;
}

export interface CriticalSlot {
    id: string; // Identifier for the critical slot on the sheet. Format is internalName@loc#slot
    name?: string; // Name, if loc/slot are null, this is the name of the critical point (example: engine)
    loc?: string; // Location of the critical slot (HD, LT, RT, ...)
    slot?: number; // Slot number of the critical slot
    hits?: number; // How many hits did this location receive. If is an armored location, this is the number of hits it has taken
    totalAmmo?: number; // If is an ammo slot: how much total ammo is in this slot.
    consumed?: number; // If is an ammo slot: how much ammo have been consumed. If is a F_MODULAR_ARMOR, is the armor points used
    destroying?: number; // If this location is in the process of being destroyed. Contains the timestamp of when the destruction started
    destroyed?: number; // If this location is destroyed (can be from 0 hits if the structure is completely destroyed). Contains the timestamp of the destruction
    originalName?: string; // saved original name in case we override the current name
    armored?: boolean; // If this critical slot is armored (for locations that can be armored)
    el?: SVGElement;
    eq?: Equipment;
}

export const HEAT_SCHEMA = Sanitizer.schema<HeatProfile>()
    .number('current', { default: 0, min: 0 })
    .number('previous', { default: 0, min: 0 })
    .number('next')
    .number('heatsinksOff', { min: 0 })
    .build();

export const LOCATION_SCHEMA = Sanitizer.schema<LocationData>()
    .number('armor')
    .number('internal')
    .build();

export const CRIT_SLOT_SCHEMA = Sanitizer.schema<CriticalSlot>()
    .string('id')
    .string('name')
    .string('loc')
    .number('slot')
    .number('hits')
    .number('totalAmmo')
    .number('consumed')
    .number('destroying')
    .custom('destroyed', (value: unknown) => {
        if (typeof value === 'boolean') return value ? Date.now() : undefined; // We may have old boolean values, we convert them to timestamp
        if (typeof value === 'number') return value;
        return undefined;
    })
    .string('originalName')
    .boolean('armored')
    .build();

export const INVENTORY_SCHEMA = Sanitizer.schema<SerializedInventory>()
    .string('id')
    .number('totalAmmo')
    .number('consumed')
    .string('ammo')
    .custom('states', (value: unknown) => {
        if (!value) return undefined;
        if (Array.isArray(value)) {
            return value
                .filter(item => 
                    typeof item === 'object' && 
                    item !== null && 
                    'name' in item && 
                    'value' in item
                )
                .map(item => ({
                    name: String(item.name),
                    value: String(item.value)
                }));
        }
        return undefined;
    })
    .boolean('destroyed')
    .build();

export const C3_POSITION_SCHEMA = Sanitizer.schema<{ x: number; y: number }>()
    .number('x', { default: 0 })
    .number('y', { default: 0 })
    .build();

export const C3_NETWORK_GROUP_SCHEMA = Sanitizer.schema<SerializedC3NetworkGroup>()
    .string('id')
    .string('type')
    .string('color')
    .custom('peerIds', (value: unknown) => {
        if (!value) return undefined;
        if (Array.isArray(value)) {
            return value.filter(id => typeof id === 'string').map(String);
        }
        return undefined;
    })
    .string('masterId')
    .number('masterCompIndex')
    .custom('members', (value: unknown) => {
        if (!value) return undefined;
        if (Array.isArray(value)) {
            return value.filter(id => typeof id === 'string').map(String);
        }
        return undefined;
    })
    .build();

    
export interface MountedEquipment {
    owner: CBTForceUnit;
    id: string;
    name: string;
    locations?: Set<string>;
    equipment?: Equipment;
    baseHitMod?: string;
    hitModVariation?: null | number; // Temporary variable to calculate delta hit modifier
    physical?: boolean;
    linkedWith?: null | MountedEquipment[];
    parent?: null | MountedEquipment;
    destroyed?: boolean;
    critSlots?: CriticalSlot[];
    states: Map<string, string>;
    el?: SVGElement;
    // Used for entries that doesn't have critical slots
    ammo?: string;
    totalAmmo?: number;
    consumed?: number;
}

export interface ViewportTransform {
    scale: number;
    translateX: number;
    translateY: number;
}
