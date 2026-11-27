// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake



export const MULFACTION_EXTINCT = 3;
export const MULFACTION_NONE = -1;
export const MULFACTION_MERCENARY = 34;

export type FactionAffinity = 'Inner Sphere' | 'IS Clan' | 'HW Clan' | 'Periphery' | 'Mercenary' | 'Other'; 
export type FactionEraMembership = Set<number>;
export type RawFactionEraMembership = number[] | Set<number>;

export interface MULFaction {
    id: number; // MUL id (unique)
    name: string; // Faction name
    group: FactionAffinity; // Inner Sphere, Clan, etc.
    img: string; // Logo URL for the faction
    eras: Record<number, FactionEraMembership>; // Indexed by era ID, value is a list of unit IDs
}

export interface RawMULFaction {
    id: number; // MUL id (unique)
    name: string; // Faction name
    group: FactionAffinity; // Inner Sphere, Clan, etc.
    img: string; // Logo URL for the faction
    eras: Record<number, RawFactionEraMembership>; // Indexed by era ID, value is a list of unit IDs
}

export interface MULFactions {
    version: string;
    assetHash: string;
    factions: MULFaction[];
}

export interface RawMULFactions {
    version: string;
    assetHash: string;
    factions: RawMULFaction[];
}
