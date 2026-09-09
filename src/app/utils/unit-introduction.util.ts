// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import type { Era } from '../models/eras.model';
import type { UnitSummary } from '../models/unit-summary.model';

/** Unlisted designs remain available from their introduction, without a synthetic MUL ID. */
export function isUnitIntroducedByEra(unit: Pick<UnitSummary, 'year'>, era: Era): boolean {
    return Number.isFinite(unit.year) && unit.year <= (era.years.to ?? Number.POSITIVE_INFINITY);
}
