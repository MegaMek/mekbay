// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EquipmentFlag } from './equipment-flags.type';
import type { Equipment } from './equipment.model';
import { weaponTraitFlag } from './weapon-traits-kernel';

const HEAT_SINK_FLAG = 'F_HEAT_SINK' as const;
const DOUBLE_HEAT_SINK_FLAG = 'F_DOUBLE_HEAT_SINK' as const;
const PROTOTYPE_DOUBLE_HEAT_SINK_FLAG = 'F_IS_DOUBLE_HEAT_SINK_PROTOTYPE' as const;
const COMPACT_HEAT_SINK_FLAG = 'F_COMPACT_HEAT_SINK' as const;
const LASER_HEAT_SINK_FLAG = 'F_LASER_HEAT_SINK' as const;

export const UNSUPPORTED_MEK_HEAT_FLAGS: readonly EquipmentFlag[] = Object.freeze([
    weaponTraitFlag('vibroclaw'),
]);

export function unsupportedMekHeatFlag(equipment: Equipment): EquipmentFlag | undefined {
    return UNSUPPORTED_MEK_HEAT_FLAGS.find(flag => equipment.hasFlag(flag));
}

export function isHeatSinkEquipment(equipment: Equipment | null | undefined): boolean {
    return equipment?.hasAnyFlag([
        HEAT_SINK_FLAG,
        DOUBLE_HEAT_SINK_FLAG,
        PROTOTYPE_DOUBLE_HEAT_SINK_FLAG,
    ]) === true;
}

export function isSingleHeatSinkEquipment(equipment: Equipment | null | undefined): boolean {
    return equipment?.hasFlag(HEAT_SINK_FLAG) === true;
}

export function isDoubleHeatSinkEquipment(equipment: Equipment | null | undefined): boolean {
    return equipment?.hasFlag(DOUBLE_HEAT_SINK_FLAG) === true;
}

export function isPrototypeDoubleHeatSinkEquipment(equipment: Equipment | null | undefined): boolean {
    return equipment?.hasFlag(PROTOTYPE_DOUBLE_HEAT_SINK_FLAG) === true;
}

export function isCompactHeatSinkEquipment(equipment: Equipment | null | undefined): boolean {
    return equipment?.hasFlag(COMPACT_HEAT_SINK_FLAG) === true;
}

export function isLaserHeatSinkEquipment(equipment: Equipment | null | undefined): boolean {
    return equipment?.hasFlag(LASER_HEAT_SINK_FLAG) === true;
}

export function heatSinkUnitsPerMount(equipment: Equipment | null | undefined): number {
    if (!isHeatSinkEquipment(equipment)) return 0;
    return isCompactHeatSinkEquipment(equipment) && isDoubleHeatSinkEquipment(equipment) ? 2 : 1;
}

export function heatSinkDissipationRate(equipment: Equipment | null | undefined): 1 | 2 | null {
    if (equipment?.type !== 'misc' || !isHeatSinkEquipment(equipment)) return null;
    if (isCompactHeatSinkEquipment(equipment) || isSingleHeatSinkEquipment(equipment)) return 1;
    if (isDoubleHeatSinkEquipment(equipment) || isPrototypeDoubleHeatSinkEquipment(equipment)) return 2;
    return null;
}

export function isUnsupportedMekHeatEquipment(equipment: Equipment | null | undefined): boolean {
    return equipment != null && unsupportedMekHeatFlag(equipment) !== undefined;
}
