// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

/** Detached heat-source row used by runtime projections and their UI. */
export interface UnitHeatSource {
    readonly id: string;
    readonly label: string;
    readonly value: number;
    readonly inventorySelection?: boolean;
    readonly signature?: string;
    readonly replacedByFiringEntryId?: string;
}
