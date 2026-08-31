// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

export const EQUIPMENT_STATUSES = Object.freeze([
    'available',
    'disabled',
    'destroyed',
] as const);

export type EquipmentStatus = typeof EQUIPMENT_STATUSES[number];
export type UnavailableEquipmentStatus = Exclude<EquipmentStatus, 'available'>;

const EQUIPMENT_STATUS_SET: ReadonlySet<string> = new Set(EQUIPMENT_STATUSES);

export function isEquipmentStatus(value: unknown): value is EquipmentStatus {
    return typeof value === 'string' && EQUIPMENT_STATUS_SET.has(value);
}

export function isUnavailableEquipmentStatus(value: unknown): value is UnavailableEquipmentStatus {
    return value === 'disabled' || value === 'destroyed';
}

export function combineEquipmentStatuses(statuses: readonly EquipmentStatus[]): EquipmentStatus {
    if (statuses.includes('destroyed')) return 'destroyed';
    if (statuses.includes('disabled')) return 'disabled';
    return 'available';
}
