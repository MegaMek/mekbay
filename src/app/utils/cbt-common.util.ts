// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { UnitSummary } from "../models/unit-summary.model";
import {
    effectiveClassicPilotingSkill,
    fixedClassicPilotingSkill,
    type ClassicSkillUnitFacts,
} from '../models/entity/utils/battle-value/rules';

/**
 * Returns the fixed Piloting value for units whose Piloting cannot be changed.
 * Returns `null` when the unit uses the requested Piloting value.
 */
export function getFixedPilotingSkill(
    unit: Pick<UnitSummary, 'type' | 'subtype' | 'canAntiMech'>,
): number | null {
    return fixedClassicPilotingSkill(summarySkillFacts(unit));
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
export function getEffectivePilotingSkill(
    unit: Pick<UnitSummary, 'type' | 'subtype' | 'canAntiMech'>,
    pilotingSkill: number,
): number {
    return effectiveClassicPilotingSkill(summarySkillFacts(unit), pilotingSkill);
}

function summarySkillFacts(
    unit: Pick<UnitSummary, 'type' | 'subtype' | 'canAntiMech'>,
): ClassicSkillUnitFacts {
    return Object.freeze({
        unitType: unit.type,
        unitSubtype: unit.subtype,
        canAntiMech: unit.canAntiMech === true,
    });
}
