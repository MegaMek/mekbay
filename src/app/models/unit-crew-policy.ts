// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { UnitType, UnitSubtype } from './entity/types';

export type UnitCrewKind = 'none' | 'integrated' | 'swappable';

/** Assignment policy is a unit fact; an empty personnel roster does not erase its stations. */
export function unitCrewKind(type: UnitType, subtype: UnitSubtype, stationCount?: number): UnitCrewKind {
    if (stationCount === 0 || type === 'Handheld Weapon' || type === 'Building') return 'none';
    if (type === 'Infantry' && subtype !== 'Battle Armor') return 'integrated';
    return 'swappable';
}

export interface UnitCrewPolicy {
    readonly kind: UnitCrewKind;
    readonly positions: readonly { readonly positionId: string; readonly label: string }[];
    readonly canEdit: boolean;
    readonly reason?: string;
}
