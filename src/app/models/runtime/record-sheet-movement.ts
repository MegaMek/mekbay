// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { MekConversionMode } from '../mek-conversion-mode';
import type { MotiveModes } from '../motiveModes.model';

/** Runtime facts shared by the Mek and non-Mek sheet controls. */
export interface RecordSheetMovementSelection {
    readonly selectedMode: MotiveModes | null;
    readonly airborne: boolean;
    /** A LAM's or QuadVee's current mode and the modes it converts between; absent for every other unit. */
    readonly conversion?: Readonly<{ mode: MekConversionMode; modes: readonly MekConversionMode[] }>;
    readonly options: readonly Readonly<{
        mode: MotiveModes;
        modifier: number;
        legal: boolean;
        minimumMp: number;
        /** Set when the option belongs to one air/ground state only: an AirMech offers both at once. */
        airborne?: boolean;
    }>[];
}
