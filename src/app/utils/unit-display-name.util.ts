// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { DisplayUnitNameFormat } from '../models/options.model';

/** Name facts shared by catalog summaries and live entities. */
export interface UnitNameSource {
    readonly chassis: string | (() => string);
    readonly baseChassis?: string;
    readonly clanName?: string | (() => string);
    readonly model?: string | (() => string);
}

export function formatChassisName(
    chassis: string,
    clanName: string | undefined,
    format: DisplayUnitNameFormat = 'innerSphereClan',
): string {
    const innerSphere = chassis.trim();
    const clan = clanName?.trim() ?? '';
    if (!innerSphere) return clan;
    if (!clan) return innerSphere;
    return format === 'clanInnerSphere' ? `${clan} (${innerSphere})` : `${innerSphere} (${clan})`;
}

/** Format from the separate names; never reinterpret parentheses in a chassis. */
export function formatUnitChassis(
    unit: UnitNameSource | null | undefined,
    format: DisplayUnitNameFormat = 'innerSphereClan',
): string {
    if (!unit) return '';
    const chassis = typeof unit.chassis === 'function' ? unit.chassis() : unit.baseChassis ?? unit.chassis;
    const clan = typeof unit.clanName === 'function' ? unit.clanName() : unit.clanName;
    return formatChassisName(chassis, clan, format);
}

export function formatUnitName(
    unit: UnitNameSource | null | undefined,
    format: DisplayUnitNameFormat = 'innerSphereClan',
): string {
    if (!unit) return '';
    const model = typeof unit.model === 'function' ? unit.model() : unit.model;
    return [formatUnitChassis(unit, format), model].filter(Boolean).join(' ').trim();
}
