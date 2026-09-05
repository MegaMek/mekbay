// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { UnitSummary } from '../models/unit-summary.model';
import type { MinMaxStatsRange } from '../services/data.service';
import { parseASDamageValue } from './as-damage.util';

export type UnitStatValues = Record<keyof MinMaxStatsRange, number | null>;

// Exported sentinels denote an unsupported measurement, rather than zero capability.
export function trackedUnitStat(value: number | null | undefined, signed = false): number | null {
    return value == null || !Number.isFinite(value) || value === 999 || (!signed && value < 0)
        ? null : value;
}

export function getUnitStatBucketKey(unit: UnitSummary): string {
    return `${unit.as?.TP ?? 'XX'}:${unit.weightClass === 'Colossal/Super-Heavy' ? 'superheavy' : 'standard'}`;
}

export function getUnitStatValues(unit: UnitSummary): UnitStatValues {
    const stat = trackedUnitStat;
    const sum = (left: number | null | undefined, right: number | null | undefined) =>
        stat(left) === null || stat(right) === null ? null : left! + right!;
    const run = stat(unit.run2);
    const jump = stat(unit.jump);
    // Aerospace uses named range bands. Their numeric derived range of zero is not a measurement.
    const numericRange = !unit.comp?.some(component => component.r && /[a-z]/i.test(component.r));
    return {
        mobility: run === null || jump === null ? null : Math.max(run, jump),
        endurance: sum(unit.armor, unit.internal),
        asEndurance: sum(unit.as?.Arm, unit.as?.Str),
        armor: stat(unit.armor),
        internal: stat(unit.internal),
        heat: stat(unit.heat),
        dissipation: stat(unit.dissipation),
        dissipationEfficiency: stat(unit.heat) === null || stat(unit.dissipation) === null
            ? null : stat(unit._dissipationEfficiency, true),
        runMP: stat(unit.run),
        run2MP: run,
        jumpMP: jump,
        umuMP: stat(unit.umu),
        alphaNoPhysical: stat(unit._mdSumNoPhysical),
        alphaNoPhysicalNoOneshots: stat(unit._mdSumNoPhysicalNoOneshots),
        maxRange: numericRange ? stat(unit._maxRange) : null,
        weightedMaxRange: numericRange ? stat(unit._weightedMaxRange) : null,
        dpt: stat(unit.dpt),
        asTmm: stat(unit.as?.TMM),
        asArm: stat(unit.as?.Arm),
        asStr: stat(unit.as?.Str),
        asDmgS: stat(parseASDamageValue(unit.as?.dmg?.dmgS)),
        asDmgM: stat(parseASDamageValue(unit.as?.dmg?.dmgM)),
        asDmgL: stat(parseASDamageValue(unit.as?.dmg?.dmgL)),
        dropshipCapacity: stat(unit.capital?.dropshipCapacity),
        escapePods: stat(unit.capital?.escapePods),
        lifeBoats: stat(unit.capital?.lifeBoats),
        gravDecks: unit.capital ? unit.capital.gravDecks?.length ?? 0 : null,
        sailIntegrity: stat(unit.capital?.sailIntegrity),
        kfIntegrity: stat(unit.capital?.kfIntegrity),
    };
}
