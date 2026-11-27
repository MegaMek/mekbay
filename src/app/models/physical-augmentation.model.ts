// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Equipment } from './equipment.model';

export const SPIKES_FLAG = 'F_SPIKES' as const;
export const RAM_PLATE_FLAG = 'F_RAM_PLATE' as const;

export function isSpikesEquipment(equipment: Equipment | undefined): boolean {
    return equipment?.hasFlag(SPIKES_FLAG) === true;
}

export function isRamPlateEquipment(equipment: Equipment | undefined): boolean {
    return equipment?.hasFlag(RAM_PLATE_FLAG) === true;
}

export function hasSpikesFlags(flags: ReadonlySet<string>): boolean {
    return flags.has(SPIKES_FLAG);
}

export function hasRamPlateFlags(flags: ReadonlySet<string>): boolean {
    return flags.has(RAM_PLATE_FLAG);
}
