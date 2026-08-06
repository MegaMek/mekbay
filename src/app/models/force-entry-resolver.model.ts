// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { Era } from './eras.model';
import type { Faction } from './factions.model';
import type { Unit } from './units.model';

export interface ForceEntryResolver {
    getUnitByName(name: string): Unit | undefined;
    getFactionById(id: number): Faction | undefined;
    getEraById(id: number): Era | undefined;
}