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

import { ForceUnit } from '../models/force-unit.model';
import { Unit, ASUnitTypeCode } from '../models/units.model';
import { FormationTypeDefinition } from './formation-type.model';

/*
 * Author: Drake
 *
 * Alpha Strike formation type identifier.
 */

// ── Shared helper functions ──────────────────────────────────────────────────

/** Aerospace movement mode keys (excluded from ground move calculation) */
const AEROSPACE_MODES = new Set(['a', 'p', 'k']);

function countMatchedPairs(units: ForceUnit[]): number {
    const counts = units.reduce((acc, curr) => {
        const name = curr.getUnit().name;
        acc[name] = (acc[name] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);
    return Object.values(counts).filter(count => count >= 2).length;
}

function countMatchedPairsFiltered(units: ForceUnit[], filter: (u: ForceUnit) => boolean): number {
    const filtered = units.filter(filter);
    return countMatchedPairs(filtered);
}

function findIdenticalPairs(units: ForceUnit[]): ForceUnit[][] {
    const pairs: ForceUnit[][] = [];
    const seen = new Set<string>();
    for (const unit of units) {
        const name = unit.getUnit().name;
        if (seen.has(name)) {
            pairs.push([unit, units.find(u => u.getUnit().name === name)!]);
        }
        seen.add(name);
    }
    return pairs;
}

function isOnlyCombatVehicles(units: ForceUnit[]): boolean {
    return units.every(u => {
        const tp = u.getUnit().as?.TP;
        return tp === 'CV' || tp === 'SV';
    });
}

// ── Main class ───────────────────────────────────────────────────────────────

export class ASLanceTypeIdentifierUtil {

    private static readonly definitions: FormationTypeDefinition[] = [

        // ─── Air Lance ───────────────────────────────────────────────────
        // TODO: Implement when we will support group of groups.
        // {
        //     id: 'air-lance',
        //     name: 'Air',
        //     description: 'Lance of ground units plus two aerospace/conventional fighters',
        //     effectDescription: 'No additional bonus ability is granted by this formation; the fighters do not benefit from the bonus abilities gained by the ground units\' lance formation, and are not counted towards any of the Air Lance\'s requirements.',
        //     techBase: 'Special',
        //     minUnits: 4,
        //     validator: (units: ForceUnit[]) => {
        //         const fighters = units.filter(u => {
        //             const tp = u.getUnit().as?.TP;
        //             return tp === 'AF' || tp === 'CF';
        //         });
        //         const groundUnits = units.filter(u => {
        //             const tp = u.getUnit().as?.TP;
        //             return tp !== 'AF' && tp !== 'CF' && !ASLanceTypeIdentifierUtil.isInfantry(u.getUnit());
        //         });

        //         if (fighters.length !== 2 || groundUnits.length < 1) return false;
        //         return fighters[0].getUnit().name === fighters[1].getUnit().name;
        //     }
        // },

        // ─── Anti-'Mech Lance ────────────────────────────────────────────
        //
        // ANTI-'MECH LANCE
        // Requirements: All units must be infantry.
        // Bonus Ability: None specified.
        //
        {
            id: 'anti-mech-lance',
            name: 'Anti-\'Mech',
            description: 'All infantry units for urban and anti-mech warfare',
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                return units.every(u => ASLanceTypeIdentifierUtil.isInfantry(u.getUnit()));
            }
        },

        // ─── Assault Lance ───────────────────────────────────────────────
        //
        // ASSAULT LANCE
        // Requirements: At least 3 units must be Size 3+. No Size 1 units allowed.
        //   All units must have minimum (undamaged) Armor of 5.
        //   75% must have Medium-range attack value of 3+.
        //   Must contain at least 1 Juggernaut or 2 Snipers.
        // Ideal Role: Juggernaut
        // Bonus Ability: Choose Demoralizer or Multi-Tasker SPA at start of play.
        //   Each turn, up to half the units (rounded down) receive the chosen ability.
        //   Destroyed/withdrawn units do not count. The chosen ability cannot be
        //   changed mid-scenario, but can switch users from turn to turn.
        //
        {
            id: 'assault-lance',
            name: 'Assault',
            description: 'Heavy firepower and armor powerhouse formation',
            effectDescription: 'At the beginning of play, choose either Demoralizer or Multi-Tasker SPA. Each turn, designate up to half the units (rounded down) to receive the chosen ability for that turn. Destroyed or withdrawn units do not count.',
            effectGroups: [{
                abilityIds: ['demoralizer', 'multi_tasker'],
                selection: 'choose-one',
                distribution: 'half-round-down',
                perTurn: true,
            }],
            idealRole: 'Juggernaut',
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                const largeUnits = units.filter(u => ASLanceTypeIdentifierUtil.getSize(u.getUnit()) >= 3);
                const hasSmall = units.some(u => ASLanceTypeIdentifierUtil.getSize(u.getUnit()) === 1);

                if (largeUnits.length < 3 || hasSmall) return false;

                // All units must have a minimum (undamaged) Armor of 5
                const hasEnoughArmor = units.every(u => (u.getUnit().as?.Arm ?? 0) >= 5);
                // 75% must have medium-range attack value of 3+
                const highMedDmg = units.filter(u => (u.getUnit().as?.dmg?._dmgM ?? 0) >= 3);
                const has75PercentHighDmg = highMedDmg.length >= Math.ceil(units.length * 0.75);

                // At least 1 Juggernaut OR 2 Snipers
                const hasJuggernaut = units.some(u => u.getUnit().role === 'Juggernaut');
                const sniperCount = units.filter(u => u.getUnit().role === 'Sniper').length;

                return hasEnoughArmor && has75PercentHighDmg && (hasJuggernaut || sniperCount >= 2);
            }
        },

        //
        // FAST ASSAULT LANCE (variant of Assault Lance)
        // Requirements: Same as Assault Lance, plus all units must have minimum
        //   ground Move of 10" or possess the ability to jump (any distance).
        // Bonus Ability: In addition to the Assault Lance bonus, up to 2 units
        //   may also receive the Stand Aside SPA per turn. These may stack with
        //   the Demoralizer or Multi-Tasker abilities.
        //
        {
            id: 'fast-assault-lance',
            parent: 'assault-lance',
            name: 'Fast Assault',
            description: 'Mobile assault formation with speed advantage',
            effectDescription: 'In addition to the Assault Lance bonus, up to 2 units per Fast Assault Lance may receive the Stand Aside SPA per turn. These may stack with the Demoralizer or Multi-Tasker abilities.',
            effectGroups: [{
                abilityIds: ['stand_aside'],
                selection: 'all',
                distribution: 'fixed',
                count: 2,
                perTurn: true,
            }],
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                // All units must have minimum ground Move 10" or possess ability to jump
                return units.every(u => {
                    const groundMove = ASLanceTypeIdentifierUtil.getMaxGroundMove(u.getUnit());
                    const jumpMove = ASLanceTypeIdentifierUtil.getJumpMove(u.getUnit());
                    return groundMove >= 10 || jumpMove > 0;
                });
            }
        },

        // ─── Battle Lance ────────────────────────────────────────────────
        //
        // BATTLE LANCE
        // Requirements: 50% must be Size 3+. At least 3 units must be any
        //   combination of the Brawler, Sniper, and/or Skirmisher unit roles.
        // Ideal Role: Brawler
        // Bonus Ability: Formation receives Lucky SPA at level = (units at setup + 2).
        //   Usable by any unit. May stack with individual Lucky SPA (max 4 rerolls
        //   per unit per scenario).
        // Variations: Light Battle Lance, Medium Battle Lance, Heavy Battle Lance.
        //
        {
            id: 'battle-lance',
            name: 'Battle',
            description: 'Line troops with balanced firepower and armor',
            effectDescription: 'The formation receives a Lucky SPA as a level equal to the number of units in the formation at setup plus 2. Useable by any unit in the formation. May stack with individual Lucky SPA (max 4 rerolls per unit per scenario).',
            effectGroups: [{
                abilityIds: ['lucky'],
                selection: 'all',
                distribution: 'shared-pool',
            }],
            idealRole: 'Brawler',
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                const largeUnits = units.filter(u => ASLanceTypeIdentifierUtil.getSize(u.getUnit()) >= 3);

                if (isOnlyCombatVehicles(units)) {
                    const matchedPairs = countMatchedPairsFiltered(units,
                        u => ASLanceTypeIdentifierUtil.getSize(u.getUnit()) >= 3);
                    if (matchedPairs < 2) return false;
                }

                const hasRequiredRoles = units.filter(u =>
                    ['Brawler', 'Sniper', 'Skirmisher'].includes(u.getUnit().role));

                return largeUnits.length >= Math.ceil(units.length * 0.5) && hasRequiredRoles.length >= 3;
            }
        },

        //
        // LIGHT BATTLE LANCE (variant of Battle Lance)
        // Requirements: 75% must be Size 1. No units of Size 4+.
        //   If vehicle formation, at least 2 matched pairs of Size 1 units.
        //   At least 1 unit must be of the Scout role.
        // Bonus Ability: As per the standard Battle Lance.
        //
        {
            id: 'light-battle-lance',
            name: 'Light Battle',
            description: 'Fast light formation for reconnaissance and skirmishing',
            effectDescription: 'As per the standard Battle Lance.',
            effectGroups: [{
                abilityIds: ['lucky'],
                selection: 'all',
                distribution: 'shared-pool',
            }],
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                const smallUnits = units.filter(u => ASLanceTypeIdentifierUtil.getSize(u.getUnit()) === 1);
                const hasLargeSize4 = units.some(u => ASLanceTypeIdentifierUtil.getSize(u.getUnit()) >= 4);

                if (isOnlyCombatVehicles(units)) {
                    const matchedPairs = countMatchedPairsFiltered(units,
                        u => ASLanceTypeIdentifierUtil.getSize(u.getUnit()) === 1);
                    if (matchedPairs < 2) return false;
                }

                const hasScout = units.some(u => u.getUnit().role === 'Scout');
                return smallUnits.length >= Math.ceil(units.length * 0.75) && !hasLargeSize4 && hasScout;
            }
        },

        //
        // MEDIUM BATTLE LANCE (variant of Battle Lance)
        // Requirements: 50% must be Size 2. No units of Size 4+.
        //   If vehicle formation, at least 2 matched pairs of Size 2 units.
        // Bonus Ability: As per the standard Battle Lance.
        //
        {
            id: 'medium-battle-lance',
            name: 'Medium Battle',
            description: 'Medium weight balanced formation',
            effectDescription: 'As per the standard Battle Lance.',
            effectGroups: [{
                abilityIds: ['lucky'],
                selection: 'all',
                distribution: 'shared-pool',
            }],
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                const mediumUnits = units.filter(u => ASLanceTypeIdentifierUtil.getSize(u.getUnit()) === 2);
                const hasLargeSize4 = units.some(u => ASLanceTypeIdentifierUtil.getSize(u.getUnit()) >= 4);

                if (isOnlyCombatVehicles(units)) {
                    const matchedPairs = countMatchedPairsFiltered(units,
                        u => ASLanceTypeIdentifierUtil.getSize(u.getUnit()) === 2);
                    if (matchedPairs < 2) return false;
                }

                return mediumUnits.length >= Math.ceil(units.length * 0.5) && !hasLargeSize4;
            }
        },

        //
        // HEAVY BATTLE LANCE (variant of Battle Lance)
        // Requirements: 50% must be Size 3+. No Size 1 units.
        //   If vehicle formation, at least 2 matched pairs of Size 3+ units.
        // Bonus Ability: As per the standard Battle Lance.
        //
        {
            id: 'heavy-battle-lance',
            name: 'Heavy Battle',
            description: 'Heavy weight powerhouse formation',
            effectDescription: 'As per the standard Battle Lance.',
            effectGroups: [{
                abilityIds: ['lucky'],
                selection: 'all',
                distribution: 'shared-pool',
            }],
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                const largeUnits = units.filter(u => ASLanceTypeIdentifierUtil.getSize(u.getUnit()) >= 3);
                const hasSmall = units.some(u => ASLanceTypeIdentifierUtil.getSize(u.getUnit()) === 1);

                if (isOnlyCombatVehicles(units)) {
                    const matchedPairs = countMatchedPairsFiltered(units,
                        u => ASLanceTypeIdentifierUtil.getSize(u.getUnit()) >= 3);
                    if (matchedPairs < 2) return false;
                }

                return largeUnits.length >= Math.ceil(units.length * 0.5) && !hasSmall;
            }
        },

        // ─── Striker / Cavalry Lance ─────────────────────────────────────
        //
        // STRIKER/CAVALRY LANCE
        // Requirements: All units must have minimum ground Move of 10" or
        //   jumping Move of 8"j. No units may be Size 4+.
        //   50% must be of the Striker or Skirmisher roles.
        // Ideal Role: Striker
        // Bonus Ability: 75% of the units (round normally) receive the
        //   Speed Demon SPA.
        // Variations: Light Striker/Cavalry Lance, Heavy Striker/Cavalry Lance.
        //
        {
            id: 'striker-lance',
            name: 'Striker/Cavalry',
            description: 'Fast mobile firepower',
            effectDescription: '75% of the units (round normally) receive the Speed Demon SPA.',
            effectGroups: [{
                abilityIds: ['speed_demon'],
                selection: 'all',
                distribution: 'percent-75',
            }],
            idealRole: 'Striker',
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                // All units must have minimum ground Move 10" or jumping Move 8"j
                const allFast = units.every(u => {
                    const groundMove = ASLanceTypeIdentifierUtil.getMaxGroundMove(u.getUnit());
                    const jumpMove = ASLanceTypeIdentifierUtil.getJumpMove(u.getUnit());
                    return groundMove >= 10 || jumpMove >= 8;
                });
                // No SZ 4+
                const noSize4 = units.every(u => ASLanceTypeIdentifierUtil.getSize(u.getUnit()) < 4);
                // 50% Striker or Skirmisher
                const hasRequiredRoles = units.filter(u =>
                    u.getUnit().role === 'Striker' || u.getUnit().role === 'Skirmisher');

                return allFast && noSize4 && hasRequiredRoles.length >= Math.ceil(units.length * 0.5);
            }
        },

        //
        // LIGHT STRIKER/CAVALRY LANCE (variant of Striker/Cavalry)
        // Requirements: All units must have minimum Move of 10" (with or without
        //   jump). No units may be Size 3+. At least 2 units must have Long-range
        //   attack value > 0. At least 2 must be Striker or Skirmisher roles.
        // Bonus Ability: As per the standard Striker/Cavalry Lance.
        //
        {
            id: 'light-striker-lance',
            name: 'Light Striker/Cavalry',
            description: 'Fast light mobile force',
            effectDescription: 'As per the standard Striker/Cavalry Lance.',
            effectGroups: [{
                abilityIds: ['speed_demon'],
                selection: 'all',
                distribution: 'percent-75',
            }],
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                // All Move 10"+ (with or without jump)
                const allFast = units.every(u => ASLanceTypeIdentifierUtil.getAnyGroundOrJumpMove(u.getUnit()) >= 10);
                // No SZ 3+
                const noSize3 = units.every(u => ASLanceTypeIdentifierUtil.getSize(u.getUnit()) < 3);
                // 2+ with Long-range attack value > 0
                const hasLongRange = units.filter(u => (u.getUnit().as?.dmg?._dmgL ?? 0) > 0);
                // 2+ Striker or Skirmisher
                const hasRequiredRoles = units.filter(u =>
                    u.getUnit().role === 'Striker' || u.getUnit().role === 'Skirmisher');

                return allFast && noSize3 && hasLongRange.length >= 2 && hasRequiredRoles.length >= 2;
            }
        },

        //
        // HEAVY STRIKER/CAVALRY LANCE (variant of Striker/Cavalry)
        // Requirements: All units must have minimum Move of 8" (with or without
        //   jump). At least 3 units must be Size 3+. No units smaller than Size 2.
        //   At least 1 unit must have Long-range attack value > 1.
        //   At least 2 must be Striker or Skirmisher roles.
        // Bonus Ability: As per the standard Striker/Cavalry Lance.
        //
        {
            id: 'heavy-striker-lance',
            name: 'Heavy Striker/Cavalry',
            description: 'Heavy fast-moving formation',
            effectDescription: 'As per the standard Striker/Cavalry Lance.',
            effectGroups: [{
                abilityIds: ['speed_demon'],
                selection: 'all',
                distribution: 'percent-75',
            }],
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                // All Move 8"+ (with or without jump)
                const allFast = units.every(u => ASLanceTypeIdentifierUtil.getAnyGroundOrJumpMove(u.getUnit()) >= 8);
                // 3+ SZ 3+
                const largeUnits = units.filter(u => ASLanceTypeIdentifierUtil.getSize(u.getUnit()) >= 3);
                // No SZ < 2
                const noSmall = units.every(u => ASLanceTypeIdentifierUtil.getSize(u.getUnit()) >= 2);
                // 1+ Long-range > 1
                const hasLongRange = units.some(u => (u.getUnit().as?.dmg?._dmgL ?? 0) > 1);
                // 2+ Striker or Skirmisher
                const hasRequiredRoles = units.filter(u =>
                    u.getUnit().role === 'Striker' || u.getUnit().role === 'Skirmisher');

                return allFast && largeUnits.length >= 3 && noSmall && hasLongRange && hasRequiredRoles.length >= 2;
            }
        },

        // ─── Fire Lance ──────────────────────────────────────────────────
        //
        // FIRE LANCE
        // Requirements: 75% must be of the Missile Boat or Sniper unit roles.
        // Ideal Role: Missile Boat
        // Bonus Ability: Each turn, up to half the units (rounded down) may
        //   receive the Sniper SPA. Destroyed/withdrawn units do not count.
        // Variations: Fire Support, Artillery Fire, Direct Fire, Anti-Air.
        //
        {
            id: 'fire-lance',
            name: 'Fire',
            description: 'Long-range firepower specialists',
            effectDescription: 'Each turn, up to half the units (rounded down) may receive the Sniper SPA for that turn. Destroyed or withdrawn units do not count.',
            effectGroups: [{
                abilityIds: ['sniper'],
                selection: 'all',
                distribution: 'half-round-down',
                perTurn: true,
            }],
            idealRole: 'Missile Boat',
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                const hasRequiredRoles = units.filter(u =>
                    ['Missile Boat', 'Sniper'].includes(u.getUnit().role));
                return hasRequiredRoles.length >= Math.ceil(units.length * 0.75);
            }
        },

        //
        // ANTI-AIR LANCE (variant of Fire Lance)
        // Requirements: In addition to the Fire Lance requirements, at least 2
        //   units must possess the FLK (Flak), AC (Autocannon), or ART (Artillery)
        //   special abilities.
        // Bonus Ability: Each turn, up to half the units (rounded down) may
        //   receive the effects of the Anti-Aircraft Specialists Special Command
        //   Ability. Destroyed/withdrawn units do not count.
        //
        {
            id: 'anti-air-lance',
            parent: 'fire-lance',
            name: 'Anti-Air',
            description: 'Air defense specialists',
            effectDescription: 'Each turn, up to half the units (rounded down) may receive the effects of the Anti-Aircraft Specialists Special Command Ability for that turn. Destroyed or withdrawn units do not count.',
            effectGroups: [{
                commandAbilityIds: ['anti_aircraft_specialists'],
                selection: 'all',
                distribution: 'half-round-down',
                perTurn: true,
            }],
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                // 2+ units with FLK, AC, or ART special abilities
                const qualifyingUnits = units.filter(u =>
                    ASLanceTypeIdentifierUtil.hasSpecial(u.getUnit(), 'FLK') ||
                    ASLanceTypeIdentifierUtil.hasSpecial(u.getUnit(), 'AC') ||
                    ASLanceTypeIdentifierUtil.hasSpecial(u.getUnit(), 'ART'));
                return qualifyingUnits.length >= 2;
            }
        },

        //
        // ARTILLERY FIRE LANCE (variant of Fire Lance)
        // Requirements: At least 2 units must have an Artillery (ARTX-#) special
        //   ability.
        // Bonus Ability: Each turn, up to half the units (rounded down) may
        //   receive the Oblique Artilleryman SPA. Destroyed/withdrawn units
        //   do not count.
        //
        {
            id: 'artillery-fire-lance',
            name: 'Artillery Fire',
            description: 'Artillery support specialists',
            effectDescription: 'Each turn, up to half the units (rounded down) may receive the Oblique Artilleryman SPA for that turn. Destroyed or withdrawn units do not count.',
            effectGroups: [{
                abilityIds: ['oblique_artilleryman'],
                selection: 'all',
                distribution: 'half-round-down',
                perTurn: true,
            }],
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                const hasArtillery = units.filter(u =>
                    ASLanceTypeIdentifierUtil.hasSpecial(u.getUnit(), 'ART'));
                return hasArtillery.length >= 2;
            }
        },

        //
        // DIRECT FIRE LANCE (variant of Fire Lance)
        // Requirements: At least 2 units must be Size 3+. All units must deliver
        //   at least 2 points of damage at Long range.
        // Bonus Ability: Each turn, up to half the units (rounded down) may
        //   receive the Weapon Specialist SPA. Destroyed/withdrawn units
        //   do not count.
        //
        {
            id: 'direct-fire-lance',
            name: 'Direct Fire',
            description: 'Direct fire heavy weapons',
            effectDescription: 'Each turn, up to half the units (rounded down) may receive the Weapon Specialist SPA for that turn. Destroyed or withdrawn units do not count.',
            effectGroups: [{
                abilityIds: ['weapon_specialist'],
                selection: 'all',
                distribution: 'half-round-down',
                perTurn: true,
            }],
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                // 2+ SZ 3+
                const largeUnits = units.filter(u => ASLanceTypeIdentifierUtil.getSize(u.getUnit()) >= 3);
                // All must deliver at least 2 damage at Long range
                const allLongRange = units.every(u => (u.getUnit().as?.dmg?._dmgL ?? 0) >= 2);

                return largeUnits.length >= 2 && allLongRange;
            }
        },

        //
        // FIRE SUPPORT LANCE (variant of Fire Lance)
        // Requirements: At least 3 units must possess the Indirect Fire (IF#)
        //   special ability.
        // Bonus Ability: Each turn, up to half the units (rounded down) may
        //   receive the Oblique Attacker SPA. Destroyed/withdrawn units
        //   do not count.
        //
        {
            id: 'fire-support-lance',
            name: 'Fire Support',
            description: 'Indirect fire specialists',
            effectDescription: 'Each turn, up to half the units (rounded down) may receive the Oblique Attacker SPA for that turn. Destroyed or withdrawn units do not count.',
            effectGroups: [{
                abilityIds: ['oblique_attacker'],
                selection: 'all',
                distribution: 'half-round-down',
                perTurn: true,
            }],
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                // 3+ units with IF (Indirect Fire) special ability
                const indirectCapable = units.filter(u =>
                    ASLanceTypeIdentifierUtil.hasSpecial(u.getUnit(), 'IF'));
                return indirectCapable.length >= 3;
            }
        },

        // ─── Recon Lance ─────────────────────────────────────────────────
        //
        // RECON LANCE
        // Requirements: All units must have minimum Move of 10". At least 2
        //   units must be of the Scout or Striker roles.
        // Ideal Role: Scout
        // Bonus Ability: At start of play, choose Eagle's Eyes, Forward Observer,
        //   or Maneuvering Ace SPA. Every unit receives the chosen SPA (cannot be
        //   changed mid-scenario).
        // Variations: Light Recon Lance, Heavy Recon Lance.
        //
        {
            id: 'recon-lance',
            name: 'Recon',
            description: 'Fast reconnaissance specialists',
            effectDescription: 'At the beginning of play, choose Eagle\'s Eyes, Forward Observer, or Maneuvering Ace SPA. Every unit in this formation receives the chosen SPA (cannot be changed mid-scenario).',
            effectGroups: [{
                abilityIds: ['eagles_eyes', 'forward_observer', 'maneuvering_ace'],
                selection: 'choose-one',
                distribution: 'all',
            }],
            idealRole: 'Scout',
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                // All units Move 10"+
                const allFast = units.every(u => ASLanceTypeIdentifierUtil.getAnyGroundOrJumpMove(u.getUnit()) >= 10);
                // 2+ Scout or Striker
                const scoutOrStriker = units.filter(u =>
                    u.getUnit().role === 'Scout' || u.getUnit().role === 'Striker');
                return allFast && scoutOrStriker.length >= 2;
            }
        },

        //
        // LIGHT RECON LANCE (variant of Recon Lance)
        // Requirements: All units must be Size 1 with minimum Move of 12"
        //   (with or without jump). All units must be of the Scout role.
        // Bonus Ability: As per the standard Recon Lance, except each unit
        //   may receive a different SPA.
        //
        {
            id: 'light-recon-lance',
            name: 'Light Recon',
            description: 'Ultra-fast light reconnaissance',
            effectDescription: 'As per the standard Recon Lance, except each unit may receive a different SPA.',
            effectGroups: [{
                abilityIds: ['eagles_eyes', 'forward_observer', 'maneuvering_ace'],
                selection: 'choose-each',
                distribution: 'all',
            }],
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                // All SZ 1
                const allSmall = units.every(u => ASLanceTypeIdentifierUtil.getSize(u.getUnit()) === 1);
                // All Move 12"+ (with or without jump)
                const allVeryFast = units.every(u => ASLanceTypeIdentifierUtil.getAnyGroundOrJumpMove(u.getUnit()) >= 12);
                // All Scout role
                const allScouts = units.every(u => u.getUnit().role === 'Scout');

                return allSmall && allVeryFast && allScouts;
            }
        },

        //
        // HEAVY RECON LANCE (variant of Recon Lance)
        // Requirements: All units must have Move of 8"+. At least 2 must move
        //   10"+ (with or without jump). At least 1 unit must be Size 3+.
        //   At least 2 units must be of the Scout role.
        // Bonus Ability: As per the standard Recon Lance, except only up to
        //   half the units (round up) may receive the chosen SPA.
        //
        {
            id: 'heavy-recon-lance',
            name: 'Heavy Recon',
            description: 'Armored reconnaissance formation',
            effectDescription: 'As per the standard Recon Lance, except only up to half the units (round up) may receive the chosen SPA.',
            effectGroups: [{
                abilityIds: ['eagles_eyes', 'forward_observer', 'maneuvering_ace'],
                selection: 'choose-one',
                distribution: 'half-round-up',
            }],
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                // All Move 8"+
                const allFast = units.every(u => ASLanceTypeIdentifierUtil.getAnyGroundOrJumpMove(u.getUnit()) >= 8);
                // 2+ Move 10"+ (with or without jump)
                const veryFast = units.filter(u => ASLanceTypeIdentifierUtil.getAnyGroundOrJumpMove(u.getUnit()) >= 10);
                // 1+ SZ 3+
                const hasLarge = units.some(u => ASLanceTypeIdentifierUtil.getSize(u.getUnit()) >= 3);
                // 2+ Scout
                const scoutUnits = units.filter(u => u.getUnit().role === 'Scout');

                return allFast && veryFast.length >= 2 && hasLarge && scoutUnits.length >= 2;
            }
        },

        // ─── Pursuit Lance ───────────────────────────────────────────────
        //
        // PURSUIT LANCE
        // Requirements: All units must be Size 2 or less. 75% (round normally)
        //   must have Move of 12"+ (regardless of jump). At least 1 unit must
        //   have Medium-range attack value > 1.
        // Ideal Role: Striker
        // Bonus Ability: 75% receive the Blood Stalker SPA. May choose an enemy
        //   Formation rather than a single unit as the target. All members must
        //   choose the same enemy Formation.
        // Variations: Probe Lance, Sweep Lance.
        //
        {
            id: 'pursuit-lance',
            name: 'Pursuit',
            description: 'Fast scout hunters with firepower',
            effectDescription: '75% of the units receive the Blood Stalker SPA. The Pursuit Lance may choose an enemy Formation rather than a single unit as the Blood Stalker target. All members must choose the same enemy Formation.',
            effectGroups: [{
                abilityIds: ['blood_stalker'],
                selection: 'all',
                distribution: 'percent-75',
            }],
            idealRole: 'Striker',
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                // All SZ ≤ 2
                const allSmallOrMedium = units.every(u => ASLanceTypeIdentifierUtil.getSize(u.getUnit()) <= 2);
                // 75% Move 12"+ (regardless of jump)
                const fastUnits = units.filter(u => ASLanceTypeIdentifierUtil.getAnyGroundOrJumpMove(u.getUnit()) >= 12);
                // 1+ medium-range attack > 1
                const hasMedRange = units.some(u => (u.getUnit().as?.dmg?._dmgM ?? 0) > 1);

                return allSmallOrMedium && fastUnits.length >= Math.ceil(units.length * 0.75) && hasMedRange;
            }
        },

        //
        // PROBE LANCE (variant of Pursuit Lance)
        // Requirements: All units must be Size 3 or less. 75% must have Move
        //   of 10"+ (with or without jump). All units must deliver at least 2
        //   points of damage at Medium range.
        // Bonus Ability: As per the standard Pursuit Lance.
        //
        {
            id: 'probe-lance',
            name: 'Probe',
            description: 'Mobile reconnaissance force',
            effectDescription: 'As per the standard Pursuit Lance.',
            effectGroups: [{
                abilityIds: ['blood_stalker'],
                selection: 'all',
                distribution: 'percent-75',
            }],
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                // All SZ ≤ 3
                const allNotHuge = units.every(u => ASLanceTypeIdentifierUtil.getSize(u.getUnit()) <= 3);
                // 75% Move 10"+ (with or without jump)
                const fastUnits = units.filter(u => ASLanceTypeIdentifierUtil.getAnyGroundOrJumpMove(u.getUnit()) >= 10);
                // All must deliver at least 2 damage at Medium range
                const allMedDmg = units.every(u => (u.getUnit().as?.dmg?._dmgM ?? 0) >= 2);

                return allNotHuge && fastUnits.length >= Math.ceil(units.length * 0.75) && allMedDmg;
            }
        },

        //
        // SWEEP LANCE (variant of Pursuit Lance)
        // Requirements: All units must be Size 2 or less. All must have Move
        //   of 10"+ (regardless of jump). All must deliver at least 2 points
        //   of damage at Short range.
        // Bonus Ability: As per the standard Pursuit Lance.
        //
        {
            id: 'sweep-lance',
            name: 'Sweep',
            description: 'Fast medium-range sweeping force',
            effectDescription: 'As per the standard Pursuit Lance.',
            effectGroups: [{
                abilityIds: ['blood_stalker'],
                selection: 'all',
                distribution: 'percent-75',
            }],
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                // All SZ ≤ 2
                const allSmallOrMedium = units.every(u => ASLanceTypeIdentifierUtil.getSize(u.getUnit()) <= 2);
                // All Move 10"+ (regardless of jump)
                const allFast = units.every(u => ASLanceTypeIdentifierUtil.getAnyGroundOrJumpMove(u.getUnit()) >= 10);
                // All must deliver at least 2 damage at Short range
                const allShortDmg = units.every(u => (u.getUnit().as?.dmg?._dmgS ?? 0) >= 2);

                return allSmallOrMedium && allFast && allShortDmg;
            }
        },

        // ─── Command Lance ───────────────────────────────────────────────
        //
        // COMMAND LANCE
        // Requirements: At least 1 unit must be designated as the commander.
        //   50% must have one of: Sniper, Missile Boat, Skirmisher, or Juggernaut
        //   roles. 1 additional unit must be Brawler, Striker, or Scout.
        // Ideal Role: None
        // Bonus Ability: Prior to play, half the units (round up) receive one
        //   free SPA each: Antagonizer, Blood Stalker, Combat Intuition, Eagle's
        //   Eyes, Marksman, or Multi-Tasker. The commander's unit also receives
        //   Tactical Genius SPA.
        // Variations: Vehicle Command Lance.
        //
        {
            id: 'command-lance',
            name: 'Command',
            description: 'Diverse formation built around force commander',
            effectDescription: 'Prior to play, half the units (round up) receive one free SPA each (Antagonizer, Blood Stalker, Combat Intuition, Eagle\'s Eyes, Marksman, or Multi-Tasker). The commander\'s unit also receives the Tactical Genius SPA.',
            effectGroups: [
                {
                    abilityIds: ['antagonizer', 'blood_stalker', 'combat_intuition', 'eagles_eyes', 'marksman', 'multi_tasker'],
                    selection: 'choose-each',
                    distribution: 'half-round-up',
                },
                {
                    abilityIds: ['tactical_genius'],
                    selection: 'all',
                    distribution: 'commander',
                },
            ],
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                // 50% Sniper, Missile Boat, Skirmisher, or Juggernaut
                const hasRequiredRoles = units.filter(u =>
                    ['Sniper', 'Missile Boat', 'Skirmisher', 'Juggernaut'].includes(u.getUnit().role));
                // 1+ Brawler, Striker, or Scout
                const hasAdditionalRole = units.filter(u =>
                    ['Brawler', 'Striker', 'Scout'].includes(u.getUnit().role));

                return hasRequiredRoles.length >= Math.ceil(units.length * 0.5) && hasAdditionalRole.length >= 1;
            }
        },

        //
        // VEHICLE COMMAND LANCE (variant of Command Lance)
        // Requirements: All units must be combat vehicles. One unit must be
        //   designated as the commander. Only one pair of vehicles needs to be
        //   of the Sniper, Missile Boat, Skirmisher, or Juggernaut roles.
        // Bonus Ability: As per the standard Command Lance.
        //
        {
            id: 'vehicle-command-lance',
            name: 'Vehicle Command',
            description: 'Formation of command vehicle units',
            effectDescription: 'As per the standard Command Lance.',
            effectGroups: [
                {
                    abilityIds: ['antagonizer', 'blood_stalker', 'combat_intuition', 'eagles_eyes', 'marksman', 'multi_tasker'],
                    selection: 'choose-each',
                    distribution: 'half-round-up',
                },
                {
                    abilityIds: ['tactical_genius'],
                    selection: 'all',
                    distribution: 'commander',
                },
            ],
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                if (!isOnlyCombatVehicles(units)) return false;
                // One pair of identical vehicles with Sniper, Missile Boat, Skirmisher, or Juggernaut
                const vehiclePairs = findIdenticalPairs(units);
                const hasRequiredRoles = vehiclePairs.some(pair =>
                    pair.every(u =>
                        ['Sniper', 'Missile Boat', 'Skirmisher', 'Juggernaut'].includes(u.getUnit().role)));
                return hasRequiredRoles;
            }
        },

        // ─── Support Lance ───────────────────────────────────────────────
        //
        // SUPPORT LANCE
        // Requirements: None.
        // Ideal Role: None
        // Bonus Ability: Before play, designate one other formation to support.
        //   Half the units (round down) receive the same SPAs as the supported
        //   formation. SPA count may not exceed the supported formation's count.
        //   If bonus abilities from the supported formation are assigned each turn,
        //   the Support Lance assigns them at start of play and may not switch.
        //   If supporting a Command Lance, receives the two non-commander SPAs
        //   but not the Tactical Genius SPA.
        //
        {
            id: 'support-lance',
            name: 'Support',
            description: 'Multi-role formation backing other units',
            effectDescription: 'Before play, designate one other formation to support. Half the units (round down) receive the same SPAs as the supported formation. SPA count may not exceed the supported formation\'s count.',
            validator: (units: ForceUnit[]) => {
                return units.length >= 3;
            }
        },

        // ─── Nova (Combined Transport & Infantry) ────────────────────────
        //
        // NOVA (Combined Transport & Infantry)
        // A Nova formation is built on top of an existing formation for the
        // non-infantry units. The non-infantry units fulfill the requirements
        // and receive the bonuses for the base formation.
        // Requirements: The non-infantry units must be capable of transporting
        //   all infantry units simultaneously (BA with MEC mounting OMNI units,
        //   BA with XMEC mounting 'Mechs, infantry mounting units with IT#, or
        //   a combination). 5 OmniMechs + 5 Battle Armor for Clan Stars.
        // Ideal Role: None
        // Bonus Ability: Mounted infantry may make weapon attacks using the
        //   transport's attacker movement modifier with an additional +2 TN
        //   modifier for being mounted.
        //
        {
            id: 'nova',
            name: 'Nova',
            description: 'Clan OmniMech Star with mechanized battle armor',
            effectDescription: 'Mounted infantry may make weapon attacks using the transport\'s attacker movement modifier with an additional +2 TN modifier for being mounted.',
            techBase: 'Clan',
            validator: (units: ForceUnit[]) => {
                if (units.length !== 10) return false;

                const mechs = units.filter(u => {
                    const tp = u.getUnit().as?.TP;
                    return tp === 'BM' || tp === 'IM';
                });
                const battleArmor = units.filter(u => u.getUnit().as?.TP === 'BA');

                if (mechs.length !== 5 || battleArmor.length !== 5) return false;

                // All mechs must have OMNI special
                const allOmni = mechs.every(u => ASLanceTypeIdentifierUtil.hasSpecial(u.getUnit(), 'OMNI'));
                return allOmni;
            }
        },

        // ─── Aerospace Formations ────────────────────────────────────────

        //
        // INTERCEPTOR SQUADRON
        // Requirements: Over 50% must be of the Interceptor unit role.
        // Bonus Ability: Any units with Move (Thrust) of 9 or less receive
        //   the Speed Demon SPA. Up to 2 fighters may also receive the
        //   Range Master (Long) SPA.
        //
        {
            id: 'interceptor-squadron',
            name: 'Interceptor Squadron',
            description: 'Interceptor specialists',
            effectDescription: 'Any units with Move (Thrust) of 9 or less receive the Speed Demon SPA. In addition, up to 2 fighters may also receive the Range Master (Long) SPA.',
            effectGroups: [
                {
                    abilityIds: ['speed_demon'],
                    selection: 'all',
                    distribution: 'conditional',
                    condition: 'Move (Thrust) ≤ 9',
                },
                {
                    abilityIds: ['range_master'],
                    selection: 'all',
                    distribution: 'fixed',
                    count: 2,
                },
            ],
            minUnits: 6,
            validator: (units: ForceUnit[]) => {
                if (!units.every(u => ASLanceTypeIdentifierUtil.isAeroUnit(u.getUnit()))) return false;
                const hasInterceptorRole = units.filter(u => u.getUnit().role === 'Interceptor');
                return hasInterceptorRole.length > Math.ceil(units.length * 0.5);
            }
        },

        //
        // AEROSPACE SUPERIORITY SQUADRON
        // Requirements: Over 50% must be of the Interceptor or Fast Dogfighter
        //   unit roles.
        // Bonus Ability: Select up to 50% of the units and assign up to 2 of
        //   the following SPAs (in any combination): Blood Stalker, Ride the
        //   Wash, Hot Dog.
        //
        {
            id: 'aerospace-superiority-squadron',
            name: 'Aerospace Superiority Squadron',
            description: 'Air superiority specialists',
            effectDescription: 'Prior to the start of the scenario, select up to 50% of the units and assign up to 2 of the following SPAs (in any combination): Blood Stalker, Ride the Wash, Hot Dog.',
            effectGroups: [{
                abilityIds: ['blood_stalker', 'ride_the_wash', 'hot_dog'],
                selection: 'choose-each',
                distribution: 'up-to-50-percent',
                maxPerUnit: 2,
            }],
            minUnits: 6,
            validator: (units: ForceUnit[]) => {
                if (!units.every(u => ASLanceTypeIdentifierUtil.isAeroUnit(u.getUnit()))) return false;
                const interceptorOrDogfighter = units.filter(u =>
                    u.getUnit().role === 'Interceptor' || u.getUnit().role === 'Fast Dogfighter');
                return interceptorOrDogfighter.length > Math.ceil(units.length * 0.5);
            }
        },

        //
        // FIRE SUPPORT SQUADRON
        // Requirements: At least 50% must be of the Fire Support role. The
        //   remainder must be of the Dogfighter role.
        // Bonus Ability: Choose 2 pairs of fighters and assign one SPA each
        //   pair: Golden Goose, Ground Hugger, Hot Dog, or Shaky Stick.
        //   The two pairs may not receive the same SPA.
        //
        {
            id: 'fire-support-squadron',
            name: 'Fire Support Squadron',
            description: 'Fire support specialists',
            effectDescription: 'Prior to the start of the scenario, choose 2 pairs of fighters and assign one SPA each pair: Golden Goose, Ground Hugger, Hot Dog, or Shaky Stick. The two pairs may not receive the same SPA.',
            effectGroups: [{
                abilityIds: ['golden_goose', 'ground_hugger', 'hot_dog', 'shaky_stick'],
                selection: 'choose-each',
                distribution: 'fixed-pairs',
                count: 2,
            }],
            minUnits: 6,
            validator: (units: ForceUnit[]) => {
                if (!units.every(u => ASLanceTypeIdentifierUtil.isAeroUnit(u.getUnit()))) return false;
                const hasFireSupport = units.filter(u => u.getUnit().role === 'Fire Support');
                const hasDogfighter = units.some(u => u.getUnit().role?.includes('Dogfighter'));
                return hasFireSupport.length >= Math.ceil(units.length * 0.5) && hasDogfighter;
            }
        },

        //
        // STRIKE SQUADRON
        // Requirements: Over 50% must be of the Attack or Dogfighter unit roles.
        // Bonus Ability: Up to 50% of the units may receive the Speed Demon SPA.
        //   The remaining fighters receive the Golden Goose SPA.
        //
        {
            id: 'strike-squadron',
            name: 'Strike Squadron',
            description: 'Strike specialists',
            effectDescription: 'Up to 50% of the units may receive the Speed Demon SPA. The remaining fighters receive the Golden Goose SPA.',
            effectGroups: [
                {
                    abilityIds: ['speed_demon'],
                    selection: 'all',
                    distribution: 'up-to-50-percent',
                },
                {
                    abilityIds: ['golden_goose'],
                    selection: 'all',
                    distribution: 'remainder',
                },
            ],
            minUnits: 6,
            validator: (units: ForceUnit[]) => {
                if (!units.every(u => ASLanceTypeIdentifierUtil.isAeroUnit(u.getUnit()))) return false;
                const attackOrDogfighter = units.filter(u =>
                    u.getUnit().role?.includes('Attack') || u.getUnit().role?.includes('Dogfighter'));
                return attackOrDogfighter.length > Math.ceil(units.length * 0.5);
            }
        },

        //
        // ELECTRONIC WARFARE SQUADRON
        // Requirements: No unit role requirement, but over 50% must possess
        //   one or more of: PRB, AECM, BH, ECM, LPRB, LECM, LTAG, TAG, or WAT
        //   special abilities.
        // Bonus Ability: Receives the Communications Disruption Special Command
        //   Ability, enabling disruption of one randomly-determined enemy lance
        //   or squadron on a 1D6 roll of 6 (persists one turn). If the force
        //   already has CommunicationsDisruption SCA, the squadron may choose
        //   which enemy formation is affected.
        //
        {
            id: 'electronic-warfare-squadron',
            name: 'Electronic Warfare Squadron',
            description: 'Electronic warfare specialists',
            effectDescription: 'This squadron receives the Communications Disruption Special Command Ability, enabling it to disrupt the communications of one randomly-determined enemy lance or squadron on a 1D6 roll of 6 (persists one turn).',
            effectGroups: [{
                commandAbilityIds: ['communications_disruption'],
                selection: 'all',
                distribution: 'all',
            }],
            minUnits: 6,
            validator: (units: ForceUnit[]) => {
                if (!units.every(u => ASLanceTypeIdentifierUtil.isAeroUnit(u.getUnit()))) return false;
                const EW_SPECIALS = ['PRB', 'AECM', 'BH', 'ECM', 'LPRB', 'LECM', 'LTAG', 'TAG', 'WAT'];
                const hasEW = units.filter(u =>
                    EW_SPECIALS.some(prefix => ASLanceTypeIdentifierUtil.hasSpecial(u.getUnit(), prefix)));
                return hasEW.length > Math.ceil(units.length * 0.5);
            }
        },

        //
        // TRANSPORT SQUADRON
        // Requirements: May include support aircraft, conventional/aerospace
        //   fighters, Small Craft, and/or DropShips. At least 50% must be
        //   of the Transport unit role.
        // Bonus Ability: Choose one SPA to apply to all Transport-role units:
        //   Dust-Off, Ride the Wash, or Wind Walker.
        //
        {
            id: 'transport-squadron',
            name: 'Transport Squadron',
            description: 'Transport specialists',
            effectDescription: 'Choose one SPA to apply to all Transport-role units: Dust-Off, Ride the Wash, or Wind Walker.',
            effectGroups: [{
                abilityIds: ['dust_off', 'ride_the_wash', 'wind_walker'],
                selection: 'choose-one',
                distribution: 'role-filtered',
                roleFilter: 'Transport',
            }],
            minUnits: 6,
            validator: (units: ForceUnit[]) => {
                // May include support aircraft, conventional/aerospace fighters, Small Craft, DropShips
                const allowedTypes: ASUnitTypeCode[] = ['AF', 'CF', 'SC', 'DS', 'SV', 'DA'];
                if (!units.every(u => allowedTypes.includes(u.getUnit().as?.TP as ASUnitTypeCode))) return false;
                const hasTransportRole = units.filter(u => u.getUnit().role?.includes('Transport'));
                return hasTransportRole.length >= Math.ceil(units.length * 0.5);
            }
        },
    ];

    // ── Validation & matching logic ──────────────────────────────────────

    private static validateDefinition(definition: FormationTypeDefinition, units: ForceUnit[]): boolean {
        if (definition.parent) {
            const parentDefinition = this.definitions.find(d => d.id === definition.parent);
            if (!parentDefinition) {
                console.error(`Parent definition '${definition.parent}' not found for '${definition.id}'`);
                return false;
            }
            if (!this.validateDefinition(parentDefinition, units)) {
                return false;
            }
        }

        try {
            if (definition.minUnits && units.length < definition.minUnits) {
                return false;
            }
            // If all units match the ideal role, skip the full validator
            if (definition.idealRole) {
                const allMatchIdeal = units.every(u => u.getUnit().role === definition.idealRole);
                if (allMatchIdeal) {
                    return true;
                }
            }
            return definition.validator(units);
        } catch (error) {
            console.error(`Error validating lance type ${definition.id}:`, error);
            return false;
        }
    }

    /**
     * Identifies all matching formation types for the given force units
     */
    public static identifyLanceTypes(units: ForceUnit[], techBase: string, factionName: string): FormationTypeDefinition[] {
        const matches: FormationTypeDefinition[] = [];

        for (const definition of this.definitions) {
            try {
                if (definition.exclusiveFaction && !factionName.includes(definition.exclusiveFaction)) {
                    continue;
                }
                if (techBase && definition.techBase
                    && definition.techBase !== 'Special'
                    && techBase !== 'Mixed'
                    && definition.techBase !== techBase) {
                    continue;
                }
                if (this.validateDefinition(definition, units)) {
                    matches.push(definition);
                }
            } catch (error) {
                console.error(`Error validating lance type ${definition.id}:`, error);
            }
        }

        return matches;
    }

    /**
     * Gets the best matching formation type (most specific)
     */
    public static getBestMatch(units: ForceUnit[], techBase: string, factionName: string): FormationTypeDefinition | null {
        const matches = this.identifyLanceTypes(units, techBase, factionName);
        if (matches.length === 0) return null;

        let totalWeight = 0;
        const weights: number[] = [];
        for (const match of matches) {
            let weight = 1;
            if (match.exclusiveFaction && factionName.includes(match.exclusiveFaction)) {
                weight *= 5;
            } else if (match.parent) {
                weight *= 3;
            } else if (match.id !== 'support-lance' && match.id !== 'command-lance' && match.id !== 'battle-lance') {
                weight *= 2;
            }
            weights.push(weight);
            totalWeight += weight;
        }

        let roll = Math.random() * totalWeight;
        for (let i = 0; i < matches.length; i++) {
            roll -= weights[i];
            if (roll <= 0) return matches[i];
        }
        return matches[matches.length - 1];
    }

    // ── Helper methods ───────────────────────────────────────────────────

    /** Returns the AS Size value for a unit */
    private static getSize(unit: Unit): number {
        return unit.as?.SZ ?? 0;
    }

    /**
     * Returns the maximum ground-based movement in inches.
     * Excludes jump ('j') and aerospace modes ('a', 'p', 'k').
     */
    private static getMaxGroundMove(unit: Unit): number {
        const mvm = unit.as?.MVm;
        if (!mvm) return 0;
        let max = 0;
        for (const [mode, value] of Object.entries(mvm)) {
            if (mode === 'j' || AEROSPACE_MODES.has(mode)) continue;
            if (value > max) max = value;
        }
        return max;
    }

    /** Returns the jump movement value in inches (0 if no jump) */
    private static getJumpMove(unit: Unit): number {
        return unit.as?.MVm?.['j'] ?? 0;
    }

    /**
     * Returns max(groundMove, jumpMove) — used for "Move of X, with or without jump"
     */
    private static getAnyGroundOrJumpMove(unit: Unit): number {
        return Math.max(this.getMaxGroundMove(unit), this.getJumpMove(unit));
    }

    /** Checks if unit type is infantry (CI, BA, PM) */
    private static isInfantry(unit: Unit): boolean {
        const tp = unit.as?.TP;
        return tp === 'CI' || tp === 'BA' || tp === 'PM';
    }

    /** Checks if unit type is an aerospace unit */
    private static isAeroUnit(unit: Unit): boolean {
        const tp = unit.as?.TP;
        return tp === 'AF' || tp === 'CF' || tp === 'SC' || tp === 'DS'
            || tp === 'DA' || tp === 'WS' || tp === 'SS' || tp === 'JS';
    }

    /** Checks if unit has a special ability starting with the given prefix */
    private static hasSpecial(unit: Unit, prefix: string): boolean {
        return unit.as?.specials?.some(s => s.startsWith(prefix)) || false;
    }
}
