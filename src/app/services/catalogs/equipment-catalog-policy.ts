// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { RawEquipmentData } from '../../models/equipment.model';

const PLAYTEST_NAME = 'playtest';

/** Framework-free release/runtime policy shared by Angular and Node tooling. */
export function isPlaytestEquipment(
    internalName: string,
    equipment: RawEquipmentData['equipment'][string],
): boolean {
    return [internalName, equipment?.id, equipment?.name]
        .some(name => typeof name === 'string' && name.toLocaleLowerCase().includes(PLAYTEST_NAME));
}
