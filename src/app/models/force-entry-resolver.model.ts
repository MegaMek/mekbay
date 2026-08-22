// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { Era } from './eras.model';
import type { Faction } from './factions.model';
import type { UnitSummary } from './unit-summary.model';

export interface ForceEntryResolver {
    getUnitByName(name: string): UnitSummary | undefined;
    getFactionById(id: number): Faction | undefined;
    getEraById(id: number): Era | undefined;
}