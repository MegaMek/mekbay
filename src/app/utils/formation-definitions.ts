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
import { Rulebook } from '../models/common.model';

/*
 * Author: Drake
 *
 * Unified formation definitions for both Alpha Strike and Classic BattleTech.
 * Each definition carries two validators (validatorAS / validatorCBT) and
 * dual rulebook references.  Shared metadata (id, name, description,
 * effectDescription, effectGroups, idealRole, …) is defined once
 */

// ── AS helper functions ──────────────────────────────────────────────────────

const AEROSPACE_MODES = new Set(['a', 'p', 'k']);

function asGetSize(unit: Unit): number {
    return unit.as?.SZ ?? 0;
}

function asGetMaxGroundMove(unit: Unit): number {
    const mvm = unit.as?.MVm;
    if (!mvm) return 0;
    let max = 0;
    for (const [mode, value] of Object.entries(mvm)) {
        if (mode === 'j' || AEROSPACE_MODES.has(mode)) continue;
        if (value > max) max = value;
    }
    return max;
}

function asGetJumpMove(unit: Unit): number {
    return unit.as?.MVm?.['j'] ?? 0;
}

function asGetAnyGroundOrJumpMove(unit: Unit): number {
    return Math.max(asGetMaxGroundMove(unit), asGetJumpMove(unit));
}

function asIsInfantry(unit: Unit): boolean {
    const tp = unit.as?.TP;
    return tp === 'CI' || tp === 'BA' || tp === 'PM';
}

function asIsAeroUnit(unit: Unit): boolean {
    const tp = unit.as?.TP;
    return tp === 'AF' || tp === 'CF' || tp === 'SC' || tp === 'DS'
        || tp === 'DA' || tp === 'WS' || tp === 'SS' || tp === 'JS';
}

function asHasSpecial(unit: Unit, prefix: string): boolean {
    return unit.as?.specials?.some(s => s.startsWith(prefix)) || false;
}

function asIsOnlyCombatVehicles(units: ForceUnit[]): boolean {
    return units.every(u => {
        const tp = u.getUnit().as?.TP;
        return tp === 'CV' || tp === 'SV';
    });
}

function asFindIdenticalPairs(units: ForceUnit[]): ForceUnit[][] {
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

// ── Common helper functions ─────────────────────────────────────────────────────

function countMatchedPairs(units: ForceUnit[]): number {
    const counts = units.reduce((acc, curr) => {
        const name = curr.getUnit().name;
        acc[name] = (acc[name] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);
    return Object.values(counts).filter(count => count >= 2).length;
}

function countMatchedPairsFiltered(units: ForceUnit[], filter: (u: ForceUnit) => boolean): number {
    return countMatchedPairs(units.filter(filter));
}

function findIdenticalVehiclePairs(units: ForceUnit[]): ForceUnit[][] {
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

// ── CBT helper functions ─────────────────────────────────────────────────────

function cbtGetWeightClass(unit: Unit): number {
    const tons = unit.tons;
    if (unit.type === 'Mek') {
        if (tons < 40) return 0;
        if (tons <= 55) return 1;
        if (tons <= 75) return 3;
        return 4;
    }
    if (tons < 40) return 0;
    if (tons < 60) return 1;
    if (tons < 80) return 3;
    return 4;
}

function cbtCanDealDamage(unit: Unit, minDamage: number, atRange: number): boolean {
    if (!unit.comp || unit.comp.length === 0) return false;
    let totalDamageAtRange = 0;
    for (const comp of unit.comp) {
        if (!comp.r) continue;
        let maxRange = 0;
        for (const r of comp.r.split('/')) {
            const parsed = parseInt(r);
            if (parsed > maxRange) maxRange = parsed;
        }
        if (maxRange < atRange) continue;
        if (comp.d) {
            const damage = parseInt(comp.d);
            if (!isNaN(damage)) {
                totalDamageAtRange += damage;
                if (totalDamageAtRange >= minDamage) return true;
            }
        }
    }
    return false;
}

function cbtHasAutocannon(unit: Unit): boolean {
    return unit.comp?.some(c => c.n?.includes('AC/')) || false;
}

function cbtHasLBXAutocannon(unit: Unit): boolean {
    return unit.comp?.some(c => c.n?.includes('LB ')) || false;
}

function cbtHasLRM(unit: Unit): boolean {
    return unit.comp?.some(c => c.n?.includes('LRM')) || false;
}

function cbtHasSRM(unit: Unit): boolean {
    return unit.comp?.some(c => c.n?.includes('SRM')) || false;
}

function cbtHasArtillery(unit: Unit): boolean {
    return unit.comp?.some(c => c.t === 'A') || false;
}

function cbtIsOnlyCombatVehicles(units: ForceUnit[]): boolean {
    return units.every(u => u.getUnit().type === 'Tank' || u.getUnit().type === 'VTOL');
}

// ── Formation definitions ────────────────────────────────────────────────────

export const FORMATION_DEFINITIONS: FormationTypeDefinition[] = [

    // ─── Air Lance ───────────────────────────────────────────────────────
    // TODO: Implement when we will support group of groups.
    // {
    //     id: 'air-lance',
    //     name: 'Air',
    //     description: 'Lance of ground units plus two aerospace/conventional fighters',
    //     effectDescription: 'No additional bonus ability is granted by this formation.',
    //     techBase: 'Special',
    //     minUnits: 4,
    //     rulesRef: [{ book: Rulebook.CO, page: 61 }, { book: Rulebook.ASCE, page: 121 }],
    //     ...
    // },

    // ─── Anti-'Mech Lance ────────────────────────────────────────────────
    //
    // Requirements: All units must be infantry.
    // Bonus Ability: Distracting Swarm — units swarming an enemy cause +1 TN modifier.
    //
    {
        id: 'anti-mech-lance',
        name: 'Anti-\'Mech',
        description: 'All infantry units for urban and anti-mech warfare',
        effectDescription: 'Distracting Swarm — units in this formation swarming an enemy unit cause a +1 To-Hit modifier to any weapon attacks made by the enemy unit.',
        minUnits: 4,
        rulesRef: [{ book: Rulebook.CO, page: 61 }],
        validatorAS: (units: ForceUnit[]) => {
            return units.every(u => asIsInfantry(u.getUnit()));
        },
        validatorCBT: (units: ForceUnit[]) => {
            return units.every(u => u.getUnit().type === 'Infantry');
        },
    },

    // ─── Assault Lance ───────────────────────────────────────────────────
    //
    // Requirements (AS): At least 3 units Size 3+. No Size 1. All armor ≥ 5.
    //   75% medium-range ≥ 3. At least 1 Juggernaut or 2 Snipers.
    // Requirements (CBT): At least 3 heavy+. No light. All armor ≥ 135.
    //   75% can deal 25 dmg at 7 hexes. 1 Juggernaut + 2 Snipers.
    // Bonus: Choose Demoralizer or Multi-Tasker; up to half (round down) per turn.
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
        rulesRef: [{ book: Rulebook.CO, page: 61 }, { book: Rulebook.ASCE, page: 118 }],
        validatorAS: (units: ForceUnit[]) => {
            const largeUnits = units.filter(u => asGetSize(u.getUnit()) >= 3);
            const hasSmall = units.some(u => asGetSize(u.getUnit()) === 1);
            if (largeUnits.length < 3 || hasSmall) return false;
            const hasEnoughArmor = units.every(u => (u.getUnit().as?.Arm ?? 0) >= 5);
            const highMedDmg = units.filter(u => (u.getUnit().as?.dmg?._dmgM ?? 0) >= 3);
            const has75PercentHighDmg = highMedDmg.length >= Math.ceil(units.length * 0.75);
            const hasJuggernaut = units.some(u => u.getUnit().role === 'Juggernaut');
            const sniperCount = units.filter(u => u.getUnit().role === 'Sniper').length;
            return hasEnoughArmor && has75PercentHighDmg && (hasJuggernaut || sniperCount >= 2);
        },
        validatorCBT: (units: ForceUnit[]) => {
            const heavyOrLarger = units.filter(u => cbtGetWeightClass(u.getUnit()) >= 3);
            const hasLight = units.some(u => cbtGetWeightClass(u.getUnit()) === 0);
            if (heavyOrLarger.length < 3 || hasLight) return false;
            const hasEnoughArmor = units.every(u => u.getUnit().armor >= 135);
            const highDamage = units.filter(u => cbtCanDealDamage(u.getUnit(), 25, 7));
            const has75PercentHighDamage = highDamage.length >= Math.ceil(units.length * 0.75);
            const hasJuggernaut = units.some(u => u.getUnit().role === 'Juggernaut');
            const sniperCount = units.filter(u => u.getUnit().role === 'Sniper').length;
            return hasEnoughArmor && has75PercentHighDamage && (hasJuggernaut || sniperCount >= 2);
        },
    },

    //
    // ANVIL LANCE (variant of Assault Lance)
    // Exclusive to House Marik. All medium+, armor ≥ 105, 50% with AC/LRM/SRM.
    // Bonus: Up to 2 units per turn receive Cluster Hitter or Sandblaster.
    //
    {
        id: 'anvil-lance',
        name: 'Anvil',
        description: 'Marik heavy formation for holding enemy advance',
        effectDescription: 'At the beginning of each turn, up to two units in this formation may receive the Cluster Hitter or Sandblaster SPA. The player may assign the same SPA to both units, or one Sandblaster and the other Cluster Hitter.',
        effectGroups: [{
            abilityIds: ['cluster_hitter', 'sandblaster'],
            selection: 'choose-each',
            distribution: 'fixed',
            count: 2,
            perTurn: true,
        }],
        exclusiveFaction: 'Free Worlds League',
        idealRole: 'Juggernaut',
        minUnits: 4,
        rulesRef: [{ book: Rulebook.CO, page: 62 }],
        validatorAS: undefined,
        validatorCBT: (units: ForceUnit[]) => {
            const allMediumOrLarger = units.every(u => cbtGetWeightClass(u.getUnit()) >= 1);
            const hasEnoughArmor = units.every(u => u.getUnit().armor >= 105);
            const hasWeapons = units.filter(u => cbtHasAutocannon(u.getUnit()) ||
                cbtHasLRM(u.getUnit()) || cbtHasSRM(u.getUnit()));
            return allMediumOrLarger && hasEnoughArmor && hasWeapons.length >= Math.ceil(units.length * 0.5);
        },
    },

    //
    // FAST ASSAULT LANCE (variant of Assault Lance)
    // AS: All units Move 10"+ or jump. CBT: All walk ≥ 5 or jump > 0.
    // Bonus: In addition to Assault Lance bonus, up to 2 units per turn get Stand Aside.
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
        rulesRef: [{ book: Rulebook.CO, page: 62 }, { book: Rulebook.ASCE, page: 118 }],
        validatorAS: (units: ForceUnit[]) => {
            return units.every(u => {
                const groundMove = asGetMaxGroundMove(u.getUnit());
                const jumpMove = asGetJumpMove(u.getUnit());
                return groundMove >= 10 || jumpMove > 0;
            });
        },
        validatorCBT: (units: ForceUnit[]) => {
            return units.every(u => u.getUnit().walk >= 5 || u.getUnit().jump > 0);
        },
    },

    //
    // HUNTER LANCE (variant of Assault Lance)
    // At least 50% Ambusher or Juggernaut role.
    // Bonus: 50% per turn get Combat Intuition.
    //
    {
        id: 'hunter-lance',
        name: 'Hunter',
        description: 'Ambush specialists for heavy terrain',
        effectDescription: 'At the beginning of each turn, 50 percent of the units in the formation may be granted the Combat Intuition SPA.',
        effectGroups: [{
            abilityIds: ['combat_intuition'],
            selection: 'all',
            distribution: 'up-to-50-percent',
            perTurn: true,
        }],
        idealRole: 'Ambusher',
        minUnits: 4,
        rulesRef: [{ book: Rulebook.CO, page: 62 }],
        validatorAS: (units: ForceUnit[]) => {
            const ambusherOrJuggernaut = units.filter(u =>
                u.getUnit().role === 'Ambusher' || u.getUnit().role === 'Juggernaut');
            return ambusherOrJuggernaut.length >= Math.ceil(units.length * 0.5);
        },
        validatorCBT: (units: ForceUnit[]) => {
            const ambusherOrJuggernaut = units.filter(u =>
                u.getUnit().role === 'Ambusher' || u.getUnit().role === 'Juggernaut');
            return ambusherOrJuggernaut.length >= Math.ceil(units.length * 0.5);
        },
    },

    // ─── Battle Lance ────────────────────────────────────────────────────
    //
    // Requirements: 50% heavy+. 3+ Brawler/Sniper/Skirmisher.
    //   Vehicle formations need 2 matched pairs of heavy units.
    // Bonus: Lucky SPA shared pool (units at setup + 2). Max 4 rerolls per unit.
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
        rulesRef: [{ book: Rulebook.CO, page: 62 }, { book: Rulebook.ASCE, page: 117 }],
        validatorAS: (units: ForceUnit[]) => {
            const largeUnits = units.filter(u => asGetSize(u.getUnit()) >= 3);
            if (asIsOnlyCombatVehicles(units)) {
                if (countMatchedPairs(largeUnits) < 2) return false;
            }
            const hasRequiredRoles = units.filter(u =>
                ['Brawler', 'Sniper', 'Skirmisher'].includes(u.getUnit().role));
            return largeUnits.length >= Math.ceil(units.length * 0.5) && hasRequiredRoles.length >= 3;
        },
        validatorCBT: (units: ForceUnit[]) => {
            const heavyOrLarger = units.filter(u => cbtGetWeightClass(u.getUnit()) >= 3);
            if (cbtIsOnlyCombatVehicles(units)) {
                if (countMatchedPairs(heavyOrLarger) < 2) return false;
            }
            const hasRequiredRoles = units.filter(u =>
                ['Brawler', 'Sniper', 'Skirmisher'].includes(u.getUnit().role));
            return heavyOrLarger.length >= Math.ceil(units.length * 0.5) && hasRequiredRoles.length >= 3;
        },
    },

    //
    // LIGHT BATTLE LANCE
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
        rulesRef: [{ book: Rulebook.CO, page: 62 }, { book: Rulebook.ASCE, page: 117 }],
        validatorAS: (units: ForceUnit[]) => {
            const smallUnits = units.filter(u => asGetSize(u.getUnit()) === 1);
            const hasLargeSize4 = units.some(u => asGetSize(u.getUnit()) >= 4);
            if (asIsOnlyCombatVehicles(units)) {
                if (countMatchedPairsFiltered(units, u => asGetSize(u.getUnit()) === 1) < 2) return false;
            }
            const hasScout = units.some(u => u.getUnit().role === 'Scout');
            return smallUnits.length >= Math.ceil(units.length * 0.75) && !hasLargeSize4 && hasScout;
        },
        validatorCBT: (units: ForceUnit[]) => {
            const lightUnits = units.filter(u => cbtGetWeightClass(u.getUnit()) === 0);
            const hasAssault = units.some(u => cbtGetWeightClass(u.getUnit()) === 4);
            if (cbtIsOnlyCombatVehicles(units)) {
                if (countMatchedPairs(lightUnits) < 2) return false;
            }
            const hasScout = units.some(u => u.getUnit().role === 'Scout');
            return lightUnits.length >= Math.ceil(units.length * 0.75) && !hasAssault && hasScout;
        },
    },

    //
    // MEDIUM BATTLE LANCE
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
        rulesRef: [{ book: Rulebook.CO, page: 62 }, { book: Rulebook.ASCE, page: 117 }],
        validatorAS: (units: ForceUnit[]) => {
            const mediumUnits = units.filter(u => asGetSize(u.getUnit()) === 2);
            const hasLargeSize4 = units.some(u => asGetSize(u.getUnit()) >= 4);
            if (asIsOnlyCombatVehicles(units)) {
                if (countMatchedPairsFiltered(units, u => asGetSize(u.getUnit()) === 2) < 2) return false;
            }
            return mediumUnits.length >= Math.ceil(units.length * 0.5) && !hasLargeSize4;
        },
        validatorCBT: (units: ForceUnit[]) => {
            const mediumUnits = units.filter(u => cbtGetWeightClass(u.getUnit()) === 1);
            const hasAssault = units.some(u => cbtGetWeightClass(u.getUnit()) === 4);
            if (cbtIsOnlyCombatVehicles(units)) {
                if (countMatchedPairs(mediumUnits) < 2) return false;
            }
            return mediumUnits.length >= Math.ceil(units.length * 0.5) && !hasAssault;
        },
    },

    //
    // HEAVY BATTLE LANCE
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
        rulesRef: [{ book: Rulebook.CO, page: 63 }, { book: Rulebook.ASCE, page: 117 }],
        validatorAS: (units: ForceUnit[]) => {
            const largeUnits = units.filter(u => asGetSize(u.getUnit()) >= 3);
            const hasSmall = units.some(u => asGetSize(u.getUnit()) === 1);
            if (asIsOnlyCombatVehicles(units)) {
                if (countMatchedPairsFiltered(units, u => asGetSize(u.getUnit()) >= 3) < 2) return false;
            }
            return largeUnits.length >= Math.ceil(units.length * 0.5) && !hasSmall;
        },
        validatorCBT: (units: ForceUnit[]) => {
            const heavyOrLarger = units.filter(u => cbtGetWeightClass(u.getUnit()) >= 3);
            const hasLight = units.some(u => cbtGetWeightClass(u.getUnit()) === 0);
            if (cbtIsOnlyCombatVehicles(units)) {
                if (countMatchedPairs(heavyOrLarger) < 2) return false;
            }
            return heavyOrLarger.length >= Math.ceil(units.length * 0.5) && !hasLight;
        },
    },

    //
    // RIFLE LANCE (CBT only — exclusive to House Davion)
    // Bonus: Up to 2 units per turn get Sandblaster or Weapon Specialist.
    //
    {
        id: 'rifle-lance',
        name: 'Rifle',
        description: 'Davion autocannon specialists',
        effectDescription: 'At the beginning of each turn, up to two units in this formation may receive either the Sandblaster or Weapon Specialist SPA. The player may assign the same SPA to both units, or one Weapon Specialist and the other Sandblaster.',
        effectGroups: [{
            abilityIds: ['sandblaster', 'weapon_specialist'],
            selection: 'choose-each',
            distribution: 'fixed',
            count: 2,
            perTurn: true,
        }],
        exclusiveFaction: 'Federated Suns',
        rulesRef: [{ book: Rulebook.CO, page: 63 }],
        validatorAS: undefined,
        validatorCBT: (units: ForceUnit[]) => {
            if (units.length < 1) return false;
            const mediumOrHeavy = units.filter(u => {
                const weight = cbtGetWeightClass(u.getUnit());
                return weight === 1 || weight === 3;
            });
            const withAutocannon = units.filter(u => cbtHasAutocannon(u.getUnit()));
            const fastEnough = units.every(u => u.getUnit().walk >= 4);
            return mediumOrHeavy.length >= Math.ceil(units.length * 0.75) &&
                   withAutocannon.length >= Math.ceil(units.length * 0.5) &&
                   fastEnough;
        },
    },

    //
    // BERSERKER/CLOSE COMBAT LANCE
    // Requirements: As Battle Lance.
    // Bonus: 2 units receive Swordsman or Zweihander. Same ability for both.
    //
    {
        id: 'berserker-lance',
        name: 'Berserker/Close Combat',
        description: 'Close combat specialists for physical attacks',
        effectDescription: 'Two units in this formation receive the Swordsman or Zweihander SPA. The same ability must be assigned to both units.',
        effectGroups: [{
            abilityIds: ['swordsman', 'zweihander'],
            selection: 'choose-one',
            distribution: 'fixed',
            count: 2,
        }],
        minUnits: 4,
        rulesRef: [{ book: Rulebook.CO, page: 63 }],
        validatorAS: (units: ForceUnit[]) => {
            // Same as battle lance
            const largeUnits = units.filter(u => asGetSize(u.getUnit()) >= 3);
            if (asIsOnlyCombatVehicles(units)) {
                if (countMatchedPairs(largeUnits) < 2) return false;
            }
            const hasRequiredRoles = units.filter(u =>
                ['Brawler', 'Sniper', 'Skirmisher'].includes(u.getUnit().role));
            return largeUnits.length >= Math.ceil(units.length * 0.5) && hasRequiredRoles.length >= 3;
        },
        validatorCBT: (units: ForceUnit[]) => {
            const heavyOrLarger = units.filter(u => cbtGetWeightClass(u.getUnit()) >= 3);
            if (cbtIsOnlyCombatVehicles(units)) {
                if (countMatchedPairs(heavyOrLarger) < 2) return false;
            }
            const hasRequiredRoles = units.filter(u =>
                ['Brawler', 'Sniper', 'Skirmisher'].includes(u.getUnit().role));
            return heavyOrLarger.length >= Math.ceil(units.length * 0.5) && hasRequiredRoles.length >= 3;
        },
    },

    // ─── Command Lance ───────────────────────────────────────────────────
    //
    // Bonus: Two non-commander units get one free SPA each (Antagonizer,
    //   Blood Stalker, Combat Intuition, Eagle's Eyes, Marksman, Multi-Tasker).
    //   Commander gets Tactical Genius.
    //
    {
        id: 'command-lance',
        name: 'Command',
        description: 'Diverse formation built around force commander',
        effectDescription: 'Prior to the beginning of play, two of the non-commander units in this formation receive one of the following Special Pilot Abilities for free (each unit may receive a different SPA): Antagonizer, Combat Intuition, Blood Stalker, Eagle\'s Eyes, Marksman, or Multi-Tasker. In addition, the commander\'s unit receives the Tactical Genius SPA. If the commander already has the Tactical Genius SPA, instead add a +1 modifier to the force\'s Initiative roll results, including any rerolls made as a result of the Tactical Genius SPA.',
        effectGroups: [
            {
                abilityIds: ['antagonizer', 'blood_stalker', 'combat_intuition', 'eagles_eyes', 'marksman', 'multi_tasker'],
                selection: 'choose-each',
                distribution: 'fixed',
                count: 2,
            },
            {
                abilityIds: ['tactical_genius'],
                selection: 'all',
                distribution: 'commander',
            },
        ],
        minUnits: 4,
        rulesRef: [{ book: Rulebook.CO, page: 63 }, { book: Rulebook.ASCE, page: 120 }],
        validatorAS: (units: ForceUnit[]) => {
            const hasRequiredRoles = units.filter(u =>
                ['Sniper', 'Missile Boat', 'Skirmisher', 'Juggernaut'].includes(u.getUnit().role));
            const hasAdditionalRole = units.filter(u =>
                ['Brawler', 'Striker', 'Scout'].includes(u.getUnit().role));
            return hasRequiredRoles.length >= Math.ceil(units.length * 0.5) && hasAdditionalRole.length >= 1;
        },
        validatorCBT: (units: ForceUnit[]) => {
            const hasRequiredRoles = units.filter(u =>
                ['Sniper', 'Missile Boat', 'Skirmisher', 'Juggernaut'].includes(u.getUnit().role));
            const hasAdditionalRole = units.filter(u =>
                ['Brawler', 'Striker', 'Scout'].includes(u.getUnit().role));
            return hasRequiredRoles.length >= Math.ceil(units.length * 0.5) && hasAdditionalRole.length >= 1;
        },
    },

    //
    // ORDER LANCE (CBT only — exclusive to House Kurita)
    // Bonus: Commander gets Tactical Genius, Antagonizer or Sniper.
    //   All units get Iron Will or Speed Demon (same for all).
    //
    {
        id: 'order-lance',
        name: 'Order',
        description: 'Kurita synchronized formation of identical units',
        effectDescription: 'Designate one unit as the formation\'s commander; that unit receives the Tactical Genius, Antagonizer, or Sniper SPA. All units in the formation receive the Iron Will or Speed Demon SPA; the entire formation must select the same ability.',
        effectGroups: [
            {
                abilityIds: ['tactical_genius', 'antagonizer', 'sniper'],
                selection: 'choose-one',
                distribution: 'commander',
            },
            {
                abilityIds: ['iron_will', 'speed_demon'],
                selection: 'choose-one',
                distribution: 'all',
            },
        ],
        exclusiveFaction: 'Draconis Combine',
        minUnits: 4,
        rulesRef: [{ book: Rulebook.CO, page: 63 }],
        validatorAS: undefined,
        validatorCBT: (units: ForceUnit[]) => {
            const firstWeight = cbtGetWeightClass(units[0].getUnit());
            const sameWeight = units.every(u => cbtGetWeightClass(u.getUnit()) === firstWeight);
            const firstChassis = units[0].getUnit().chassis;
            const sameChassis = units.every(u => u.getUnit().chassis === firstChassis);
            return sameWeight && sameChassis;
        },
    },

    //
    // VEHICLE COMMAND LANCE
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
        rulesRef: [{ book: Rulebook.CO, page: 63 }, { book: Rulebook.ASCE, page: 120 }],
        validatorAS: (units: ForceUnit[]) => {
            if (!asIsOnlyCombatVehicles(units)) return false;
            const vehiclePairs = asFindIdenticalPairs(units);
            return vehiclePairs.some(pair =>
                pair.every(u =>
                    ['Sniper', 'Missile Boat', 'Skirmisher', 'Juggernaut'].includes(u.getUnit().role)));
        },
        validatorCBT: (units: ForceUnit[]) => {
            if (!cbtIsOnlyCombatVehicles(units)) return false;
            const vehiclePairs = findIdenticalVehiclePairs(units);
            return vehiclePairs.some(pair =>
                pair.every(u =>
                    ['Sniper', 'Missile Boat', 'Skirmisher', 'Juggernaut'].includes(u.getUnit().role)));
        },
    },

    // ─── Fire Lance ──────────────────────────────────────────────────────
    //
    // 75% Missile Boat or Sniper roles.
    // Bonus: Up to 2 units per turn get Sniper SPA.
    //
    {
        id: 'fire-lance',
        name: 'Fire',
        description: 'Long-range firepower specialists',
        effectDescription: 'At the beginning of each turn, up to two units in this formation may receive the Sniper SPA, which will affect their weapon attacks during that turn.',
        effectGroups: [{
            abilityIds: ['sniper'],
            selection: 'all',
            distribution: 'fixed',
            count: 2,
            perTurn: true,
        }],
        idealRole: 'Missile Boat',
        minUnits: 4,
        rulesRef: [{ book: Rulebook.CO, page: 64 }, { book: Rulebook.ASCE, page: 119 }],
        validatorAS: (units: ForceUnit[]) => {
            const hasRequiredRoles = units.filter(u =>
                ['Missile Boat', 'Sniper'].includes(u.getUnit().role));
            return hasRequiredRoles.length >= Math.ceil(units.length * 0.75);
        },
        validatorCBT: (units: ForceUnit[]) => {
            const hasRequiredRoles = units.filter(u =>
                ['Missile Boat', 'Sniper'].includes(u.getUnit().role));
            return hasRequiredRoles.length >= Math.ceil(units.length * 0.75);
        },
    },

    //
    // ANTI-AIR LANCE (variant of Fire Lance)
    // Bonus: Up to 2 units per turn get Anti-Aircraft Specialist SCA.
    //
    {
        id: 'anti-air-lance',
        parent: 'fire-lance',
        name: 'Anti-Air',
        description: 'Air defense specialists',
        effectDescription: 'At the beginning of each turn, up to two units in this formation may receive the Anti-Aircraft Specialist Special Command Ability. This will affect the weapon attacks made by the designated units during that turn.',
        effectGroups: [{
            commandAbilityIds: ['anti_aircraft_specialists'],
            selection: 'all',
            distribution: 'fixed',
            count: 2,
            perTurn: true,
        }],
        minUnits: 4,
        rulesRef: [{ book: Rulebook.CO, page: 64 }, { book: Rulebook.ASCE, page: 119 }],
        validatorAS: (units: ForceUnit[]) => {
            const qualifyingUnits = units.filter(u =>
                asHasSpecial(u.getUnit(), 'FLK') ||
                asHasSpecial(u.getUnit(), 'AC') ||
                asHasSpecial(u.getUnit(), 'ART'));
            return qualifyingUnits.length >= 2;
        },
        validatorCBT: (units: ForceUnit[]) => {
            const hasAntiAir = units.filter(u => cbtHasLBXAutocannon(u.getUnit()) ||
                cbtHasAutocannon(u.getUnit()));
            const hasArtillery = units.filter(u => cbtHasArtillery(u.getUnit()));
            const hasQuirk = units.filter(u => u.getUnit().quirks.includes('Anti-Aircraft Targeting'));
            return hasAntiAir.length >= 2 || hasArtillery.length >= 2 || hasQuirk.length >= 2;
        },
    },

    //
    // ARTILLERY FIRE LANCE
    // Bonus: Up to 2 units per turn get Oblique Artilleryman.
    //
    {
        id: 'artillery-fire-lance',
        name: 'Artillery Fire',
        description: 'Artillery support specialists',
        effectDescription: 'At the beginning of each turn, up to two units in this formation may receive the Oblique Artilleryman Special Pilot Ability, which will affect their artillery weapon attacks made during that turn.',
        effectGroups: [{
            abilityIds: ['oblique_artilleryman'],
            selection: 'all',
            distribution: 'fixed',
            count: 2,
            perTurn: true,
        }],
        minUnits: 4,
        rulesRef: [{ book: Rulebook.CO, page: 64 }, { book: Rulebook.ASCE, page: 119 }],
        validatorAS: (units: ForceUnit[]) => {
            return units.filter(u => asHasSpecial(u.getUnit(), 'ART')).length >= 2;
        },
        validatorCBT: (units: ForceUnit[]) => {
            return units.filter(u => cbtHasArtillery(u.getUnit())).length >= 2;
        },
    },

    //
    // DIRECT FIRE LANCE
    // Bonus: Up to 2 units per turn get Weapon Specialist.
    //
    {
        id: 'direct-fire-lance',
        name: 'Direct Fire',
        description: 'Direct fire heavy weapons',
        effectDescription: 'At the beginning of each turn, up to two units in this formation may receive the Weapon Specialist SPA. This ability will affect the weapon attacks made by the designated units during that turn.',
        effectGroups: [{
            abilityIds: ['weapon_specialist'],
            selection: 'all',
            distribution: 'fixed',
            count: 2,
            perTurn: true,
        }],
        minUnits: 4,
        rulesRef: [{ book: Rulebook.CO, page: 64 }, { book: Rulebook.ASCE, page: 119 }],
        validatorAS: (units: ForceUnit[]) => {
            const largeUnits = units.filter(u => asGetSize(u.getUnit()) >= 3);
            const allLongRange = units.every(u => (u.getUnit().as?.dmg?._dmgL ?? 0) >= 2);
            return largeUnits.length >= 2 && allLongRange;
        },
        validatorCBT: (units: ForceUnit[]) => {
            const heavyOrLarger = units.filter(u => cbtGetWeightClass(u.getUnit()) >= 3);
            const longRangeHighDamage = units.every(u => cbtCanDealDamage(u.getUnit(), 10, 18));
            return heavyOrLarger.length >= 2 && longRangeHighDamage;
        },
    },

    //
    // FIRE SUPPORT LANCE
    // Bonus: Up to 2 units per turn get Oblique Attacker.
    //
    {
        id: 'fire-support-lance',
        name: 'Fire Support',
        description: 'Indirect fire specialists',
        effectDescription: 'At the beginning of each turn, up to two units in this formation may receive the Oblique Attacker Special Pilot Ability, which will affect their indirect weapon attacks during that turn.',
        effectGroups: [{
            abilityIds: ['oblique_attacker'],
            selection: 'all',
            distribution: 'fixed',
            count: 2,
            perTurn: true,
        }],
        minUnits: 4,
        rulesRef: [{ book: Rulebook.CO, page: 64 }, { book: Rulebook.ASCE, page: 119 }],
        validatorAS: (units: ForceUnit[]) => {
            return units.filter(u => asHasSpecial(u.getUnit(), 'IF')).length >= 3;
        },
        validatorCBT: (units: ForceUnit[]) => {
            const indirectCapable = units.filter(u => cbtHasLRM(u.getUnit()) ||
                cbtHasArtillery(u.getUnit()));
            return indirectCapable.length >= 3;
        },
    },

    //
    // LIGHT FIRE LANCE
    // Bonus: Coordinated Fire Support — if a unit hits, others get -1 TN (cumulative, max -3).
    //
    {
        id: 'light-fire-lance',
        name: 'Light Fire',
        description: 'Light units with coordinated long-range fire',
        effectDescription: 'Coordinated Fire Support — If a unit in this formation hits a target with at least one of its weapons, other units in this formation making weapon attacks against the same target receive a -1 modifier to their attack rolls. This bonus is cumulative per attacking unit, up to a -3 To-Hit modifier.',
        minUnits: 4,
        rulesRef: [{ book: Rulebook.CO, page: 64 }, { book: Rulebook.ASCE, page: 119 }],
        validatorAS: (units: ForceUnit[]) => {
            const noLarge = units.every(u => asGetSize(u.getUnit()) < 3);
            const hasRequiredRoles = units.filter(u =>
                ['Missile Boat', 'Sniper'].includes(u.getUnit().role));
            return noLarge && hasRequiredRoles.length >= Math.ceil(units.length * 0.5);
        },
        validatorCBT: (units: ForceUnit[]) => {
            const noHeavy = units.every(u => cbtGetWeightClass(u.getUnit()) < 3);
            const hasRequiredRoles = units.filter(u =>
                ['Missile Boat', 'Sniper'].includes(u.getUnit().role));
            return noHeavy && hasRequiredRoles.length >= Math.ceil(units.length * 0.5);
        },
    },

    // ─── Clan Nova ───────────────────────────────────────────────────────
    //
    // 5 OmniMechs + 5 mechanized BA.
    // Bonus: Mounted infantry attacks with transport's movement modifier + 2 TN.
    //
    {
        id: 'nova',
        name: 'Nova',
        description: 'Clan OmniMech Star with mechanized battle armor',
        effectDescription: 'Mounted infantry may make weapon attacks using the transport\'s attacker movement modifier with an additional +2 TN modifier for being mounted.',
        techBase: 'Clan',
        rulesRef: [{ book: Rulebook.CO, page: 64 }, { book: Rulebook.ASCE, page: 121 }],
        validatorAS: (units: ForceUnit[]) => {
            if (units.length !== 10) return false;
            const mechs = units.filter(u => {
                const tp = u.getUnit().as?.TP;
                return tp === 'BM' || tp === 'IM';
            });
            const battleArmor = units.filter(u => u.getUnit().as?.TP === 'BA');
            if (mechs.length !== 5 || battleArmor.length !== 5) return false;
            return mechs.every(u => asHasSpecial(u.getUnit(), 'OMNI'));
        },
        validatorCBT: (units: ForceUnit[]) => {
            if (units.length !== 10) return false;
            const mechs = units.filter(u => u.getUnit().type === 'Mek');
            const battleArmor = units.filter(u => u.getUnit().subtype === 'Battle Armor');
            if (mechs.length !== 5 || battleArmor.length !== 5) return false;
            return mechs.every(u => u.getUnit().omni === 1);
        },
    },

    // ─── Pursuit Lance ───────────────────────────────────────────────────
    //
    // Bonus: 75% receive Blood Stalker. May target enemy Formation instead of unit.
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
        rulesRef: [{ book: Rulebook.CO, page: 65 }, { book: Rulebook.ASCE, page: 120 }],
        validatorAS: (units: ForceUnit[]) => {
            const allSmallOrMedium = units.every(u => asGetSize(u.getUnit()) <= 2);
            const fastUnits = units.filter(u => asGetAnyGroundOrJumpMove(u.getUnit()) >= 12);
            const hasMedRange = units.some(u => (u.getUnit().as?.dmg?._dmgM ?? 0) > 1);
            return allSmallOrMedium && fastUnits.length >= Math.ceil(units.length * 0.75) && hasMedRange;
        },
        validatorCBT: (units: ForceUnit[]) => {
            const lightOrMedium = units.every(u => cbtGetWeightClass(u.getUnit()) <= 1);
            const fastUnits = units.filter(u => u.getUnit().walk >= 6);
            const hasLongRange = units.some(u => cbtCanDealDamage(u.getUnit(), 5, 15));
            return lightOrMedium && fastUnits.length >= Math.ceil(units.length * 0.75) && hasLongRange;
        },
    },

    //
    // PROBE LANCE
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
        rulesRef: [{ book: Rulebook.CO, page: 65 }, { book: Rulebook.ASCE, page: 120 }],
        validatorAS: (units: ForceUnit[]) => {
            const allNotHuge = units.every(u => asGetSize(u.getUnit()) <= 3);
            const fastUnits = units.filter(u => asGetAnyGroundOrJumpMove(u.getUnit()) >= 10);
            const allMedDmg = units.every(u => (u.getUnit().as?.dmg?._dmgM ?? 0) >= 2);
            return allNotHuge && fastUnits.length >= Math.ceil(units.length * 0.75) && allMedDmg;
        },
        validatorCBT: (units: ForceUnit[]) => {
            const noAssault = units.every(u => cbtGetWeightClass(u.getUnit()) < 4);
            const fastUnits = units.filter(u => u.getUnit().walk >= 6);
            const hasDamage = units.every(u => cbtCanDealDamage(u.getUnit(), 10, 9));
            return noAssault && fastUnits.length >= Math.ceil(units.length * 0.75) && hasDamage;
        },
    },

    //
    // SWEEP LANCE
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
        rulesRef: [{ book: Rulebook.CO, page: 65 }, { book: Rulebook.ASCE, page: 120 }],
        validatorAS: (units: ForceUnit[]) => {
            const allSmallOrMedium = units.every(u => asGetSize(u.getUnit()) <= 2);
            const allFast = units.every(u => asGetAnyGroundOrJumpMove(u.getUnit()) >= 10);
            const allShortDmg = units.every(u => (u.getUnit().as?.dmg?._dmgS ?? 0) >= 2);
            return allSmallOrMedium && allFast && allShortDmg;
        },
        validatorCBT: (units: ForceUnit[]) => {
            const lightOrMedium = units.every(u => cbtGetWeightClass(u.getUnit()) <= 1);
            const fastUnits = units.every(u => u.getUnit().walk >= 5);
            const hasDamage = units.every(u => cbtCanDealDamage(u.getUnit(), 10, 6));
            return lightOrMedium && fastUnits && hasDamage;
        },
    },

    // ─── Recon Lance ─────────────────────────────────────────────────────
    //
    // Bonus: Choose Eagle's Eyes or Maneuvering Ace → up to 3 units.
    //   All units also receive Forward Observer.
    //
    {
        id: 'recon-lance',
        name: 'Recon',
        description: 'Fast reconnaissance specialists',
        effectDescription: 'At the beginning of play, choose either Eagle\'s Eyes or Maneuvering Ace SPA and apply it to up to three units in this formation. The chosen ability cannot be switched between units or changed during the scenario. In addition, all units in this formation receive the Forward Observer SPA.',
        effectGroups: [
            {
                abilityIds: ['eagles_eyes', 'maneuvering_ace'],
                selection: 'choose-one',
                distribution: 'fixed',
                count: 3,
            },
            {
                abilityIds: ['forward_observer'],
                selection: 'all',
                distribution: 'all',
            },
        ],
        idealRole: 'Scout',
        minUnits: 4,
        rulesRef: [{ book: Rulebook.CO, page: 65 }, { book: Rulebook.ASCE, page: 119 }],
        validatorAS: (units: ForceUnit[]) => {
            const allFast = units.every(u => asGetAnyGroundOrJumpMove(u.getUnit()) >= 10);
            const scoutOrStriker = units.filter(u =>
                u.getUnit().role === 'Scout' || u.getUnit().role === 'Striker');
            return allFast && scoutOrStriker.length >= 2;
        },
        validatorCBT: (units: ForceUnit[]) => {
            const fastUnits = units.every(u => u.getUnit().walk >= 5);
            const scoutOrStriker = units.filter(u =>
                u.getUnit().role === 'Scout' || u.getUnit().role === 'Striker');
            return fastUnits && scoutOrStriker.length >= 2;
        },
    },

    //
    // HEAVY RECON LANCE
    //
    {
        id: 'heavy-recon-lance',
        name: 'Heavy Recon',
        description: 'Armored reconnaissance formation',
        effectDescription: 'As per the standard Recon Lance, except that only two units in this formation may receive the chosen SPA. All units in this formation still receive the Forward Observer SPA.',
        effectGroups: [
            {
                abilityIds: ['eagles_eyes', 'maneuvering_ace'],
                selection: 'choose-one',
                distribution: 'fixed',
                count: 2,
            },
            {
                abilityIds: ['forward_observer'],
                selection: 'all',
                distribution: 'all',
            },
        ],
        minUnits: 4,
        rulesRef: [{ book: Rulebook.CO, page: 66 }, { book: Rulebook.ASCE, page: 119 }],
        validatorAS: (units: ForceUnit[]) => {
            const allFast = units.every(u => asGetAnyGroundOrJumpMove(u.getUnit()) >= 8);
            const veryFast = units.filter(u => asGetAnyGroundOrJumpMove(u.getUnit()) >= 10);
            const hasLarge = units.some(u => asGetSize(u.getUnit()) >= 3);
            const scoutUnits = units.filter(u => u.getUnit().role === 'Scout');
            return allFast && veryFast.length >= 2 && hasLarge && scoutUnits.length >= 2;
        },
        validatorCBT: (units: ForceUnit[]) => {
            const fastUnits = units.every(u => u.getUnit().walk >= 4);
            const veryFast = units.filter(u => u.getUnit().walk >= 5);
            const hasHeavyOrAssault = units.some(u => cbtGetWeightClass(u.getUnit()) >= 3);
            const scoutUnits = units.filter(u => u.getUnit().role === 'Scout');
            return fastUnits && veryFast.length >= 2 && hasHeavyOrAssault && scoutUnits.length >= 2;
        },
    },

    //
    // LIGHT RECON LANCE
    //
    {
        id: 'light-recon-lance',
        name: 'Light Recon',
        description: 'Ultra-fast light reconnaissance',
        effectDescription: 'As per the standard Recon Lance, except all units in this formation receive the chosen SPA, in addition to the Forward Observer SPA.',
        effectGroups: [
            {
                abilityIds: ['eagles_eyes', 'maneuvering_ace'],
                selection: 'choose-one',
                distribution: 'all',
            },
            {
                abilityIds: ['forward_observer'],
                selection: 'all',
                distribution: 'all',
            },
        ],
        minUnits: 4,
        rulesRef: [{ book: Rulebook.CO, page: 66 }, { book: Rulebook.ASCE, page: 119 }],
        validatorAS: (units: ForceUnit[]) => {
            const allSmall = units.every(u => asGetSize(u.getUnit()) === 1);
            const allVeryFast = units.every(u => asGetAnyGroundOrJumpMove(u.getUnit()) >= 12);
            const allScouts = units.every(u => u.getUnit().role === 'Scout');
            return allSmall && allVeryFast && allScouts;
        },
        validatorCBT: (units: ForceUnit[]) => {
            const allLight = units.every(u => cbtGetWeightClass(u.getUnit()) === 0);
            const veryFast = units.every(u => u.getUnit().walk >= 6);
            const allScouts = units.every(u => u.getUnit().role === 'Scout');
            return allLight && veryFast && allScouts;
        },
    },

    // ─── Security Lance ─────────────────────────────────────────────────
    //
    // Bonus: If Defender, 75% get Environmental Specialist or Terrain Master.
    //   If not Defender, 75% get Speed Demon.
    //
    {
        id: 'security-lance',
        name: 'Security',
        description: 'Installation defense specialists',
        effectDescription: 'If acting as the Defender in a scenario, at the beginning of play 75% of the units are assigned Environmental Specialist or Terrain Master SPA of their choice; the same variation must be chosen for each unit. If not acting as the Defender, 75% are assigned the Speed Demon SPA at the beginning of play.',
        effectGroups: [{
            abilityIds: ['environmental_specialist', 'terrain_master', 'speed_demon'],
            selection: 'choose-one',
            distribution: 'percent-75',
        }],
        minUnits: 4,
        rulesRef: [{ book: Rulebook.CO, page: 65 }],
        validatorAS: (units: ForceUnit[]) => {
            const hasScoutOrStriker = units.some(u =>
                u.getUnit().role === 'Scout' || u.getUnit().role === 'Striker');
            const hasSniperOrMissileBoat = units.some(u =>
                u.getUnit().role === 'Sniper' || u.getUnit().role === 'Missile Boat');
            const assaultCount = units.filter(u => asGetSize(u.getUnit()) >= 4).length;
            return assaultCount <= 1 && hasScoutOrStriker && hasSniperOrMissileBoat;
        },
        validatorCBT: (units: ForceUnit[]) => {
            const hasScoutOrStriker = units.some(u =>
                u.getUnit().role === 'Scout' || u.getUnit().role === 'Striker');
            const hasSniperOrMissileBoat = units.some(u =>
                u.getUnit().role === 'Sniper' || u.getUnit().role === 'Missile Boat');
            const assaultCount = units.filter(u => cbtGetWeightClass(u.getUnit()) === 4).length;
            return assaultCount <= 1 && hasScoutOrStriker && hasSniperOrMissileBoat;
        },
    },

    // ─── Striker / Cavalry Lance ─────────────────────────────────────────
    //
    // Bonus: 75% receive Speed Demon.
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
        rulesRef: [{ book: Rulebook.CO, page: 66 }, { book: Rulebook.ASCE, page: 118 }],
        validatorAS: (units: ForceUnit[]) => {
            const allFast = units.every(u => {
                const groundMove = asGetMaxGroundMove(u.getUnit());
                const jumpMove = asGetJumpMove(u.getUnit());
                return groundMove >= 10 || jumpMove >= 8;
            });
            const noSize4 = units.every(u => asGetSize(u.getUnit()) < 4);
            const hasRequiredRoles = units.filter(u =>
                u.getUnit().role === 'Striker' || u.getUnit().role === 'Skirmisher');
            return allFast && noSize4 && hasRequiredRoles.length >= Math.ceil(units.length * 0.5);
        },
        validatorCBT: (units: ForceUnit[]) => {
            const fastUnits = units.every(u => u.getUnit().walk >= 5 || u.getUnit().jump >= 4);
            const noAssault = units.every(u => cbtGetWeightClass(u.getUnit()) < 4);
            const hasRequiredRoles = units.filter(u =>
                u.getUnit().role === 'Striker' || u.getUnit().role === 'Skirmisher');
            return noAssault && fastUnits && hasRequiredRoles.length >= Math.ceil(units.length * 0.5);
        },
    },

    //
    // HAMMER LANCE (CBT only — exclusive to House Marik)
    // Bonus: Up to 2 units per turn get Jumping Jack or Speed Demon.
    //
    {
        id: 'hammer-lance',
        name: 'Hammer',
        description: 'Marik fast flanking force',
        effectDescription: 'At the beginning of each turn, up to two Hammer Lance units may receive either the Jumping Jack or Speed Demon SPA. The player may assign the same SPA to both units, or one may receive Jumping Jack and the other Speed Demon.',
        effectGroups: [{
            abilityIds: ['jumping_jack', 'speed_demon'],
            selection: 'choose-each',
            distribution: 'fixed',
            count: 2,
            perTurn: true,
        }],
        exclusiveFaction: 'Free Worlds League',
        idealRole: 'Striker',
        minUnits: 4,
        rulesRef: [{ book: Rulebook.CO, page: 66 }],
        validatorAS: undefined,
        validatorCBT: (units: ForceUnit[]) => {
            return units.every(u => u.getUnit().walk >= 5);
        },
    },

    //
    // LIGHT STRIKER/CAVALRY LANCE
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
        rulesRef: [{ book: Rulebook.CO, page: 67 }, { book: Rulebook.ASCE, page: 118 }],
        validatorAS: (units: ForceUnit[]) => {
            const allFast = units.every(u => asGetAnyGroundOrJumpMove(u.getUnit()) >= 10);
            const noSize3 = units.every(u => asGetSize(u.getUnit()) < 3);
            const hasLongRange = units.filter(u => (u.getUnit().as?.dmg?._dmgL ?? 0) > 0);
            const hasRequiredRoles = units.filter(u =>
                u.getUnit().role === 'Striker' || u.getUnit().role === 'Skirmisher');
            return allFast && noSize3 && hasLongRange.length >= 2 && hasRequiredRoles.length >= 2;
        },
        validatorCBT: (units: ForceUnit[]) => {
            const fastUnits = units.every(u => u.getUnit().walk >= 5);
            const noHeavy = units.every(u => cbtGetWeightClass(u.getUnit()) < 3);
            const hasLongRange = units.filter(u => cbtCanDealDamage(u.getUnit(), 5, 18));
            const hasRequiredRoles = units.filter(u =>
                u.getUnit().role === 'Striker' || u.getUnit().role === 'Skirmisher');
            return fastUnits && noHeavy && hasLongRange.length >= 2 && hasRequiredRoles.length >= 2;
        },
    },

    //
    // HEAVY STRIKER/CAVALRY LANCE
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
        rulesRef: [{ book: Rulebook.CO, page: 66 }, { book: Rulebook.ASCE, page: 118 }],
        validatorAS: (units: ForceUnit[]) => {
            const allFast = units.every(u => asGetAnyGroundOrJumpMove(u.getUnit()) >= 8);
            const largeUnits = units.filter(u => asGetSize(u.getUnit()) >= 3);
            const noSmall = units.every(u => asGetSize(u.getUnit()) >= 2);
            const hasLongRange = units.some(u => (u.getUnit().as?.dmg?._dmgL ?? 0) > 1);
            const hasRequiredRoles = units.filter(u =>
                u.getUnit().role === 'Striker' || u.getUnit().role === 'Skirmisher');
            return allFast && largeUnits.length >= 3 && noSmall && hasLongRange && hasRequiredRoles.length >= 2;
        },
        validatorCBT: (units: ForceUnit[]) => {
            const fastUnits = units.every(u => u.getUnit().walk >= 4);
            const heavyOrLarger = units.filter(u => cbtGetWeightClass(u.getUnit()) >= 3);
            const noLight = units.every(u => cbtGetWeightClass(u.getUnit()) > 0);
            const hasLongRange = units.some(u => cbtCanDealDamage(u.getUnit(), 5, 18));
            const hasRequiredRoles = units.filter(u =>
                u.getUnit().role === 'Striker' || u.getUnit().role === 'Skirmisher');
            return fastUnits && heavyOrLarger.length >= 3 && noLight && hasLongRange && hasRequiredRoles.length >= 2;
        },
    },

    //
    // HORDE (CBT only)
    // Bonus: Swarm — when targeted, may switch target to another unit in formation.
    //
    {
        id: 'horde',
        name: 'Horde',
        description: 'Mass light unit swarm tactics',
        effectDescription: 'Swarm — When any unit in this formation is targeted by an enemy attack, that unit\'s player may switch the target to any other unit in this formation that is still a legal target (within line of sight) and at the same range or less from the attacker. This ability can only be used by units which spent Running, Jumping, or Flank movement points that turn.',
        minUnits: 5,
        rulesRef: [{ book: Rulebook.CO, page: 67 }],
        validatorAS: undefined,
        validatorCBT: (units: ForceUnit[]) => {
            if (units.length < 5 || units.length > 10) return false;
            const allLight = units.every(u => cbtGetWeightClass(u.getUnit()) === 0);
            const lowDamage = units.every(u => !cbtCanDealDamage(u.getUnit(), 11, 9));
            return allLight && lowDamage;
        },
    },

    //
    // RANGER LANCE
    // Bonus: 75% receive one Terrain Master SPA (same variation for all).
    //
    {
        id: 'ranger-lance',
        name: 'Ranger',
        description: 'Terrain warfare specialists',
        effectDescription: 'At the beginning of play, 75% of the units in this formation receive one Terrain Master SPA. The same Terrain Master variation must be assigned to these units.',
        effectGroups: [{
            abilityIds: ['terrain_master'],
            selection: 'choose-one',
            distribution: 'percent-75',
        }],
        idealRole: 'Skirmisher',
        minUnits: 4,
        rulesRef: [{ book: Rulebook.CO, page: 67 }],
        validatorAS: (units: ForceUnit[]) => {
            return units.every(u => asGetSize(u.getUnit()) < 4);
        },
        validatorCBT: (units: ForceUnit[]) => {
            return units.every(u => cbtGetWeightClass(u.getUnit()) < 4);
        },
    },

    // ─── Support Lance ───────────────────────────────────────────────────
    {
        id: 'support-lance',
        name: 'Support',
        description: 'Multi-role formation backing other units',
        effectDescription: 'Before play, designate one other formation to support. Half the units (round down) receive the same SPAs as the supported formation. SPA count may not exceed the supported formation\'s count.',
        rulesRef: [{ book: Rulebook.CO, page: 66 }, { book: Rulebook.ASCE, page: 121 }],
        validatorAS: (units: ForceUnit[]) => {
            return units.length >= 3;
        },
        validatorCBT: (units: ForceUnit[]) => {
            return units.length >= 3;
        },
    },

    // ─── Urban Combat Lance ──────────────────────────────────────────────
    //
    // Bonus: Up to 75% per turn get Street Fighter (Mech/PM) or Urban Guerrilla (infantry).
    //   Vehicles get 1-point Luck + one-time Marksman.
    //
    {
        id: 'urban-lance',
        name: 'Urban Combat',
        description: 'City fighting specialists',
        effectDescription: 'At the beginning of each turn, up to 75% of the units may receive the Street Fighter (if \'Mech or ProtoMech) or Urban Guerrilla (if infantry) SPAs. Vehicles receive the equivalent of 1-point of Luck and a one-time use of the Marksman SPA.',
        effectGroups: [{
            abilityIds: ['street_fighter', 'urban_guerrilla', 'lucky', 'marksman'],
            selection: 'choose-each',
            distribution: 'percent-75',
            perTurn: true,
        }],
        idealRole: 'Ambusher',
        minUnits: 4,
        rulesRef: [{ book: Rulebook.CO, page: 67 }],
        validatorAS: (units: ForceUnit[]) => {
            const jumpOrInfantry = units.filter(u =>
                asGetJumpMove(u.getUnit()) > 0 || asIsInfantry(u.getUnit()));
            const slowUnits = units.filter(u => asGetMaxGroundMove(u.getUnit()) <= 8);
            return jumpOrInfantry.length >= Math.ceil(units.length * 0.5) &&
                   slowUnits.length >= Math.ceil(units.length * 0.5);
        },
        validatorCBT: (units: ForceUnit[]) => {
            const jumpOrInfantry = units.filter(u =>
                u.getUnit().jump > 0 || u.getUnit().type === 'Infantry');
            const slowUnits = units.filter(u => u.getUnit().walk <= 4);
            return jumpOrInfantry.length >= Math.ceil(units.length * 0.5) &&
                   slowUnits.length >= Math.ceil(units.length * 0.5);
        },
    },

    // ─── Aerospace Formations ────────────────────────────────────────────

    //
    // INTERCEPTOR SQUADRON
    // Bonus: Units with Thrust ≤ 9 get Speed Demon. Up to 2 get Range Master (Long).
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
        rulesRef: [{ book: Rulebook.CO, page: 68 }, { book: Rulebook.ASCE, page: 122 }],
        validatorAS: (units: ForceUnit[]) => {
            if (!units.every(u => asIsAeroUnit(u.getUnit()))) return false;
            const hasInterceptorRole = units.filter(u => u.getUnit().role === 'Interceptor');
            return hasInterceptorRole.length > Math.ceil(units.length * 0.5);
        },
        validatorCBT: (units: ForceUnit[]) => {
            if (!units.every(u => u.getUnit().type === 'Aero')) return false;
            const hasInterceptorRole = units.filter(u => u.getUnit().role === 'Interceptor');
            return hasInterceptorRole.length > Math.ceil(units.length * 0.5);
        },
    },

    //
    // AEROSPACE SUPERIORITY SQUADRON
    // Bonus: Up to 50% get up to 2 SPAs: Blood Stalker, Ride the Wash, Hot Dog.
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
        rulesRef: [{ book: Rulebook.CO, page: 67 }, { book: Rulebook.ASCE, page: 122 }],
        validatorAS: (units: ForceUnit[]) => {
            if (!units.every(u => asIsAeroUnit(u.getUnit()))) return false;
            const interceptorOrDogfighter = units.filter(u =>
                u.getUnit().role === 'Interceptor' || u.getUnit().role === 'Fast Dogfighter');
            return interceptorOrDogfighter.length > Math.ceil(units.length * 0.5);
        },
        validatorCBT: (units: ForceUnit[]) => {
            if (!units.every(u => u.getUnit().type === 'Aero')) return false;
            const interceptorOrDogfighter = units.filter(u =>
                u.getUnit().role === 'Interceptor' || u.getUnit().role === 'Fast Dogfighter');
            return interceptorOrDogfighter.length > Math.ceil(units.length * 0.5);
        },
    },

    //
    // FIRE SUPPORT SQUADRON
    // Bonus: Choose 2 pairs; each pair gets one SPA: Golden Goose, Ground Hugger,
    //   Hot Dog, or Shaky Stick. The two pairs may not receive the same SPA.
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
        rulesRef: [{ book: Rulebook.CO, page: 68 }, { book: Rulebook.ASCE, page: 122 }],
        validatorAS: (units: ForceUnit[]) => {
            if (!units.every(u => asIsAeroUnit(u.getUnit()))) return false;
            const hasFireSupport = units.filter(u => u.getUnit().role === 'Fire Support');
            const hasDogfighter = units.some(u => u.getUnit().role?.includes('Dogfighter'));
            return hasFireSupport.length >= Math.ceil(units.length * 0.5) && hasDogfighter;
        },
        validatorCBT: (units: ForceUnit[]) => {
            if (!units.every(u => u.getUnit().type === 'Aero')) return false;
            const hasFireSupport = units.filter(u => u.getUnit().role === 'Fire Support');
            const hasDogfighter = units.some(u => u.getUnit().role?.includes('Dogfighter'));
            return hasFireSupport.length >= Math.ceil(units.length * 0.5) && hasDogfighter;
        },
    },

    //
    // STRIKE SQUADRON
    // Bonus: Up to 50% get Speed Demon. Remainder get Golden Goose.
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
        rulesRef: [{ book: Rulebook.CO, page: 68 }, { book: Rulebook.ASCE, page: 122 }],
        validatorAS: (units: ForceUnit[]) => {
            if (!units.every(u => asIsAeroUnit(u.getUnit()))) return false;
            const attackOrDogfighter = units.filter(u =>
                u.getUnit().role?.includes('Attack') || u.getUnit().role?.includes('Dogfighter'));
            return attackOrDogfighter.length > Math.ceil(units.length * 0.5);
        },
        validatorCBT: (units: ForceUnit[]) => {
            if (!units.every(u => u.getUnit().type === 'Aero')) return false;
            const attackOrDogfighter = units.filter(u =>
                u.getUnit().role?.includes('Attack') || u.getUnit().role?.includes('Dogfighter'));
            return attackOrDogfighter.length > Math.ceil(units.length * 0.5);
        },
    },

    //
    // ELECTRONIC WARFARE SQUADRON
    // Bonus: Communications Disruption SCA.
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
        rulesRef: [{ book: Rulebook.CO, page: 67 }, { book: Rulebook.ASCE, page: 122 }],
        validatorAS: (units: ForceUnit[]) => {
            if (!units.every(u => asIsAeroUnit(u.getUnit()))) return false;
            const EW_SPECIALS = ['PRB', 'AECM', 'BH', 'ECM', 'LPRB', 'LECM', 'LTAG', 'TAG', 'WAT'];
            const hasEW = units.filter(u =>
                EW_SPECIALS.some(prefix => asHasSpecial(u.getUnit(), prefix)));
            return hasEW.length > Math.ceil(units.length * 0.5);
        },
        validatorCBT: (units: ForceUnit[]) => {
            if (!units.every(u => u.getUnit().type === 'Aero')) return false;
            const hasEWEquipment = units.filter(u => {
                const eqNames = u.getUnit().comp?.map(c => c.n) || [];
                return eqNames.some(name => [
                    'Beagle Probe', 'Active Probe', 'Angel ECM', 'Guardian ECM',
                    'ECM Suite', 'Bloodhound Probe', 'Light Probe', 'Light ECM',
                    'TAG', 'Light TAG', 'Watchdog'
                ].includes(name));
            });
            return hasEWEquipment.length > Math.ceil(units.length * 0.5);
        },
    },

    //
    // TRANSPORT SQUADRON
    // Bonus: Choose one SPA for all Transport-role units: Dust-Off, Ride the Wash, Wind Walker.
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
        rulesRef: [{ book: Rulebook.CO, page: 68 }, { book: Rulebook.ASCE, page: 123 }],
        validatorAS: (units: ForceUnit[]) => {
            const allowedTypes: ASUnitTypeCode[] = ['AF', 'CF', 'SC', 'DS', 'SV', 'DA'];
            if (!units.every(u => allowedTypes.includes(u.getUnit().as?.TP as ASUnitTypeCode))) return false;
            const hasTransportRole = units.filter(u => u.getUnit().role?.includes('Transport'));
            return hasTransportRole.length >= Math.ceil(units.length * 0.5);
        },
        validatorCBT: (units: ForceUnit[]) => {
            if (!units.every(u => u.getUnit().type === 'Aero')) return false;
            const hasTransportRole = units.filter(u => u.getUnit().role && u.getUnit().role.includes('Transport'));
            return hasTransportRole.length >= Math.ceil(units.length * 0.5);
        },
    },
];
