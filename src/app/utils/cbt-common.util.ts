// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { DEFAULT_PILOTING_SKILL } from "../models/crew.model";
import type { UnitSummary } from "../models/unit-summary.model";

const NO_ANTIMEK_SKILL = 8;

/**
 * Returns the fixed Piloting value for units whose Piloting cannot be changed.
 * Returns `null` when the unit uses the requested Piloting value.
 */
export function getFixedPilotingSkill(unit: UnitSummary): number | null {
    if (unit.type === 'ProtoMek') {
        return DEFAULT_PILOTING_SKILL;
    }
    if (unit.type !== 'Infantry' || unit.canAntiMech) {
        return null;
    }
    if (unit.subtype.includes('Mechanized')) {
        return DEFAULT_PILOTING_SKILL;
    }
    if (unit.subtype.includes('Conventional Infantry')) {
        return NO_ANTIMEK_SKILL;
    }
    return DEFAULT_PILOTING_SKILL;
}

/**
 * Returns the effective piloting skill for a unit, enforcing CBT skill rating rules:
 *
 * - **ProtoMek**: No Piloting Skill — always uses column 5 of the BV Skill Multiplier Table.
 * - **Mechanized Infantry**: Cannot perform anti-Mech attacks — Piloting fixed at 5
 *   (use column 5 of the BV Skill Multiplier Table).
 * - **Conventional Infantry without Anti-Mech Kit**: Default Anti-Mech Skill Rating
 *   of 8, which cannot be improved.
 * - All other units: the provided piloting skill is returned unchanged.
 *
 * @param unit - The unit to evaluate
 * @param pilotingSkill - The raw/requested piloting skill
 * @returns The effective piloting skill after applying CBT rules
 */
export function getEffectivePilotingSkill(unit: UnitSummary, pilotingSkill: number): number {
    return getFixedPilotingSkill(unit) ?? pilotingSkill;
}
