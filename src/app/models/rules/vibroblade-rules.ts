// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { Equipment } from '../equipment.model';
import {
    getVibrobladeProfileFromFlags,
    type VibrobladeProfile,
} from '../entity/utils/physical-weapon-kernel';

export type { VibrobladeProfile } from '../entity/utils/physical-weapon-kernel';

export { getVibrobladeProfileFromFlags } from '../entity/utils/physical-weapon-kernel';

export function getVibrobladeProfile(equipment: Equipment | null | undefined): VibrobladeProfile | null {
    return equipment ? getVibrobladeProfileFromFlags(equipment.flags) : null;
}

export function getVibrobladeHeat(equipment: Equipment | null | undefined): number {
    return getVibrobladeProfile(equipment)?.activeHeat ?? 0;
}
