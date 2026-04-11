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

import type { ForceUnit } from '../models/force-unit.model';
import { CBT_WEIGHT_CLASS_ORDINALS, type Unit, type ASUnitTypeCode } from '../models/units.model';
import type { FormationTypeDefinition } from './formation-type.model';
import { GameSystem, Rulebook } from '../models/common.model';
import { isClan } from './org/org-registry.util';
import { CBTForceUnit } from '../models/cbt-force-unit.model';
import { ASForceUnit } from '../models/as-force-unit.model';

/*
 * Author: Drake
 *
 * Unified formation definitions for both Alpha Strike and Classic BattleTech.
 * Each definition carries a `validator(units, gameSystem)` that branches
 * internally when the two systems differ, plus dual rulebook references.
 * Shared metadata (id, name, description, effectDescription, effectGroups,
 * idealRole, …) is defined once.
 */

// ── AS helper functions ──────────────────────────────────────────────────────

const isAS = GameSystem.ALPHA_STRIKE;
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

function isClanForce(units: ForceUnit[]): boolean {
    const faction = units[0].force.faction();
    if (!faction) return false;
    return isClan(faction);
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

// ── CBT helper functions ─────────────────────────────────────────────────────

function cbtGetWeightClass(unit: Unit): number {
    return CBT_WEIGHT_CLASS_ORDINALS.get(unit.weightClass) ?? -1;
}

const CBT_LIGHT_WEIGHT_CLASS = CBT_WEIGHT_CLASS_ORDINALS.get('Light') ?? 1;
const CBT_MEDIUM_WEIGHT_CLASS = CBT_WEIGHT_CLASS_ORDINALS.get('Medium') ?? 2;
const CBT_HEAVY_WEIGHT_CLASS = CBT_WEIGHT_CLASS_ORDINALS.get('Heavy') ?? 3;
const CBT_ASSAULT_WEIGHT_CLASS = CBT_WEIGHT_CLASS_ORDINALS.get('Assault') ?? 4;

function cbtIsLightWeight(unit: Unit): boolean {
    return cbtGetWeightClass(unit) === CBT_LIGHT_WEIGHT_CLASS;
}

function cbtIsMediumWeight(unit: Unit): boolean {
    return cbtGetWeightClass(unit) === CBT_MEDIUM_WEIGHT_CLASS;
}

function cbtIsMediumOrLarger(unit: Unit): boolean {
    return cbtGetWeightClass(unit) >= CBT_MEDIUM_WEIGHT_CLASS;
}

function cbtIsLightOrMedium(unit: Unit): boolean {
    return cbtGetWeightClass(unit) <= CBT_MEDIUM_WEIGHT_CLASS;
}

function cbtIsHeavyOrLarger(unit: Unit): boolean {
    return cbtGetWeightClass(unit) >= CBT_HEAVY_WEIGHT_CLASS;
}

function cbtIsAssaultOrLarger(unit: Unit): boolean {
    return cbtGetWeightClass(unit) >= CBT_ASSAULT_WEIGHT_CLASS;
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

// Matches both AC and LB-X
function cbtHasAutocannon(unit: Unit): boolean {
    return unit.comp?.some(c => c.n?.includes('AC/') || c.n?.includes('LB ') || c.n?.includes('LB-')) || false;
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
    //     minUnits: 3,
    //     rulesRef: [{ book: Rulebook.CO, page: 61 }, { book: Rulebook.ASCE, page: 121 }],
    //     ...
    // },

    // ─── Anti-'Mech Lance ────────────────────────────────────────────────
    //
    // Requirements: All units must be infantry.
    // Bonus Ability: Distracting Swarm: units swarming an enemy cause +1 TN modifier.
    //
    {
        id: 'anti-mech-lance',
        name: 'Anti-\'Mech',
        description: 'All infantry units for urban and anti-mech warfare',
        effectDescription: 'Distracting Swarm: units in this formation swarming an enemy unit cause a +1 To-Hit modifier to any weapon attacks made by the enemy unit.',
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 61 }],
        requirements: () => {
            const infantry = isAS ? 'infantry (CI, BA, or PM)' : 'Infantry';
            return `Minimum 3 units. All units must be ${infantry}.`;
        },
        validator: (units) => {
            return units.every(u => isAS ? asIsInfantry(u.getUnit()) : u.getUnit().type === 'Infantry');
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
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 61 }, { book: Rulebook.ASCE, page: 118 }],
        requirements: () => {
            const heavyOrAssault = isAS ? 'Size 3+' : 'heavy or assault';
            const light = isAS ? 'Size 1' : 'light';
            const armor = isAS ? '5' : '135 points';
            const mediumRange = isAS ? 'have medium-range damage ≥ 3' : 'deal 25+ damage at 7 hexes';
            return `Minimum 3 units. At least 3 ${heavyOrAssault}. No ${light} units. All armor ≥ ${armor}. 75% must ${mediumRange}. At least 1 Juggernaut or 2 Snipers.`;
        },
        validator: (units) => {
            const heavyUnits = units.filter(u => isAS
                ? asGetSize(u.getUnit()) >= 3
                : cbtIsHeavyOrLarger(u.getUnit()));
            const hasLight = units.some(u => isAS
                ? asGetSize(u.getUnit()) === 1
                : cbtIsLightWeight(u.getUnit()));
            if (heavyUnits.length < 3 || hasLight) return false;
            if (isAS) {
                const hasEnoughArmor = units.every(u => (u.getUnit().as?.Arm ?? 0) >= 5);
                const highMedDmg = units.filter(u => (u.getUnit().as?.dmg?._dmgM ?? 0) >= 3);
                if (!hasEnoughArmor || highMedDmg.length < Math.ceil(units.length * 0.75)) return false;
            } else {
                const hasEnoughArmor = units.every(u => u.getUnit().armor >= 135);
                const highDamage = units.filter(u => cbtCanDealDamage(u.getUnit(), 25, 7));
                if (!hasEnoughArmor || highDamage.length < Math.ceil(units.length * 0.75)) return false;
            }
            const hasJuggernaut = units.some(u => u.getUnit().role === 'Juggernaut');
            const sniperCount = units.filter(u => u.getUnit().role === 'Sniper').length;
            return hasJuggernaut || sniperCount >= 2;
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
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 62 }],
        requirements: () => {
            const mediumOrHeavier = isAS ? 'Size 2+' : 'medium or heavier';
            const equipment = isAS ? '4. 50% must have AC, FLK, LRM, or SRM specials' : '105 points. 50% must have autocannons, LRMs, or SRMs';
            return `Minimum 3 units. Free Worlds League only. All ${mediumOrHeavier}. All armor ≥ ${equipment}.`;
        },
        validator: (units) => {
            if (isAS) {
            const allMediumOrLarger = units.every(u => asGetSize(u.getUnit()) >= 2);
            const hasEnoughArmor = units.every(u => (u.getUnit().as?.Arm ?? 0) >= 4);
            const hasWeapons = units.filter(u =>
                asHasSpecial(u.getUnit(), 'AC') ||
                asHasSpecial(u.getUnit(), 'FLK') ||
                asHasSpecial(u.getUnit(), 'LRM') ||
                asHasSpecial(u.getUnit(), 'SRM'));
            return allMediumOrLarger && hasEnoughArmor && hasWeapons.length >= Math.ceil(units.length * 0.5);
            } else {
                const allMediumOrLarger = units.every(u => cbtIsMediumOrLarger(u.getUnit()));
                const hasEnoughArmor = units.every(u => u.getUnit().armor >= 105);
                const hasWeapons = units.filter(u =>
                    cbtHasAutocannon(u.getUnit()) ||
                    cbtHasLRM(u.getUnit()) ||
                    cbtHasSRM(u.getUnit()));
                return allMediumOrLarger && hasEnoughArmor && hasWeapons.length >= Math.ceil(units.length * 0.5);
            }
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
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 62 }, { book: Rulebook.ASCE, page: 118 }],
        requirements: () => {
            const move = isAS ? 'Move 10" or any jump capability' : 'walk ≥ 5 or jump > 0';
//            const move = isAS ? `Move ${isHex ? '5 hexes' : '10"'} or any jump capability` : 'walk ≥ 5 or jump > 0';
            return `Minimum 3 units. Must meet Assault Lance requirements. All units must have ${move}.`;
        },
        validator: (units) => {
            if (isAS) {
                return units.every(u => {
                    const groundMove = asGetMaxGroundMove(u.getUnit());
                    const jumpMove = asGetJumpMove(u.getUnit());
                    return groundMove >= 10 || jumpMove > 0;
                });
            } else {
                return units.every(u => u.getUnit().walk >= 5 || u.getUnit().jump > 0);
            }
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
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 62 }],
        requirements: () => 'Minimum 3 units. At least 50% must have the Ambusher or Juggernaut role.',
        validator: (units) => {
            const count = units.filter(u => u.getUnit().role === 'Ambusher' || u.getUnit().role === 'Juggernaut');
            return count.length >= Math.ceil(units.length * 0.5);
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
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 62 }, { book: Rulebook.ASCE, page: 117 }],
        requirements: () => {
            const heavyOrHeavier = isAS ? 'Size 3+' : 'heavy or assault';
            const heavy = isAS ? 'Size 3' : 'heavy';
            return `Minimum 3 units. 50% must be ${heavyOrHeavier}. At least 3 Brawler, Sniper, or Skirmisher roles. Vehicle formations require 2 matched pairs of ${heavy} units.`;
        },
        validator: (units) => {
            const heavyUnits = units.filter(u => isAS
                ? asGetSize(u.getUnit()) >= 3
                : cbtIsHeavyOrLarger(u.getUnit()));
            if (isAS ? asIsOnlyCombatVehicles(units) : cbtIsOnlyCombatVehicles(units)) {
                if (countMatchedPairs(heavyUnits) < 2) return false;
            }
            const hasRequiredRoles = units.filter(u =>
                ['Brawler', 'Sniper', 'Skirmisher'].includes(u.getUnit().role));
            return heavyUnits.length >= Math.ceil(units.length * 0.5) && hasRequiredRoles.length >= 3;
        },
    },

    //
    // LIGHT BATTLE LANCE
    //
    {
        id: 'light-battle-lance',
        name: 'Light Battle',
        description: 'Fast light formation for reconnaissance and skirmishing',
        effectDescription: 'The formation receives a Lucky SPA as a level equal to the number of units in the formation at setup plus 2. Useable by any unit in the formation. May stack with individual Lucky SPA (max 4 rerolls per unit per scenario).',
        effectGroups: [{
            abilityIds: ['lucky'],
            selection: 'all',
            distribution: 'shared-pool',
        }],
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 62 }, { book: Rulebook.ASCE, page: 117 }],
        requirements: () => {
            const lightNoAssault = isAS ? 'Size 1. No Size 4+' : 'light. No assault';
            const light = isAS ? 'Size 1' : 'light';
            return `Minimum 3 units. 75% must be ${lightNoAssault} units. At least 1 Scout. Vehicle formations require 2 matched pairs of ${light} units.`;
        },
        validator: (units) => {
            const lightUnits = units.filter(u => isAS
                ? asGetSize(u.getUnit()) === 1
                : cbtIsLightWeight(u.getUnit()));
            const hasAssault = units.some(u => isAS
                ? asGetSize(u.getUnit()) >= 4
                : cbtIsAssaultOrLarger(u.getUnit()));
            if (isAS ? asIsOnlyCombatVehicles(units) : cbtIsOnlyCombatVehicles(units)) {
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
        effectDescription: 'The formation receives a Lucky SPA as a level equal to the number of units in the formation at setup plus 2. Useable by any unit in the formation. May stack with individual Lucky SPA (max 4 rerolls per unit per scenario).',
        effectGroups: [{
            abilityIds: ['lucky'],
            selection: 'all',
            distribution: 'shared-pool',
        }],
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 62 }, { book: Rulebook.ASCE, page: 117 }],
        requirements: () => {
            const mediumNoAssault = isAS ? 'Size 2. No Size 4+' : 'medium. No assault';
            const medium = isAS ? 'Size 2' : 'medium';
            return `Minimum 3 units. 50% must be ${mediumNoAssault} units. Vehicle formations require 2 matched pairs of ${medium} units.`;
        },
        validator: (units) => {
            const mediumUnits = units.filter(u => isAS
                ? asGetSize(u.getUnit()) === 2
                : cbtIsMediumWeight(u.getUnit()));
            const hasAssault = units.some(u => isAS
                ? asGetSize(u.getUnit()) >= 4
                : cbtIsAssaultOrLarger(u.getUnit()));
            if (isAS ? asIsOnlyCombatVehicles(units) : cbtIsOnlyCombatVehicles(units)) {
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
        effectDescription: 'The formation receives a Lucky SPA as a level equal to the number of units in the formation at setup plus 2. Useable by any unit in the formation. May stack with individual Lucky SPA (max 4 rerolls per unit per scenario).',
        effectGroups: [{
            abilityIds: ['lucky'],
            selection: 'all',
            distribution: 'shared-pool',
        }],
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 63 }, { book: Rulebook.ASCE, page: 117 }],
        requirements: () => {
            const heavyNoLight = isAS ? 'Size 3+. No Size 1' : 'heavy or assault. No light';
            const heavy = isAS ? 'Size 3' : 'heavy';
            return `Minimum 3 units. 50% must be ${heavyNoLight} units. Vehicle formations require 2 matched pairs of ${heavy} units.`;
        },
        validator: (units) => {
            const heavyUnits = units.filter(u =>
                isAS ? asGetSize(u.getUnit()) >= 3 : cbtIsHeavyOrLarger(u.getUnit()));
            const hasLight = units.some(u => isAS
                ? asGetSize(u.getUnit()) === 1
                : cbtIsLightWeight(u.getUnit()));
            if (isAS ? asIsOnlyCombatVehicles(units) : cbtIsOnlyCombatVehicles(units)) {
                if (countMatchedPairs(heavyUnits) < 2) return false;
            }
            return heavyUnits.length >= Math.ceil(units.length * 0.5) && !hasLight;
        },
    },

    //
    // RIFLE LANCE (exclusive to House Davion)
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
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 63 }],
        requirements: () => {
            const mediumOrHeavy = isAS ? 'Size 2-3' : 'medium or heavy';
            const equipment = isAS
                ? 'AC or FLK special. All units Move 8"+'
                : 'autocannons (including LB-X, Ultra, or Rotary). All units walk ≥ 4';
            return `Minimum 3 units. Federated Suns only. 75% must be ${mediumOrHeavy}. 50% must have ${equipment}.`;
        },
        validator: (units) => {
            if (isAS) {
                const mediumOrHeavy = units.filter(u => {
                    const sz = asGetSize(u.getUnit());
                    return sz >= 2 && sz <= 3;
                });
                const withAutocannon = units.filter(u => asHasSpecial(u.getUnit(), 'AC') || asHasSpecial(u.getUnit(), 'FLK'));
                const allFast = units.every(u => asGetMaxGroundMove(u.getUnit()) >= 8);
                return mediumOrHeavy.length >= Math.ceil(units.length * 0.75) &&
                       withAutocannon.length >= Math.ceil(units.length * 0.5) && allFast;
            } else {
                if (units.length < 1) return false;
                const mediumOrHeavy = units.filter(u => {
                    const weight = cbtGetWeightClass(u.getUnit());
                    return weight === CBT_MEDIUM_WEIGHT_CLASS || weight === CBT_HEAVY_WEIGHT_CLASS;
                });
                const withAutocannon = units.filter(u => cbtHasAutocannon(u.getUnit()));
                const fastEnough = units.every(u => u.getUnit().walk >= 4);
                return mediumOrHeavy.length >= Math.ceil(units.length * 0.75) &&
                       withAutocannon.length >= Math.ceil(units.length * 0.5) && fastEnough;
            }
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
        parent: 'battle-lance',
        nameAliases: ['Berserker', 'Close Combat'],
        description: 'Close combat specialists for physical attacks',
        effectDescription: 'Two units in this formation receive the Swordsman or Zweihander SPA. The same ability must be assigned to both units.',
        effectGroups: [{
            abilityIds: ['swordsman', 'zweihander'],
            selection: 'choose-one',
            distribution: 'fixed',
            count: 2,
        }],
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 63 }],
        requirements: () => 'Same as Battle Lance.',
        validator: (units) => {
            const heavyUnits = units.filter(u =>
                isAS ? asGetSize(u.getUnit()) >= 3 : cbtIsHeavyOrLarger(u.getUnit()));
            if (isAS ? asIsOnlyCombatVehicles(units) : cbtIsOnlyCombatVehicles(units)) {
                if (countMatchedPairs(heavyUnits) < 2) return false;
            }
            const hasRequiredRoles = units.filter(u =>
                ['Brawler', 'Sniper', 'Skirmisher'].includes(u.getUnit().role));
            return heavyUnits.length >= Math.ceil(units.length * 0.5) && hasRequiredRoles.length >= 3;
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
                excludeCommander: true,
            },
            {
                abilityIds: ['tactical_genius'],
                selection: 'all',
                distribution: 'commander',
            },
        ],
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 63 }, { book: Rulebook.ASCE, page: 120 }],
        requirements: () => 'Minimum 3 units. 50% must have Sniper, Missile Boat, Skirmisher, or Juggernaut role. At least 1 Brawler, Striker, or Scout.',
        validator: (units) => {
            const heavyRoles = units.filter(u =>
                ['Sniper', 'Missile Boat', 'Skirmisher', 'Juggernaut'].includes(u.getUnit().role));
            const diverseRoles = units.filter(u =>
                ['Brawler', 'Striker', 'Scout'].includes(u.getUnit().role));
            return heavyRoles.length >= Math.ceil(units.length * 0.5) && diverseRoles.length >= 1;
        },
    },

    //
    // ORDER LANCE (exclusive to House Kurita)
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
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 63 }],
        requirements: () => {
            const weight = isAS ? 'Size' : 'weight';
            return `Minimum 3 units. Draconis Combine only. All units must share the same ${weight} class and chassis.`;
        },
        validator: (units) => {
            const firstTier = isAS ? asGetSize(units[0].getUnit()) : cbtGetWeightClass(units[0].getUnit());
            const sameTier = units.every(u =>
                (isAS ? asGetSize(u.getUnit()) : cbtGetWeightClass(u.getUnit())) === firstTier);
            const firstChassis = units[0].getUnit().chassis;
            const sameChassis = units.every(u => u.getUnit().chassis === firstChassis);
            return sameTier && sameChassis;
        },
    },

    //
    // VEHICLE COMMAND LANCE
    //
    {
        id: 'vehicle-command-lance',
        name: 'Vehicle Command',
        description: 'Formation of command vehicle units',
        effectDescription: 'Prior to the beginning of play, two of the non-commander units in this formation receive one of the following Special Pilot Abilities for free (each unit may receive a different SPA): Antagonizer, Combat Intuition, Blood Stalker, Eagle\'s Eyes, Marksman, or Multi-Tasker. In addition, the commander\'s unit receives the Tactical Genius SPA. If the commander already has the Tactical Genius SPA, instead add a +1 modifier to the force\'s Initiative roll results, including any rerolls made as a result of the Tactical Genius SPA.',
        effectGroups: [
            {
                abilityIds: ['antagonizer', 'blood_stalker', 'combat_intuition', 'eagles_eyes', 'marksman', 'multi_tasker'],
                selection: 'choose-each',
                distribution: 'half-round-up',
                excludeCommander: true,
            },
            {
                abilityIds: ['tactical_genius'],
                selection: 'all',
                distribution: 'commander',
            },
        ],
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 63 }, { book: Rulebook.ASCE, page: 120 }],
        requirements: () => 'Minimum 3 units. All must be combat vehicles. At least one matched pair with Sniper, Missile Boat, Skirmisher, or Juggernaut role.',
        validator: (units) => {
            if (!(isAS ? asIsOnlyCombatVehicles(units) : cbtIsOnlyCombatVehicles(units))) return false;
            return findIdenticalPairs(units).some(pair =>
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
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 64 }, { book: Rulebook.ASCE, page: 119 }],
        requirements: () => 'Minimum 3 units. 75% must have the Missile Boat or Sniper role.',
        validator: (units) => {
            const count = units.filter(u =>
                u.getUnit().role === 'Missile Boat' || u.getUnit().role === 'Sniper');
            return count.length >= Math.ceil(units.length * 0.75);
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
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 64 }, { book: Rulebook.ASCE, page: 119 }],
        requirements: () => {
            const weapons = isAS
                ? 'FLK, AC, or ART specials'
                : 'an LBX autocannon, standard autocannon, artillery weapon, or Anti-Aircraft Targeting quirk';
            return `Minimum 3 units. Must meet Fire Lance requirements. At least 2 units with ${weapons}.`;
        },
        validator: (units) => {
            if (isAS) {
                const qualifyingUnits = units.filter(u =>
                    asHasSpecial(u.getUnit(), 'FLK') ||
                    asHasSpecial(u.getUnit(), 'AC') ||
                    asHasSpecial(u.getUnit(), 'ART'));
                return qualifyingUnits.length >= 2;
            } else {
                const qualifyingUnits = units.filter(u =>
                    cbtHasAutocannon(u.getUnit()) ||
                    cbtHasArtillery(u.getUnit()) ||
                    u.getUnit().quirks.includes('Anti-Aircraft Targeting'));
                return qualifyingUnits.length >= 2;
            }
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
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 64 }, { book: Rulebook.ASCE, page: 119 }],
        requirements: () => {
            const artillery = isAS ? 'the ART special' : 'artillery weapons';
            return `Minimum 3 units. At least 2 units with ${artillery}.`;
        },
        validator: (units) => {
            const artilleryCount = units.filter(u => isAS
                ? asHasSpecial(u.getUnit(), 'ART')
                : cbtHasArtillery(u.getUnit())).length;
            return artilleryCount >= 2;
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
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 64 }, { book: Rulebook.ASCE, page: 119 }],
        requirements: () => {
            const heavyOrAssault = isAS ? 'Size 3+' : 'heavy or assault';
            const longRange = isAS ? 'long-range damage ≥ 2' : 'deal 10+ damage at 18 hexes';
            return `Minimum 3 units. At least 2 ${heavyOrAssault} units. All units must have ${longRange}.`;
        },
        validator: (units) => {
            const heavyUnits = units.filter(u =>
                isAS ? asGetSize(u.getUnit()) >= 3 : cbtIsHeavyOrLarger(u.getUnit()));
            const allLongRange = isAS
                ? units.every(u => (u.getUnit().as?.dmg?._dmgL ?? 0) >= 2)
                : units.every(u => cbtCanDealDamage(u.getUnit(), 10, 18));
            return heavyUnits.length >= 2 && allLongRange;
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
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 64 }, { book: Rulebook.ASCE, page: 119 }],
        requirements: () => {
            const indirectFire = isAS ? 'the IF (Indirect Fire) special' : 'LRMs or artillery';
            return `Minimum 3 units. At least 3 units with ${indirectFire}.`;
        },
        validator: (units) => {
            const indirectCount = units.filter(u => isAS
                ? asHasSpecial(u.getUnit(), 'IF')
                : (cbtHasLRM(u.getUnit()) || cbtHasArtillery(u.getUnit()))).length;
            return indirectCount >= 3;
        },
    },

    //
    // LIGHT FIRE LANCE
    // Bonus: Coordinated Fire Support: if a unit hits, others get -1 TN (cumulative, max -3).
    //
    {
        id: 'light-fire-lance',
        name: 'Light Fire',
        description: 'Light units with coordinated long-range fire',
        effectDescription: 'Coordinated Fire Support: If a unit in this formation hits a target with at least one of its weapons, other units in this formation making weapon attacks against the same target receive a -1 modifier to their attack rolls. This bonus is cumulative per attacking unit, up to a -3 To-Hit modifier.',
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 64 }, { book: Rulebook.ASCE, page: 119 }],
        requirements: () => {
            const heavy = isAS ? 'Size 3+' : 'heavy or assault';
            return `Minimum 3 units. No ${heavy} units. 50% must have the Missile Boat or Sniper role.`;
        },
        validator: (units) => {
            const noHeavy = units.every(u =>
                (isAS ? asGetSize(u.getUnit()) : cbtGetWeightClass(u.getUnit())) < 3);
            const hasRequiredRoles = units.filter(u =>
                ['Missile Boat', 'Sniper'].includes(u.getUnit().role));
            return noHeavy && hasRequiredRoles.length >= Math.ceil(units.length * 0.5);
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
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 65 }, { book: Rulebook.ASCE, page: 120 }],
        requirements: () => {
            const lightOrMedium = isAS ? 'Size ≤ 2' : 'light or medium';
            const move = isAS ? 'Move 12"+' : 'walk ≥ 6';            
            const mediumRange = isAS ? 'with medium-range damage > 1' : 'deal 5+ damage at 15 hexes';
            return `Minimum 3 units. All ${lightOrMedium}. 75% must have ${move}. At least 1 unit ${mediumRange}.`;
        },
        validator: (units) => {
            const allSmallOrMedium = units.every(u =>
                isAS ? asGetSize(u.getUnit()) <= 2 : cbtIsLightOrMedium(u.getUnit()));
            const fastUnits = units.filter(u => isAS
                ? asGetAnyGroundOrJumpMove(u.getUnit()) >= 12
                : u.getUnit().walk >= 6);
            const hasRange = isAS
                ? units.some(u => (u.getUnit().as?.dmg?._dmgM ?? 0) > 1)
                : units.some(u => cbtCanDealDamage(u.getUnit(), 5, 15));
            return allSmallOrMedium && fastUnits.length >= Math.ceil(units.length * 0.75) && hasRange;
        },
    },

    //
    // PROBE LANCE
    //
    {
        id: 'probe-lance',
        name: 'Probe',
        description: 'Mobile reconnaissance force',
        effectDescription: '75% of the units receive the Blood Stalker SPA. The Pursuit Lance may choose an enemy Formation rather than a single unit as the Blood Stalker target. All members must choose the same enemy Formation.',
        effectGroups: [{
            abilityIds: ['blood_stalker'],
            selection: 'all',
            distribution: 'percent-75',
        }],
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 65 }, { book: Rulebook.ASCE, page: 120 }],
        requirements: () => {
            const assault = isAS ? 'Size 4+' : 'assault';
            const move = isAS ? 'Move 10"+' : 'walk ≥ 6';
            const mediumRange = isAS ? 'have medium-range damage > 1' : 'deal 5+ damage at 15 hexes';
            return `Minimum 3 units. No ${assault} units. 75% must have ${move}. All units must ${mediumRange}.`;
        },
        validator: (units) => {
            const allNotHuge = units.every(u =>
                (isAS ? asGetSize(u.getUnit()) : cbtGetWeightClass(u.getUnit())) < 4);
            const fastUnits = units.filter(u => isAS
                ? asGetAnyGroundOrJumpMove(u.getUnit()) >= 10
                : u.getUnit().walk >= 6);
            const allDamage = isAS
                ? units.every(u => (u.getUnit().as?.dmg?._dmgM ?? 0) >= 2)
                : units.every(u => cbtCanDealDamage(u.getUnit(), 10, 9));
            return allNotHuge && fastUnits.length >= Math.ceil(units.length * 0.75) && allDamage;
        },
    },

    //
    // SWEEP LANCE
    //
    {
        id: 'sweep-lance',
        name: 'Sweep',
        description: 'Fast medium-range sweeping force',
        effectDescription: '75% of the units receive the Blood Stalker SPA. The Pursuit Lance may choose an enemy Formation rather than a single unit as the Blood Stalker target. All members must choose the same enemy Formation.',
        effectGroups: [{
            abilityIds: ['blood_stalker'],
            selection: 'all',
            distribution: 'percent-75',
        }],
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 65 }, { book: Rulebook.ASCE, page: 120 }],
        requirements: () => {
            const lightOrMedium = isAS ? 'Size ≤ 2' : 'light or medium';
            const move = isAS ? 'Move 10"+' : 'walk ≥ 5';
            const shortRange = isAS ? 'have short-range damage ≥ 2' : 'deal 10+ damage at 6 hexes';
            return `Minimum 3 units. All ${lightOrMedium}. All units must have ${move}. All units must ${shortRange}.`;
        },
        validator: (units) => {
            const allSmallOrMedium = units.every(u =>
                isAS ? asGetSize(u.getUnit()) <= 2 : cbtIsLightOrMedium(u.getUnit()));
            const allFast = units.every(u => isAS
                ? asGetAnyGroundOrJumpMove(u.getUnit()) >= 10
                : u.getUnit().walk >= 5);
            const allDamage = isAS
                ? units.every(u => (u.getUnit().as?.dmg?._dmgS ?? 0) >= 2)
                : units.every(u => cbtCanDealDamage(u.getUnit(), 10, 6));
            return allSmallOrMedium && allFast && allDamage;
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
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 65 }, { book: Rulebook.ASCE, page: 119 }],
        requirements: () => {
            const move = isAS ? 'Move 10"+' : 'walk ≥ 5';
            return `Minimum 3 units. All units must have ${move}. At least 2 Scout or Striker roles.`;
        },
        validator: (units) => {
            const allFast = units.every(u => isAS
                ? asGetAnyGroundOrJumpMove(u.getUnit()) >= 10
                : u.getUnit().walk >= 5);
            const scoutOrStriker = units.filter(u =>
                u.getUnit().role === 'Scout' || u.getUnit().role === 'Striker');
            return allFast && scoutOrStriker.length >= 2;
        },
    },

    //
    // HEAVY RECON LANCE
    //
    {
        id: 'heavy-recon-lance',
        name: 'Heavy Recon',
        description: 'Armored reconnaissance formation',
        effectDescription: 'At the beginning of play, choose either Eagle\'s Eyes or Maneuvering Ace SPA and apply it to up to two units in this formation. The chosen ability cannot be switched between units or changed during the scenario. In addition, all units in this formation receive the Forward Observer SPA.',
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
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 66 }, { book: Rulebook.ASCE, page: 119 }],
        requirements: () => {
            const allMove = isAS ? 'Move 8"+' : 'walk ≥ 4';
            const someMove = isAS ? 'Move 10"+' : 'walk ≥ 5';
            const heavyOrAssault = isAS ? 'Size 3+' : 'heavy or assault';
            return `Minimum 3 units. All ${allMove}. At least 2 with ${someMove}. At least 1 ${heavyOrAssault}. At least 2 Scouts.`;
        },
        validator: (units) => {
            const allFast = units.every(u => isAS
                ? asGetAnyGroundOrJumpMove(u.getUnit()) >= 8
                : u.getUnit().walk >= 4);
            const veryFast = units.filter(u => isAS
                ? asGetAnyGroundOrJumpMove(u.getUnit()) >= 10
                : u.getUnit().walk >= 5);
            const hasHeavy = units.some(u =>
                isAS ? asGetSize(u.getUnit()) >= 3 : cbtIsHeavyOrLarger(u.getUnit()));
            const scoutUnits = units.filter(u => u.getUnit().role === 'Scout');
            return allFast && veryFast.length >= 2 && hasHeavy && scoutUnits.length >= 2;
        },
    },

    //
    // LIGHT RECON LANCE
    //
    {
        id: 'light-recon-lance',
        name: 'Light Recon',
        description: 'Ultra-fast light scouts optimized for deep reconnaissance',
        effectDescription: 'At the beginning of play, choose either Eagle\'s Eyes or Maneuvering Ace SPA and apply it to all units in this formation. This choice is permanent for the scenario. Additionally, all units receive the Forward Observer SPA.',
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
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 66 }, { book: Rulebook.ASCE, page: 119 }],
        requirements: () => {
            const light = isAS ? 'Size 1' : 'light';
            const move = isAS ? 'Move 12"+' : 'walk ≥ 6';
            return `Minimum 3 units. All ${light}. All ${move}. All must have the Scout role.`;
        },
        validator: (units) => {
            const allLight = units.every(u =>
                isAS ? asGetSize(u.getUnit()) === 1 : cbtIsLightWeight(u.getUnit()));
            const allVeryFast = units.every(u => isAS
                ? asGetAnyGroundOrJumpMove(u.getUnit()) >= 12
                : u.getUnit().walk >= 6);
            const allScouts = units.every(u => u.getUnit().role === 'Scout');
            return allLight && allVeryFast && allScouts;
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
            abilityIds: ['speed_demon', 'environmental_specialist', 'terrain_master_drag_racer', 'terrain_master_forest_ranger', 'terrain_master_frogman', 'terrain_master_mountaineer', 'terrain_master_nightwalker', 'terrain_master_sea_monster', 'terrain_master_swamp_beast'],
            selection: 'choose-one',
            distribution: 'percent-75',
        }],
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 65 }],
        requirements: () => {
            const assault = isAS ? 'Size 4+' : 'assault';
            return `Minimum 3 units. At most 1 ${assault} unit. At least 1 Scout or Striker. At least 1 Sniper or Missile Boat.`;
        },
        validator: (units) => {
            const hasScoutOrStriker = units.some(u =>
                u.getUnit().role === 'Scout' || u.getUnit().role === 'Striker');
            const hasSniperOrMissileBoat = units.some(u =>
                u.getUnit().role === 'Sniper' || u.getUnit().role === 'Missile Boat');
            const assaultCount = units.filter(u => isAS
                ? asGetSize(u.getUnit()) >= 4
                : cbtIsAssaultOrLarger(u.getUnit())).length;
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
        nameAliases: ['Striker', 'Cavalry'],
        description: 'Fast mobile firepower',
        effectDescription: '75% of the units (round normally) receive the Speed Demon SPA.',
        effectGroups: [{
            abilityIds: ['speed_demon'],
            selection: 'all',
            distribution: 'percent-75',
        }],
        idealRole: 'Striker',
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 66 }, { book: Rulebook.ASCE, page: 118 }],
        requirements: () => {
            const move = isAS ? 'Move 10"+ or Jump 8+"' : 'walk ≥ 5 or jump ≥ 4';
            const assault = isAS ? 'Size 4+' : 'assault';
            return `Minimum 3 units. All ${move}. No ${assault} units. 50% must have Striker or Skirmisher role.`;
        },
        validator: (units) => {
            const allFast = units.every(u => isAS
                ? (asGetMaxGroundMove(u.getUnit()) >= 10 || asGetJumpMove(u.getUnit()) >= 8)
                : (u.getUnit().walk >= 5 || u.getUnit().jump >= 4));
            const noAssault = units.every(u =>
                (isAS ? asGetSize(u.getUnit()) : cbtGetWeightClass(u.getUnit())) < 4);
            const hasRequiredRoles = units.filter(u =>
                u.getUnit().role === 'Striker' || u.getUnit().role === 'Skirmisher');
            return allFast && noAssault && hasRequiredRoles.length >= Math.ceil(units.length * 0.5);
        },
    },

    //
    // HAMMER LANCE (exclusive to House Marik)
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
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 66 }],
        requirements: () => {
            const move = isAS ? 'Move 10"+' : 'walk ≥ 5';
            return `Minimum 3 units. Free Worlds League only. All units must have ${move}.`;
        },
        validator: (units) => {
            return units.every(u => isAS
                ? asGetAnyGroundOrJumpMove(u.getUnit()) >= 10
                : u.getUnit().walk >= 5);
        },
    },

    //
    // LIGHT STRIKER/CAVALRY LANCE
    //
    {
        id: 'light-striker-lance',
        name: 'Light Striker/Cavalry',
        nameAliases: ['Light Striker', 'Light Cavalry'],
        description: 'Fast light mobile force',
        effectDescription: '75% of the units (round normally) receive the Speed Demon SPA.',
        effectGroups: [{
            abilityIds: ['speed_demon'],
            selection: 'all',
            distribution: 'percent-75',
        }],
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 66 }, { book: Rulebook.ASCE, page: 118 }],
        requirements: () => {
            const move = isAS ? 'Move 10"+' : 'walk ≥ 5';
            const noHeavyOrAssault = isAS ? 'Size 3+' : 'heavy or assault';
            const longRange = isAS ? 'with long-range damage > 0' : 'deal 5+ damage at 18 hexes';
            return `Minimum 3 units. All ${move}. No ${noHeavyOrAssault} units. At least 2 ${longRange}. At least 2 Striker or Skirmisher roles.`;
        },
        validator: (units) => {
            const allFast = units.every(u => isAS
                ? asGetAnyGroundOrJumpMove(u.getUnit()) >= 10
                : u.getUnit().walk >= 5);
            const noHeavy = units.every(u =>
                (isAS ? asGetSize(u.getUnit()) : cbtGetWeightClass(u.getUnit())) < 3);
            const hasLongRange = units.filter(u => isAS
                ? (u.getUnit().as?.dmg?._dmgL ?? 0) > 0
                : cbtCanDealDamage(u.getUnit(), 5, 18));
            const hasRequiredRoles = units.filter(u =>
                u.getUnit().role === 'Striker' || u.getUnit().role === 'Skirmisher');
            return allFast && noHeavy && hasLongRange.length >= 2 && hasRequiredRoles.length >= 2;
        },
    },

    //
    // HEAVY STRIKER/CAVALRY LANCE
    //
    {
        id: 'heavy-striker-lance',
        name: 'Heavy Striker/Cavalry',
        nameAliases: ['Heavy Striker', 'Heavy Cavalry'],
        description: 'Heavy fast-moving formation',
        effectDescription: '75% of the units (round normally) receive the Speed Demon SPA.',
        effectGroups: [{
            abilityIds: ['speed_demon'],
            selection: 'all',
            distribution: 'percent-75',
        }],
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 66 }, { book: Rulebook.ASCE, page: 118 }],
        requirements: () => {
            const move = isAS ? 'Move 8"+' : 'walk ≥ 4';
            const heavyOrAssault = isAS ? 'Size 3+. No Size 1' : 'heavy or assault. No light';
            const longRange = isAS ? 'with long-range damage > 1' : 'deals 5+ damage at 18 hexes';
            return `Minimum 3 units. All ${move}. At least 3 ${heavyOrAssault} units. At least 1 ${longRange}. At least 2 Striker or Skirmisher roles.`;
        },
        validator: (units) => {
            const allFast = units.every(u => isAS
                ? asGetAnyGroundOrJumpMove(u.getUnit()) >= 8
                : u.getUnit().walk >= 4);
            const heavyUnits = units.filter(u =>
                isAS ? asGetSize(u.getUnit()) >= 3 : cbtIsHeavyOrLarger(u.getUnit()));
            const noLight = units.every(u =>
                isAS ? asGetSize(u.getUnit()) >= 2 : cbtIsMediumOrLarger(u.getUnit()));
            const hasLongRange = isAS
                ? units.some(u => (u.getUnit().as?.dmg?._dmgL ?? 0) > 1)
                : units.some(u => cbtCanDealDamage(u.getUnit(), 5, 18));
            const hasRequiredRoles = units.filter(u =>
                u.getUnit().role === 'Striker' || u.getUnit().role === 'Skirmisher');
            return allFast && heavyUnits.length >= 3 && noLight && hasLongRange && hasRequiredRoles.length >= 2;
        },
    },

    //
    // HORDE
    // Bonus: Swarm: when targeted, may switch target to another unit in formation.
    //
    {
        id: 'horde',
        name: 'Horde',
        description: 'Mass light unit swarm tactics',
        effectDescription: 'Swarm: When any unit in this formation is targeted by an enemy attack, that unit\'s player may switch the target to any other unit in this formation that is still a legal target (within line of sight) and at the same range or less from the attacker. This ability can only be used by units which spent Running, Jumping, or Flank movement points that turn.',
        minUnits: 5,
        maxUnits: 10,
        rulesRef: [{ book: Rulebook.CO, page: 67 }],
        requirements: () => {
            const light = isAS ? 'Size 1' : 'light';
            const mediumRange = isAS ? 'have medium-range damage < 2' : 'deal less than 11 damage at 9 hexes';
            return `5-10 units. All ${light}. All must ${mediumRange}.`;
        },
        validator: (units) => {
            if (units.length < 5 || units.length > 10) return false;
            const allLight = units.every(u =>
                isAS ? asGetSize(u.getUnit()) === 1 : cbtIsLightWeight(u.getUnit()));
            const lowDamage = isAS
                ? units.every(u => (u.getUnit().as?.dmg?._dmgM ?? 0) < 2)
                : units.every(u => !cbtCanDealDamage(u.getUnit(), 11, 9));
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
            abilityIds: ['terrain_master_drag_racer', 'terrain_master_forest_ranger', 'terrain_master_frogman', 'terrain_master_mountaineer', 'terrain_master_nightwalker', 'terrain_master_sea_monster', 'terrain_master_swamp_beast'],
            selection: 'choose-one',
            distribution: 'percent-75',
        }],
        idealRole: 'Skirmisher',
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 67 }],
        requirements: () => {
            const assault = isAS ? 'Size 4+' : 'assault';
            return `Minimum 3 units. No ${assault} units.`;
        },
        validator: (units) => {
            return units.every(u =>
                (isAS ? asGetSize(u.getUnit()) : cbtGetWeightClass(u.getUnit())) < 4);
        },
    },

    // ─── Support Lance ───────────────────────────────────────────────────
    {
        id: 'support-lance',
        name: 'Support',
        description: 'Multi-role formation backing other units',
        minUnits: 3,
        effectDescription: 'Before play, designate one other formation to support. Half the units (round down) receive the same SPAs as the supported formation. SPA count may not exceed the supported formation\'s count.',
        rulesRef: [{ book: Rulebook.CO, page: 66 }, { book: Rulebook.ASCE, page: 121 }],
        requirements: () => 'Minimum 3 units. No additional composition requirements.',
        validator: (units) => units.length >= 3,
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
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 67 }],
        requirements: () => {
            const move = isAS ? 'ground Move ≤ 8"+' : 'walk ≤ 4';
            return `Minimum 3 units. 50% must have jump movement or be infantry. 50% must have ${move}.`;
        },
        validator: (units) => {
            const jumpOrInfantry = units.filter(u => isAS
                ? (asGetJumpMove(u.getUnit()) > 0 || asIsInfantry(u.getUnit()))
                : (u.getUnit().jump > 0 || u.getUnit().type === 'Infantry'));
            const slowUnits = units.filter(u => isAS
                ? asGetMaxGroundMove(u.getUnit()) <= 8
                : u.getUnit().walk <= 4);
            return jumpOrInfantry.length >= Math.ceil(units.length * 0.5) &&
                   slowUnits.length >= Math.ceil(units.length * 0.5);
        },
    },

    // ─── CLAN-EXCLUSIVE FORMATIONS ──────────────────────────────────────────────
    //
    // Phalanx Star
    // Bonus: Float Like a Butterfly SPA shared pool. Max 6 rerolls per track. Only one reroll per attack or critical hit roll.
    //
    {
        id: 'phalanx-star',
        name: 'Phalanx',
        description: 'Second-Line combined arms defensive formation.',
        effectDescription: 'The formation receives a Float Like a Butterfly SPA. Useable by any unit in the formation. (max 6 rerolls per scenario).',
        effectGroups: [{
            abilityIds: ['float_like_a_butterfly'],
            selection: 'all',
            distribution: 'shared-pool',
        }],
        minUnits: 3,
        rulesRef: [{ book: Rulebook.BOT, page: 27 }],
        requirements: () => 'Clan only. Minimum 2 combat vehicles or BattleMeks. Remainder must be Elementals, combat vehicles, or BattleMeks. Must be at least two different unit types.',
        validator: (units) => {
            if (!isClanForce(units)) return false;
            if (isAS) {
                const BM = units.filter(u => u.getUnit().as?.TP === 'BM').length;
                const BA = units.filter(u => u.getUnit().as?.TP === 'BA').length;
                const CV = units.filter(u => u.getUnit().as?.TP === 'CV').length;
                if (units.length > BM + BA + CV) return false;
                return (BM >= 2 && (BA > 0 || CV > 0)) || (CV >= 2 && (BM > 0 || BA > 0)); 
            } else {
                const BM = units.filter(u => u.getUnit().type === 'Mek').length;
                const BA = units.filter(u => u.getUnit().subtype === 'Battle Armor').length;
                const CV = units.filter(u => u.getUnit().type === 'Tank' || u.getUnit().type === 'VTOL' || u.getUnit().type === 'Naval').length;
                if (units.length > BM + BA + CV) return false;
                return (BM >= 2 && (BA > 0 || CV > 0)) || (CV >= 2 && (BM > 0 || BA > 0)); 
            }
        },
    },

    //
    // Rogue Star
    // Bonus: At the beginning of each turn, up to 2 units get Combat Intuition SPA.
    //

    {
        id: 'rogue-star',
        name: 'Rogue',
        description: 'Swift strike formation.',
        effectDescription: 'At the beginning of each turn, up to two units in this formation may receive the Combat Intuition SPA.',
        effectGroups: [{
            abilityIds: ['combat_intuition'],
            selection: 'all',
            distribution: 'fixed',
            count: 2,
            perTurn: true,
        }],
        minUnits: 3,
        rulesRef: [{ book: Rulebook.BOT, page: 27 }],
        requirements: () => 'Clan only. At least two units in the Formation must be the same model (including the same OmniMek configuration)',
        validator: (units) => {
            if (!isClanForce(units)) return false;
            const seen = new Set<string>();
            const hasPair = units.some(unit => {
                const name = unit.getUnit().name;
                if (seen.has(name)) return true;
                seen.add(name);
                return false;
            });
            return hasPair;
        },
    },

    //
    // Strategic Command Star
    // Bonus: Two non-commander units get one free SPA each (Antagonizer,
    //   Blood Stalker, Combat Intuition, Eagle's Eyes, Marksman, Multi-Tasker).
    //   Commander gets Tactical Genius.

    {
        id: 'strategic-command-star',
        name: 'Strategic Command',
        description: 'Combined arms command star.',
        effectDescription: 'Clan only. Prior to the beginning of play, two of the non-commander units in this formation receive one of the following Special Pilot Abilities for free (each unit may receive a different SPA): Antagonizer, Combat Intuition, Blood Stalker, Eagle\'s Eyes, Marksman, or Multi-Tasker. In addition, the commander\'s unit receives the Tactical Genius SPA. If the commander already has the Tactical Genius SPA, instead add a +1 modifier to the force\'s Initiative roll results, including any rerolls made as a result of the Tactical Genius SPA. Aerospace units cannot be designated force commander.',
        effectGroups: [
            {
                abilityIds: ['antagonizer', 'blood_stalker', 'combat_intuition', 'eagles_eyes', 'marksman', 'multi_tasker'],
                selection: 'choose-each',
                distribution: 'fixed',
                count: 2,
                excludeCommander: true,
            },
            {
                abilityIds: ['tactical_genius'],
                selection: 'all',
                distribution: 'commander',
            },
        ],
        minUnits: 3,
        rulesRef: [{ book: Rulebook.BOT, page: 27 }],
        requirements: () => {
            const gunnery = isAS ? '' : 'Gunnery ';
            const heavyOrAssault = isAS ? 'Size 3+, and no size 1' : 'heavy or assault, and no lights';
            return `Minimum 3 units. All must have ${gunnery}Skill 3 or lower. Must have 1 Aerospace Point. Others must be Mek or Battle Armor. If Mek, at least 2 units ${heavyOrAssault}.`;
        },
        validator: (units) => {
            if (!isClanForce(units)) return false;
            const skillCheck = units.every(u =>
            (isAS ? (u as ASForceUnit).pilotSkill() : (u as CBTForceUnit).gunnerySkill()) <= 3);
            if (!skillCheck) return false;
            const hasAF = units.filter(u =>
                (isAS ? u.getUnit().as?.TP === 'AF' : u.getUnit().type === 'Aero')).length;
            if (hasAF !== 2) return false;
            const hasBM = units.filter(u =>
                (isAS ? u.getUnit().as?.TP === 'BM' : u.getUnit().type === 'Mek')).length;
                if (hasBM > 0) { 
                    const heavyMeks = units.filter(u => isAS ? (u.getUnit().as?.TP === 'BM' && asGetSize(u.getUnit()) >= 3) : (u.getUnit().type === 'Mek' && cbtIsHeavyOrLarger(u.getUnit()))).length;
                    const lightMeks = units.some(u => isAS ? (u.getUnit().as?.TP === 'BM' && asGetSize(u.getUnit()) === 1) : (u.getUnit().type === 'Mek' && cbtIsLightWeight(u.getUnit())));
                    if (heavyMeks < 2 || lightMeks) return false;
                }
            const hasBA = units.filter(u =>
                (isAS ? u.getUnit().as?.TP === 'BA' : u.getUnit().subtype === 'Battle Armor')).length;
            return hasAF === 2 && (hasBM >= 2 || hasBA >= 1);
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
        requirements: () => 'Minimum 6 units. All must be aerospace units. More than 50% must have the Interceptor role.',
        validator: (units) => {
            if (!units.every(u => isAS ? asIsAeroUnit(u.getUnit()) : u.getUnit().type === 'Aero')) return false;
            return units.filter(u => u.getUnit().role === 'Interceptor').length > Math.ceil(units.length * 0.5);
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
        requirements: () => 'Minimum 6 units. All must be aerospace units. More than 50% must have the Interceptor or Fast Dogfighter role.',
        validator: (units) => {
            if (!units.every(u => isAS ? asIsAeroUnit(u.getUnit()) : u.getUnit().type === 'Aero')) return false;
            const count = units.filter(u =>
                u.getUnit().role === 'Interceptor' || u.getUnit().role === 'Fast Dogfighter');
            return count.length > Math.ceil(units.length * 0.5);
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
        requirements: () => 'Minimum 6 units. All must be aerospace units. 50% or more must have the Fire Support role. At least 1 Dogfighter.',
        validator: (units) => {
            if (!units.every(u => isAS ? asIsAeroUnit(u.getUnit()) : u.getUnit().type === 'Aero')) return false;
            const fireSupport = units.filter(u => u.getUnit().role === 'Fire Support');
            const hasDogfighter = units.some(u => u.getUnit().role?.includes('Dogfighter'));
            return fireSupport.length >= Math.ceil(units.length * 0.5) && hasDogfighter;
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
        requirements: () => 'Minimum 6 units. All must be aerospace units. More than 50% must have an Attack or Dogfighter role.',
        validator: (units) => {
            if (!units.every(u => isAS ? asIsAeroUnit(u.getUnit()) : u.getUnit().type === 'Aero')) return false;
            const count = units.filter(u =>
                u.getUnit().role?.includes('Attack') || u.getUnit().role?.includes('Dogfighter'));
            return count.length > Math.ceil(units.length * 0.5);
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
        requirements: () => {
            const equipment = isAS ? 'EW specials (PRB, AECM, ECM, TAG, etc.)' : 'ECM, BAP, or TAG';
            return `Minimum 6 units. All must be aerospace units. More than 50% must have ${equipment}.`;
        },
        validator: (units) => {
            if (!units.every(u => isAS ? asIsAeroUnit(u.getUnit()) : u.getUnit().type === 'Aero')) return false;
            if (isAS) {
                const EW_SPECIALS = ['PRB', 'AECM', 'BH', 'ECM', 'LPRB', 'LECM', 'LTAG', 'TAG', 'WAT'];
                const hasEW = units.filter(u =>
                    EW_SPECIALS.some(prefix => asHasSpecial(u.getUnit(), prefix)));
                return hasEW.length > Math.ceil(units.length * 0.5);
            } else {
                const hasEWEquipment = units.filter(u => {
                    const eqList = u.getUnit().comp?.map(c => c.eq) || [];
                    return eqList.some(eq =>  
                        eq?.hasAnyFlag(['F_ECM', 'F_BAP', 'F_TAG']))
                });
                return hasEWEquipment.length > Math.ceil(units.length * 0.5);
            }
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
        requirements: () => {
            const aerospaceType = isAS ? 'type (AF, CF, SC, DS, SV, or DA)' : 'units';
            return `Minimum 6 units. All must be aerospace ${aerospaceType}. 50% or more must have the Transport role.`;
        },
        validator: (units) => {
            if (isAS) {
                const allowedTypes: ASUnitTypeCode[] = ['AF', 'CF', 'SC', 'DS', 'SV', 'DA'];
                if (!units.every(u => allowedTypes.includes(u.getUnit().as?.TP as ASUnitTypeCode))) return false;
            } else {
                if (!units.every(u => u.getUnit().type === 'Aero')) return false;
            }
            return units.filter(u => u.getUnit().role?.includes('Transport')).length >= Math.ceil(units.length * 0.5);
        },
    },
];
