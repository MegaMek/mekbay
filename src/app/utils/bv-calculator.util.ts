// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { UnitSummary } from "../models/unit-summary.model";
import { adjustMekBattleValueForSkills } from '../models/entity/utils/battle-value/rules';
import { getEffectivePilotingSkill } from "./cbt-common.util";


export class BVCalculatorUtil {
    /**
     * Calculate adjusted Battle Value based on pilot skills
     * @param unit - Unit object containing base Battle Value
     * @param gunnerySkill - Gunnery skill level (0-8+)
     * @param pilotingSkill - Piloting skill level (0-8+)
     * @returns Adjusted Battle Value rounded to nearest integer
     */
    static calculateAdjustedBV(unit: UnitSummary, baseBv: number, gunnerySkill: number, pilotingSkill: number): number {
        pilotingSkill = getEffectivePilotingSkill(unit, pilotingSkill);
        return adjustMekBattleValueForSkills(baseBv, gunnerySkill, pilotingSkill);
    }
}
