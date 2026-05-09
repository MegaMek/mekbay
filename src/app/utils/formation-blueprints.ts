import { GameSystem, Rulebook } from '../models/common.model';
import type { FormationTypeDefinition } from './formation-type.model';
import type { FormationConstraint, FormationPredicateId, FormationRequirementBlueprint } from './formation-requirement.model';

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

const battleLanceConstraints: readonly FormationConstraint[] = [
    percent('battle-heavy-percent', '50% heavy/Size 3+ units', 'heavy-size', 0.5),
    countMin('battle-role-count', '3 Brawler/Sniper/Skirmisher units', 'battle-role', 3),
    matchedPairs('battle-vehicle-pairs', '2 matched heavy/Size 3+ vehicle pairs', 'heavy-size', 2, 'combat-vehicle'),
];

const fireLanceConstraints: readonly FormationConstraint[] = [
    percent('fire-role-percent', '75% Missile Boat/Sniper units', 'fire-role', 0.75),
];

const clanOnlyConstraints: readonly FormationConstraint[] = [
    all('clan-force', 'Clan force', 'clan-force'),
];

function bloodStalkerFormationEffectDescription(formationName: string): (gameSystem: GameSystem) => string {
    return (gameSystem) => {
        const isAs = gameSystem === GameSystem.ALPHA_STRIKE;
        if (isAs) {
            return `75% of the units receive the Blood Stalker SPA. The ${formationName} may choose an enemy formation rather than a single unit as the Blood Stalker target. All members must choose the same enemy formation.`;
        } else {
            return '75% of the units receive the Blood Stalker SPA.';
        }
    };
}

export const FORMATION_RUNTIME_DEFINITIONS: FormationTypeDefinition[] = [

    {
        id: 'anti-mech-lance',
        name: 'Anti-\'Mech',
        description: 'All infantry units for urban and anti-mech warfare',
        effectDescription: 'Distracting Swarm: units in this formation swarming an enemy unit cause a +1 To-Hit modifier to any weapon attacks made by the enemy unit.',
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 61 }, { book: Rulebook.FMK, page: 87 }],
        requirements: (gameSystem) => {
			const inf = gameSystem === GameSystem.ALPHA_STRIKE ? ' (CI, BA, or PM)' : '';
            return `Minimum 3 units. All units must be Infantry${inf}.`;
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
        requirements: (gameSystem) => {
            if (gameSystem === GameSystem.ALPHA_STRIKE) {
                return 'Minimum 3 units. At least 3 units Size 3+. No Size 1 units. All armor ≥ 5. 75% must have medium-range damage ≥ 3. At least 1 Juggernaut or 2 Snipers.';
            }
            return 'Minimum 3 units. At least 3 heavy or assault. No light units. All armor ≥ 135 points. 75% must deal 25+ damage at 7 hexes. At least 1 Juggernaut or 2 Snipers.';
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
        exclusiveFaction: ['Free Worlds League'],
        idealRole: 'Juggernaut',
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 62 }],
        requirements: (gameSystem) => {
            if (gameSystem === GameSystem.ALPHA_STRIKE) {
                return 'Minimum 3 units. Free Worlds League only. All Size 2+. All armor ≥ 4. 50% must have AC, FLK, LRM, or SRM specials.';
            }
            return 'Minimum 3 units. Free Worlds League only. All medium or heavier. All armor ≥ 105 points. 50% must have autocannons, LRMs, or SRMs.';
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
        inheritParentEffects: true,
        effectGroups: [{
            abilityIds: ['stand_aside'],
            selection: 'all',
            distribution: 'fixed',
            count: 2,
            perTurn: true,
        }],
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 62 }, { book: Rulebook.ASCE, page: 118 }],
        requirements: (gameSystem) => {
            const move = gameSystem === GameSystem.ALPHA_STRIKE ? '[[10]]+ or any jump capability' : 'walk ≥ 5 or jump > 0';
            return `Must meet Assault Lance requirements. All units must have ${move}.`;
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
        rulesRef: [{ book: Rulebook.CO, page: 62 }, { book: Rulebook.FMD, page: 82 }],
        requirements: () => 'Minimum 3 units. At least 50% must have the Ambusher or Juggernaut role.',
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
        requirements: (gameSystem) => {
            if (gameSystem === GameSystem.ALPHA_STRIKE) {
                return 'Minimum 3 units. 50% must be Size 3+. At least 3 Brawler, Sniper, or Skirmisher roles. Vehicle formations require 2 matched pairs of Size 3+ units.';
            }
            return `Minimum 3 units. 50% must be heavy or assault. At least 3 Brawler, Sniper, or Skirmisher roles. Vehicle formations require 2 matched pairs of heavy units.`;
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
        rulesRef: [{ book: Rulebook.CO, page: 62 }, { book: Rulebook.ASCE, page: 118 }],
        requirements: (gameSystem) => {
            if (gameSystem === GameSystem.ALPHA_STRIKE) {
                return 'Minimum 3 units. 75% must be Size 1. No Size 4+ units. At least 1 Scout. Vehicle formations require 2 matched pairs of Size 1 units.';
            }
            return 'Minimum 3 units. 75% must be light. No assault units. At least 1 Scout. Vehicle formations require 2 matched pairs of light units.';
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
        rulesRef: [{ book: Rulebook.CO, page: 62 }, { book: Rulebook.ASCE, page: 118 }],
        requirements: (gameSystem) => {
            if (gameSystem === GameSystem.ALPHA_STRIKE) {
                return 'Minimum 3 units. 50% must be Size 2. No Size 4+ units. Vehicle formations require 2 matched pairs of Size 2 units.';
            }
            return 'Minimum 3 units. 50% must be medium. No assault units. Vehicle formations require 2 matched pairs of medium units.';
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
        rulesRef: [{ book: Rulebook.CO, page: 63 }, { book: Rulebook.ASCE, page: 118 }],
        requirements: (gameSystem) => {
            if (gameSystem === GameSystem.ALPHA_STRIKE) {
                return 'Minimum 3 units. 50% must be Size 3+. No Size 1 units. Vehicle formations require 2 matched pairs of Size 3+ units.';
            }
            return 'Minimum 3 units. 50% must be heavy or assault. No light units. Vehicle formations require 2 matched pairs of heavy units.';
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
        exclusiveFaction: ['Federated Suns', 'Federated Commonwealth'],
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 63 }, { book: Rulebook.FMD, page: 82 }],
        requirements: (gameSystem) => {
            if (gameSystem === GameSystem.ALPHA_STRIKE) {
                return 'Minimum 3 units. Federated Suns only. 75% must be Size 2-3. 50% must have AC or FLK special. All units Move [[8]]+.';
            }
            return 'Minimum 3 units. Federated Suns only. 75% must be medium or heavy. 50% must have autocannons (including LB-X, Ultra, or Rotary). All units walk ≥ 4.';
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
        description: 'Close combat specialists for physical attacks',
        effectDescription: 'Two units in this formation receive the Swordsman or Zweihander SPA. The same ability must be assigned to both units.',
        effectGroups: [{
            abilityIds: ['swordsman', 'zweihander'],
            selection: 'choose-one',
            distribution: 'fixed',
            count: 2,
        }],
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 63 }, { book: Rulebook.FMK, page: 87 }],
        requirements: (gameSystem) => {            
            return 'Must meet Battle Lance requirements.';
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
        exclusiveFaction: ['Draconis Combine'],
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 63 }, { book: Rulebook.FMK, page: 87 }],
        requirements: (gameSystem) => {
            const tier = gameSystem === GameSystem.ALPHA_STRIKE ? 'Size' : 'weight';
            return `Minimum 3 units. Draconis Combine only. All units must share the same ${tier} class and chassis.`;
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
        requirements: (gameSystem) => {
            if (gameSystem === GameSystem.ALPHA_STRIKE) {
                return 'Minimum 3 units. Must meet Fire Lance requirements. At least 2 units with FLK, AC, or ART specials.';
            }
            return 'Minimum 3 units. Must meet Fire Lance requirements. At least 2 units with an LBX autocannon, standard autocannon, artillery weapon, or Anti-Aircraft Targeting quirk.';
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
        requirements: (gameSystem) => {
            const artillery = gameSystem === GameSystem.ALPHA_STRIKE ? 'the ART special' : 'artillery weapons';
            return `Minimum 3 units. At least 2 units with ${artillery}.`;
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
        requirements: (gameSystem) => {
            if (gameSystem === GameSystem.ALPHA_STRIKE) {
                return 'Minimum 3 units. At least 2 Size 3+ units. All units must have long-range damage ≥ 2.';
            }
            return 'Minimum 3 units. At least 2 heavy or assault units. All units must deal 10+ damage at 18 hexes.';
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
        requirements: (gameSystem) => {
            const indirectFire = gameSystem === GameSystem.ALPHA_STRIKE ? 'the IF (Indirect Fire) special' : 'LRMs or artillery';
			 
            return `Minimum 3 units. At least 3 units with ${indirectFire}.`;
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
        rulesRef: [{ book: Rulebook.CO, page: 64 }, { book: Rulebook.FMD, page: 82 }],
        requirements: (gameSystem) => {
            const noHeavy = gameSystem === GameSystem.ALPHA_STRIKE ? 'Size 3+' : 'heavy or assault';
            return `Minimum 3 units. No ${noHeavy} units. 50% must have the Missile Boat or Sniper role.`;
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
        effectDescription: bloodStalkerFormationEffectDescription('Pursuit Lance'),
        effectGroups: [{
            abilityIds: ['blood_stalker'],
            selection: 'all',
            distribution: 'percent-75',
        }],
        idealRole: 'Striker',
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 65 }, { book: Rulebook.ASCE, page: 120 }],
        requirements: (gameSystem) => {
            if (gameSystem === GameSystem.ALPHA_STRIKE) {
                return 'Minimum 3 units. All Size ≤ 2. 75% must have Move [[12]]+. At least 1 unit with medium-range damage > 1.';
            }
            return 'Minimum 3 units. All light or medium. 75% must have walk ≥ 6. At least 1 unit dealing 5+ damage at 15 hexes.';
        },
    },

    //
    // PROBE LANCE
    //
    {
        id: 'probe-lance',
        name: 'Probe',
        description: 'Mobile reconnaissance force',
        effectDescription: bloodStalkerFormationEffectDescription('Probe Lance'),
        effectGroups: [{
            abilityIds: ['blood_stalker'],
            selection: 'all',
            distribution: 'percent-75',
        }],
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 65 }, { book: Rulebook.ASCE, page: 120 }],
        requirements: (gameSystem) => {
            if (gameSystem === GameSystem.ALPHA_STRIKE) {
                return 'Minimum 3 units. No Size 4+ units. 75% must have Move [[10]]+. All units must have medium-range damage ≥ 2.';
            }
            return 'Minimum 3 units. No assault units. 75% must have walk ≥ 6. All units must deal 10+ damage at 9 hexes.';
        },
    },

    //
    // SWEEP LANCE
    //
    {
        id: 'sweep-lance',
        name: 'Sweep',
        description: 'Fast medium-range sweeping force',
        effectDescription: bloodStalkerFormationEffectDescription('Sweep Lance'),
        effectGroups: [{
            abilityIds: ['blood_stalker'],
            selection: 'all',
            distribution: 'percent-75',
        }],
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 65 }, { book: Rulebook.ASCE, page: 120 }],
        requirements: (gameSystem) => {
            if (gameSystem === GameSystem.ALPHA_STRIKE) {
                return 'Minimum 3 units. All Size ≤ 2. All units must have Move [[10]]+. All units must have short-range damage ≥ 2.';
            }
            return 'Minimum 3 units. All light or medium. All units must have walk ≥ 5. All units must deal 10+ damage at 6 hexes.';
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
        requirements: (gameSystem) => {
            const fast = gameSystem === GameSystem.ALPHA_STRIKE ? 'Move [[10]]+' : 'walk ≥ 5';
            return `Minimum 3 units. All units must have ${fast}. At least 2 Scout or Striker roles.`;
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
        rulesRef: [{ book: Rulebook.CO, page: 65 }, { book: Rulebook.ASCE, page: 120 }],
        requirements: (gameSystem) => {
            if (gameSystem === GameSystem.ALPHA_STRIKE) {
                return 'Minimum 3 units. All Move [[8]]+. At least 2 with Move [[10]]+. At least 1 Size 3+ unit. At least 2 Scouts.';
            }
            return 'Minimum 3 units. All walk ≥ 4. At least 2 with walk ≥ 5. At least 1 heavy or assault. At least 2 Scouts.';
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
        rulesRef: [{ book: Rulebook.CO, page: 65 }, { book: Rulebook.ASCE, page: 119 }],
        requirements: (gameSystem) => {
            if (gameSystem === GameSystem.ALPHA_STRIKE) {
                return 'Minimum 3 units. All Size 1. All Move [[12]]+. All must have the Scout role.';
            }
            return 'Minimum 3 units. All light. All walk ≥ 6. All must have the Scout role.';
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
        rulesRef: [{ book: Rulebook.CO, page: 65 }, { book: Rulebook.FMMERC, page: 91 }],
        requirements: (gameSystem) => {
            const assault = gameSystem === GameSystem.ALPHA_STRIKE ? 'Size 4+' : 'assault';
            return `Minimum 3 units. At most 1 ${assault} unit. At least 1 Scout or Striker. At least 1 Sniper or Missile Boat.`;
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
        requirements: (gameSystem) => {
            if (gameSystem === GameSystem.ALPHA_STRIKE) {
                return 'Minimum 3 units. All Move [[10]]+ or Jump [[8]]+. No Size 4+ units. 50% must have Striker or Skirmisher role.';
            }
            return 'Minimum 3 units. All walk ≥ 5 or jump ≥ 4. No assault units. 50% must have Striker or Skirmisher role.';
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
        exclusiveFaction: ['Free Worlds League'],
        idealRole: 'Striker',
        minUnits: 3,
        rulesRef: [{ book: Rulebook.CO, page: 66 }],
        requirements: (gameSystem) => {
            const fast = gameSystem === GameSystem.ALPHA_STRIKE ? 'Move [[10]]+' : 'walk ≥ 5';
            return `Minimum 3 units. Free Worlds League only. All units must have ${fast}.`;
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
        requirements: (gameSystem) => {
            if (gameSystem === GameSystem.ALPHA_STRIKE) {
                return 'Minimum 3 units. All Move [[10]]+. No Size 3+ units. At least 2 with long-range damage > 0. At least 2 Striker or Skirmisher roles.';
            }
            return 'Minimum 3 units. All walk ≥ 5. No heavy or assault units. At least 2 deal 5+ damage at 18 hexes. At least 2 Striker or Skirmisher roles.';
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
        rulesRef: [{ book: Rulebook.CO, page: 66 }, { book: Rulebook.ASCE, page: 119 }],
        requirements: (gameSystem) => {
            if (gameSystem === GameSystem.ALPHA_STRIKE) {
                return 'Minimum 3 units. All Move [[8]]+. At least 3 Size 3+. No Size 1 units. At least 1 with long-range damage > 1. At least 2 Striker or Skirmisher roles.';
            }
            return 'Minimum 3 units. All walk ≥ 4. At least 3 heavy or assault. No light units. At least 1 deals 5+ damage at 18 hexes. At least 2 Striker or Skirmisher roles.';
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
        rulesRef: [{ book: Rulebook.CO, page: 66 }, { book: Rulebook.FMK, page: 87 }],
        requirements: (gameSystem) => {
            if (gameSystem === GameSystem.ALPHA_STRIKE) {
                return '5-10 units. All Size 1. All must have medium-range damage < 2.';
            }
            return '5-10 units. All light. All must deal less than 11 damage at 9 hexes.';
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
        rulesRef: [{ book: Rulebook.CO, page: 66 }],
        requirements: (gameSystem) => {
            const assault = gameSystem === GameSystem.ALPHA_STRIKE ? 'Size 4+' : 'assault';
            return `Minimum 3 units. No ${assault} units.`;
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
        requirements: (gameSystem) => {
            const move = gameSystem === GameSystem.ALPHA_STRIKE ? `ground Move ≤ [[8]]+` : 'walk ≤ 4';
            return `Minimum 3 units. 50% must have jump movement or be infantry. 50% must have ${move}.`;
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
        effectDescription: 'Clan only. Prior to the beginning of play, two of the non-commander units in this formation receive one of the following Special Pilot Abilities for free (each unit may receive a different SPA): Antagonizer, Combat Intuition, Blood Stalker, Eagle\'s Eyes, Marksman, or Multi-Tasker. In addition, the commander\'s unit receives the Tactical Genius SPA. If the commander already has the Tactical Genius SPA, instead add a +1 modifier to the force\'s Initiative roll results, including any rerolls made as a result of the Tactical Genius SPA. Aerospace units cannot be designated force commander. Counts as Command Star.',
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
        requirements: (gameSystem) => {
            if (gameSystem === GameSystem.ALPHA_STRIKE) {
                return 'Minimum 3 units. All must have skill 3 or lower. Must have 2 AF. Others must be BM, IM, or BA. If BM or IM, at least 2 units Size 3+ and, no Size 1.';
            }
                return 'Minimum 3 units. All must have Gunnery Skill 3 or lower. Must have 1 Aerospace Point. Others must be Mek or Battle Armor. If Mek, at least 2 units heavy or assault, and no lights.';
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
    },

    //
    // AEROSPACE SUPERIORITY SQUADRON
    // Bonus: Up to 50% get up to 2 SPAs: Blood Stalker, Ride the Wash, Hot Dog.
    //
    {
        id: 'aerospace-superiority-squadron',
        name: 'Aerospace Superiority',
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
    },

    //
    // FIRE SUPPORT SQUADRON
    // Bonus: Choose 2 pairs; each pair gets one SPA: Golden Goose, Ground Hugger,
    //   Hot Dog, or Shaky Stick. The two pairs may not receive the same SPA.
    //
    {
        id: 'fire-support-squadron',
        name: 'Fire Support',
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
    },

    //
    // STRIKE SQUADRON
    // Bonus: Up to 50% get Speed Demon. Remainder get Golden Goose.
    //
    {
        id: 'strike-squadron',
        name: 'Strike',
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
    },

    //
    // ELECTRONIC WARFARE SQUADRON
    // Bonus: Communications Disruption SCA.
    //
    {
        id: 'electronic-warfare-squadron',
        name: 'Electronic Warfare',
        description: 'Electronic warfare specialists',
        effectDescription: 'This squadron receives the Communications Disruption Special Command Ability, enabling it to disrupt the communications of one randomly-determined enemy lance or squadron on a 1D6 roll of 6 (persists one turn).',
        effectGroups: [{
            commandAbilityIds: ['communications_disruption'],
            selection: 'all',
            distribution: 'all',
        }],
        minUnits: 6,
        rulesRef: [{ book: Rulebook.CO, page: 67 }, { book: Rulebook.ASCE, page: 122 }],
        requirements: (gameSystem) => {
            const equipment = gameSystem === GameSystem.ALPHA_STRIKE ? 'EW specials (PRB, AECM, ECM, TAG, etc.)' : 'ECM, BAP, or TAG';
            return `Minimum 6 units. All must be aerospace units. More than 50% must have ${equipment}.`;
        },
    },

    //
    // TRANSPORT SQUADRON
    // Bonus: Choose one SPA for all Transport-role units: Dust-Off, Ride the Wash, Wind Walker.
    //
    {
        id: 'transport-squadron',
        name: 'Transport',
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
        requirements: (gameSystem) => {
            const aerospaceType = gameSystem === GameSystem.ALPHA_STRIKE ? 'type (AF, CF, SC, DS, SV, or DA)' : 'units';
            return `Minimum 6 units. All must be aerospace ${aerospaceType}. 50% or more must have the Transport role.`;
        },
    },
];

const FORMATION_RUNTIME_DEFINITION_BY_ID = new Map(
    FORMATION_RUNTIME_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export function getFormationDefinition(id: string): FormationTypeDefinition | null {
    return FORMATION_RUNTIME_DEFINITION_BY_ID.get(id) ?? null;
}

export function getFormationDefinitions(): readonly FormationTypeDefinition[] {
    return FORMATION_RUNTIME_DEFINITIONS;
}

export const FORMATION_BLUEPRINTS: Readonly<Record<string, FormationRequirementBlueprint>> = {
    'anti-mech-lance': { id: 'anti-mech-lance', constraints: [all('anti-mech-all-infantry', 'All infantry units', 'infantry-unit')] },
    'assault-lance': { id: 'assault-lance', constraints: assaultLanceConstraints },
    'anvil-lance': {
        id: 'anvil-lance',
        constraints: [
            all('anvil-medium-plus', 'All medium+/Size 2+ units', 'medium-plus-size'),
            all('anvil-armor', 'All armor threshold', 'anvil-armor'),
            percent('anvil-weapons', '50% AC/FLK/LRM/SRM units', 'anvil-weapon', 0.5),
        ],
    },
    'fast-assault-lance': { id: 'fast-assault-lance', constraints: [...assaultLanceConstraints, all('fast-assault-move', 'All fast assault movement', 'fast-assault-move')] },
    'hunter-lance': { id: 'hunter-lance', constraints: [percent('hunter-role-percent', '50% Ambusher/Juggernaut units', 'hunter-role', 0.5)] },
    'battle-lance': { id: 'battle-lance', constraints: battleLanceConstraints },
    'light-battle-lance': {
        id: 'light-battle-lance',
        constraints: [
            percent('light-battle-light-percent', '75% light/Size 1 units', 'light-size', 0.75),
            all('light-battle-no-assault', 'No assault/Size 4+ units', 'ranger-size'),
            countMin('light-battle-scout', '1 Scout', 'scout-role', 1),
            matchedPairs('light-battle-vehicle-pairs', '2 matched light vehicle pairs', 'light-size', 2, 'combat-vehicle'),
        ],
    },
    'medium-battle-lance': {
        id: 'medium-battle-lance',
        constraints: [
            percent('medium-battle-medium-percent', '50% medium/Size 2 units', 'medium-size', 0.5),
            all('medium-battle-no-assault', 'No assault/Size 4+ units', 'ranger-size'),
            matchedPairs('medium-battle-vehicle-pairs', '2 matched medium vehicle pairs', 'medium-size', 2, 'combat-vehicle'),
        ],
    },
    'heavy-battle-lance': {
        id: 'heavy-battle-lance',
        constraints: [
            percent('heavy-battle-heavy-percent', '50% heavy/Size 3+ units', 'heavy-size', 0.5),
            countMax('heavy-battle-no-light', 'No light/Size 1 units', 'light-size', 0),
            matchedPairs('heavy-battle-vehicle-pairs', '2 matched heavy vehicle pairs', 'heavy-size', 2, 'combat-vehicle'),
        ],
    },
    'rifle-lance': {
        id: 'rifle-lance',
        constraints: [
            percent('rifle-medium-heavy', '75% medium/heavy or Size 2-3 units', 'rifle-medium-heavy-size', 0.75),
            percent('rifle-autocannon', '50% autocannon units', 'rifle-autocannon', 0.5),
            all('rifle-move', 'All rifle movement threshold', 'rifle-move'),
        ],
    },
    'berserker-lance': { id: 'berserker-lance', constraints: battleLanceConstraints },
    'command-lance': {
        id: 'command-lance',
        constraints: [
            percent('command-heavy-roles', '50% command heavy roles', 'command-heavy-role', 0.5),
            countMin('command-diverse-role', '1 Brawler/Striker/Scout', 'command-diverse-role', 1),
        ],
    },
    'order-lance': { id: 'order-lance', constraints: [sameTier('order-same-tier', 'Same Size/weight class'), sameChassis('order-same-chassis', 'Same chassis')] },
    'vehicle-command-lance': {
        id: 'vehicle-command-lance',
        constraints: [
            all('vehicle-command-all-vehicles', 'All combat vehicles', 'combat-vehicle'),
            matchedPairs('vehicle-command-command-pair', '1 matched command-role pair', 'command-heavy-role', 1),
        ],
    },
    'fire-lance': { id: 'fire-lance', constraints: fireLanceConstraints },
    'anti-air-lance': { id: 'anti-air-lance', constraints: [...fireLanceConstraints, countMin('anti-air-equipment-count', '2 anti-air equipped units', 'anti-air-equipment', 2)] },
    'artillery-fire-lance': { id: 'artillery-fire-lance', constraints: [countMin('artillery-count', '2 artillery units', 'artillery-equipment', 2)] },
    'direct-fire-lance': { id: 'direct-fire-lance', constraints: [countMin('direct-fire-heavy-count', '2 heavy/Size 3+ units', 'heavy-size', 2), all('direct-fire-damage', 'All direct-fire damage threshold', 'direct-fire-damage')] },
    'fire-support-lance': { id: 'fire-support-lance', constraints: [countMin('fire-support-equipment-count', '3 indirect-fire units', 'fire-support-equipment', 3)] },
    'light-fire-lance': { id: 'light-fire-lance', constraints: [countMax('light-fire-no-heavy', 'No heavy/Size 3+ units', 'heavy-size', 0), percent('light-fire-role-percent', '50% Missile Boat/Sniper units', 'light-fire-role', 0.5)] },
    'pursuit-lance': { id: 'pursuit-lance', constraints: [countMax('pursuit-no-heavy', 'All light-medium/Size <= 2 units', 'heavy-size', 0), percent('pursuit-move-percent', '75% pursuit movement threshold', 'pursuit-move', 0.75), countMin('pursuit-range', '1 medium range damage unit', 'medium-damage-positive', 1)] },
    'probe-lance': { id: 'probe-lance', constraints: [all('probe-no-assault', 'No assault/Size 4+ units', 'ranger-size'), percent('probe-move-percent', '75% probe movement threshold', 'probe-move', 0.75), all('probe-damage', 'All medium damage threshold', 'medium-damage-2')] },
    'sweep-lance': { id: 'sweep-lance', constraints: [countMax('sweep-no-heavy', 'All light-medium/Size <= 2 units', 'heavy-size', 0), all('sweep-move', 'All sweep movement threshold', 'sweep-move'), all('sweep-damage', 'All short damage threshold', 'short-damage-2')] },
    'recon-lance': { id: 'recon-lance', constraints: [all('recon-move', 'All recon movement threshold', 'recon-move'), countMin('recon-role-count', '2 Scout/Striker units', 'scout-or-striker-role', 2)] },
    'heavy-recon-lance': { id: 'heavy-recon-lance', constraints: [all('heavy-recon-move', 'All heavy recon movement threshold', 'heavy-recon-move'), countMin('heavy-recon-fast-count', '2 faster units', 'recon-move', 2), countMin('heavy-recon-heavy-count', '1 heavy/Size 3+ unit', 'heavy-size', 1), countMin('heavy-recon-scout-count', '2 Scout units', 'scout-role', 2)] },
    'light-recon-lance': { id: 'light-recon-lance', constraints: [all('light-recon-light', 'All light/Size 1 units', 'light-size'), all('light-recon-fast', 'All very fast units', 'very-fast-move'), all('light-recon-scout', 'All Scout units', 'scout-role')] },
    'security-lance': { id: 'security-lance', constraints: [countMax('security-assault-max', 'At most 1 assault/Size 4+ unit', 'assault-size', 1), countMin('security-light-role', '1 Scout/Striker', 'security-light-role', 1), countMin('security-heavy-role', '1 Sniper/Missile Boat', 'security-heavy-role', 1)] },
    'striker-lance': { id: 'striker-lance', constraints: [all('striker-speed', 'All striker movement threshold', 'striker-speed'), countMax('striker-no-assault', 'No assault/Size 4+ units', 'assault-size', 0), percent('striker-role-percent', '50% Striker/Skirmisher units', 'striker-or-skirmisher-role', 0.5)] },
    'hammer-lance': { id: 'hammer-lance', constraints: [all('hammer-move', 'All hammer movement threshold', 'recon-move')] },
    'light-striker-lance': { id: 'light-striker-lance', constraints: [all('light-striker-move', 'All light striker movement threshold', 'recon-move'), countMax('light-striker-no-heavy', 'No heavy/Size 3+ units', 'heavy-size', 0), countMin('light-striker-long-damage', '2 long damage units', 'long-damage-positive', 2), countMin('light-striker-role-count', '2 Striker/Skirmisher units', 'striker-or-skirmisher-role', 2)] },
    'heavy-striker-lance': { id: 'heavy-striker-lance', constraints: [all('heavy-striker-move', 'All heavy striker movement threshold', 'heavy-recon-move'), countMin('heavy-striker-heavy-count', '3 heavy/Size 3+ units', 'heavy-size', 3), countMax('heavy-striker-no-light', 'No light/Size 1 units', 'light-size', 0), countMin('heavy-striker-long-damage', '1 strong long damage unit', 'long-damage-strong', 1), countMin('heavy-striker-role-count', '2 Striker/Skirmisher units', 'striker-or-skirmisher-role', 2)] },
    horde: { id: 'horde', constraints: [all('horde-all-light', 'All light/Size 1 units', 'light-size'), all('horde-low-damage', 'All low medium-range damage units', 'low-medium-damage')] },
    'ranger-lance': { id: 'ranger-lance', constraints: [all('ranger-no-assault', 'No assault/Size 4+ units', 'ranger-size')] },
    'support-lance': { id: 'support-lance', constraints: [] },
    'urban-lance': { id: 'urban-lance', constraints: [percent('urban-jump-infantry', '50% jump or infantry units', 'jump-or-infantry', 0.5), percent('urban-slow', '50% slow urban units', 'slow-urban-move', 0.5)] },
    'phalanx-star': {
        id: 'phalanx-star',
        constraints: [
            ...clanOnlyConstraints,
            all('phalanx-allowed', 'All allowed phalanx unit types', 'phalanx-allowed-unit'),
            anyOf('phalanx-shape', 'Phalanx combined-arms shape', [
                allOf('phalanx-bm-core', 'BM/Mek core plus support', [countMin('phalanx-bm-count', '2 BM/Mek units', 'phalanx-bm-or-mek', 2), countMin('phalanx-ba-cv-count', '1 BA/CV unit', 'phalanx-ba-or-cv', 1)]),
                allOf('phalanx-cv-core', 'CV core plus support', [countMin('phalanx-cv-count', '2 CV units', 'phalanx-cv', 2), countMin('phalanx-bm-ba-count', '1 BM/BA unit', 'phalanx-bm-or-ba', 1)]),
            ]),
        ],
    },
    'rogue-star': { id: 'rogue-star', constraints: [...clanOnlyConstraints, matchedPairs('rogue-model-pair', 'At least two same model/name units', 'clan-force', 1)] },
    'strategic-command-star': {
        id: 'strategic-command-star',
        constraints: [
            ...clanOnlyConstraints,
            all('strategic-skill', 'All skill 3 or lower', 'strategic-skill-3'),
            countExact('strategic-aero-count', 'Exactly 2 aerospace units', 'strategic-aero', 2),
            conditional('strategic-mek-conditions', 'BM/Mek heavy and no-light conditions', 'bm-or-mek-unit', [countMin('strategic-heavy-mek-count', '2 heavy BM/Mek units', 'heavy-bm-or-mek', 2), countMax('strategic-light-mek-count', 'No light BM/Mek units', 'light-bm-or-mek', 0)]),
            anyOf('strategic-core', 'BM/Mek or BA core', [countMin('strategic-bm-count', '2 BM/Mek units', 'bm-or-mek-unit', 2), countMin('strategic-ba-count', '1 BA unit', 'battle-armor-unit', 1)]),
        ],
    },
    'interceptor-squadron': { id: 'interceptor-squadron', constraints: [all('interceptor-all-aerospace', 'All aerospace units', 'aerospace-unit'), strictMajority('interceptor-role-majority', 'Strict majority Interceptor role', 'interceptor-role')] },
    'aerospace-superiority-squadron': { id: 'aerospace-superiority-squadron', constraints: [all('aerospace-superiority-all-aerospace', 'All aerospace units', 'aerospace-unit'), strictMajority('aerospace-superiority-role-majority', 'Strict majority Interceptor/Fast Dogfighter role', 'aerospace-superiority-role')] },
    'fire-support-squadron': { id: 'fire-support-squadron', constraints: [all('fire-support-squadron-all-aerospace', 'All aerospace units', 'aerospace-unit'), percent('fire-support-squadron-role', '50% Fire Support role', 'fire-support-role', 0.5), countMin('fire-support-squadron-dogfighter', '1 Dogfighter role', 'dogfighter-role', 1)] },
    'strike-squadron': { id: 'strike-squadron', constraints: [all('strike-all-aerospace', 'All aerospace units', 'aerospace-unit'), strictMajority('strike-role-majority', 'Strict majority Attack/Dogfighter role', 'attack-or-dogfighter-role')] },
    'electronic-warfare-squadron': { id: 'electronic-warfare-squadron', constraints: [all('ew-all-aerospace', 'All aerospace units', 'aerospace-unit'), strictMajority('ew-equipment-majority', 'Strict majority EW equipment', 'ew-equipment')] },
    'transport-squadron': { id: 'transport-squadron', constraints: [all('transport-all-aerospace', 'All transport aerospace units', 'transport-squadron-unit'), percent('transport-role-percent', '50% Transport role', 'transport-role', 0.5)] },
};

export function getFormationBlueprint(id: string): FormationRequirementBlueprint | null {
    return FORMATION_BLUEPRINTS[id] ?? null;
}
