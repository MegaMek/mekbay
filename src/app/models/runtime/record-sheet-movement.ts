// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { MotiveModes } from '../motiveModes.model';

/** Runtime facts shared by the Mek and non-Mek sheet controls. */
export interface RecordSheetMovementSelection {
    readonly selectedMode: MotiveModes | null;
    readonly airborne: boolean;
    readonly options: readonly Readonly<{
        mode: MotiveModes;
        modifier: number;
        legal: boolean;
        minimumMp: number;
    }>[];
}
