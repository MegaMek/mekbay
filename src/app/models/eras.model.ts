// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake


export type EraMembership = number[] | Set<number>;

export interface Era {
    id: number; // MUL id (unique)
    name: string; // Faction name
    years: {
        from?: number; // Start year of the era
        to?: number; // End year of the era
    };
    description?: string; // Description of the era
    img?: string; // Logo URL for the era
    icon?: string; // Icon URL for the era (same as logo but aligned)
    factions: EraMembership; // List of faction ids associated with this era
    units: EraMembership; // List of unit ids associated with this era
}

export interface Eras {
    version: string;
    etag: string;
    eras: Era[];
}