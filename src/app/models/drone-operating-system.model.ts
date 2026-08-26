// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Equipment } from './equipment.model';

export const DRONE_OPERATING_SYSTEM_FLAG = 'F_DRONE_OPERATING_SYSTEM' as const;
export const DRONE_WEAPON_BV_MULTIPLIER = 0.8;
export const DRONE_FIRE_CONTROL_BV_MULTIPLIER = 0.95;

export function isDroneOperatingSystemEquipment(equipment: Equipment | undefined): boolean {
    return equipment?.hasFlag(DRONE_OPERATING_SYSTEM_FLAG) === true;
}
