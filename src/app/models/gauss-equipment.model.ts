// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { WeaponEquipment, type Equipment } from './equipment.model';

export const GAUSS_FLAG = 'F_GAUSS' as const;

export function isGaussEquipment(
    equipment: Equipment | null | undefined,
): boolean {
    return equipment instanceof WeaponEquipment && equipment.hasFlag(GAUSS_FLAG);
}
