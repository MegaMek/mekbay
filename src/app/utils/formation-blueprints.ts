// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { GameSystem, Rulebook } from '../models/common.model';
import { resolveFormationTypeDefinition, type FormationTypeDefinition, type FormationTypeDefinitionSource } from './formation-type.model';
import type { FormationConstraint, FormationPredicateId, FormationRequirementBlueprint, FormationRequirementBlueprintSource } from './formation-requirement.model';

function all(id: string, label: string, predicate: FormationPredicateId): FormationConstraint {
    return { id, kind: 'all', label, predicate };
}

function countMin(id: string, label: string, predicate: FormationPredicateId, count: number): FormationConstraint {
    return { id, kind: 'count-min', label, predicate, count };
}

function countMax(id: string, label: string, predicate: FormationPredicateId, count: number): FormationConstraint {
    return { id, kind: 'count-max', label, predicate, count };
}

function countExact(id: string, label: string, predicate: FormationPredicateId, count: number): FormationConstraint {
    return { id, kind: 'count-exact', label, predicate, count };
}

function percent(id: string, label: string, predicate: FormationPredicateId, ratio: number): FormationConstraint {
    return { id, kind: 'percent-min', label, predicate, ratio, rounding: 'ceil' };
}

function percentNormally(id: string, label: string, predicate: FormationPredicateId, ratio: number): FormationConstraint {
    return { id, kind: 'percent-min', label, predicate, ratio, rounding: 'normal' };
}

function strictMajority(id: string, label: string, predicate: FormationPredicateId): FormationConstraint {
    return { id, kind: 'percent-min', label, predicate, ratio: 0.5, rounding: 'strict-majority' };
}

function anyOf(id: string, label: string, constraints: readonly FormationConstraint[]): FormationConstraint {
    return { id, kind: 'any-of', label, constraints };
}

function allOf(id: string, label: string, constraints: readonly FormationConstraint[]): FormationConstraint {
    return { id, kind: 'all-of', label, constraints };
}

function conditional(id: string, label: string, when: FormationPredicateId, constraints: readonly FormationConstraint[]): FormationConstraint {
    return { id, kind: 'conditional', label, when, constraints };
}

function matchedPairs(
    id: string,
    label: string,
    predicate: FormationPredicateId,
    count: number,
    onlyWhenAll?: FormationPredicateId,
): FormationConstraint {
    return { id, kind: 'matched-pairs-min', label, predicate, count, ...(onlyWhenAll ? { onlyWhenAll } : {}) };
}

function sameTier(id: string, label: string): FormationConstraint {
    return {
        id,
        kind: 'same-value',
        label,
        factByGameSystem: {
            [GameSystem.ALPHA_STRIKE]: 'asSize',
            [GameSystem.CLASSIC]: 'cbtWeightClass',
        },
    };
}

function sameChassis(id: string, label: string): FormationConstraint {
    return {
        id,
        kind: 'same-value',
        label,
        factByGameSystem: {
            [GameSystem.ALPHA_STRIKE]: 'chassis',
            [GameSystem.CLASSIC]: 'chassis',
        },
    };
}

const assaultLanceConstraints: readonly FormationConstraint[] = [
    countMin('assault-heavy-count', '3 heavy/Size 3+ units', 'heavy-size', 3),
    countMax('assault-no-light', 'No light/Size 1 units', 'light-size', 0),
    all('assault-armor', 'All armor threshold', 'assault-armor'),
    percent('assault-damage', '75% assault damage threshold', 'assault-damage', 0.75),
    anyOf('assault-role-choice', '1 Juggernaut or 2 Snipers', [
        countMin('assault-juggernaut', '1 Juggernaut', 'assault-role-juggernaut', 1),
        countMin('assault-snipers', '2 Snipers', 'assault-role-sniper', 2),
    ]),
];

const battleLanceCoreConstraints: readonly FormationConstraint[] = [
    percent('battle-heavy-percent', '50% heavy/Size 3+ units', 'heavy-size', 0.5),
    countMin('battle-role-count', '3 Brawler/Sniper/Skirmisher units', 'battle-role', 3),
];

const classicBattleLanceConstraints: readonly FormationConstraint[] = [
    ...battleLanceCoreConstraints,
    matchedPairs('battle-vehicle-pairs', '2 matched heavy/Size 3+ vehicle pairs', 'heavy-size', 2, 'combat-vehicle'),
];

const fireLanceConstraints: readonly FormationConstraint[] = [
    percent('fire-role-percent', '75% Missile Boat/Sniper units', 'fire-role', 0.75),
];

const clanOnlyConstraints: readonly FormationConstraint[] = [
    all('clan-force', 'Clan force', 'clan-force'),
];
const CLAN_EXCLUSIVE_FACTIONS = ['Clan'];

function sharedBlueprint(
    id: string,
    constraints: readonly FormationConstraint[],
): FormationRequirementBlueprintSource {
    return { id, classic: constraints, alphaStrike: constraints };
}

export const FORMATION_RUNTIME_DEFINITIONS: FormationTypeDefinitionSource[] = [

    {
        id: 'anti-mech-lance',
        name: 'Anti-\'Mech',
        description: 'Infantry trained to disrupt and damage enemy BattleMechs while supporting allied forces.',
        classic: {
            effectDescription: 'Distracting Swarm: units in this formation swarming an enemy unit cause a +1 To-Hit modifier to any weapon attacks made by the enemy unit.',
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 61 }, { book: Rulebook.FMK, page: 87 }],
            requirements: 'Minimum 3 units. All units must be Infantry.',
        },
        alphaStrike: {
            effectDescription: 'Enemy Units in base-to-base contact with an Anti-\'Mech Lance suffer a -1 To-Hit Modifier penalty to any weapon attacks made by that enemy Unit.',
            minUnits: 3,
            rulesRef: [{ book: Rulebook.FMK, page: 87 }],
            requirements: 'Minimum 3 units. All units must be Infantry (CI, BA, or PM).',
        },
    },

    // ─── Assault Lance ───────────────────────────────────────────────────
    //
    // Requirements (AS): At least 3 units Size 3+. No Size 1. All armor ≥ 5.
    //   75% medium-range ≥ 3. At least 1 Juggernaut or 2 Snipers.
    // Requirements (CBT): At least 3 heavy+. No light. All armor ≥ 135.
    //   75% can deal 25 dmg at 7 hexes. Must contain at least 1 Juggernaut or 2 Snipers.
    // Bonus: Choose Demoralizer or Multi-Tasker; Classic grants it to up to 2
    //   units per turn, while Alpha Strike grants it to half (round down).
    //
    {
        id: 'assault-lance',
        name: 'Assault',
        description: 'A slow, heavily armored powerhouse that uses massive firepower and brute force to break through enemy lines.',
        classic: {
            effectDescription: 'At the beginning of play, choose either Demoralizer or Multi-Tasker SPA. At the beginning of each turn, designate up to two units to receive the chosen ability for that turn. The recipients may change each turn, but the chosen SPA may not change during the scenario.',
            effectGroups: [{
                abilityIds: ['demoralizer', 'multi_tasker'],
                selection: 'choose-one',
                distribution: 'fixed',
                count: 2,
                perTurn: true,
            }],
            idealRole: 'Juggernaut',
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 61 }],
            requirements: 'Minimum 3 units. At least 3 heavy or assault. No light units. All armor ≥ 135 points. 75% must deal 25+ damage at 7 hexes. At least 1 Juggernaut or 2 Snipers.',
        },
        alphaStrike: {
            effectDescription: 'At the beginning of play, choose either Demoralizer or Multi-Tasker SPA. Each turn, designate up to half the units (rounded down) to receive the chosen ability for that turn. Destroyed or withdrawn units do not count.',
            effectGroups: [{
                abilityIds: ['demoralizer', 'multi_tasker'],
                selection: 'choose-one',
                distribution: 'half-round-down',
                perTurn: true,
            }],
            idealRole: 'Juggernaut',
            minUnits: 3,
            rulesRef: [{ book: Rulebook.ASCE, page: 118 }],
            requirements: 'Minimum 3 units. At least 3 units Size 3+. No Size 1 units. All armor ≥ 5. 75% must have medium-range damage ≥ 3. At least 1 Juggernaut or 2 Snipers.',
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
        description: 'A tough Marik formation that holds the enemy\'s attention and stops its advance while Hammer units maneuver.',
        exclusiveFaction: ['Free Worlds League'],
        classic: {
            effectDescription: 'At the beginning of each turn, up to two units in this formation may receive the Cluster Hitter or Sandblaster SPA. The player may assign the same SPA to both units, or one Sandblaster and the other Cluster Hitter.',
            effectGroups: [{ abilityIds: ['cluster_hitter', 'sandblaster'], selection: 'choose-each', distribution: 'fixed', count: 2, perTurn: true }],
            idealRole: 'Juggernaut',
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 62 }],
            requirements: 'Minimum 3 units. Free Worlds League only. All medium or heavier. All armor ≥ 105 points. 50% must have autocannons, LRMs, or SRMs.',
        },
        alphaStrike: {
            effectDescription: 'At the beginning of each turn, up to two units in this formation may receive the Cluster Hitter or Sandblaster SPA. The player may assign the same SPA to both units, or one Sandblaster and the other Cluster Hitter.',
            effectGroups: [{ abilityIds: ['cluster_hitter', 'sandblaster'], selection: 'choose-each', distribution: 'fixed', count: 2, perTurn: true }],
            idealRole: 'Juggernaut',
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 62 }],
            requirements: 'Minimum 3 units. Free Worlds League only. All Size 2+. All armor ≥ 4. 50% must have AC, FLK, LRM, or SRM specials.',
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
        description: 'A mobile assault variant built to close faster and keep pressure on the enemy.',
        inheritParentEffects: true,
        classic: {
            effectDescription: 'In addition to the Assault Lance bonus, at the beginning of each turn up to two units may receive the Stand Aside SPA. These need not be the same units receiving Demoralizer or Multi-Tasker.',
            effectGroups: [{ abilityIds: ['stand_aside'], selection: 'all', distribution: 'fixed', count: 2, perTurn: true }],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 62 }],
            requirements: 'Must meet Assault Lance requirements. All units must have walk ≥ 5 or jump > 0.',
        },
        alphaStrike: {
            effectDescription: 'In addition to the Assault Lance bonus, up to two units per Fast Assault Lance may receive the Stand Aside SPA per turn. These may stack with the Demoralizer or Multi-Tasker abilities.',
            effectGroups: [{ abilityIds: ['stand_aside'], selection: 'all', distribution: 'fixed', count: 2, perTurn: true }],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.ASCE, page: 118 }],
            requirements: 'Must meet Assault Lance requirements. All units must have [[10]]+ or any jump capability.',
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
        description: 'Ambush specialists that prefer heavy woods or urban terrain, where they can strike and destroy enemy forces.',
        classic: {
            effectDescription: 'At the beginning of each turn, 50 percent of the units in the formation may be granted the Combat Intuition SPA.',
            effectGroups: [{ abilityIds: ['combat_intuition'], selection: 'all', distribution: 'up-to-50-percent', perTurn: true }],
            idealRole: 'Ambusher',
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 62 }, { book: Rulebook.FMD, page: 82 }],
            requirements: 'Minimum 3 units. At least 50% must have the Ambusher or Juggernaut role.',
        },
        alphaStrike: {
            effectDescription: 'At the beginning of each turn, 50 percent of the units in the formation may be granted the Combat Intuition SPA.',
            effectGroups: [{ abilityIds: ['combat_intuition'], selection: 'all', distribution: 'up-to-50-percent', perTurn: true }],
            idealRole: 'Ambusher',
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 62 }, { book: Rulebook.FMD, page: 82 }],
            requirements: 'Minimum 3 units. At least 50% must have the Ambusher or Juggernaut role.',
        },
    },

    // ─── Battle Lance ────────────────────────────────────────────────────
    //
    // Requirements: 50% heavy+. 3+ Brawler/Sniper/Skirmisher.
    //   Vehicle formations need 2 matched pairs of heavy units.
    // Bonus: Classic grants a fixed 6-point Lucky pool; Alpha Strike uses the
    //   number of units at setup + 2. Both cap each unit at 4 rerolls.
    //
    {
        id: 'battle-lance',
        name: 'Battle',
        description: 'Line troops that hold the center or support an assault, relying on armor, mass, and sustained firepower to close with the enemy.',
        classic: {
            effectDescription: 'The formation receives the equivalent of a 6-point Lucky SPA, usable by any unit in the formation for up to six rerolls. It may stack with individual Lucky SPAs, but each unit is limited to four rerolls per scenario.',
            effectGroups: [{
                abilityIds: ['lucky'],
                selection: 'all',
                distribution: 'shared-pool',
                sharedPool: {
                    level: { kind: 'fixed', value: 6 },
                    totalUsesPerScenario: 6,
                    maxUsesPerUnitPerScenario: 4,
                    stacksWithIndividualAbility: true,
                },
            }],
            idealRole: 'Brawler',
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 62 }],
            requirements: 'Minimum 3 units. 50% must be heavy or assault. At least 3 Brawler, Sniper, or Skirmisher roles. Vehicle formations require 2 matched pairs of heavy units.',
        },
        alphaStrike: {
            effectDescription: 'The formation receives a Lucky SPA as a level equal to the number of units in the formation at setup plus 2. Usable by any unit in the formation. May stack with individual Lucky SPA (max 4 rerolls per unit per scenario).',
            effectGroups: [{
                abilityIds: ['lucky'],
                selection: 'all',
                distribution: 'shared-pool',
                sharedPool: {
                    level: { kind: 'unit-count-plus', offset: 2 },
                    maxUsesPerUnitPerScenario: 4,
                    stacksWithIndividualAbility: true,
                },
            }],
            idealRole: 'Brawler',
            minUnits: 3,
            rulesRef: [{ book: Rulebook.ASCE, page: 117 }],
            requirements: 'Minimum 3 units. 50% must be Size 3+. At least 3 Brawler, Sniper, or Skirmisher roles.',
        },
    },

    //
    // LIGHT BATTLE LANCE
    //
    {
        id: 'light-battle-lance',
        name: 'Light Battle',
        description: 'A light Battle variant for fast reconnaissance and skirmishing, relying on speed and coordinated fire rather than mass.',
        classic: {
            effectDescription: 'The formation receives the equivalent of a 6-point Lucky SPA, usable by any unit in the formation for up to six rerolls. It may stack with individual Lucky SPAs, but each unit is limited to four rerolls per scenario.',
            effectGroups: [{ abilityIds: ['lucky'], selection: 'all', distribution: 'shared-pool', sharedPool: { level: { kind: 'fixed', value: 6 }, totalUsesPerScenario: 6, maxUsesPerUnitPerScenario: 4, stacksWithIndividualAbility: true } }],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 63 }],
            requirements: 'Minimum 3 units. 75% must be light. No assault units. At least 1 Scout. Vehicle formations require 2 matched pairs of light units.',
        },
        alphaStrike: {
            effectDescription: 'The formation receives a Lucky SPA as a level equal to the number of units in the formation at setup plus 2. Usable by any unit in the formation. May stack with individual Lucky SPA (max 4 rerolls per unit per scenario).',
            effectGroups: [{ abilityIds: ['lucky'], selection: 'all', distribution: 'shared-pool', sharedPool: { level: { kind: 'unit-count-plus', offset: 2 }, maxUsesPerUnitPerScenario: 4, stacksWithIndividualAbility: true } }],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.ASCE, page: 118 }],
            requirements: 'Minimum 3 units. 75% must be Size 1. No Size 4+ units. At least 1 Scout. Vehicle formations require 2 matched pairs of Size 1 units.',
        },
    },

    //
    // MEDIUM BATTLE LANCE
    //
    {
        id: 'medium-battle-lance',
        name: 'Medium Battle',
        description: 'A balanced Battle variant that combines medium-unit mobility with enough armor and firepower for the line.',
        classic: {
            effectDescription: 'The formation receives the equivalent of a 6-point Lucky SPA, usable by any unit in the formation for up to six rerolls. It may stack with individual Lucky SPAs, but each unit is limited to four rerolls per scenario.',
            effectGroups: [{ abilityIds: ['lucky'], selection: 'all', distribution: 'shared-pool', sharedPool: { level: { kind: 'fixed', value: 6 }, totalUsesPerScenario: 6, maxUsesPerUnitPerScenario: 4, stacksWithIndividualAbility: true } }],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 63 }],
            requirements: 'Minimum 3 units. 50% must be medium. No assault units. Vehicle formations require 2 matched pairs of medium units.',
        },
        alphaStrike: {
            effectDescription: 'The formation receives a Lucky SPA as a level equal to the number of units in the formation at setup plus 2. Usable by any unit in the formation. May stack with individual Lucky SPA (max 4 rerolls per unit per scenario).',
            effectGroups: [{ abilityIds: ['lucky'], selection: 'all', distribution: 'shared-pool', sharedPool: { level: { kind: 'unit-count-plus', offset: 2 }, maxUsesPerUnitPerScenario: 4, stacksWithIndividualAbility: true } }],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.ASCE, page: 118 }],
            requirements: 'Minimum 3 units. 50% must be Size 2. No Size 4+ units. Vehicle formations require 2 matched pairs of Size 2 units.',
        },
    },

    //
    // HEAVY BATTLE LANCE
    //
    {
        id: 'heavy-battle-lance',
        name: 'Heavy Battle',
        description: 'A heavy Battle variant that brings durable line-fighting power to heavily armored units.',
        classic: {
            effectDescription: 'The formation receives the equivalent of a 6-point Lucky SPA, usable by any unit in the formation for up to six rerolls. It may stack with individual Lucky SPAs, but each unit is limited to four rerolls per scenario.',
            effectGroups: [{ abilityIds: ['lucky'], selection: 'all', distribution: 'shared-pool', sharedPool: { level: { kind: 'fixed', value: 6 }, totalUsesPerScenario: 6, maxUsesPerUnitPerScenario: 4, stacksWithIndividualAbility: true } }],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 63 }],
            requirements: 'Minimum 3 units. 50% must be heavy or assault. No light units. Vehicle formations require 2 matched pairs of heavy units.',
        },
        alphaStrike: {
            effectDescription: 'The formation receives a Lucky SPA as a level equal to the number of units in the formation at setup plus 2. Usable by any unit in the formation. May stack with individual Lucky SPA (max 4 rerolls per unit per scenario).',
            effectGroups: [{ abilityIds: ['lucky'], selection: 'all', distribution: 'shared-pool', sharedPool: { level: { kind: 'unit-count-plus', offset: 2 }, maxUsesPerUnitPerScenario: 4, stacksWithIndividualAbility: true } }],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.ASCE, page: 118 }],
            requirements: 'Minimum 3 units. 50% must be Size 3+. No Size 1 units. Vehicle formations require 2 matched pairs of Size 3+ units.',
        },
    },

    //
    // RIFLE LANCE (exclusive to House Davion)
    // Bonus: Up to 2 units per turn get Sandblaster or Weapon Specialist.
    //
    {
        id: 'rifle-lance',
        name: 'Rifle',
        description: 'Davion autocannon specialists trained to coordinate accurate long-range fire.',
        exclusiveFaction: ['Federated Suns', 'Federated Commonwealth'],
        classic: {
            effectDescription: 'At the beginning of each turn, up to two units in this formation may receive either the Sandblaster or Weapon Specialist SPA. The player may assign the same SPA to both units, or one Weapon Specialist and the other Sandblaster.',
            effectGroups: [{ abilityIds: ['sandblaster', 'weapon_specialist'], selection: 'choose-each', distribution: 'fixed', count: 2, perTurn: true }],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 63 }, { book: Rulebook.FMD, page: 82 }],
            requirements: 'Minimum 3 units. Federated Suns only. 75% must be medium or heavy. 50% must have autocannons (including LB-X, Ultra, or Rotary). All units walk ≥ 4.',
        },
        alphaStrike: {
            effectDescription: 'At the beginning of each turn, up to two units in this formation may receive either the Sandblaster or Weapon Specialist SPA. The player may assign the same SPA to both units, or one Weapon Specialist and the other Sandblaster.',
            effectGroups: [{ abilityIds: ['sandblaster', 'weapon_specialist'], selection: 'choose-each', distribution: 'fixed', count: 2, perTurn: true }],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 63 }, { book: Rulebook.FMD, page: 82 }],
            requirements: 'Minimum 3 units. Federated Suns only. 75% must be Size 2-3. 50% must have AC or FLK special. All units Move [[8]]+.',
        },
    },

    //
    // BERSERKER/CLOSE COMBAT LANCE
    // Requirements: As Battle Lance.
    // Bonus: 2 units receive Swordsman or Zweihander. Same ability for both.
    //
    {
        id: 'berserker-lance',
        parent: 'battle-lance',
        name: 'Berserker/Close Combat',
        nameAliases: ['Berserker', 'Close Combat'],
        description: 'Close-combat specialists made famous by Rasalhague Regulars and the KungsArmé, trained to smash the enemy with BattleMech strength.',
        classic: {
            effectDescription: 'Two units in this formation receive the Swordsman or Zweihander SPA. The same ability must be assigned to both units.',
            effectGroups: [{ abilityIds: ['swordsman', 'zweihander'], selection: 'choose-one', distribution: 'fixed', count: 2 }],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 63 }, { book: Rulebook.FMK, page: 87 }],
            requirements: 'Must meet Battle Lance requirements.',
        },
        alphaStrike: {
            effectDescription: 'Two units in this formation receive the Swordsman or Zweihander SPA. The same ability must be assigned to both units.',
            effectGroups: [{ abilityIds: ['swordsman', 'zweihander'], selection: 'choose-one', distribution: 'fixed', count: 2 }],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 63 }, { book: Rulebook.FMK, page: 87 }],
            requirements: 'Must meet Battle Lance requirements.',
        },
    },

    // ─── Command Lance ───────────────────────────────────────────────────
    //
    // Bonus: Classic grants one SPA each to 2 non-commanders; Alpha Strike
    //   grants one SPA each to half the formation (round up). The commander
    //   also gets Tactical Genius.
    //
    {
        id: 'command-lance',
        name: 'Command',
        description: 'A command-centered formation with diverse capabilities intended to support and protect its leader.',
        classic: {
            effectDescription: 'Prior to the beginning of play, two non-commander units each receive one of these SPAs (each may choose differently): Antagonizer, Blood Stalker, Combat Intuition, Eagle\'s Eyes, Marksman, or Multi-Tasker. The commander receives Tactical Genius; if the commander already has it, instead add +1 to the force\'s Initiative results, including Tactical Genius rerolls.',
            effectGroups: [
                { abilityIds: ['antagonizer', 'blood_stalker', 'combat_intuition', 'eagles_eyes', 'marksman', 'multi_tasker'], selection: 'choose-each', distribution: 'fixed', count: 2, excludeCommander: true },
                { abilityIds: ['tactical_genius'], selection: 'all', distribution: 'commander' },
            ],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 63 }],
            requirements: 'Minimum 3 units. 50% must have Sniper, Missile Boat, Skirmisher, or Juggernaut role. At least 1 additional Brawler, Striker, or Scout.',
        },
        alphaStrike: {
            effectDescription: 'Prior to the beginning of play, half the units in this formation (round up) each receive one of these SPAs (each may choose differently): Antagonizer, Blood Stalker, Combat Intuition, Eagle\'s Eyes, Marksman, or Multi-Tasker. In addition, the commander receives Tactical Genius; if the commander already has it, instead add +1 to the force\'s Initiative results, including Tactical Genius rerolls.',
            effectGroups: [
                { abilityIds: ['antagonizer', 'blood_stalker', 'combat_intuition', 'eagles_eyes', 'marksman', 'multi_tasker'], selection: 'choose-each', distribution: 'half-round-up' },
                { abilityIds: ['tactical_genius'], selection: 'all', distribution: 'commander' },
            ],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.ASCE, page: 120 }],
            requirements: 'Minimum 3 units. 50% must have Sniper, Missile Boat, Skirmisher, or Juggernaut role. At least 1 additional Brawler, Striker, or Scout.',
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
        description: 'Highly organized Kurita units trained to operate as a synchronized whole.',
        exclusiveFaction: ['Draconis Combine'],
        classic: {
            effectDescription: 'Designate one unit as the formation\'s commander; that unit receives the Tactical Genius, Antagonizer, or Sniper SPA. All units in the formation receive the Iron Will or Speed Demon SPA; the entire formation must select the same ability.',
            effectGroups: [
                { abilityIds: ['tactical_genius', 'antagonizer', 'sniper'], selection: 'choose-one', distribution: 'commander' },
                { abilityIds: ['iron_will', 'speed_demon'], selection: 'choose-one', distribution: 'all' },
            ],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 63 }, { book: Rulebook.FMK, page: 87 }],
            requirements: 'Minimum 3 units. Draconis Combine only. All units must share the same weight class and chassis.',
        },
        alphaStrike: {
            effectDescription: 'Designate one unit as the formation\'s commander; that unit receives the Tactical Genius, Antagonizer, or Sniper SPA. All units in the formation receive the Iron Will or Speed Demon SPA; the entire formation must select the same ability.',
            effectGroups: [
                { abilityIds: ['tactical_genius', 'antagonizer', 'sniper'], selection: 'choose-one', distribution: 'commander' },
                { abilityIds: ['iron_will', 'speed_demon'], selection: 'choose-one', distribution: 'all' },
            ],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 63 }, { book: Rulebook.FMK, page: 87 }],
            requirements: 'Minimum 3 units. Draconis Combine only. All units must share the same Size class and chassis.',
        },
    },

    //
    // VEHICLE COMMAND LANCE
    //
    {
        id: 'vehicle-command-lance',
        name: 'Vehicle Command',
        description: 'A vehicle command variant built around a designated commander and two vehicles with qualifying combat roles.',
        classic: {
            effectDescription: 'As the standard Command Lance: two non-commander units each receive one eligible SPA, and the commander receives Tactical Genius (or the Initiative bonus if it already has Tactical Genius).',
            effectGroups: [
                { abilityIds: ['antagonizer', 'blood_stalker', 'combat_intuition', 'eagles_eyes', 'marksman', 'multi_tasker'], selection: 'choose-each', distribution: 'fixed', count: 2, excludeCommander: true },
                { abilityIds: ['tactical_genius'], selection: 'all', distribution: 'commander' },
            ],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 63 }],
            requirements: 'Minimum 3 units. All must be combat vehicles. At least two units must have the Sniper, Missile Boat, Skirmisher, or Juggernaut role.',
        },
        alphaStrike: {
            effectDescription: 'As the standard Command Lance: half the units (round up) each receive one eligible SPA, and the commander receives Tactical Genius (or the Initiative bonus if it already has Tactical Genius).',
            effectGroups: [
                { abilityIds: ['antagonizer', 'blood_stalker', 'combat_intuition', 'eagles_eyes', 'marksman', 'multi_tasker'], selection: 'choose-each', distribution: 'half-round-up' },
                { abilityIds: ['tactical_genius'], selection: 'all', distribution: 'commander' },
            ],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.ASCE, page: 120 }],
            requirements: 'Minimum 3 units. All must be combat vehicles. At least two units must have the Sniper, Missile Boat, Skirmisher, or Juggernaut role.',
        },
    },

    // ─── Fire Lance ──────────────────────────────────────────────────────
    //
    // 75% Missile Boat or Sniper roles.
    // Bonus: Classic grants Sniper to up to 2 units per turn; Alpha Strike
    //   grants it to up to half (round down).
    //
    {
        id: 'fire-lance',
        name: 'Fire',
        description: 'Long-range firepower specialists that stay clear of the enemy while raining down destructive attacks.',
        classic: {
            effectDescription: 'At the beginning of each turn, up to two units in this formation may receive the Sniper SPA, which affects their weapon attacks during that turn.',
            effectGroups: [{ abilityIds: ['sniper'], selection: 'all', distribution: 'fixed', count: 2, perTurn: true }],
            idealRole: 'Missile Boat',
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 64 }],
            requirements: 'Minimum 3 units. 75% must have the Missile Boat or Sniper role.',
        },
        alphaStrike: {
            effectDescription: 'At the beginning of each turn, up to half the units (rounded down) may receive the Sniper SPA, which affects their weapon attacks during that turn. Destroyed or withdrawn units do not count.',
            effectGroups: [{ abilityIds: ['sniper'], selection: 'all', distribution: 'half-round-down', perTurn: true }],
            idealRole: 'Missile Boat',
            minUnits: 3,
            rulesRef: [{ book: Rulebook.ASCE, page: 119 }],
            requirements: 'Minimum 3 units. 75% must have the Missile Boat or Sniper role.',
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
        description: 'A Fire Lance variant specializing in engaging airborne threats with dedicated anti-air capabilities.',
        classic: {
            effectDescription: 'At the beginning of each turn, up to two units may receive the Anti-Aircraft Specialist Special Command Ability, which affects their weapon attacks during that turn.',
            effectGroups: [{ commandAbilityIds: ['anti_aircraft_specialists'], selection: 'all', distribution: 'fixed', count: 2, perTurn: true }],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 64 }],
            requirements: 'Minimum 3 units. Must meet Fire Lance requirements. At least 2 units with an LBX autocannon, standard autocannon, artillery weapon, or Anti-Aircraft Targeting quirk.',
        },
        alphaStrike: {
            effectDescription: 'At the beginning of each turn, up to half the units (rounded down) may receive the Anti-Aircraft Specialists Special Command Ability, which affects their weapon attacks during that turn. Destroyed or withdrawn units do not count.',
            effectGroups: [{ commandAbilityIds: ['anti_aircraft_specialists'], selection: 'all', distribution: 'half-round-down', perTurn: true }],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.ASCE, page: 119 }],
            requirements: 'Minimum 3 units. Must meet Fire Lance requirements. At least 2 units with FLK, AC, or ART specials.',
        },
    },

    //
    // ARTILLERY FIRE LANCE
    // Bonus: Up to 2 units per turn get Oblique Artilleryman.
    //
    {
        id: 'artillery-fire-lance',
        name: 'Artillery Fire',
        description: 'A Fire Lance variant built to coordinate artillery attacks from a protected distance.',
        classic: {
            effectDescription: 'At the beginning of each turn, up to two units may receive the Oblique Artilleryman SPA, which affects their artillery weapon attacks during that turn.',
            effectGroups: [{ abilityIds: ['oblique_artilleryman'], selection: 'all', distribution: 'fixed', count: 2, perTurn: true }],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 64 }],
            requirements: 'Minimum 3 units. At least 2 units with artillery weapons.',
        },
        alphaStrike: {
            effectDescription: 'At the beginning of each turn, up to half the units (rounded down) may receive the Oblique Artilleryman SPA, which affects their artillery weapon attacks during that turn. Destroyed or withdrawn units do not count.',
            effectGroups: [{ abilityIds: ['oblique_artilleryman'], selection: 'all', distribution: 'half-round-down', perTurn: true }],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.ASCE, page: 119 }],
            requirements: 'Minimum 3 units. At least 2 units with the ART special.',
        },
    },

    //
    // DIRECT FIRE LANCE
    // Bonus: Up to 2 units per turn get Weapon Specialist.
    //
    {
        id: 'direct-fire-lance',
        name: 'Direct Fire',
        description: 'Heavy direct-fire specialists that concentrate powerful attacks on priority targets.',
        classic: {
            effectDescription: 'At the beginning of each turn, up to two units may receive the Weapon Specialist SPA, which affects their weapon attacks during that turn.',
            effectGroups: [{ abilityIds: ['weapon_specialist'], selection: 'all', distribution: 'fixed', count: 2, perTurn: true }],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 64 }],
            requirements: 'Minimum 3 units. At least 2 heavy or assault units. All units must deal 10+ damage at 18 hexes.',
        },
        alphaStrike: {
            effectDescription: 'At the beginning of each turn, up to half the units (rounded down) may receive the Weapon Specialist SPA, which affects their weapon attacks during that turn. Destroyed or withdrawn units do not count.',
            effectGroups: [{ abilityIds: ['weapon_specialist'], selection: 'all', distribution: 'half-round-down', perTurn: true }],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.ASCE, page: 119 }],
            requirements: 'Minimum 3 units. At least 2 Size 3+ units. All units must have long-range damage ≥ 2.',
        },
    },

    //
    // FIRE SUPPORT LANCE
    // Bonus: Up to 2 units per turn get Oblique Attacker.
    //
    {
        id: 'fire-support-lance',
        name: 'Fire Support',
        description: 'Indirect-fire specialists that coordinate artillery support for the rest of the force.',
        classic: {
            effectDescription: 'At the beginning of each turn, up to two units may receive the Oblique Attacker SPA, which affects their indirect weapon attacks during that turn.',
            effectGroups: [{ abilityIds: ['oblique_attacker'], selection: 'all', distribution: 'fixed', count: 2, perTurn: true }],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 64 }],
            requirements: 'Minimum 3 units. At least 3 units with weapons capable of indirect fire.',
        },
        alphaStrike: {
            effectDescription: 'At the beginning of each turn, up to half the units (rounded down) may receive the Oblique Attacker SPA, which affects their indirect weapon attacks during that turn. Destroyed or withdrawn units do not count.',
            effectGroups: [{ abilityIds: ['oblique_attacker'], selection: 'all', distribution: 'half-round-down', perTurn: true }],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.ASCE, page: 119 }],
            requirements: 'Minimum 3 units. At least 3 units with the IF (Indirect Fire) special.',
        },
    },

    //
    // LIGHT FIRE LANCE
    // Bonus: Coordinated Fire Support: if a unit hits, others get -1 TN (cumulative, max -3).
    //
    {
        id: 'light-fire-lance',
        name: 'Light Fire',
        description: 'Light units trained to combine their fire so they can threaten targets too large for any one unit.',
        classic: {
            effectDescription: 'Coordinated Fire Support: If a unit in this formation hits a target with at least one weapon, other units attacking the same target receive a -1 modifier to their attack rolls. This is cumulative per attacking unit, to a maximum -3 To-Hit modifier.',
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 64 }, { book: Rulebook.FMD, page: 82 }],
            requirements: 'Minimum 3 units. No heavy or assault units. 50% must have the Missile Boat or Sniper role.',
        },
        alphaStrike: {
            effectDescription: 'Coordinated Fire Support: If a unit in this formation hits a target with at least one weapon, other units attacking the same target receive a -1 modifier to their attack rolls. This is cumulative per attacking unit, to a maximum -3 To-Hit modifier.',
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 64 }, { book: Rulebook.FMD, page: 82 }],
            requirements: 'Minimum 3 units. No Size 3+ units. 50% must have the Missile Boat or Sniper role.',
        },
    },

    // ─── Pursuit Lance ───────────────────────────────────────────────────
    //
    // Bonus: 75% receive Blood Stalker. May target enemy Formation instead of unit.
    //
    {
        id: 'pursuit-lance',
        name: 'Pursuit',
        description: 'Fast, hard-hitting scout hunters that can chase reconnaissance units or conduct reconnaissance in force.',
        classic: {
            effectDescription: '75% of the units receive the Blood Stalker SPA.',
            effectGroups: [{ abilityIds: ['blood_stalker'], selection: 'all', distribution: 'percent-75' }],
            idealRole: 'Striker',
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 65 }],
            requirements: 'Minimum 3 units. All light or medium. 75% must have walk ≥ 6. At least 1 unit dealing 5+ damage at 15 hexes.',
        },
        alphaStrike: {
            effectDescription: '75% of the units receive the Blood Stalker SPA. The Pursuit Lance may choose an enemy formation rather than a single unit as the Blood Stalker target. All members must choose the same enemy formation.',
            effectGroups: [{ abilityIds: ['blood_stalker'], selection: 'all', distribution: 'percent-75' }],
            idealRole: 'Striker',
            minUnits: 3,
            rulesRef: [{ book: Rulebook.ASCE, page: 120 }],
            requirements: 'Minimum 3 units. All Size ≤ 2. 75% must have Move [[12]]+. At least 1 unit with medium-range damage > 1.',
        },
    },

    //
    // PROBE LANCE
    //
    {
        id: 'probe-lance',
        name: 'Probe',
        description: 'A lighter Pursuit variant for aggressive reconnaissance, using mobility and coordinated fire to probe enemy positions.',
        classic: {
            effectDescription: '75% of the units receive the Blood Stalker SPA.',
            effectGroups: [{ abilityIds: ['blood_stalker'], selection: 'all', distribution: 'percent-75' }],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 65 }],
            requirements: 'Minimum 3 units. No assault units. 75% must have walk ≥ 6. All units must deal 10+ damage at 9 hexes.',
        },
        alphaStrike: {
            effectDescription: '75% of the units receive the Blood Stalker SPA. The Probe Lance may choose an enemy formation rather than a single unit as the Blood Stalker target. All members must choose the same enemy formation.',
            effectGroups: [{ abilityIds: ['blood_stalker'], selection: 'all', distribution: 'percent-75' }],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.ASCE, page: 120 }],
            requirements: 'Minimum 3 units. No Size 4+ units. 75% must have Move [[10]]+. All units must have medium-range damage ≥ 2.',
        },
    },

    //
    // SWEEP LANCE
    //
    {
        id: 'sweep-lance',
        name: 'Sweep',
        description: 'A mobile Pursuit variant focused on close-range sweeping attacks against exposed enemy formations.',
        classic: {
            effectDescription: '75% of the units receive the Blood Stalker SPA.',
            effectGroups: [{ abilityIds: ['blood_stalker'], selection: 'all', distribution: 'percent-75' }],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 65 }],
            requirements: 'Minimum 3 units. All light or medium. All units must have walk ≥ 5. All units must deal 10+ damage at 6 hexes.',
        },
        alphaStrike: {
            effectDescription: '75% of the units receive the Blood Stalker SPA. The Sweep Lance may choose an enemy formation rather than a single unit as the Blood Stalker target. All members must choose the same enemy formation.',
            effectGroups: [{ abilityIds: ['blood_stalker'], selection: 'all', distribution: 'percent-75' }],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.ASCE, page: 120 }],
            requirements: 'Minimum 3 units. All Size ≤ 2. All units must have Move [[10]]+. All units must have short-range damage ≥ 2.',
        },
    },

    // ─── Recon Lance ─────────────────────────────────────────────────────
    //
    // Bonus: Classic chooses Eagle's Eyes or Maneuvering Ace for up to 3 and
    //   grants Forward Observer to all. Alpha Strike chooses one of all three
    //   SPAs and grants the chosen ability to the entire formation.
    //
    {
        id: 'recon-lance',
        name: 'Recon',
        description: 'Extremely fast scouts that rush ahead to identify objectives, evade fire, and harass or flank opponents.',
        classic: {
            effectDescription: 'At the beginning of play, choose either Eagle\'s Eyes or Maneuvering Ace and apply it to up to three units. The recipients and chosen SPA cannot change during the scenario. In addition, all units receive Forward Observer.',
            effectGroups: [
                { abilityIds: ['eagles_eyes', 'maneuvering_ace'], selection: 'choose-one', distribution: 'fixed', count: 3 },
                { abilityIds: ['forward_observer'], selection: 'all', distribution: 'all' },
            ],
            idealRole: 'Scout',
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 65 }],
            requirements: 'Minimum 3 units. All units must have walk ≥ 5. At least 2 Scout or Striker roles.',
        },
        alphaStrike: {
            effectDescription: 'At the beginning of play, choose Eagle\'s Eyes, Forward Observer, or Maneuvering Ace. Every unit in the formation receives the chosen SPA, which cannot be changed during the scenario.',
            effectGroups: [{
                abilityIds: ['eagles_eyes', 'forward_observer', 'maneuvering_ace'],
                selection: 'choose-one',
                distribution: 'all',
            }],
            idealRole: 'Scout',
            minUnits: 3,
            rulesRef: [{ book: Rulebook.ASCE, page: 119 }],
            requirements: 'Minimum 3 units. All units must have Move [[10]]+. At least 2 Scout or Striker roles.',
        },
    },

    //
    // HEAVY RECON LANCE
    //
    {
        id: 'heavy-recon-lance',
        name: 'Heavy Recon',
        description: 'An armored reconnaissance variant that keeps the scouting role while adding heavier units.',
        classic: {
            effectDescription: 'As the standard Recon Lance, except only two units may receive the chosen Eagle\'s Eyes or Maneuvering Ace SPA. All units still receive Forward Observer.',
            effectGroups: [
                { abilityIds: ['eagles_eyes', 'maneuvering_ace'], selection: 'choose-one', distribution: 'fixed', count: 2 },
                { abilityIds: ['forward_observer'], selection: 'all', distribution: 'all' },
            ],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 65 }],
            requirements: 'Minimum 3 units. All walk ≥ 4. At least 2 with walk ≥ 5. At least 1 heavy or assault. At least 2 Scouts.',
        },
        alphaStrike: {
            effectDescription: 'As the standard Recon Lance, except only up to half the units (round up) may receive the chosen Eagle\'s Eyes, Forward Observer, or Maneuvering Ace SPA.',
            effectGroups: [{
                abilityIds: ['eagles_eyes', 'forward_observer', 'maneuvering_ace'],
                selection: 'choose-one',
                distribution: 'half-round-up',
            }],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.ASCE, page: 120 }],
            requirements: 'Minimum 3 units. All Move [[8]]+. At least 2 with Move [[10]]+. At least 1 Size 3+ unit. At least 2 Scouts.',
        },
    },

    //
    // LIGHT RECON LANCE
    //
    {
        id: 'light-recon-lance',
        name: 'Light Recon',
        description: 'Ultra-mobile light scouts built for deep reconnaissance, spotting, and rapid maneuver.',
        classic: {
            effectDescription: 'As the standard Recon Lance, except all units receive the chosen Eagle\'s Eyes or Maneuvering Ace SPA, in addition to Forward Observer.',
            effectGroups: [
                { abilityIds: ['eagles_eyes', 'maneuvering_ace'], selection: 'choose-one', distribution: 'all' },
                { abilityIds: ['forward_observer'], selection: 'all', distribution: 'all' },
            ],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 65 }],
            requirements: 'Minimum 3 units. All light. All walk ≥ 6. All must have the Scout role.',
        },
        alphaStrike: {
            effectDescription: 'As the standard Recon Lance, except each unit may independently receive Eagle\'s Eyes, Forward Observer, or Maneuvering Ace.',
            effectGroups: [{
                abilityIds: ['eagles_eyes', 'forward_observer', 'maneuvering_ace'],
                selection: 'choose-each',
                distribution: 'all',
            }],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.ASCE, page: 119 }],
            requirements: 'Minimum 3 units. All Size 1. All Move [[12]]+. All must have the Scout role.',
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
        description: 'Independent defenders for installations and other vital sites, combining terrain expertise with the speed to pursue raiders.',
        classic: {
            effectDescription: 'If acting as the Defender, 75% of the units receive Environmental Specialist or Terrain Master (the same variation for each unit). Otherwise, 75% receive Speed Demon.',
            effectGroups: [{ abilityIds: ['speed_demon', 'environmental_specialist', 'terrain_master_drag_racer', 'terrain_master_forest_ranger', 'terrain_master_frogman', 'terrain_master_mountaineer', 'terrain_master_nightwalker', 'terrain_master_sea_monster', 'terrain_master_swamp_beast'], selection: 'choose-one', distribution: 'percent-75' }],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 65 }, { book: Rulebook.FMMERC, page: 91 }],
            requirements: 'Minimum 3 units. At most 1 assault unit. At least 1 Scout or Striker. At least 1 Sniper or Missile Boat.',
        },
        alphaStrike: {
            effectDescription: 'If acting as the Defender, 75% of the units receive Environmental Specialist or Terrain Master (the same variation for each unit). Otherwise, 75% receive Speed Demon.',
            effectGroups: [{ abilityIds: ['speed_demon', 'environmental_specialist', 'terrain_master_drag_racer', 'terrain_master_forest_ranger', 'terrain_master_frogman', 'terrain_master_mountaineer', 'terrain_master_nightwalker', 'terrain_master_sea_monster', 'terrain_master_swamp_beast'], selection: 'choose-one', distribution: 'percent-75' }],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 65 }, { book: Rulebook.FMMERC, page: 91 }],
            requirements: 'Minimum 3 units. At most 1 Size 4+ unit. At least 1 Scout or Striker. At least 1 Sniper or Missile Boat.',
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
        description: 'Fast-moving units that bring firepower to the fight, survive the engagement, then withdraw or hold until the main force arrives.',
        classic: {
            effectDescription: '75% of the units receive the Speed Demon SPA.',
            effectGroups: [{ abilityIds: ['speed_demon'], selection: 'all', distribution: 'percent-75' }],
            idealRole: 'Striker',
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 66 }],
            requirements: 'Minimum 3 units. All walk ≥ 5 or jump ≥ 4. No assault units. 50% must have Striker or Skirmisher role.',
        },
        alphaStrike: {
            effectDescription: '75% of the units (round normally) receive the Speed Demon SPA.',
            effectGroups: [{ abilityIds: ['speed_demon'], selection: 'all', distribution: 'percent-75' }],
            idealRole: 'Striker',
            minUnits: 3,
            rulesRef: [{ book: Rulebook.ASCE, page: 118 }],
            requirements: 'Minimum 3 units. All Move [[10]]+ or Jump [[8]]+. No Size 4+ units. 50% must have Striker or Skirmisher role.',
        },
    },

    //
    // HAMMER LANCE (exclusive to House Marik)
    // Bonus: Up to 2 units per turn get Jumping Jack or Speed Demon.
    //
    {
        id: 'hammer-lance',
        name: 'Hammer',
        description: 'Fast Marik flanking units trained to strike the enemy\'s flank or rear while an Anvil formation holds its attention.',
        exclusiveFaction: ['Free Worlds League'],
        classic: {
            effectDescription: 'At the beginning of each turn, up to two units may receive either Jumping Jack or Speed Demon. The same SPA may be assigned to both, or each may receive a different one.',
            effectGroups: [{ abilityIds: ['jumping_jack', 'speed_demon'], selection: 'choose-each', distribution: 'fixed', count: 2, perTurn: true }],
            idealRole: 'Striker',
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 66 }],
            requirements: 'Minimum 3 units. Free Worlds League only. All units must have walk ≥ 5.',
        },
        alphaStrike: {
            effectDescription: 'At the beginning of each turn, up to two units may receive either Jumping Jack or Speed Demon. The same SPA may be assigned to both, or each may receive a different one.',
            effectGroups: [{ abilityIds: ['jumping_jack', 'speed_demon'], selection: 'choose-each', distribution: 'fixed', count: 2, perTurn: true }],
            idealRole: 'Striker',
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 66 }],
            requirements: 'Minimum 3 units. Free Worlds League only. All units must have Move [[10]]+.',
        },
    },

    //
    // LIGHT STRIKER/CAVALRY LANCE
    //
    {
        id: 'light-striker-lance',
        name: 'Light Striker/Cavalry',
        nameAliases: ['Light Striker', 'Light Cavalry'],
        description: 'A light cavalry variant for swift flanking attacks and harassment.',
        classic: {
            effectDescription: '75% of the units receive the Speed Demon SPA.',
            effectGroups: [{ abilityIds: ['speed_demon'], selection: 'all', distribution: 'percent-75' }],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 66 }],
            requirements: 'Minimum 3 units. All walk ≥ 5. No heavy or assault units. At least 2 deal 5+ damage at 18 hexes. At least 2 Striker or Skirmisher roles.',
        },
        alphaStrike: {
            effectDescription: '75% of the units (round normally) receive the Speed Demon SPA.',
            effectGroups: [{ abilityIds: ['speed_demon'], selection: 'all', distribution: 'percent-75' }],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.ASCE, page: 118 }],
            requirements: 'Minimum 3 units. All Move [[10]]+. No Size 3+ units. At least 2 with long-range damage > 0. At least 2 Striker or Skirmisher roles.',
        },
    },

    //
    // HEAVY STRIKER/CAVALRY LANCE
    //
    {
        id: 'heavy-striker-lance',
        name: 'Heavy Striker/Cavalry',
        nameAliases: ['Heavy Striker', 'Heavy Cavalry'],
        description: 'A heavier cavalry variant combining speed with armor and long-range firepower.',
        classic: {
            effectDescription: '75% of the units receive the Speed Demon SPA.',
            effectGroups: [{ abilityIds: ['speed_demon'], selection: 'all', distribution: 'percent-75' }],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 66 }],
            requirements: 'Minimum 3 units. All walk ≥ 4. At least 3 heavy or assault. No light units. At least 1 deals 5+ damage at 18 hexes. At least 2 Striker or Skirmisher roles.',
        },
        alphaStrike: {
            effectDescription: '75% of the units (round normally) receive the Speed Demon SPA.',
            effectGroups: [{ abilityIds: ['speed_demon'], selection: 'all', distribution: 'percent-75' }],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.ASCE, page: 119 }],
            requirements: 'Minimum 3 units. All Move [[8]]+. At least 3 Size 3+. No Size 1 units. At least 1 with long-range damage > 1. At least 2 Striker or Skirmisher roles.',
        },
    },

    //
    // HORDE
    // Bonus: Swarm: when targeted, may switch target to another unit in formation.
    //
    {
        id: 'horde',
        name: 'Horde',
        description: 'Light "bug" BattleMechs that swarm and overwhelm larger opponents through numbers.',
        classic: {
            effectDescription: 'Swarm: When a unit is targeted, its player may switch the attack to another legal target in this formation at the same or shorter range. Only units that used Running, Jumping, or Flank movement points that turn may use this ability.',
            minUnits: 5,
            maxUnits: 10,
            rulesRef: [{ book: Rulebook.CO, page: 66 }, { book: Rulebook.FMK, page: 87 }],
            requirements: '5-10 units. All light. All must deal less than 11 damage at 9 hexes.',
        },
        alphaStrike: {
            effectDescription: 'Swarm: When any Unit in this Formation is targeted, the targeted Unit\'s player may switch the target to any other Unit in this Formation that is a legal target and at the same range or less from the attacker.',
            minUnits: 5,
            maxUnits: 10,
            rulesRef: [{ book: Rulebook.CO, page: 66 }, { book: Rulebook.FMK, page: 87 }],
            requirements: '5-10 units. All Size 1. All must have medium-range damage < 2.',
        },
    },

    {
        id: 'swarm',
        name: 'Swarm',
        description: 'A formation composed exclusively of small VTOL units.',
        classic: {
            effectDescription: 'Coordinated Fire: The formation may make a standard weapon attack against a target within Short Range and Line of Sight of all members as if it were a single Unit. Make one to-hit roll; on a hit, add 1 damage point to one attack.',
            effectGroups: [{ formationWideAbilities: [{ id: 'coordinated_fire', name: 'Coordinated Fire', summary: ['The formation may make a standard weapon attack against a target within Short Range and Line of Sight of all members as if it were a single Unit.', 'The targeted player chooses one attacking unit from which to calculate the to-hit modifiers. Make one to-hit roll for the formation; it hits or misses as one.', 'If the attack hits, add 1 damage point to one of the attacks. All other attacks use their standard damage.'], rulesRef: [{ book: Rulebook.FMMERC, page: 52 }] }], distribution: 'formation-wide' }],
            minUnits: 4,
            rulesRef: [{ book: Rulebook.FMMERC, page: 52 }],
            requirements: 'VTOL Company. All units must be VTOLs. No heavy or assault units.',
        },
        alphaStrike: {
            effectDescription: 'Coordinated Fire: The formation may make a standard weapon attack against a target within Short Range and Line of Sight of all members as if it were a single Unit. Make one to-hit roll; on a hit, add 1 damage point to one attack.',
            effectGroups: [{ formationWideAbilities: [{ id: 'coordinated_fire', name: 'Coordinated Fire', summary: ['The formation may make a standard weapon attack against a target within Short Range and Line of Sight of all members as if it were a single Unit.', 'The targeted player chooses one attacking unit from which to calculate the to-hit modifiers. Make one to-hit roll for the formation; it hits or misses as one.', 'If the attack hits, add 1 damage point to one of the attacks. All other attacks use their standard damage.'], rulesRef: [{ book: Rulebook.FMMERC, page: 52 }] }], distribution: 'formation-wide' }],
            minUnits: 4,
            rulesRef: [{ book: Rulebook.FMMERC, page: 52 }],
            requirements: 'VTOL Company. All units must be VTOLs. No Size 3+ units.',
        },
    },

    //
    // RANGER LANCE
    // Bonus: 75% receive one Terrain Master SPA (same variation for all).
    //
    {
        id: 'ranger-lance',
        name: 'Ranger',
        description: 'Terrain specialists trained to fight in heavy cover or ground that slows other forces.',
        classic: {
            effectDescription: 'At the beginning of play, 75% of the units receive one Terrain Master SPA. The same variation must be assigned to all recipients.',
            effectGroups: [{ abilityIds: ['terrain_master_drag_racer', 'terrain_master_forest_ranger', 'terrain_master_frogman', 'terrain_master_mountaineer', 'terrain_master_nightwalker', 'terrain_master_sea_monster', 'terrain_master_swamp_beast'], selection: 'choose-one', distribution: 'percent-75' }],
            idealRole: 'Skirmisher',
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 66 }],
            requirements: 'Minimum 3 units. No assault units.',
        },
        alphaStrike: {
            effectDescription: 'At the beginning of play, 75% of the units receive one Terrain Master SPA. The same variation must be assigned to all recipients.',
            effectGroups: [{ abilityIds: ['terrain_master_drag_racer', 'terrain_master_forest_ranger', 'terrain_master_frogman', 'terrain_master_mountaineer', 'terrain_master_nightwalker', 'terrain_master_sea_monster', 'terrain_master_swamp_beast'], selection: 'choose-one', distribution: 'percent-75' }],
            idealRole: 'Skirmisher',
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 66 }],
            requirements: 'Minimum 3 units. No Size 4+ units.',
        },
    },

    // ─── Support Lance ───────────────────────────────────────────────────
    {
        id: 'support-lance',
        name: 'Support',
        description: 'A multi-role formation that does not excel at one mission, instead reinforcing other formations.',
        classic: {
            minUnits: 3,
            effectDescription: 'Before play, designate another formation to support. For every two units in the supported formation using a formation bonus, one Support Lance unit receives the same ability. The copied bonus is retained while the Support Lance has at least three active units and is not lost if the supported formation falls below its own retention threshold. If the supported formation offers a choice of SPAs, choose the Support Lance\'s SPAs at setup; those choices may not change during play. When supporting a Command Lance, copy the SPAs actually granted to its non-commander units and assign each copied SPA to a Support Lance unit eligible for it; Tactical Genius is never copied.',
            effectGroups: [{ selection: 'copy', distribution: 'formation-target', recipientLimit: 'one-per-two-target-recipients' }],
            rulesRef: [{ book: Rulebook.CO, page: 66 }],
            requirements: 'Minimum 3 units. No additional composition requirements.',
        },
        alphaStrike: {
            minUnits: 3,
            effectDescription: 'Before play, designate another formation to support. Half the Support Lance units (round down) receive the same SPAs as the supported formation. The number of copies of each SPA may not exceed the number the supported formation receives at setup. If the supported formation assigns a bonus at the beginning of each turn, choose the Support Lance assignments at setup; they may not be moved during play. The copied bonuses are retained while the Support Lance has at least three active units and are not lost if the supported formation falls below its own retention threshold. When supporting a Command Lance, copy the SPAs actually granted to its non-commander units and assign each copied SPA to an appropriate Support Lance unit; Tactical Genius is never copied.',
            effectGroups: [{ selection: 'copy', distribution: 'formation-target', recipientLimit: 'half-self-round-down' }],
            rulesRef: [{ book: Rulebook.ASCE, page: 121 }],
            requirements: 'Minimum 3 units. No additional composition requirements.',
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
        description: 'Short-range, intensive fighters built for city combat, using jump movement to attack around buildings.',
        classic: {
            effectDescription: 'At the beginning of each turn, up to 75% of the units may receive Street Fighter (\'Mechs or ProtoMechs) or Urban Guerrilla (infantry). Vehicles receive the equivalent of 1-point Luck and a one-time use of Marksman.',
            effectGroups: [{ abilityIds: ['street_fighter', 'urban_guerrilla', 'lucky', 'marksman'], selection: 'choose-each', distribution: 'percent-75', perTurn: true }],
            idealRole: 'Ambusher',
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 67 }],
            requirements: 'Minimum 3 units. 50% must have jump movement or be infantry. 50% must have walk ≤ 4.',
        },
        alphaStrike: {
            effectDescription: 'At the beginning of each turn, up to 75% of the units may receive Street Fighter (\'Mechs or ProtoMechs) or Urban Guerrilla (infantry). Vehicles receive the equivalent of 1-point Luck and a one-time use of Marksman.',
            effectGroups: [{ abilityIds: ['street_fighter', 'urban_guerrilla', 'lucky', 'marksman'], selection: 'choose-each', distribution: 'percent-75', perTurn: true }],
            idealRole: 'Ambusher',
            minUnits: 3,
            rulesRef: [{ book: Rulebook.CO, page: 67 }],
            requirements: 'Minimum 3 units. 50% must have jump movement or be infantry. 50% must have ground Move ≤ [[8]].',
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
        description: 'A Clan combined-arms defensive Star that mixes BattleMechs or vehicles with Elementals and other ground units.',
        exclusiveFaction: CLAN_EXCLUSIVE_FACTIONS,
        classic: {
            effectDescription: 'The formation receives a Float Like a Butterfly SPA usable by any unit in the formation, with a maximum of six rerolls per scenario.',
            effectGroups: [{ abilityIds: ['float_like_a_butterfly'], selection: 'all', distribution: 'shared-pool', sharedPool: { totalUsesPerScenario: 6 } }],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.BOT, page: 27 }],
            requirements: 'Clan only. Minimum 2 combat vehicles or BattleMeks. Remainder must be Elementals, combat vehicles, or BattleMeks. Must be at least two different unit types.',
        },
        alphaStrike: {
            effectDescription: 'The formation receives a Float Like a Butterfly SPA usable by any unit in the formation, with a maximum of six rerolls per scenario.',
            effectGroups: [{ abilityIds: ['float_like_a_butterfly'], selection: 'all', distribution: 'shared-pool', sharedPool: { totalUsesPerScenario: 6 } }],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.BOT, page: 27 }],
            requirements: 'Clan only. Minimum 2 combat vehicles or BattleMeks. Remainder must be Elementals, combat vehicles, or BattleMeks. Must be at least two different unit types.',
        },
    },

    //
    // Rogue Star
    // Bonus: At the beginning of each turn, up to 2 units get Combat Intuition SPA.
    //
    {
        id: 'rogue-star',
        name: 'Rogue',
        description: 'A swift Clan strike formation built for sudden attacks and rapid pressure.',
        exclusiveFaction: CLAN_EXCLUSIVE_FACTIONS,
        classic: {
            effectDescription: 'At the beginning of each turn, up to two units may receive the Combat Intuition SPA.',
            effectGroups: [{ abilityIds: ['combat_intuition'], selection: 'all', distribution: 'fixed', count: 2, perTurn: true }],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.BOT, page: 27 }],
            requirements: 'Clan only. At least two units in the formation must be the same model (including the same OmniMek configuration).',
        },
        alphaStrike: {
            effectDescription: 'At the beginning of each turn, up to two units may receive the Combat Intuition SPA.',
            effectGroups: [{ abilityIds: ['combat_intuition'], selection: 'all', distribution: 'fixed', count: 2, perTurn: true }],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.BOT, page: 27 }],
            requirements: 'Clan only. At least two units in the formation must be the same model (including the same OmniMek configuration).',
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
        description: 'A Clan combined-arms command formation that coordinates aerospace and ground units around a skilled leader.',
        exclusiveFaction: CLAN_EXCLUSIVE_FACTIONS,
        classic: {
            effectDescription: 'Two non-commander units each receive one eligible Command Lance SPA, and the commander receives Tactical Genius (or its Initiative bonus). Aerospace units cannot be the force commander. Counts as a Command Star.',
            effectGroups: [
                { abilityIds: ['antagonizer', 'blood_stalker', 'combat_intuition', 'eagles_eyes', 'marksman', 'multi_tasker'], selection: 'choose-each', distribution: 'fixed', count: 2, excludeCommander: true },
                { abilityIds: ['tactical_genius'], selection: 'all', distribution: 'commander' },
            ],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.BOT, page: 27 }],
            requirements: 'Minimum 3 units. All must have Gunnery Skill 3 or lower. Must have 1 Aerospace Point. Others must be Mek or Battle Armor. If Mek, at least 2 units heavy or assault, and no lights.',
        },
        alphaStrike: {
            effectDescription: 'Two non-commander units each receive one eligible Command Lance SPA, and the commander receives Tactical Genius (or its Initiative bonus). Aerospace units cannot be the force commander. Counts as a Command Star.',
            effectGroups: [
                { abilityIds: ['antagonizer', 'blood_stalker', 'combat_intuition', 'eagles_eyes', 'marksman', 'multi_tasker'], selection: 'choose-each', distribution: 'fixed', count: 2, excludeCommander: true },
                { abilityIds: ['tactical_genius'], selection: 'all', distribution: 'commander' },
            ],
            minUnits: 3,
            rulesRef: [{ book: Rulebook.BOT, page: 27 }],
            requirements: 'Minimum 3 units. All must have skill 3 or lower. Must have 2 AF. Others must be BM, IM, or BA. If BM or IM, at least 2 units Size 3+ and no Size 1.',
        },
    },

    // ─── Aerospace Formations ────────────────────────────────────────────

    //
    // INTERCEPTOR SQUADRON
    // Bonus: Units with Thrust ≤ 9 get Speed Demon. Up to 2 get Range Master (Long).
    //
    {
        id: 'interceptor-squadron',
        name: 'Interceptor',
        description: 'Fast aerospace combat groups that strike approaching threats before they reach the main force, trading armor and firepower for speed.',
        classic: {
            effectDescription: 'Units with Thrust 9 or less receive Speed Demon. In addition, up to two fighters may receive Range Master (Long).',
            effectGroups: [
                { abilityIds: ['speed_demon'], selection: 'all', distribution: 'conditional', condition: 'Move (Thrust) ≤ 9' },
                { abilityIds: ['range_master'], selection: 'all', distribution: 'fixed', count: 2 },
            ],
            minUnits: 6,
            rulesRef: [{ book: Rulebook.CO, page: 68 }],
            requirements: 'Minimum 6 units. All must be aerospace or conventional fighters. More than 50% must have the Interceptor role.',
        },
        alphaStrike: {
            effectDescription: 'Units with Move (Thrust) 9 or less receive Speed Demon. In addition, up to two fighters may receive Range Master (Long).',
            effectGroups: [
                { abilityIds: ['speed_demon'], selection: 'all', distribution: 'conditional', condition: 'Move (Thrust) ≤ 9' },
                { abilityIds: ['range_master'], selection: 'all', distribution: 'fixed', count: 2 },
            ],
            minUnits: 6,
            rulesRef: [{ book: Rulebook.ASCE, page: 122 }],
            requirements: 'Minimum 6 units. All must be aerospace or conventional fighters. More than 50% must have the Interceptor role.',
        },
    },

    //
    // AEROSPACE SUPERIORITY SQUADRON
    // Bonus: Up to 50% get up to 2 SPAs: Blood Stalker, Ride the Wash, Hot Dog.
    //
    {
        id: 'aerospace-superiority-squadron',
        name: 'Aerospace Superiority',
        description: 'An air-superiority formation balancing speed, firepower, and armor to defeat opposing aerospace units.',
        classic: {
            effectDescription: 'Before the scenario, assign up to two of Blood Stalker, Hot Dog, and Ride the Wash—in any combination—to up to half the units.',
            effectGroups: [{ abilityIds: ['blood_stalker', 'ride_the_wash', 'hot_dog'], selection: 'choose-each', distribution: 'up-to-50-percent', maxPerUnit: 2 }],
            minUnits: 6,
            rulesRef: [{ book: Rulebook.CO, page: 67 }],
            requirements: 'Minimum 6 units. All must be aerospace or conventional fighters. More than 50% must have the Interceptor or Fast Dogfighter role.',
        },
        alphaStrike: {
            effectDescription: 'Before the scenario, assign up to two of Blood Stalker, Hot Dog, and Ride the Wash—in any combination—to up to half the units.',
            effectGroups: [{ abilityIds: ['blood_stalker', 'ride_the_wash', 'hot_dog'], selection: 'choose-each', distribution: 'up-to-50-percent', maxPerUnit: 2 }],
            minUnits: 6,
            rulesRef: [{ book: Rulebook.ASCE, page: 122 }],
            requirements: 'Minimum 6 units. All must be aerospace or conventional fighters. More than 50% must have the Interceptor or Fast Dogfighter role.',
        },
    },

    //
    // FIRE SUPPORT SQUADRON
    // Bonus: Choose 2 pairs; each pair gets one SPA: Golden Goose, Ground Hugger,
    //   Hot Dog, or Shaky Stick. The two pairs may not receive the same SPA.
    //
    {
        id: 'fire-support-squadron',
        name: 'Fire Support',
        description: 'Long-range aerospace formations optimized for ground attack that can also back up interceptors and strike fighters.',
        classic: {
            effectDescription: 'Before the scenario, choose two fighter pairs and assign one SPA to each pair: Golden Goose, Ground Hugger, Hot Dog, or Shaky Stick. The pairs may not receive the same SPA.',
            effectGroups: [{ abilityIds: ['golden_goose', 'ground_hugger', 'hot_dog', 'shaky_stick'], selection: 'choose-each', distribution: 'fixed-pairs', count: 2 }],
            minUnits: 6,
            rulesRef: [{ book: Rulebook.CO, page: 68 }],
            requirements: 'Minimum 6 units. All must be aerospace or conventional fighters. At least 50% must have the Fire Support role; every remaining unit must have the Dogfighter role.',
        },
        alphaStrike: {
            effectDescription: 'Before the scenario, choose two fighter pairs and assign one SPA to each pair: Golden Goose, Ground Hugger, Hot Dog, or Shaky Stick. The pairs may not receive the same SPA.',
            effectGroups: [{ abilityIds: ['golden_goose', 'ground_hugger', 'hot_dog', 'shaky_stick'], selection: 'choose-each', distribution: 'fixed-pairs', count: 2 }],
            minUnits: 6,
            rulesRef: [{ book: Rulebook.ASCE, page: 122 }],
            requirements: 'Minimum 6 units. All must be aerospace or conventional fighters. At least 50% must have the Fire Support role; every remaining unit must have the Dogfighter role.',
        },
    },

    //
    // STRIKE SQUADRON
    // Bonus: Up to 50% get Speed Demon. Remainder get Golden Goose.
    //
    {
        id: 'strike-squadron',
        name: 'Strike',
        description: 'Aerospace formations for close air support and air-to-ground attacks, balancing potent firepower with reliable armor.',
        classic: {
            effectDescription: 'Up to 50% of the units may receive Speed Demon. The remaining fighters receive Golden Goose.',
            effectGroups: [
                { abilityIds: ['speed_demon'], selection: 'all', distribution: 'up-to-50-percent' },
                { abilityIds: ['golden_goose'], selection: 'all', distribution: 'remainder' },
            ],
            minUnits: 6,
            rulesRef: [{ book: Rulebook.CO, page: 68 }],
            requirements: 'Minimum 6 units. All must be aerospace or conventional fighters. More than 50% must have an Attack or Dogfighter role.',
        },
        alphaStrike: {
            effectDescription: 'Up to 50% of the units may receive Speed Demon. The remaining fighters receive Golden Goose.',
            effectGroups: [
                { abilityIds: ['speed_demon'], selection: 'all', distribution: 'up-to-50-percent' },
                { abilityIds: ['golden_goose'], selection: 'all', distribution: 'remainder' },
            ],
            minUnits: 6,
            rulesRef: [{ book: Rulebook.ASCE, page: 122 }],
            requirements: 'Minimum 6 units. All must be aerospace or conventional fighters. More than 50% must have an Attack or Dogfighter role.',
        },
    },

    //
    // ELECTRONIC WARFARE SQUADRON
    // Bonus: Communications Disruption SCA.
    //
    {
        id: 'electronic-warfare-squadron',
        name: 'Electronic Warfare',
        description: 'Aerospace support formations that disrupt enemy communications while countering hostile electronic warfare.',
        classic: {
            effectDescription: 'This squadron receives the Communications Disruption Special Command Ability. At the start of the Electronic Warfare Squadron\'s turn, roll 1D6; on a 6, one randomly determined enemy lance or squadron suffers Communications Disruption for one turn. If the full Special Command Abilities rules are in use and the force already has Communications Disruption, choose the affected enemy lance or squadron instead of determining it randomly. Ground units can be affected only while at least one Electronic Warfare Squadron unit is flying over the map where they are operating.',
            effectGroups: [{
                formationWideAbilities: [{
                    id: 'communications_disruption',
                    name: 'Communications Disruption',
                    summary: [
                        'Before play, designate opposing lances up to the number controlled by the force commander.',
                        'Each turn roll 1D6; on a 6, one random designated lance may expend only Walking, Cruising, or Safe Thrust movement that turn.',
                        'Units using only Jumping, VTOL, or UMU movement are unaffected.',
                    ],
                    rulesRef: [{ book: Rulebook.CO, page: 84 }],
                }],
                distribution: 'formation-wide',
            }],
            minUnits: 6,
            rulesRef: [{ book: Rulebook.CO, page: 67 }],
            requirements: 'Minimum 6 units. All must be aerospace or conventional fighters. More than 50% must have ECM, BAP, or TAG equipment.',
        },
        alphaStrike: {
            effectDescription: 'This squadron receives the Communications Disruption Special Command Ability. At the start of the Electronic Warfare Squadron\'s turn, roll 1D6; on a 6, one randomly determined enemy lance or squadron suffers Communications Disruption for one turn. If the full Special Command Abilities rules are in use and the force already has Communications Disruption, choose the affected enemy lance or squadron instead of determining it randomly. Ground units can be affected only while at least one Electronic Warfare Squadron unit is flying over the map where they are operating.',
            effectGroups: [{
                formationWideAbilities: [{
                    id: 'communications_disruption',
                    name: 'Communications Disruption',
                    summary: [
                        'Each turn roll 1D6; on a 6, one random enemy lance, Star, or Level II reduces Move by [[4]] (minimum [[1]]) for the turn.',
                        'Aerospace elements reduce base Thrust by 1 instead. Requires a 2:1 Battlefield Intelligence ratio if BI rules are in play.',
                    ],
                    rulesRef: [{ book: Rulebook.ASCE, page: 103 }],
                }],
                distribution: 'formation-wide',
            }],
            minUnits: 6,
            rulesRef: [{ book: Rulebook.ASCE, page: 122 }],
            requirements: 'Minimum 6 units. All must be aerospace or conventional fighters. More than 50% must have EW specials (PRB, AECM, ECM, TAG, etc.).',
        },
    },

    //
    // TRANSPORT SQUADRON
    // Bonus: Choose one SPA for all Transport-role units: Dust-Off, Ride the Wash, Wind Walker.
    //
    {
        id: 'transport-squadron',
        name: 'Transport',
        description: 'Cargo and troop-moving aerospace formations escorted by fighters, avoiding air battles when possible.',
        classic: {
            effectDescription: 'Choose Dust-Off, Ride the Wash, or Wind Walker and apply it to all Transport-role units.',
            effectGroups: [{ abilityIds: ['dust_off', 'ride_the_wash', 'wind_walker'], selection: 'choose-one', distribution: 'role-filtered', roleFilter: 'Transport' }],
            minUnits: 6,
            rulesRef: [{ book: Rulebook.CO, page: 68 }],
            requirements: 'Minimum 6 units. All must be support aircraft, conventional fighters, aerospace fighters, Small Craft, or DropShips. 50% or more must have the Transport role.',
        },
        alphaStrike: {
            effectDescription: 'Choose Dust-Off, Ride the Wash, or Wind Walker and apply it to all Transport-role units.',
            effectGroups: [{ abilityIds: ['dust_off', 'ride_the_wash', 'wind_walker'], selection: 'choose-one', distribution: 'role-filtered', roleFilter: 'Transport' }],
            minUnits: 6,
            rulesRef: [{ book: Rulebook.ASCE, page: 123 }],
            requirements: 'Minimum 6 units. All must be AF, CF, SC, DS/DA, or airborne SV units (airships or fixed-wing support vehicles). 50% or more must have the Transport role.',
        },
    },
];

const FORMATION_RUNTIME_DEFINITION_SOURCE_BY_ID = new Map(
    FORMATION_RUNTIME_DEFINITIONS.map((definition) => [definition.id, definition]),
);

const FORMATION_RUNTIME_DEFINITIONS_BY_GAME_SYSTEM: Readonly<Record<GameSystem, readonly FormationTypeDefinition[]>> = {
    [GameSystem.CLASSIC]: FORMATION_RUNTIME_DEFINITIONS.map((definition) => (
        resolveFormationTypeDefinition(definition, GameSystem.CLASSIC)
    )),
    [GameSystem.ALPHA_STRIKE]: FORMATION_RUNTIME_DEFINITIONS.map((definition) => (
        resolveFormationTypeDefinition(definition, GameSystem.ALPHA_STRIKE)
    )),
};

const FORMATION_RUNTIME_DEFINITION_BY_GAME_SYSTEM_AND_ID: Readonly<Record<GameSystem, ReadonlyMap<string, FormationTypeDefinition>>> = {
    [GameSystem.CLASSIC]: new Map(FORMATION_RUNTIME_DEFINITIONS_BY_GAME_SYSTEM[GameSystem.CLASSIC].map((definition) => [definition.id, definition])),
    [GameSystem.ALPHA_STRIKE]: new Map(FORMATION_RUNTIME_DEFINITIONS_BY_GAME_SYSTEM[GameSystem.ALPHA_STRIKE].map((definition) => [definition.id, definition])),
};

export function getFormationDefinitionSource(id: string): FormationTypeDefinitionSource | null {
    return FORMATION_RUNTIME_DEFINITION_SOURCE_BY_ID.get(id) ?? null;
}

export function getFormationDefinition(id: string, gameSystem: GameSystem): FormationTypeDefinition | null {
    return FORMATION_RUNTIME_DEFINITION_BY_GAME_SYSTEM_AND_ID[gameSystem].get(id) ?? null;
}

export function getFormationDefinitions(gameSystem: GameSystem): readonly FormationTypeDefinition[] {
    return FORMATION_RUNTIME_DEFINITIONS_BY_GAME_SYSTEM[gameSystem];
}

export const FORMATION_BLUEPRINTS: Readonly<Record<string, FormationRequirementBlueprintSource>> = {
    'anti-mech-lance': sharedBlueprint('anti-mech-lance', [all('anti-mech-all-infantry', 'All infantry units', 'infantry-unit')]),
    'assault-lance': sharedBlueprint('assault-lance', assaultLanceConstraints),
    'anvil-lance': sharedBlueprint('anvil-lance', [
        all('anvil-medium-plus', 'All medium+/Size 2+ units', 'medium-plus-size'),
        all('anvil-armor', 'All armor threshold', 'anvil-armor'),
        percent('anvil-weapons', '50% AC/FLK/LRM/SRM units', 'anvil-weapon', 0.5),
    ]),
    'fast-assault-lance': sharedBlueprint('fast-assault-lance', [...assaultLanceConstraints, all('fast-assault-move', 'All fast assault movement', 'fast-assault-move')]),
    'hunter-lance': sharedBlueprint('hunter-lance', [percent('hunter-role-percent', '50% Ambusher/Juggernaut units', 'hunter-role', 0.5)]),
    'battle-lance': { id: 'battle-lance', classic: classicBattleLanceConstraints, alphaStrike: battleLanceCoreConstraints },
    'light-battle-lance': sharedBlueprint('light-battle-lance', [
        percent('light-battle-light-percent', '75% light/Size 1 units', 'light-size', 0.75),
        all('light-battle-no-assault', 'No assault/Size 4+ units', 'ranger-size'),
        countMin('light-battle-scout', '1 Scout', 'scout-role', 1),
        matchedPairs('light-battle-vehicle-pairs', '2 matched light vehicle pairs', 'light-size', 2, 'combat-vehicle'),
    ]),
    'medium-battle-lance': sharedBlueprint('medium-battle-lance', [
        percent('medium-battle-medium-percent', '50% medium/Size 2 units', 'medium-size', 0.5),
        all('medium-battle-no-assault', 'No assault/Size 4+ units', 'ranger-size'),
        matchedPairs('medium-battle-vehicle-pairs', '2 matched medium vehicle pairs', 'medium-size', 2, 'combat-vehicle'),
    ]),
    'heavy-battle-lance': sharedBlueprint('heavy-battle-lance', [
        percent('heavy-battle-heavy-percent', '50% heavy/Size 3+ units', 'heavy-size', 0.5),
        countMax('heavy-battle-no-light', 'No light/Size 1 units', 'light-size', 0),
        matchedPairs('heavy-battle-vehicle-pairs', '2 matched heavy vehicle pairs', 'heavy-size', 2, 'combat-vehicle'),
    ]),
    'rifle-lance': sharedBlueprint('rifle-lance', [
        percent('rifle-medium-heavy', '75% medium/heavy or Size 2-3 units', 'rifle-medium-heavy-size', 0.75),
        percent('rifle-autocannon', '50% autocannon units', 'rifle-autocannon', 0.5),
        all('rifle-move', 'All rifle movement threshold', 'rifle-move'),
    ]),
    'berserker-lance': { id: 'berserker-lance', classic: classicBattleLanceConstraints, alphaStrike: battleLanceCoreConstraints },
    'command-lance': sharedBlueprint('command-lance', [
        percent('command-heavy-roles', '50% command heavy roles', 'command-heavy-role', 0.5),
        countMin('command-diverse-role', '1 Brawler/Striker/Scout', 'command-diverse-role', 1),
    ]),
    'order-lance': sharedBlueprint('order-lance', [sameTier('order-same-tier', 'Same Size/weight class'), sameChassis('order-same-chassis', 'Same chassis')]),
    'vehicle-command-lance': sharedBlueprint('vehicle-command-lance', [
        all('vehicle-command-all-vehicles', 'All combat vehicles', 'combat-vehicle'),
        countMin('vehicle-command-command-pair', '2 command-role vehicles', 'command-heavy-role', 2),
    ]),
    'fire-lance': sharedBlueprint('fire-lance', fireLanceConstraints),
    'anti-air-lance': sharedBlueprint('anti-air-lance', [...fireLanceConstraints, countMin('anti-air-equipment-count', '2 anti-air equipped units', 'anti-air-equipment', 2)]),
    'artillery-fire-lance': sharedBlueprint('artillery-fire-lance', [countMin('artillery-count', '2 artillery units', 'artillery-equipment', 2)]),
    'direct-fire-lance': sharedBlueprint('direct-fire-lance', [countMin('direct-fire-heavy-count', '2 heavy/Size 3+ units', 'heavy-size', 2), all('direct-fire-damage', 'All direct-fire damage threshold', 'direct-fire-damage')]),
    'fire-support-lance': sharedBlueprint('fire-support-lance', [countMin('fire-support-equipment-count', '3 indirect-fire units', 'fire-support-equipment', 3)]),
    'light-fire-lance': sharedBlueprint('light-fire-lance', [countMax('light-fire-no-heavy', 'No heavy/Size 3+ units', 'heavy-size', 0), percent('light-fire-role-percent', '50% Missile Boat/Sniper units', 'light-fire-role', 0.5)]),
    'pursuit-lance': {
        id: 'pursuit-lance',
        classic: [
            countMax('pursuit-no-heavy', 'All light-medium units', 'heavy-size', 0),
            percent('pursuit-move-percent', '75% pursuit movement threshold', 'pursuit-move', 0.75),
            countMin('pursuit-range', '1 medium range damage unit', 'medium-damage-positive', 1),
        ],
        alphaStrike: [
            countMax('pursuit-no-heavy', 'All Size 2 or smaller units', 'heavy-size', 0),
            percentNormally('pursuit-move-percent', '75% pursuit movement threshold (round normally)', 'pursuit-move', 0.75),
            countMin('pursuit-range', '1 medium range damage unit', 'medium-damage-positive', 1),
        ],
    },
    'probe-lance': sharedBlueprint('probe-lance', [all('probe-no-assault', 'No assault/Size 4+ units', 'ranger-size'), percent('probe-move-percent', '75% probe movement threshold', 'probe-move', 0.75), all('probe-damage', 'All medium damage threshold', 'medium-damage-2')]),
    'sweep-lance': sharedBlueprint('sweep-lance', [countMax('sweep-no-heavy', 'All light-medium/Size <= 2 units', 'heavy-size', 0), all('sweep-move', 'All sweep movement threshold', 'sweep-move'), all('sweep-damage', 'All short damage threshold', 'short-damage-2')]),
    'recon-lance': sharedBlueprint('recon-lance', [all('recon-move', 'All recon movement threshold', 'recon-move'), countMin('recon-role-count', '2 Scout/Striker units', 'scout-or-striker-role', 2)]),
    'heavy-recon-lance': sharedBlueprint('heavy-recon-lance', [all('heavy-recon-move', 'All heavy recon movement threshold', 'heavy-recon-move'), countMin('heavy-recon-fast-count', '2 faster units', 'recon-move', 2), countMin('heavy-recon-heavy-count', '1 heavy/Size 3+ unit', 'heavy-size', 1), countMin('heavy-recon-scout-count', '2 Scout units', 'scout-role', 2)]),
    'light-recon-lance': sharedBlueprint('light-recon-lance', [all('light-recon-light', 'All light/Size 1 units', 'light-size'), all('light-recon-fast', 'All very fast units', 'very-fast-move'), all('light-recon-scout', 'All Scout units', 'scout-role')]),
    'security-lance': sharedBlueprint('security-lance', [countMax('security-assault-max', 'At most 1 assault/Size 4+ unit', 'assault-size', 1), countMin('security-light-role', '1 Scout/Striker', 'security-light-role', 1), countMin('security-heavy-role', '1 Sniper/Missile Boat', 'security-heavy-role', 1)]),
    'striker-lance': sharedBlueprint('striker-lance', [all('striker-speed', 'All striker movement threshold', 'striker-speed'), countMax('striker-no-assault', 'No assault/Size 4+ units', 'assault-size', 0), percent('striker-role-percent', '50% Striker/Skirmisher units', 'striker-or-skirmisher-role', 0.5)]),
    'hammer-lance': sharedBlueprint('hammer-lance', [all('hammer-move', 'All hammer movement threshold', 'recon-move')]),
    'light-striker-lance': sharedBlueprint('light-striker-lance', [all('light-striker-move', 'All light striker movement threshold', 'recon-move'), countMax('light-striker-no-heavy', 'No heavy/Size 3+ units', 'heavy-size', 0), countMin('light-striker-long-damage', '2 long damage units', 'long-damage-positive', 2), countMin('light-striker-role-count', '2 Striker/Skirmisher units', 'striker-or-skirmisher-role', 2)]),
    'heavy-striker-lance': sharedBlueprint('heavy-striker-lance', [all('heavy-striker-move', 'All heavy striker movement threshold', 'heavy-recon-move'), countMin('heavy-striker-heavy-count', '3 heavy/Size 3+ units', 'heavy-size', 3), countMax('heavy-striker-no-light', 'No light/Size 1 units', 'light-size', 0), countMin('heavy-striker-long-damage', '1 strong long damage unit', 'long-damage-strong', 1), countMin('heavy-striker-role-count', '2 Striker/Skirmisher units', 'striker-or-skirmisher-role', 2)]),
    horde: sharedBlueprint('horde', [all('horde-all-light', 'All light/Size 1 units', 'light-size'), all('horde-low-damage', 'All low medium-range damage units', 'low-medium-damage')]),
    swarm: sharedBlueprint('swarm', [all('swarm-all-vtol', 'All VTOL units', 'vtol-unit'), countMax('swarm-no-heavy', 'No heavy/Size 3+ units', 'heavy-size', 0)]),
    'ranger-lance': sharedBlueprint('ranger-lance', [all('ranger-no-assault', 'No assault/Size 4+ units', 'ranger-size')]),
    'support-lance': sharedBlueprint('support-lance', []),
    'urban-lance': sharedBlueprint('urban-lance', [percent('urban-jump-infantry', '50% jump or infantry units', 'jump-or-infantry', 0.5), percent('urban-slow', '50% slow urban units', 'slow-urban-move', 0.5)]),
    'phalanx-star': sharedBlueprint('phalanx-star', [
        ...clanOnlyConstraints,
        all('phalanx-allowed', 'All allowed phalanx unit types', 'phalanx-allowed-unit'),
        anyOf('phalanx-shape', 'Phalanx combined-arms shape', [
            allOf('phalanx-bm-core', 'BM/Mek core plus support', [countMin('phalanx-bm-count', '2 BM/Mek units', 'phalanx-bm-or-mek', 2), countMin('phalanx-ba-cv-count', '1 BA/CV unit', 'phalanx-ba-or-cv', 1)]),
            allOf('phalanx-cv-core', 'CV core plus support', [countMin('phalanx-cv-count', '2 CV units', 'phalanx-cv', 2), countMin('phalanx-bm-ba-count', '1 BM/BA unit', 'phalanx-bm-or-ba', 1)]),
        ]),
    ]),
    'rogue-star': sharedBlueprint('rogue-star', [...clanOnlyConstraints, matchedPairs('rogue-model-pair', 'At least two same model/name units', 'clan-force', 1)]),
    'strategic-command-star': sharedBlueprint('strategic-command-star', [
        ...clanOnlyConstraints,
        all('strategic-skill', 'All skill 3 or lower', 'strategic-skill-3'),
        all('strategic-allowed', 'All strategic command unit types', 'aerospace-fighter-bm-ba-unit'),
        countExact('strategic-aero-count', 'Exactly 2 aerospace units', 'strategic-aero', 2),
        conditional('strategic-mek-conditions', 'BM/Mek heavy and no-light conditions', 'bm-or-mek-unit', [countMin('strategic-heavy-mek-count', '2 heavy BM/Mek units', 'heavy-bm-or-mek', 2), countMax('strategic-light-mek-count', 'No light BM/Mek units', 'light-bm-or-mek', 0)]),
        anyOf('strategic-core', 'BM/Mek or BA core', [countMin('strategic-bm-count', '2 BM/Mek units', 'bm-or-mek-unit', 2), countMin('strategic-ba-count', '1 BA unit', 'battle-armor-unit', 1)]),
    ]),
    'interceptor-squadron': sharedBlueprint('interceptor-squadron', [all('interceptor-all-aerospace', 'All aerospace or conventional fighters', 'aerospace-unit'), strictMajority('interceptor-role-majority', 'Strict majority Interceptor role', 'interceptor-role')]),
    'aerospace-superiority-squadron': sharedBlueprint('aerospace-superiority-squadron', [all('aerospace-superiority-all-aerospace', 'All aerospace or conventional fighters', 'aerospace-unit'), strictMajority('aerospace-superiority-role-majority', 'Strict majority Interceptor/Fast Dogfighter role', 'aerospace-superiority-role')]),
    'fire-support-squadron': sharedBlueprint('fire-support-squadron', [
        all('fire-support-squadron-all-aerospace', 'All aerospace or conventional fighters', 'aerospace-unit'),
        all('fire-support-squadron-roles', 'All Fire Support or Dogfighter roles', 'fire-support-or-dogfighter-role'),
        percent('fire-support-squadron-role', '50% Fire Support role', 'fire-support-role', 0.5),
    ]),
    'strike-squadron': sharedBlueprint('strike-squadron', [all('strike-all-aerospace', 'All aerospace or conventional fighters', 'aerospace-unit'), strictMajority('strike-role-majority', 'Strict majority Attack/Dogfighter role', 'attack-or-dogfighter-role')]),
    'electronic-warfare-squadron': sharedBlueprint('electronic-warfare-squadron', [all('ew-all-aerospace', 'All aerospace or conventional fighters', 'aerospace-unit'), strictMajority('ew-equipment-majority', 'Strict majority EW equipment', 'ew-equipment')]),
    'transport-squadron': sharedBlueprint('transport-squadron', [all('transport-all-aerospace', 'All permitted transport aircraft or craft', 'transport-squadron-unit'), percent('transport-role-percent', '50% Transport role', 'transport-role', 0.5)]),
};

export function hasFormationBlueprint(id: string): boolean {
    return FORMATION_BLUEPRINTS[id] !== undefined;
}

export function getFormationBlueprint(id: string, gameSystem: GameSystem): FormationRequirementBlueprint | null {
    const blueprint = FORMATION_BLUEPRINTS[id];
    if (!blueprint) return null;
    return {
        id: blueprint.id,
        constraints: gameSystem === GameSystem.CLASSIC ? blueprint.classic : blueprint.alphaStrike,
    };
}
