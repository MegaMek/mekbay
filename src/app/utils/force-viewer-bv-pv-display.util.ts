// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { ForceViewerBVPVDisplay } from '../models/options.model';
import { FormatBvPipe } from '../pipes/format-bv.pipe';

export function formatBvPv(
    adjusted: number,
    base: number,
    mode: ForceViewerBVPVDisplay,
): string {
    const format = (value: number) => FormatBvPipe.formatValue(value, true);

    if (mode === 'base') return format(base);
    if (mode === 'both' && adjusted !== base) return `${format(adjusted)} (${format(base)})`;
    return format(adjusted);
}
