// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake



import { MULFaction } from "./mulfactions.model";

export type FactionId = number;
export type Faction = MULFaction;

export function getFactionAffinity(faction: Faction): string {
    return faction.group;
}

export function getFactionImg(faction: Faction): string | undefined {
    return faction.img ?? undefined;
}

export function getFactionName(faction: Faction): string {
    return faction.name;
}