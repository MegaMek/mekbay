// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { Equipment } from './equipment.model';
import type { EquipmentFlag } from './equipment-flags.type';

export type EquipmentStatus = 'available' | 'disabled' | 'destroyed';

export interface UnitSystemStatusFacts {
    readonly engineHit: boolean;
}

export interface EquipmentStatusFacts {
    readonly equipment: Equipment | null;
    readonly equipmentId: string;
    readonly equipmentFlags: ReadonlySet<EquipmentFlag>;
    readonly mountState: EquipmentStatus;
    readonly criticals: readonly MountedCriticalFact[];
    readonly locationStates: ReadonlyMap<string, EquipmentStatus>;
    readonly unitSystemFacts: UnitSystemStatusFacts;
}

export interface MountedCriticalFact {
    readonly id: string;
    readonly location: string | null;
    readonly slot: number | null;
    readonly status: EquipmentStatus;
    readonly committedHits: number;
    readonly armored: boolean;
}

export interface CriticalSlotStatusFacts {
    readonly equipment: Equipment | null;
    readonly equipmentId: string;
    readonly slotState: EquipmentStatus;
    readonly locationState: EquipmentStatus;
    readonly unitSystemFacts: UnitSystemStatusFacts;
}

export function combineEquipmentStatuses(statuses: readonly EquipmentStatus[]): EquipmentStatus {
    if (statuses.includes('destroyed')) return 'destroyed';
    if (statuses.includes('disabled')) return 'disabled';
    return 'available';
}
