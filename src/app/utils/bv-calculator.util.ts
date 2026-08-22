// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { UnitSummary } from "../models/unit-summary.model";
import { getEffectivePilotingSkill } from "./cbt-common.util";


export class BVCalculatorUtil {

    // BattleTech BV 2.0 Skill Multiplier Table (Official Values)
    private static readonly BV2_SKILL_MATRIX = [
    //     0     1     2     3     4     5     6     7     8
        [2.42, 2.31, 2.21, 2.10, 1.93, 1.75, 1.68, 1.59, 1.50], // Gunnery 0
        [2.21, 2.11, 2.02, 1.92, 1.76, 1.60, 1.54, 1.46, 1.38], // Gunnery 1
        [1.93, 1.85, 1.76, 1.68, 1.54, 1.40, 1.35, 1.28, 1.21], // Gunnery 2
        [1.66, 1.58, 1.51, 1.44, 1.32, 1.20, 1.16, 1.10, 1.04], // Gunnery 3
        [1.38, 1.32, 1.26, 1.20, 1.10, 1.00, 0.95, 0.90, 0.85], // Gunnery 4
        [1.31, 1.19, 1.13, 1.08, 0.99, 0.90, 0.86, 0.81, 0.77], // Gunnery 5
        [1.24, 1.12, 1.07, 1.02, 0.94, 0.85, 0.81, 0.77, 0.72], // Gunnery 6
        [1.17, 1.06, 1.01, 0.96, 0.88, 0.80, 0.76, 0.72, 0.68], // Gunnery 7
        [1.10, 0.99, 0.95, 0.90, 0.83, 0.75, 0.71, 0.68, 0.64], // Gunnery 8+
    ];

    /**
     * Get BV 2.0 skill multiplier for given gunnery and piloting skills
     * @param gunnerySkill - Gunnery skill level (0-8+)
     * @param pilotingSkill - Piloting skill level (0-8+)
     * @returns Skill multiplier for BV calculation
     */
    static getSkillMultiplier(gunnerySkill: number, pilotingSkill: number): number {
        // Clamp skills to valid range (0-8)
        const clampedGunnery = Math.max(0, Math.min(8, gunnerySkill));
        const clampedPiloting = Math.max(0, Math.min(8, pilotingSkill));
        
        return this.BV2_SKILL_MATRIX[clampedGunnery][clampedPiloting] || 1.0;
    }

    /**
     * Calculate adjusted Battle Value based on pilot skills
     * @param unit - Unit object containing base Battle Value
     * @param gunnerySkill - Gunnery skill level (0-8+)
     * @param pilotingSkill - Piloting skill level (0-8+)
     * @returns Adjusted Battle Value rounded to nearest integer
     */
    static calculateAdjustedBV(unit: UnitSummary, baseBv: number, gunnerySkill: number, pilotingSkill: number): number {
        pilotingSkill = getEffectivePilotingSkill(unit, pilotingSkill);
        const multiplier = this.getSkillMultiplier(gunnerySkill, pilotingSkill);
        if (multiplier === 1.0) {
            return baseBv;
        }
        return Math.round(baseBv * multiplier);
    }
}