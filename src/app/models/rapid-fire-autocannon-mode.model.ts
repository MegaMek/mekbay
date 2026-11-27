// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { WeaponEquipment } from './equipment.model';

/** Catalog-authored firing modes owned by the UAC/RAC runtime handler. */
export function rapidFireAutocannonComponentModes(
    equipment: unknown,
): Readonly<{ readonly modes: readonly string[]; readonly defaultMode?: string }> | null {
    if (!(equipment instanceof WeaponEquipment)
        || !equipment.hasFlag('F_AC')
        || !['AC_ROTARY', 'AC_ULTRA', 'AC_ULTRA_THB'].includes(equipment.ammoType)) {
        return null;
    }
    const modes = Object.freeze([...equipment.modes]);
    return Object.freeze({
        modes,
        ...(modes[0] === undefined ? {} : { defaultMode: modes[0] }),
    });
}
