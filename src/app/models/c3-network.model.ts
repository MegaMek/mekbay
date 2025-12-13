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

import { UnitComponent } from './units.model';

/**
 * C3 Network Types based on equipment flags
 */
export enum C3NetworkType {
    /** Standard C3 Network (Master/Slave) */
    C3 = 'c3',
    /** C3i Network */
    C3I = 'c3i',
    /** Naval C3 */
    NAVAL = 'naval',
    /** Nova CEWS */
    NOVA = 'nova'
}

/**
 * C3 Equipment Role
 */
export enum C3Role {
    /** C3 Master - can have slaves connected */
    MASTER = 'master',
    /** C3 Slave - connects to a master */
    SLAVE = 'slave',
    /** C3i/Nova/Naval - any unit can be master or slave */
    PEER = 'peer'
}

/**
 * Equipment flags for C3 detection
 */
export const C3_FLAGS = {
    /** Any C3 equipment */
    ANY_C3: 'F_C3S', // We'll check for any C3 flag
    /** C3 Slave */
    C3S: 'F_C3S',
    /** C3 Boosted Slave */
    C3SBS: 'F_C3SBS',
    /** C3 Emergency Master */
    C3EM: 'F_C3EM',
    /** C3 Master */
    C3M: 'F_C3M',
    /** C3 Boosted Master */
    C3MBS: 'F_C3MBS',
    /** C3i */
    C3I: 'F_C3I',
    /** Nova CEWS */
    NOVA: 'F_NOVA',
    /** Naval C3 */
    NAVAL_C3: 'F_NAVAL_C3'
} as const;

/**
 * All C3 related flags for detection
 */
export const ALL_C3_FLAGS = [
    C3_FLAGS.C3S,
    C3_FLAGS.C3SBS,
    C3_FLAGS.C3EM,
    C3_FLAGS.C3M,
    C3_FLAGS.C3MBS,
    C3_FLAGS.C3I,
    C3_FLAGS.NOVA,
    C3_FLAGS.NAVAL_C3
] as const;

/**
 * Master flags (can have slaves connected)
 */
export const C3_MASTER_FLAGS = [
    C3_FLAGS.C3M,
    C3_FLAGS.C3MBS
] as const;

/**
 * Slave flags (connects to a master)
 */
export const C3_SLAVE_FLAGS = [
    C3_FLAGS.C3S,
    C3_FLAGS.C3SBS
] as const;

/**
 * Peer flags (any unit can be master)
 */
export const C3_PEER_FLAGS = [
    C3_FLAGS.C3I,
    C3_FLAGS.NOVA,
    C3_FLAGS.NAVAL_C3
] as const;

/**
 * Boosted C3 flags (higher tax rate)
 */
export const C3_BOOSTED_FLAGS = [
    C3_FLAGS.C3SBS,
    C3_FLAGS.C3MBS
] as const;

/**
 * Network compatibility groups - units can only link within the same group
 */
export const C3_COMPATIBLE_NETWORKS: { type: C3NetworkType; flags: string[] }[] = [
    {
        type: C3NetworkType.C3,
        flags: [C3_FLAGS.C3S, C3_FLAGS.C3SBS, C3_FLAGS.C3EM, C3_FLAGS.C3M, C3_FLAGS.C3MBS]
    },
    {
        type: C3NetworkType.C3I,
        flags: [C3_FLAGS.C3I]
    },
    {
        type: C3NetworkType.NAVAL,
        flags: [C3_FLAGS.NAVAL_C3]
    },
    {
        type: C3NetworkType.NOVA,
        flags: [C3_FLAGS.NOVA]
    }
];

/**
 * Maximum units per network type
 * For standard C3: 4 per master (1 master + 3 slaves/sub-masters)
 * Total company-level C3 network: max 12 units
 */
export const C3_NETWORK_LIMITS: Record<C3NetworkType, number> = {
    [C3NetworkType.C3]: 3, // Master can have up to 3 slaves OR 3 sub-masters (not both)
    [C3NetworkType.C3I]: 6,
    [C3NetworkType.NAVAL]: 6,
    [C3NetworkType.NOVA]: 3
};

/**
 * Maximum total units in a hierarchical C3 network (company-level)
 * and maximum network depth (master -> sub-master -> slaves)
 */
export const C3_MAX_NETWORK_TOTAL = 12;
export const C3_MAX_NETWORK_DEPTH = 2;

/**
 * Tax rates for BV calculation
 */
export const C3_TAX_RATE = 0.05;
export const C3_BOOSTED_TAX_RATE = 0.07;
export const NOVA_MAX_TAX_RATE = 0.35;

/**
 * Represents a C3 component on a unit
 */
export interface C3Component {
    /** Component reference */
    component: UnitComponent;
    /** Network type */
    networkType: C3NetworkType;
    /** Role (master/slave/peer) */
    role: C3Role;
    /** Is this a boosted C3 */
    boosted: boolean;
    /** Component index (for units with multiple C3 masters) */
    index: number;
}

/**
 * Visual position for the network editor
 */
export interface C3NodePosition {
    x: number;
    y: number;
}

/**
 * Network colors for visualization (32 distinct colors with good white text contrast)
 */
export const C3_NETWORK_COLORS = [
    // Primary spectrum
    '#1565C0', // Blue
    '#2E7D32', // Green
    '#7B1FA2', // Purple
    '#E65100', // Orange
    '#00838F', // Teal
    '#5D4037', // Brown
    // Secondary spectrum
    '#283593', // Indigo
    '#558B2F', // Lime
    '#00695C', // Dark Cyan
    '#6A1B9A', // Violet
    '#EF6C00', // Amber
    '#0277BD', // Light Blue
    '#4E342E', // Dark Brown
    // Extended palette
    '#1B5E20', // Forest Green
    '#4527A0', // Deep Indigo
    '#006064', // Dark Teal
    '#33691E', // Olive
    '#311B92', // Deep Purple
    '#00796B', // Sea Green
    '#5E35B1', // Medium Purple
    '#F57C00', // Light Orange
    '#0288D1', // Sky Blue
    '#8E24AA', // Orchid
    '#3E2723', // Espresso
    '#827717', // Dark Lime
    '#01579B', // Navy Blue
] as const;