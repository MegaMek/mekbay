// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type {
    ForceViewerBVPVDisplay,
    ForceViewerBVPVDisplayDamage,
} from '../models/options.model';
import type { ForceMember } from '../models/force-member.model';
import { forceMemberAdjustedValue, forceMemberAdjustedPreSkillValue } from '../models/force-member.model';
import { FormatBvPipe } from '../pipes/format-bv.pipe';

export function formatBvPv(
    adjustedPostSkill: number,
    adjustedPreSkill: number,
    mode: ForceViewerBVPVDisplay,
): string {
    const format = (value: number) => FormatBvPipe.formatValue(value, true);

    if (mode === 'adjustedPreSkill') return format(adjustedPreSkill);
    if (mode === 'both' && adjustedPostSkill !== adjustedPreSkill) {
        return `${format(adjustedPostSkill)} (${format(adjustedPreSkill)})`;
    }
    return format(adjustedPostSkill);
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
            total + forceMemberAdjustedPreSkillValue(member, damageMode), 0),
        mode,
    );
}
