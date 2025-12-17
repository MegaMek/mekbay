/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

/*
 * Author: Drake
 */
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
     * @param baseBV - Base Battle Value of the unit
     * @param gunnerySkill - Gunnery skill level (0-8+)
     * @param pilotingSkill - Piloting skill level (0-8+)
     * @returns Adjusted Battle Value rounded to nearest integer
     */
    static calculateAdjustedBV(baseBV: number, gunnerySkill: number, pilotingSkill: number): number {
        const multiplier = this.getSkillMultiplier(gunnerySkill, pilotingSkill);
        if (multiplier === 1.0) {
            return baseBV;
        }
        return Math.round(baseBV * multiplier);
    }

    /**
     * Get skill level description based on combined skill levels
     * @param gunnerySkill - Gunnery skill level (0-8+)
     * @param pilotingSkill - Piloting skill level (0-8+)
     * @returns Skill category description
     */
    static getSkillDescription(gunnerySkill: number, pilotingSkill: number): string {
        const totalSkill = gunnerySkill + pilotingSkill;
        if (totalSkill <= 3) return "Elite";
        if (totalSkill <= 5) return "Veteran";
        if (totalSkill <= 7) return "Regular";
        if (totalSkill <= 9) return "Green";
        return "Ultra-Green";
    }

    /**
     * Get all possible skill combinations with their multipliers
     * @returns Array of skill combinations with multipliers and descriptions
     */
    static getAllSkillCombinations(): Array<{
        gunnery: number;
        piloting: number;
        multiplier: number;
        description: string;
    }> {
        const combinations = [];
        for (let gunnery = 0; gunnery <= 8; gunnery++) {
            for (let piloting = 0; piloting <= 8; piloting++) {
                combinations.push({
                    gunnery,
                    piloting,
                    multiplier: this.getSkillMultiplier(gunnery, piloting),
                    description: this.getSkillDescription(gunnery, piloting)
                });
            }
        }
        return combinations;
    }

    /**
     * Get skill combinations for a specific skill category
     * @param category - Skill category ("Elite", "Veteran", "Regular", "Green", "Ultra-Green")
     * @returns Array of skill combinations matching the category
     */
    static getSkillCombinationsByCategory(category: string): Array<{
        gunnery: number;
        piloting: number;
        multiplier: number;
    }> {
        return this.getAllSkillCombinations().filter(combo => 
            combo.description === category
        );
    }
}