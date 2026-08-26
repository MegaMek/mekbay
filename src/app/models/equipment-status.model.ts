// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

export type EquipmentStatus = 'available' | 'disabled' | 'destroyed';

export function combineEquipmentStatuses(statuses: readonly EquipmentStatus[]): EquipmentStatus {
    if (statuses.includes('destroyed')) return 'destroyed';
    if (statuses.includes('disabled')) return 'disabled';
    return 'available';
}
