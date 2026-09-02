// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type {
    ForceViewerBVPVDisplay,
    ForceViewerBVPVDisplayDamage,
} from '../models/options.model';
import type { ForceMember } from '../models/force-member.model';
import { forceMemberAdjustedValue, forceMemberBaseValue } from '../models/force-member.model';
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

export function formatForceMembersBvPv(
    members: readonly ForceMember[],
    mode: ForceViewerBVPVDisplay,
    damageMode: ForceViewerBVPVDisplayDamage,
): string {
    return formatBvPv(
        members.reduce((total, member) =>
            total + forceMemberAdjustedValue(member, damageMode), 0),
        members.reduce((total, member) =>
            total + forceMemberBaseValue(member, damageMode), 0),
        mode,
    );
}
