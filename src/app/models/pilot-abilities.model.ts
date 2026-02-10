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

import { Rulebook, RulesReference } from './common.model';
import { GameSystem } from '../models/common.model';
import { ASUnitTypeCode } from './units.model';

/** Game-system-specific details for a pilot ability */
export interface PilotAbilityRuleDetails {
    /** Eligible unit types for this ability under this rule system. If omitted, any unit may use it. */
    unitType?: string;
    /** AS unit type codes used for filtering. If omitted, applies to any unit type. */
    unitTypeFilter?: ASUnitTypeCode[];
    /** Brief summary lines describing the ability's effect. */
    summary: string[];
    /** Extended rules description paragraphs (more comprehensive than summary). */
    description?: string[];
}

export interface PilotAbility {
    id: string;
    name: string;
    cost: number;
    /** Multiple rulebook references (e.g. CO p.72, AS:CE p.92). */
    rulesRef: RulesReference[];
    /** Classic BattleTech rules version */
    cbt?: PilotAbilityRuleDetails;
    /** Alpha Strike rules version */
    as?: PilotAbilityRuleDetails;
}

/** Resolve the game-system-specific details for a pilot ability, with fallback. */
export function getAbilityDetails(ability: PilotAbility, gameSystem: GameSystem): PilotAbilityRuleDetails {
    return ability[gameSystem] ?? ability[gameSystem === GameSystem.ALPHA_STRIKE ? 'cbt' : 'as'] ?? { summary: [] };
}

export interface ASCustomPilotAbility {
    name: string;
    cost: number;
    summary: string;
}

/** Skill-based limits for pilot abilities */
export interface PilotAbilityLimits {
    maxAbilities: number;
    maxCost: number;
}

/** Get ability limits based on pilot skill level */
export function getAbilityLimitsForSkill(skill: number): PilotAbilityLimits {
    // Green or lower (5+): 0 abilities, 0 cost
    if (skill >= 5) {
        return { maxAbilities: 0, maxCost: 0 };
    }
    // Regular (4): 1 ability, 2 cost
    if (skill === 4) {
        return { maxAbilities: 1, maxCost: 2 };
    }
    // Veteran (3): 2 abilities, 4 cost
    if (skill === 3) {
        return { maxAbilities: 2, maxCost: 4 };
    }
    // Elite (2): 2 abilities, 4 cost
    if (skill === 2) {
        return { maxAbilities: 2, maxCost: 4 };
    }
    // Heroic (1): 3 abilities, 6 cost
    if (skill === 1) {
        return { maxAbilities: 3, maxCost: 6 };
    }
    // Legendary (0): 3 abilities, 6 cost
    return { maxAbilities: 3, maxCost: 6 };
}

export const PILOT_ABILITIES: PilotAbility[] = [
    {
        id: "animal_mimicry",
        name: "Animal Mimicry",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 72 }, { book: Rulebook.ASCE, page: 92 }],
        cbt: {
            unitType: "Quad BattleMechs, ProtoMechs, and 'Mech/ProtoMech designs with an animal appearance",
            summary: ["Quad/'Mech with animal look gains \u20131 Piloting modifier, \u20131 MP cost in woods/jungle, and demoralizes opponents (+1 Morale Check modifier or \u20131 to Demoralizer roll)."],
            description: [
                "A pilot with the Animal Mimicry Ability has combined an exceptional understanding of animal behavior with his natural aptitude for 'Mech piloting to give his machine the uncanny\u2014some would even say frighteningly\u2014resemblance to a wild animal.",
                "Animal Mimicry is available only to pilots of Quad BattleMechs and ProtoMechs, and of 'Mech and ProtoMech designs that, by agreement of all players, feature an animal look to them\u2014such as beastly Clan totem 'Mechs like the Kodiak and the Mandrill.",
                "Like Natural Grace, Animal Mimicry is open to interpretation during gameplay, but can grant the following additional capabilities: the superior, naturally inspired gait provides a \u20131 target modifier to all Piloting Skill Rolls required for Quad designs; the animal-like flexibility enables it to navigate wooded terrain at a cost of \u20131 MP per hex of light, heavy, or ultraheavy woods and jungle terrain.",
                "The disturbingly realistic 'animalisms' of the 'Mech's movement adds a +1 modifier to any Morale Checks\u2014or a \u20131 target modifier to the Demoralizer Piloting Skill Roll if using the Demoralizer SPA.",
            ],
        },
        as: {
            unitType: "'Mechs, ProtoMechs",
            unitTypeFilter: ['BM', 'IM', 'PM'],
            summary: ["Reduces Move cost for ultra-heavy woods, ultra-heavy jungle, and buildings by 2\" per inch. During Combat Phase, may intimidate one enemy within medium range and LOS (2D6 roll, TN 8 + Skill \u2013 SZ); success subtracts 2\" MV, 1 TMM (min 2\"/0 TMM) and applies +1 TN for attacks against this unit. Lasts through End Phase of next turn."],
            description: [
                "The pilot with this SPA has combined an exceptional understanding of animal behavior with their own natural aptitude at the controls to give the movements of their machine an uncanny\u2014even frightening\u2014resemblance to that of a wild animal.",
                "This ability, which works only with 'Mech and ProtoMech units where the model has four legs, reduces the unit's Move cost for passing through ultra-heavy woods terrain, ultra-heavy jungle terrain, or any buildings by 2 inches per inch of movement.",
                "During the Combat Phase, the player may select one enemy unit within line of sight and within medium range of this unit to try to intimidate. The intimidating unit must make a 2D6 roll, with a target number of 8 + the intimidating unit's Skill \u2013 the intimidating unit's SZ. Success will intimidate the target.",
                "Units that are Intimidated in this fashion subtract 2\" from their MV and 1 from their TMM, to a minimum of 2\" MV and 0 TMM, and suffer a +1 Target Number modifier for all attacks made against the intimidating unit. The intimidation takes effect in the End Phase of this turn and lasts through the End Phase of the next turn.",
            ],
        },
    },
    {
        id: "antagonizer",
        name: "Antagonizer",
        cost: 3,
        rulesRef: [{ book: Rulebook.CO, page: 73 }, { book: Rulebook.ASCE, page: 92 }],
        cbt: {
            summary: ["Unit taunts a target within 10 hexes (Piloting +4); on success the target is enraged for a number of turns equal to the margin of success, forced to pursue and attack only the Antagonizer. Rage breaks if another unit hits the target or Antagonizer moves beyond 10 hexes."],
            description: [
                "The Antagonizer is a MechWarrior, pilot, or vehicle commander who has the uncanny ability to get under an enemy's skin so much that the enemy forgets all other considerations and concentrates solely on defeating the Antagonizer.",
                "To use this ability, the Antagonizer must select a single opponent within 10 hexes of his own unit and have line of sight to that opponent. The Antagonizer must then make a special 'psychological' attack on the target in place of a normal weapon attack, in the form of a Piloting Skill Roll with a +4 target modifier.",
                "If the Antagonizer-controlled unit succeeds in this roll, the target unit becomes enraged at him for a number of turns equal to the margin by which the roll succeeded. The enraged opponent unit must move toward the Antagonizer at its best possible speed, using the most direct, passable route available. The enraged unit may not target any other unit during this period; all weapons and physical attacks executed must be directed at the Antagonizer alone.",
                "If the raging unit is hit by a weapon or physical attack delivered by another unit, or the Antagonizer moves more than 10 hexes away from the raging unit, the rage will 'break,' and the raging unit may resume normal activity.",
                "The Antagonizer can attempt to taunt only one unit per turn, but may enrage multiple units in this fashion. Attempting to once again antagonize a unit that has already been enraged in the current scenario results in a +2 target modifier to the Antagonizer's Piloting Skill roll per past success, reflecting the opposing warrior's realization that they are being toyed with.",
            ],
        },
        as: {
            summary: ["During Combat Phase, in place of attack, may enrage one enemy within short range (2D6 roll, TN 5 + Skill). Enraged unit must move toward Antagonizer by most direct route, ignoring terrain costs, and can only attack the Antagonizer. Effect lasts through End Phase of next turn. Breaks if enraged unit begins any phase more than 24\" away or without LOS. No effect vs. aerospace units."],
            description: [
                "As combat talents go, the ability to enrage the enemy may seem ill-conceived at first, but few can overstate how effective it is when it draws fire from a wounded friend\u2014or exposes the berserking target's weaker back armor at the worst possible moment.",
                "During the Combat Phase, in place of the unit's attack, the player may select one enemy unit within short range of this unit to try to enrage. The Antagonizer unit must make a 2D6 roll, with a target number of 5 + their Skill. Success will enrage the target. The enrage takes effect in the End Phase of this turn and lasts through the End Phase of the next turn.",
                "Enraged units must move as close as possible to the Antagonizer unit, taking the most direct, passable, and legal route toward the Antagonizer. The enraged unit ignores increased movement costs or possible damage inflicted by its path for determining the most direct path.",
                "The enraged unit can only make attacks against its Antagonizer, unless the enraged unit has no attack that can target the Antagonizer. Attacks from the enraged unit with an area of effect must include the Antagonizer in the attack's targeted area of effect.",
                "If the enraged unit begins any phase more than 24\" from or without line of sight to the Antagonizer, the unit is no longer enraged. This ability has no effect versus aerospace units.",
                "Iron Will: If an Antagonizer is subject to a similar psychological attack by another unit with the Animal Mimicry, Antagonizer, or Demoralizer SPAs, treat the unit as if it has the Iron Will SPA, and apply a +2 modifier to the roll result to resist being intimidated or enraged.",
            ],
        },
    },
    {
        id: "blood_stalker",
        name: "Blood Stalker",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 73 }, { book: Rulebook.ASCE, page: 93 }],
        cbt: {
            summary: ["Designate one enemy per scenario: \u20131 To-Hit vs. that target, but +2 To-Hit vs. all others. Modifiers last until the designated target retreats or is destroyed."],
            description: [
                "A questionable, but strangely effective ability in many situations, the Blood Stalker SPA reflects a character's ability to single-mindedly focus on one\u2014and only one\u2014enemy target, whether for reasons of personal honor, rage or simply an intense focus on a single tactical objective.",
                "This ability need not be tapped in every scenario in which the character takes part, but if used, it can only be focused on one enemy unit per combat scenario.",
                "When used, the Blood Stalker Ability applies a \u20131 To-Hit modifier for all ranged attacks made by the warrior against his designated target. In exchange, however, any attacks directed against targets other than the one the Blood Stalker has designated suffer a +2 To-Hit modifier.",
                "These modifiers last until the End Phase of the first turn after the designated target retreats, or is otherwise defeated or destroyed. Afterwards, the ability deactivates and the Blood Stalker modifiers no longer apply.",
            ],
        },
        as: {
            summary: ["Designate a 'chosen enemy' at game start: all attacks vs. that enemy receive \u20131 TN, but all attacks vs. other enemies suffer +2 TN until the chosen enemy is destroyed. May choose a new enemy if the current one is out of LOS or destroyed at the start of Movement."],
            description: [
                "A pilot with this SPA could be said to have a one-tracked mind, and focuses all of their energies on the destruction of only one enemy at a time.",
                "The Blood Stalker unit must designate a 'chosen enemy' at the start of each game. All attacks against the chosen enemy receive a \u20131 Target Number modifier, but all attacks made against any other enemies suffer a +2 Target Number modifier until the chosen enemy is destroyed.",
                "If the Blood Stalker starts its Movement with its chosen enemy out of line of sight or destroyed, the Blood Stalker may choose a new enemy to stalk.",
            ],
        },
    },
    {
        id: "cluster_hitter",
        name: "Cluster Hitter",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 73 }, { book: Rulebook.ASCE, page: 93 }],
        cbt: {
            summary: ["May make an Aimed Attack with one cluster weapon (missiles, RACs, LB-X, etc.) using Marksman rules; all clusters hit the targeted location. Otherwise gains +1 on Cluster Hits Table. Cannot combine with Oblique Attacker or Sandblaster."],
            description: [
                "The warrior who has the Cluster Hitter Ability has spent hours mastering the focus of clustering weapons such as missile and rocket launchers, ultra and rotary autocannons, and LB-X style weapons.",
                "Able to more tightly group his shots, the Cluster Hitter can make an Aimed Attack with any one of his unit's cluster-type weapons using all of the rules for the Marksman SPA. On a successful hit, this focused attack will deliver all of the shot's clustered rounds to the targeted location.",
                "When not attempting this focused attack, the Cluster Hitter receives a +1 roll modifier on the Cluster Hits Table for all applicable weapons.",
                "The Cluster Hitter SPA cannot be used in conjunction with the Oblique Attacker SPA, or the Sandblaster SPA.",
            ],
        },
        as: {
            summary: ["If the unit does not move during its Movement Phase, add 1 point of damage to any successful weapon attack that has the FLK, LRM, or SRM special abilities."],
            description: [
                "The Cluster Hitter is a pilot who has become a marksman with some of the least precise weapons available\u2014such as missiles and flak weaponry. This allows them to focus fire in tighter groupings, for more telling damage potential.",
                "As long as the unit with this SPA does not move during its Movement Phase, it will add 1 point of damage to any successful weapon attack that has the FLK, LRM, or SRM special abilities.",
            ],
        },
    },
    {
        id: "combat_intuition",
        name: "Combat Intuition",
        cost: 3,
        rulesRef: [{ book: Rulebook.CO, page: 73 }, { book: Rulebook.ASCE, page: 93 }],
        cbt: {
            summary: ["Declare focus in End Phase (inflicts 1 pilot damage; vehicle crews are stunned). Next turn the unit may act after all others, or pre-empt any single unit\u2019s actions. Damage from pre-emptive attacks applies immediately."],
            description: [
                "A MechWarrior, pilot, or vehicle crew commander with the Combat Intuition SPA can accurately predict an opponent's actions by focusing intently on them.",
                "To use this special ability, a player must declare that a pilot with this SPA is focusing on his environment during the End Phase. This action is extremely taxing, and inflicts 1 point of pilot damage to the pilot. For vehicle crews, they are stunned in the turn after next. No Consciousness Roll is required when this damage is taken. Though Combat Intuition may be used as often as every turn, this damage effect can pose a danger to the warrior if the ability is overused.",
                "In the following turn, the unit whose pilot has Combat Intuition may take all of its actions after all other units have acted (as if the unit with Combat Intuition won Initiative over all other units in the field).",
                "Alternatively, the combat intuitive unit may 'pre-empt' the actions of any other single unit that turn, and perform all of its movement and combat actions before its chosen target can do so, and therefore the target's location (for range purposes) and movement modifiers from its last turn still apply. The effects of damage inflicted by an attack made by Combat Intuition take place immediately.",
            ],
        },
        as: {
            summary: ["If this unit's side wins Initiative, the unit may move and resolve all attacks during the Movement Phase, applying damage immediately\u2014before targets can act. Usable once every 3 turns."],
            description: [
                "The pilot or crew commander with this SPA has a knack for accurately predicting an enemy's actions if they focus hard enough on them. Though this intuition is not quite powerful enough to pass along to an entire force before the enemy has time to react, the warrior can make use of their insight to cut off a single opponent once in a while.",
                "If this unit's side wins Initiative, the unit whose pilot has this SPA can move and resolve all of its attacks during the Movement Phase, applying all damage effects immediately\u2014before any target units can act. This ability can only be used once every 3 turns.",
            ],
        },
    },
    {
        id: "cross_country",
        name: "Cross-Country",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 73 }, { book: Rulebook.ASCE, page: 93 }],
        cbt: {
            unitType: "Combat Vehicles (ground movement types only)",
            summary: ["Ground vehicle treats water as 1 depth shallower and may enter normally restricted terrain (woods, rubble, rough) at twice the BattleMech MP cost."],
            description: [
                "A vehicle crew commander with the Cross-Country ability has a knack for reading the terrain right in front of him and finding the nooks, paths, and hidden folds that will enable him to pass through areas where most drivers wouldn't dare.",
                "A Cross-Country driver can pass through water terrain as though it were 1 depth shallower, and can even move ground vehicles through woods, rubble or rough terrain\u2014even if his vehicle normally could not do so.",
                "Passing through any terrain restricted by the vehicle's movement type, such as passing through woods terrain with a hovercraft, costs the Cross-Country driver twice the normal MP a BattleMech would pay under the same conditions.",
            ],
        },
        as: {
            unitType: "Ground Vehicles",
            unitTypeFilter: ['CV', 'SV'],
            summary: ["Ground vehicle may enter woods, rough, rubble, or water terrain up to 1\" deep even if normally prohibited. Move costs for these terrains are double the cost for a 'Mech unit."],
            description: [
                "The vehicle driver with this SPA is not merely able to get their ride into and out of tight spots; they can get it into some places it's just not meant to enter!",
                "This ground unit may enter woods, rough, or rubble terrain, as well as water terrain up to 1 inch deep, even if the vehicle's movement type would ordinarily prohibit such movement. When entering terrain ordinarily prohibited to the unit, consider all Move costs for these terrains as double the cost to traverse as they would be for a 'Mech unit.",
            ],
        },
    },
    {
        id: "demoralizer",
        name: "Demoralizer",
        cost: 3,
        rulesRef: [{ book: Rulebook.CO, page: 74 }, { book: Rulebook.ASCE, page: 93 }],
        cbt: {
            summary: ["Unit intimidates a target within 10 hexes (Piloting +4); on success the target is demoralized for 1 turn\u2014limited to Walk/Cruise/Safe Thrust, cannot approach the Demoralizer, and suffers +1 To-Hit vs. the Demoralizer's unit."],
            description: [
                "A MechWarrior, pilot or vehicle crew commander with the Demoralizer Ability can make his unit a holy terror on the battlefield, projecting an intimidating presence that seems to manifest in the way he operates his machine and taunts his enemy (with or without the use of communications equipment).",
                "The Demoralizer Ability can be used against any single opposing battlefield unit to which the Demoralizer's unit has a clear line of sight, at a range no greater than 10 hexes. The Demoralizer must then make a special 'psychological' attack on the target in place of a normal weapon attack, in the form of a Piloting Skill Roll with a +4 target modifier.",
                "If the Demoralizer-controlled unit succeeds in this roll, the target unit becomes demoralized. During the following turn, the demoralized unit cannot use any movement rate faster than Walking/Cruising/Safe Thrust, and cannot deliberately move closer to the Demoralizer (though factors such as momentum or the Demoralizer's own movement may still narrow the gap between the two units).",
                "In addition, the demoralized unit suffers a +1 To-Hit modifier to all attack rolls made against the Demoralizer's unit, reflecting the fear the demoralizer has managed to instill in their opponent. These effects last for only one turn, during which time the Demoralizer may maneuver and execute attacks of his own as normal.",
                "If the demoralizer's psychological attack fails, both units act normally in the following turn, though the Demoralizer may attempt to use his ability again in the following turn.",
            ],
        },
        as: {
            summary: ["During Combat Phase, may intimidate one enemy within LOS and medium range (2D6 roll, TN 8 + Skill \u2013 SZ). Success subtracts 2\" MV, 1 TMM (min 2\"/0 TMM) and applies +1 TN for attacks against the Demoralizer. Lasts through End Phase of next turn. Breaks if target begins any phase more than 24\" away or without LOS. No effect vs. aerospace units."],
            description: [
                "A warrior with the Demoralizer SPA can make their unit a holy terror on the battlefield, projecting an intimidating presence that manifests in the way they maneuver and taunt their enemies\u2014with or without the use of communications.",
                "During the Combat Phase, the player may select one enemy unit within line of sight and within medium range of this unit to try to intimidate. The Demoralizer unit must make a 2D6 roll, with a target number of 8 + the Demoralizer's Skill \u2013 the Demoralizer's SZ. Success will intimidate the target.",
                "Units that are Intimidated in this fashion subtract 2\" from their MV and 1 from their TMM, to a minimum of 2\" MV and 0 TMM, and suffer a +1 Target Number modifier for all attacks made against the intimidating unit. The intimidation takes effect in the End Phase of this turn and lasts through the End Phase of the next turn.",
                "If a demoralized unit begins any phase more than 24\" from or without line of sight to the Demoralizer, the unit is no longer demoralized. This ability does not function at all versus aerospace units.",
                "Iron Will: If a Demoralizer is subject to a similar psychological attack by another unit with the Animal Mimicry, Antagonizer, or Demoralizer SPAs, treat the unit as if it has the Iron Will SPA, and apply a +2 modifier to the roll result to resist being intimidated or enraged.",
            ],
        },
    },
    {
        id: "dodge",
        name: "Dodge",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 74 }, { book: Rulebook.ASCE, page: 95 }],
        cbt: {
            unitType: "'Mechs, ProtoMechs",
            summary: ["When targeted by a physical attack, the pilot makes a Piloting Skill Roll; if the dodge margin of success exceeds the attacker's, the physical attack misses. One roll applies against all physical attacks that turn."],
            description: [
                "The Dodge SPA allows a pilot to execute a special evasive maneuver when engaged in physical combat. This dodge\u2014effective against physical attacks only\u2014requires the dodging warrior to make a special Piloting Skill Roll when his opponent makes his physical attack roll.",
                "All of the usual Piloting modifiers relevant to the unit's condition apply to this roll. If the dodging unit's margin of success on this Piloting Skill Roll is higher than that of the attacking unit's physical attack roll, the physical attack misses.",
                "The dodging unit does not make additional rolls for further physical attacks in the same turn. Instead, the margin of success of the Dodge roll for the first attack is compared to that of all physical attacks made against the dodging unit to determine whether each attack hits or misses.",
            ],
        },
        as: {
            unitType: "'Mechs, ProtoMechs",
            unitTypeFilter: ['BM', 'IM', 'PM'],
            summary: ["Any opposing unit that attempts a physical attack against this unit suffers a +2 Target Number modifier."],
            description: [
                "The pilot with this SPA is able to execute evasive actions in close quarters combat. Though not quite fast enough to evade weapons fire, it is more than enough to avoid or deflect an incoming physical blow.",
                "Any opposing unit that attempts to deliver a physical attack against a unit with this SPA will suffer a +2 Target Number modifier.",
            ],
        },
    },
    {
        id: "dust_off",
        name: "Dust-Off",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 74 }, { book: Rulebook.ASCE, page: 95 }],
        cbt: {
            unitType: "VTOLs (combat and support), Fighters (aerospace and conventional), Small Craft, DropShips",
            summary: ["VSTOL-capable aircraft may take off, land, or hover 1 Level above ground in woods/jungle terrain (Piloting roll: +1 Light, +2 Heavy, +3 Ultra-Heavy). Failure causes a crash\u20141 Level per 3 points of failure."],
            description: [
                "An aircraft pilot with the Dust-Off Ability has developed skills ideal for use in emergency medical and rescue evacuations, and can 'read' wooded areas to find hidden landing zones just barely large enough for a vertical landing.",
                "Using this ability requires an air vehicle capable of vertical landings (including Airships, VTOLs, LAMs in AirMech mode, or fighters with VSTOL equipment). This enables the Dust-Off pilot to take off from, land within, or hover 1 Level above the ground within wooded or jungle terrain\u2014terrain that such vehicles could not otherwise enter.",
                "Accomplishing this action requires a successful Piloting Skill Roll, with a +1 target modifier for Light Woods/Jungle, +2 for Heavy Woods/Jungle, or a +3 for Ultra-Heavy Woods/Jungle. If successful, the craft accomplishes this maneuver without damage.",
                "A failure in this roll means that the craft will suffer the effects of a crash\u20141 Level for every 3 points by which the roll failed.",
            ],
        },
        as: {
            unitType: "VTOLs, Fighters, Small Craft, DropShips",
            unitTypeFilter: ['CV', 'SV', 'AF', 'CF', 'SC', 'DA', 'DS'],
            summary: ["When making landing or liftoff rolls, reduces the Control Roll target modifier for Inappropriate Landing Area from +2 to +1."],
            description: [
                "With skills likely honed for emergency medical rescues and other evac operations, this pilot can 'read' difficult landing terrain better than the average aerojock. This makes it possible to find and set their aircraft down in clearings that are barely larger than its wingspan, where most other pilots wouldn't dare.",
                "When making landing or liftoff rolls, this unit reduces the Control Roll target modifier for Inappropriate Landing Area from +2 to +1.",
            ],
        },
    },
    {
        id: "eagles_eyes",
        name: "Eagle's Eyes",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 74 }, { book: Rulebook.ASCE, page: 95 }],
        cbt: {
            summary: ["Unit gains Beagle Active Probe effect at 1 hex range (stacks with existing probes as +1 hex). Also adds +2 to target numbers for minefield/trap attacks and \u20132 to clear them."],
            description: [
                "The Eagle's Eyes ability reflects the capability of a particularly alert and sensor-savvy warrior who can practically detect threats even before his battle computers identify them.",
                "This ability grants the unit the effective benefits of a Beagle Active Probe with a range of 1 hex. If the unit already possesses advanced sensors or other technology that provides active probe capabilities, the Eagle's Eyes ability stacks with this technology, adding 1 hex of range to the probe's radius.",
                "In addition to this, a warrior with Eagle's Eyes can quickly discern the presence of any static defense traps in the immediate vicinity\u2014including pit traps and minefields of any kind. This capability adds a +2 target modifier to target numbers for minefields, booby traps or similar attacks from traps.",
                "If the unit has the ability to clear minefields or traps, the unit receives a \u20132 target modifier to do so.",
            ],
        },
        as: {
            summary: ["Adds 2\" detection range to any probe specials (BH, PRB, LPRB). Confers RCN special even if not normally possessed. Hidden units within 2\" are automatically detected, ignoring ECM specials (AECM, ECM, LECM). Adds +2 TN to avoid minefield attacks."],
            description: [
                "For some warriors, even thirty-first century sensors are superfluous. The warrior with this SPA is so alert and sensor-savvy that they can practically identify threats before their tactical computers can identify them, a vital edge in spotting hidden surprises before it's too late.",
                "This unit adds 2 inches of detection range to any probe special abilities it already possesses (including BH, PRB, and LPRB), and confers the RCN special to the unit even if it does not possess such abilities normally.",
                "In addition, any hidden units within 2 inches of this unit are automatically detected, even if they possess ECM specials (including AECM, ECM, and LECM). Finally, this unit adds +2 to the target number to avoid minefield 'attacks' of any density.",
            ],
        },
    },
    {
        id: "environmental_specialist",
        name: "Environmental Specialist",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 74 }, { book: Rulebook.ASCE, page: 95 }],
        cbt: {
            summary: ["Halves (round down) all movement and Piloting Skill penalties from a chosen weather/atmospheric condition (wind, rain, snow, ice, etc.) and gains \u20131 To-Hit for all attacks under those conditions."],
            description: [
                "The Environmental Specialist not only has learned to survive in a harsh environment, but can actually thrive in it. Unlike the Terrain Master ability, the Environmental Specialist ability only applies to those weather and atmospheric conditions that would incur modifiers to movement and targeting, such as constantly strong winds, heavy rains, snow and ice conditions, and the like.",
                "An Environmental Specialist reduces by half (rounding down) all movement and Piloting Skill penalties related to the environment they are specialized in, when operating under such conditions.",
                "Furthermore, if the environment affects weapon attacks in any way, the Environmental Specialist receives a \u20131 target modifier for all attacks he makes under these conditions.",
            ],
        },
        as: {
            summary: ["Specify one Environmental Condition before the scenario. Reduces additional Move costs from that condition by 2\" (min +0\") and reduces Target Number modifiers from that condition by \u20131 (min +0)."],
            description: [
                "The pilot with the Environmental Specialist SPA has not only learned how to survive in a harsh environment, but can actually thrive in it. This ability specifically focuses on atmospheric and weather aspects of a given environment (as opposed to terrain mastery), and the nature of this specialization must be identified when assigned.",
                "The conditions that apply to this SPA must be specified for this unit before the scenario begins, and may include any one condition described under Environmental Conditions. If the given environmental condition applies to the scenario, this reduces any additional Move costs created by that condition by 2 inches (to a minimum of +0 inches), and any Target Number modifiers applied by the condition are also reduced by \u20131 (to a minimum of +0).",
            ],
        },
    },
    {
        id: "fist_fire",
        name: "Fist Fire",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 75 }, { book: Rulebook.ASCE, page: 96 }],
        cbt: {
            unitType: "'Mechs, ProtoMechs",
            summary: ["After a successful punch or physical weapon attack with a fully-actuated arm, fire one arm-mounted direct-fire energy or ballistic weapon at \u20131 To-Hit; weapon damage hits the same location. One attack per turn."],
            description: [
                "To use this ability, the 'Mech must have an arm that contains full actuation (a functional shoulder, upper arm, lower arm and hand), as well as at least one direct-fire energy or ballistic weapon located in that arm. Physical attack weapons may be present as well, but are not required. A Fist Fire attack may be delivered against any non-infantry unit.",
                "To execute the Fist Fire attack, the aforementioned arm must be used to deliver a punch or physical weapon attack, per standard physical combat rules. If this attack is successful and inflicts damage to the target, the Fist Fire warrior then fires one of the arm-mounted weapons, resolving the attack per the normal rules for the weapon, but with an additional \u20131 To-Hit modifier.",
                "If the weapon attack succeeds, the target sustains the weapon's damage to the same location as the physical attack.",
                "Only one punch or physical weapon attack can benefit from this ability per turn, even if the attacker also has the Melee Master Ability.",
            ],
        },
        as: {
            unitType: "'Mechs, ProtoMechs",
            unitTypeFilter: ['BM', 'IM', 'PM'],
            summary: ["Adds half the unit's Short range damage value (round up) to damage delivered by a successful standard or MEL physical attack. Cannot combine with Street Fighter, nor increase damage for charging or Death from Above."],
            description: [
                "While BattleMechs and ProtoMechs often mimic the human form, it is only the superlative warriors who can make the most of their dexterity in battle. The warrior who has developed the Fist Fire SPA demonstrates this by using their machine's onboard weapons to augment their physical attacks.",
                "This pilot with this ability adds half of his unit's Short range damage value (round up) to any damage delivered by a successful standard or melee weapon (MEL special) physical attack. This SPA may not be combined with Street Fighter, nor can it be used to increase damage for charging or Death from Above attacks.",
            ],
        },
    },
    {
        id: "float_like_a_butterfly",
        name: "Float Like a Butterfly",
        cost: 1,
        rulesRef: [{ book: Rulebook.ASCE, page: 96 }],
        as: {
            summary: ["For each point spent on this SPA, may force an opponent to reroll one attack roll or critical hit effects roll targeting this unit. The second roll stands even if worse. Cannot affect own attack rolls, hull breach checks, Initiative, or Morale rolls."],
            description: [
                "For every point spent on purchasing this special pilot ability, this unit may force an opponent to reroll an attack with this unit as the target. This unit may force a reroll of the attack roll, or the critical hit effects roll. The second roll result stands, even if it fails or is worse than the first.",
                "This special pilot ability may not be used to change the outcome of other roll types, such as its own attack rolls, hull breach checks, Initiative, or Morale rolls.",
            ],
        },
    },
    {
        id: "float_like_a_butterfly2",
        name: "Float Like a Butterfly",
        cost: 2,
        rulesRef: [{ book: Rulebook.ASCE, page: 96 }],
        as: {
            summary: ["For each point spent on this SPA, may force an opponent to reroll one attack roll or critical hit effects roll targeting this unit. The second roll stands even if worse. Cannot affect own attack rolls, hull breach checks, Initiative, or Morale rolls."],
            description: [
                "For every point spent on purchasing this special pilot ability, this unit may force an opponent to reroll an attack with this unit as the target. This unit may force a reroll of the attack roll, or the critical hit effects roll. The second roll result stands, even if it fails or is worse than the first.",
                "This special pilot ability may not be used to change the outcome of other roll types, such as its own attack rolls, hull breach checks, Initiative, or Morale rolls.",
            ],
        },
    },
    {
        id: "float_like_a_butterfly3",
        name: "Float Like a Butterfly",
        cost: 3,
        rulesRef: [{ book: Rulebook.ASCE, page: 96 }],
        as: {
            summary: ["For each point spent on this SPA, may force an opponent to reroll one attack roll or critical hit effects roll targeting this unit. The second roll stands even if worse. Cannot affect own attack rolls, hull breach checks, Initiative, or Morale rolls."],
            description: [
                "For every point spent on purchasing this special pilot ability, this unit may force an opponent to reroll an attack with this unit as the target. This unit may force a reroll of the attack roll, or the critical hit effects roll. The second roll result stands, even if it fails or is worse than the first.",
                "This special pilot ability may not be used to change the outcome of other roll types, such as its own attack rolls, hull breach checks, Initiative, or Morale rolls.",
            ],
        },
    },
    {
        id: "float_like_a_butterfly4",
        name: "Float Like a Butterfly",
        cost: 4,
        rulesRef: [{ book: Rulebook.ASCE, page: 96 }],
        as: {
            summary: ["For each point spent on this SPA, may force an opponent to reroll one attack roll or critical hit effects roll targeting this unit. The second roll stands even if worse. Cannot affect own attack rolls, hull breach checks, Initiative, or Morale rolls."],
            description: [
                "For every point spent on purchasing this special pilot ability, this unit may force an opponent to reroll an attack with this unit as the target. This unit may force a reroll of the attack roll, or the critical hit effects roll. The second roll result stands, even if it fails or is worse than the first.",
                "This special pilot ability may not be used to change the outcome of other roll types, such as its own attack rolls, hull breach checks, Initiative, or Morale rolls.",
            ],
        },
    },
    {
        id: "forward_observer",
        name: "Forward Observer",
        cost: 1,
        rulesRef: [{ book: Rulebook.CO, page: 75 }, { book: Rulebook.ASCE, page: 96 }],
        cbt: {
            summary: ["When spotting for artillery, grants \u20131 to the artillery attack roll and an additional \u20132 for fire adjustment until the target area is struck. Spotting does not impose a To-Hit modifier on the spotter."],
            description: [
                "The Forward Observer is a warrior whose finely-honed direction sense, keen eyesight, and intelligence have made him an invaluable asset for artillery direction.",
                "When this character spots for an artillery unit, the artillery unit receives a \u20131 target modifier on their artillery attack roll. Furthermore, when helping the artillery gunner adjust his fire, the Forward Observer's ability applies an additional \u20132 target modifier until the artillery gunner strikes his designated target area.",
                "The Forward Observer can spot without giving a To-Hit modifier to the artillery attack for the spotter firing.",
            ],
        },
        as: {
            summary: ["May serve as spotter for multiple artillery attacks against one target. If the Forward Observer makes its own attack, any indirect attacks it spots for (IF or indirect Artillery) do not take the TN modifier for the spotter attacking."],
            description: [
                "The Forward Observer is a warrior whose finely honed direction sense, keen eyesight, and intelligence have combined into a talent for hyper-accurate artillery direction.",
                "A Forward Observer may serve as a spotter for multiple artillery attacks against one target. If the Forward Observer makes its own attack, any indirect attacks it spots for (IF or indirect Artillery) do not take the Target Number modifier for the spotter attacking.",
            ],
        },
    },
    {
        id: "golden_goose",
        name: "Golden Goose",
        cost: 3,
        rulesRef: [{ book: Rulebook.CO, page: 75 }, { book: Rulebook.ASCE, page: 96 }],
        cbt: {
            unitType: "VTOLs (combat and support), Fighters (aerospace and conventional), Small Craft",
            summary: ["\u20131 To-Hit for air-to-ground Strike attacks, \u20132 To-Hit for Bombing. On a Bombing miss, scatter distance is reduced by 2 hexes (minimum 0)."],
            description: [
                "A pilot with the Golden Goose Ability is an intensely dedicated air-to-ground precision attacker.",
                "Pilots with this ability receive an additional \u20131 To-Hit modifier when executing air-to-ground Strike attacks, and a \u20132 To-Hit modifier when Bombing.",
                "In addition, if a Bombing attack misses, the Golden Goose ability reduces the bomb's scatter distance by 2 hexes (to a minimum of 0).",
            ],
        },
        as: {
            unitType: "VTOLs, Fighters, Small Craft",
            unitTypeFilter: ['CV', 'SV', 'AF', 'CF', 'SC'],
            summary: ["Applies \u20131 TN for air-to-ground strafing or striking attacks, and \u20132 TN for bombing attacks."],
            description: [
                "The pilot with this ability is a true ace when it comes to high speed air-to-ground attacks, often delivering accurate fire with a minimal amount of collateral damage.",
                "When resolving air-to-ground combat rules this SPA applies a \u20131 Target Number modifier for air-to-ground strafing or striking attacks, and a \u20132 modifier for bombing attacks.",
            ],
        },
    },
    {
        id: "ground_hugger",
        name: "Ground-Hugger",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 75 }, { book: Rulebook.ASCE, page: 96 }],
        cbt: {
            unitType: "VTOLs (combat and support), Fighters (aerospace and conventional), Small Craft",
            summary: ["\u20131 To-Hit for Strafing and Striking (not Bombing). May make two 1\u20133 hex Strafing runs per pass, or deliver two Strike attacks per turn (non-energy weapons must differ; energy weapons may fire twice but generate heat as a single Strafe)."],
            description: [
                "A pilot with the Ground Hugger Ability is an air-to-ground attacker every bit as brave as they are good. In addition to receiving a \u20131 To-Hit modifier for all air-to-ground Strafing and Striking attacks (but not Bombing attacks), the Ground Hugger gains the following additional capabilities.",
                "Strafing: When executing an air-to-ground Strafing attack, instead of the normal, single attack run of 1 to 5 continuous hexes per pass over the battlefield, the Ground Hugger can make up to two 1 to 3 continuous-hex Strafing runs in one turn. Both strafing runs must lie along the craft's flight line, and can even be taken contiguously to produce a solid attack line of 6 hexes in length. This added capability does not affect the heat generated by the Strafe.",
                "Striking: When executing an air-to-ground Strike attack, the Ground Hugger can deliver two such attacks in one turn. As with Strafing, the targets for both Strike attacks must be along the aircraft's flight path over the battlefield. If any non-energy weapons are used while performing this action, each Strike must use a different weapon (energy weapons may be fired twice\u2014one for each Strike\u2014but generate heat as if delivering a single Strafe).",
            ],
        },
        as: {
            unitType: "VTOLs, Fighters, Small Craft",
            unitTypeFilter: ['CV', 'SV', 'AF', 'CF', 'SC'],
            summary: ["Can execute a 'double strafe' (two strafing areas, each at least 2\" long, total 10\") or a 'double strike' (two strike attacks in a single pass). All attacks must be along the unit's flight path."],
            description: [
                "Another special skill for ace aviators, the Ground-Hugger SPA reflects a pilot whose fast reflexes and sense of timing enable them to deliver more damage in a single pass than most others.",
                "When resolving air-to-ground combat rules the pilot with this SPA can execute either a 'double strafe', or a 'double strike' attack in a single ground-attack pass. The double strafe attack allows the unit to break its normal 10-inch strafing run into two strafing areas, each at least 2 inches long (and 2 inches wide), with a total combined strafe line of 10 inches.",
                "The double strike attack, meanwhile, allows the unit to deliver two strike attacks in a single pass over the battlefield. All attacks made using this SPA must be along the airborne unit's flight path.",
            ],
        },
    },
    {
        id: "headhunter",
        name: "Headhunter",
        cost: 2,
        rulesRef: [{ book: Rulebook.ASCE, page: 96 }],
        as: {
            summary: ["Automatically identifies enemy command units (overall and sub-unit commanders). Gains +1 Initiative bonus (cumulative, max +3) for each opposing command unit killed/disabled. If no designated commanders, highest PV unit (after Skill mod) in a Formation is the commander."],
            description: [
                "Can automatically identify enemy command units. This includes overall (e.g., company) and subunit (lance) commanders in a given battle.",
                "Gains +1 Initiative bonus (cumulative, max of +3) for each opposing command unit killed/disabled (not necessarily by the Headhunter's own attacks).",
                "If the opposing force does not have any designated command units, the highest PV cost unit (after Skill modification) in a Formation is considered the commander of that Formation for this SPA.",
            ],
        },
    },
    {
        id: "heavy_lifter",
        name: "Heavy Lifter",
        cost: 1,
        rulesRef: [{ book: Rulebook.CO, page: 76 }, { book: Rulebook.ASCE, page: 97 }],
        cbt: {
            unitType: "'Mechs",
            summary: ["'Mech can lift, carry, drag, and throw objects (including hostile units) weighing up to 50% more than normal limits, affecting both lifting capacity and throwing distances."],
            description: [
                "The Heavy Lifter SPA reflects a mastery of fine balance unique among MechWarriors of any stripe. Where the lifting capabilities of most BattleMechs and IndustrialMechs are derived from a combination of the machine's own mass and special equipment, the Heavy Lifter has learned how to enhance these 'rated maximums' through creative balancing techniques and sheer determination.",
                "The Heavy Lifter SPA allows a 'Mech pilot to lift, carry, drag and even throw objects (including basic cargo and even hostile units) weighing up to 50 percent more than the machine's normal limit.",
                "This affects not only a 'Mech's maximum lifting weights defined in 'Mech Lifting Capacity (see TW), but also the maximum weight allowance and throwing distances defined in Picking Up and Throwing Objects (see TO:AR).",
            ],
        },
        as: {
            unitType: "'Mechs",
            unitTypeFilter: ['BM', 'IM'],
            summary: ["Adds 1 level to the max Size of cargo/units the 'Mech can lift, drag, or throw (External Cargo Carriers rules). If this exceeds Size 5, can lift LG cargo; if LG already included, can lift VLG. If cargo is more than 3 Sizes smaller than the 'Mech, movement is only reduced by 2\" instead of by half."],
            description: [
                "The Heavy Lifter is a MechWarrior or IndustrialMech pilot who has mastered the finer points of balance and control when using their machine to lift and carry external cargo.",
                "With this SPA, the unit adds 1 level to the maximum Size of any cargo (or units) their 'Mech can lift, drag, or throw using the External Cargo Carriers rules. If this would exceed a Size of 5, the unit can lift cargo or units that also have the LG special. If the maximum Size allowance already includes the LG special, the unit can lift Very Large cargo or units (VLG).",
                "Furthermore, if the Size of the cargo or unit being carried by the Heavy Lifter is more than 3 levels smaller than that of their own 'Mech, the Heavy Lifter's unit only reduces its movement by 2 inches, rather than by half.",
            ],
        },
    },
    {
        id: "hopper",
        name: "Hopper",
        cost: 1,
        rulesRef: [{ book: Rulebook.CO, page: 76 }, { book: Rulebook.ASCE, page: 97 }],
        cbt: {
            unitType: "'Mechs",
            summary: ["When a leg is severed, may attempt Piloting Skill Rolls (including +5 for missing leg) to remain standing; if the fall occurs, gains \u20132 to the pilot damage avoidance roll. A one-legged 'Mech can 'hop' 2 MP per turn (treated as Running, no reverse or Sprint)."],
            description: [
                "When a 'Mech loses a leg, it normally surrenders instantly to gravity and crashes to the ground\u2014often injuring its pilot in the process. A MechWarrior with the Hopper Ability possesses an extremely fine sense of innate balance and is so skilled in handling their machine that they can actually try and prevent this fall.",
                "To accomplish this, the warrior must make all necessary Piloting Skill Rolls required for his unit in the turn that the leg is severed, including the +5 target modifier for a missing leg. If these rolls are successful, the 'Mech remains standing\u2014but even if the roll to remain standing fails, the warrior receives a \u20132 target modifier to the subsequent Piloting Skill Roll required to avoid pilot damage in the resulting fall.",
                "A Hopper that remains standing can also use 2 MP of movement per turn with a 'Mech that has been reduced to one leg. This 'hopping' movement is treated as Running MP, however, and cannot be performed in reverse (nor may the Hopper's 'Mech use Sprinting movement once reduced to a single leg).",
            ],
        },
        as: {
            unitType: "'Mechs",
            unitTypeFilter: ['BM', 'IM'],
            summary: ["Can ignore the effects of the first MP Hit received (the hit still counts for tracking critical hits; only the effects are ignored). Does not grant movement if immobilized for other reasons (shutdown, bog down, etc.)."],
            description: [
                "The MechWarrior with this special pilot ability has an extremely fine sense of balance\u2014so fine, in fact, that he can even remain mobile after one of their 'Mech's legs has been blown off.",
                "A unit controlled by a pilot with this SPA can ignore the effects of the first MP Hit it receives (it still occurs, for the purposes of any event which tracks critical hits; only the effects are ignored).",
                "Note: This ability does not grant movement if the unit has been immobilized for other reasons\u2014such as when shutdown or stuck in bog down terrain.",
            ],
        },
    },
    {
        id: "hot_dog",
        name: "Hot Dog",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 76 }, { book: Rulebook.ASCE, page: 97 }],
        cbt: {
            unitType: "'Mechs, Aerospace Fighters",
            summary: ["Applies \u20131 to all rolls to avoid overheating effects, including Shutdown, Ammo Explosion, Pilot Damage, and Random Movement checks from excess heat."],
            description: [
                "Heat, a unique danger to 'Mechs and aerospace fighters, has long been a personal bane to the pilots of such units.",
                "Some pilots, however, have developed a knack for riding their machines' unique 'heat envelopes,' and pushing their fighters and 'Mechs to the limits of shutdown and even explosion just to squeeze out every last gram of performance.",
                "A character with the Hot Dog SPA can apply a \u20131 target modifier to any roll made to avoid overheating effects (including Shutdown and Ammo Explosion checks, as well as Pilot Damage and Random Movement checks from overheating).",
            ],
        },
        as: {
            unitType: "'Mechs, Aerospace Fighters",
            unitTypeFilter: ['BM', 'IM', 'AF'],
            summary: ["Unit acts as if one level lower on the Heat scale. Can sustain 4 points of Heat before auto-shutdown instead of 3. At 4 Heat: loses 6\" ground MV, \u20131 TMM (min 0), and +3 TN modifier instead of shutting down."],
            description: [
                "This MechWarrior or fighter pilot knows how to ride the heat envelope.",
                "The unit acts as if it was one level lower on the Heat scale, and can sustain 4 points of Heat before automatically shutting down rather than the usual 3. At 4 points of Heat, the unit loses 6\" of ground movement, subtracts 1 from its target movement modifier (minimum TMM of 0), and suffers a +3 Target Number modifier instead of shutting down.",
            ],
        },
    },
    {
        id: "human_tro",
        name: "Human TRO",
        cost: 1,
        rulesRef: [{ book: Rulebook.CO, page: 76 }, { book: Rulebook.ASCE, page: 97 }],
        cbt: {
            summary: ["Instantly identifies a specific unit variant and its stats on sight (one unit type declared per scenario). Receives +1 on the Determining Critical Hits Table."],
            description: [
                "The Human TRO has studied the makes, models, and capabilities of so many units of a given type ('Mech, combat vehicle, aerospace fighter, battle armor, and so forth) that they can immediately recognize the specific variant and rattle off the stats for that design on sight.",
                "To perform this feat, the Human TRO must be versed in the specific type of unit he is looking at, declared at the beginning of a scenario. A warrior focused on BattleMechs cannot use this ability to identify the configuration of an aerospace fighter, for example.",
                "The Human TRO receives a +1 modifier to rolls on the Determining Critical Hits Table.",
            ],
        },
        as: {
            summary: ["If Concealing Unit Data rules are in play, automatically identifies any non-hidden unit within 12\", revealing its data card as if the unit has LPRB (does not reveal hidden units). Once per game, may declare before rolling to hit: if the attack hits, make an additional Critical Hit check against the target."],
            description: [
                "Everyone has a hobby; this one's happens to be memorizing the specs for thousands of 'Mechs\u2014and they won't let you forget it!",
                "If the Concealing Unit Data rules are in play, this unit will automatically identify any non-hidden unit within 12 inches, revealing the subject's data card as if the Human TRO's unit has the LPRB special. This ability applies even if the Human TRO's unit does not have an active probe of any kind, but it does not confer the ability to reveal hidden units.",
                "In addition, the Human TRO may look for a weak spot in a target unit once per game. The use of this ability must be declared before rolling to hit. If the attack hits, the attacker may roll once on the Determining Critical Hits Table, in addition to any such rolls required for any other reason.",
            ],
        },
    },
    {
        id: "iron_will",
        name: "Iron Will",
        cost: 1,
        rulesRef: [{ book: Rulebook.CO, page: 76 }, { book: Rulebook.ASCE, page: 97 }],
        cbt: {
            summary: ["Opponents using Animal Mimicry, Antagonizer, or Demoralizer against this unit suffer +2 to their Piloting Skill Roll. Under Morale rules, this unit gains \u20132 to avoid being routed or when recovering nerve."],
            description: [
                "This warrior knows no fear. A unit with this ability is resistant to 'psychological attacks' by opposing units, and can even overcome the natural impulse to flee when all hope seems lost.",
                "When an opponent uses the Animal Mimicry, Antagonizer, or Demoralizer SPAs against a unit with Iron Will, apply a +2 target modifier to the Piloting Skill Roll required to activate the ability.",
                "Furthermore, if Morale rules are in play (see TO:AR), a unit controlled by a pilot or crew with this ability adds a \u20132 modifier to avoid being routed or when recovering its nerve.",
            ],
        },
        as: {
            summary: ["Resistant to psychological attacks: when forced to roll against Animal Mimicry, Antagonizer, or Demoralizer effects, applies +2 modifier to the roll result to resist. Under Morale rules, adds \u20132 TN modifier to avoid being routed or when recovering nerve."],
            description: [
                "This warrior knows no fear. A unit with this ability is resistant to 'psychological attacks' by opposing units, and can even overcome their natural impulse to flee when all hope seems lost.",
                "When forced to make a roll against the intimidating or enraging effects of an opponent using the Animal Mimicry, Antagonizer, or Demoralizer SPAs, a unit whose pilot or crew has the Iron Will SPA applies a +2 modifier to the roll result to resist these effects.",
                "Furthermore, if the Morale rules are in play, a unit controlled by a pilot or crew with this ability adds a \u20132 target modifier to avoid being routed or when recovering its nerve.",
            ],
        },
    },
    {
        id: "jumping_jack",
        name: "Jumping Jack",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 76 }, { book: Rulebook.ASCE, page: 97 }],
        cbt: {
            unitType: "'Mechs, ProtoMechs",
            summary: ["Reduces the +3 attacker movement modifier for jumping (including spotting) to +1."],
            description: [
                "Jump jet-equipped 'Mechs and ProtoMechs are among the most agile battlefield combatants, but to call them graceful is an utter fabrication. However, while most 'Mech jumps demonstrate the brute-force-over-physics approach with every earth-shuddering leap, some pilots have become astonishingly adept at such maneuvers.",
                "The Jumping Jack SPA reduces the normal +3 to-hit attacker movement modifier (including for spotting) for using Jumping movement to a +1 modifier.",
            ],
        },
        as: {
            unitType: "'Mechs, ProtoMechs",
            unitTypeFilter: ['BM', 'IM', 'PM'],
            summary: ["Unit uses a +1 attacker movement modifier for jumping instead of +2."],
            description: [
                "While jumping 'Mechs generally demonstrate all the grace one can expect from brute technological force overpowering physics, some pilots have turned these maneuvers into an art form.",
                "A pilot with the Jumping Jack SPA is so comfortable with the use of jumping movement that their unit uses a +1 attacker movement modifier for jumping instead of +2.",
            ],
        },
    },
    {
        id: "lucky",
        name: "Lucky",
        cost: 1,
        rulesRef: [{ book: Rulebook.CO, page: 77 }, { book: Rulebook.ASCE, page: 97 }],
        cbt: {
            summary: ["May reroll 1 failed Attack Roll or Piloting Skill Roll per scenario. The second result stands even if worse. Cannot be used for critical hits, hull breaches, Initiative, or Morale rolls."],
            description: [
                "It's not really skill that's placing this pilot's shots, but nobody cares as long as they get the job done.",
                "For every point spent on this SPA, the unit may reroll 1 failed Attack Roll or 1 failed Piloting Skill Roll per scenario. The second roll result stands, even if it fails or is worse than the first; the Lucky SPA may not be used again for that particular roll.",
                "This ability may not be used to change the outcome of other roll types, such as critical hit checks, hull breach checks, Initiative, or Morale rolls.",
            ],
        },
        as: {
            summary: ["May reroll 1 failed attack roll or 1 failed Control Roll per scenario. The second result stands even if worse. Cannot affect critical hit checks, hull breach checks, Initiative, or Morale rolls."],
            description: [
                "It's not really skill that's placing this pilot's shots, but nobody cares as long as they get the job done.",
                "For every point spent on purchasing this special pilot ability, this unit may reroll 1 failed attack roll or 1 failed Control Roll per scenario. The second roll result stands, even if it fails or is worse than the first.",
                "This special pilot ability may not be used to change the outcome of other roll types, such as critical hit checks, hull breach checks, Initiative, or Morale rolls.",
            ],
        },
    },
    {
        id: "lucky2",
        name: "Lucky",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 77 }, { book: Rulebook.ASCE, page: 97 }],
        cbt: {
            summary: ["May reroll 2 failed Attack Rolls or Piloting Skill Rolls per scenario. The second result stands even if worse. Cannot be used for critical hits, hull breaches, Initiative, or Morale rolls."],
            description: [
                "It's not really skill that's placing this pilot's shots, but nobody cares as long as they get the job done.",
                "For every point spent on this SPA, the unit may reroll 1 failed Attack Roll or 1 failed Piloting Skill Roll per scenario. The second roll result stands, even if it fails or is worse than the first; the Lucky SPA may not be used again for that particular roll.",
                "This ability may not be used to change the outcome of other roll types, such as critical hit checks, hull breach checks, Initiative, or Morale rolls.",
            ],
        },
        as: {
            summary: ["May reroll 2 failed attack rolls or failed Control Rolls per scenario. The second result stands even if worse. Cannot affect critical hit checks, hull breach checks, Initiative, or Morale rolls."],
            description: [
                "It's not really skill that's placing this pilot's shots, but nobody cares as long as they get the job done.",
                "For every point spent on purchasing this special pilot ability, this unit may reroll 1 failed attack roll or 1 failed Control Roll per scenario. The second roll result stands, even if it fails or is worse than the first.",
                "This special pilot ability may not be used to change the outcome of other roll types, such as critical hit checks, hull breach checks, Initiative, or Morale rolls.",
            ],
        },
    },
    {
        id: "lucky3",
        name: "Lucky",
        cost: 3,
        rulesRef: [{ book: Rulebook.CO, page: 77 }, { book: Rulebook.ASCE, page: 97 }],
        cbt: {
            summary: ["May reroll 3 failed Attack Rolls or Piloting Skill Rolls per scenario. The second result stands even if worse. Cannot be used for critical hits, hull breaches, Initiative, or Morale rolls."],
            description: [
                "It's not really skill that's placing this pilot's shots, but nobody cares as long as they get the job done.",
                "For every point spent on this SPA, the unit may reroll 1 failed Attack Roll or 1 failed Piloting Skill Roll per scenario. The second roll result stands, even if it fails or is worse than the first; the Lucky SPA may not be used again for that particular roll.",
                "This ability may not be used to change the outcome of other roll types, such as critical hit checks, hull breach checks, Initiative, or Morale rolls.",
            ],
        },
        as: {
            summary: ["May reroll 3 failed attack rolls or failed Control Rolls per scenario. The second result stands even if worse. Cannot affect critical hit checks, hull breach checks, Initiative, or Morale rolls."],
            description: [
                "It's not really skill that's placing this pilot's shots, but nobody cares as long as they get the job done.",
                "For every point spent on purchasing this special pilot ability, this unit may reroll 1 failed attack roll or 1 failed Control Roll per scenario. The second roll result stands, even if it fails or is worse than the first.",
                "This special pilot ability may not be used to change the outcome of other roll types, such as critical hit checks, hull breach checks, Initiative, or Morale rolls.",
            ],
        },
    },
    {
        id: "lucky4",
        name: "Lucky",
        cost: 4,
        rulesRef: [{ book: Rulebook.CO, page: 77 }, { book: Rulebook.ASCE, page: 97 }],
        cbt: {
            summary: ["May reroll 4 failed Attack Rolls or Piloting Skill Rolls per scenario. The second result stands even if worse. Cannot be used for critical hits, hull breaches, Initiative, or Morale rolls."],
            description: [
                "It's not really skill that's placing this pilot's shots, but nobody cares as long as they get the job done.",
                "For every point spent on this SPA, the unit may reroll 1 failed Attack Roll or 1 failed Piloting Skill Roll per scenario. The second roll result stands, even if it fails or is worse than the first; the Lucky SPA may not be used again for that particular roll.",
                "This ability may not be used to change the outcome of other roll types, such as critical hit checks, hull breach checks, Initiative, or Morale rolls.",
            ],
        },
        as: {
            summary: ["May reroll 4 failed attack rolls or failed Control Rolls per scenario. The second result stands even if worse. Cannot affect critical hit checks, hull breach checks, Initiative, or Morale rolls."],
            description: [
                "It's not really skill that's placing this pilot's shots, but nobody cares as long as they get the job done.",
                "For every point spent on purchasing this special pilot ability, this unit may reroll 1 failed attack roll or 1 failed Control Roll per scenario. The second roll result stands, even if it fails or is worse than the first.",
                "This special pilot ability may not be used to change the outcome of other roll types, such as critical hit checks, hull breach checks, Initiative, or Morale rolls.",
            ],
        },
    },
    {
        id: "maneuvering_ace",
        name: "Maneuvering Ace",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 77 }, { book: Rulebook.ASCE, page: 97 }],
        cbt: {
            unitType: "Any non-infantry",
            summary: ["Bipedal 'Mechs and VTOLs at Cruise gain lateral shift; quad 'Mechs lateral shift for 1 less MP; vehicles get \u20131 to failed-turn-mode Piloting rolls; aerospace reduces special maneuver Thrust costs by 1. All units gain \u20131 to Piloting rolls vs. skidding, sideslipping, or out-of-control."],
            description: [
                "MechWarriors and crews with the Maneuvering Ace SPA are especially good at executing quick turns and maneuvering in tight confines.",
                "Bipedal 'Mech units and VTOL units at Cruising speed whose pilots possess this ability can perform the lateral shift maneuver normally available only to four-legged 'Mechs, while four-legged 'Mechs can perform the same action for 1 less MP than usual. Vehicle crews receive a \u20131 target modifier on any Piloting Skill Rolls required if the vehicle fails to fulfill the requirements for a turn mode, while aerospace units reduce the Thrust Point costs for any special maneuvers by 1.",
                "In addition to the above, all units piloted by a Maneuvering Ace receive a \u20131 target modifier for any Piloting Skill Rolls needed to avoid skidding, sideslipping or, in the case of aerospace units, out-of-control effects.",
            ],
        },
        as: {
            summary: ["Reduces Move cost through all woods and jungle terrain types by 1\" per inch of movement. For aerospace units, reduces the Control Roll target modifier for atmospheric combat from +2 to +1."],
            description: [
                "This pilot knows how to get their ride into and out of tight spots in a hurry.",
                "This unit reduces the cost for moving through all woods and jungle terrain types by 1 inch per inch of movement. For aerospace units, a pilot with this SPA reduces the unit's Control Roll target modifier for atmospheric combat from +2 to +1.",
            ],
        },
    },
    {
        id: "marksman",
        name: "Marksman",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 77 }, { book: Rulebook.ASCE, page: 97 }],
        cbt: {
            summary: ["While stationary and making no physical attacks, may fire one weapon as an Aimed Shot (as if using a targeting computer). If combined with an actual targeting computer or enhanced imaging, the Aimed Shot gains \u20132 To-Hit."],
            description: [
                "The Marksman Ability enables a MechWarrior, ProtoMech pilot, fighter pilot, or vehicular crew gunner to potentially hit any desired location on a target.",
                "A pilot or gunner with the Marksman SPA can make a special Aimed Shot attack as if using a targeting computer. The pilot's unit must remain stationary and make no physical attacks during the round in which he uses this ability. In addition, only one of the unit's weapons may be used; no other weapon may be fired in the same turn.",
                "The Marksman Ability may be combined with a targeting computer or enhanced-imaging technology; if the warrior's unit is equipped with such items and they are active when this ability is used, the Aimed Shot attack receives a \u20132 To-Hit modifier.",
            ],
        },
        as: {
            summary: ["While stationary, any successful weapon attack within range delivers half damage (round down, min 1) but if the attack scores a Margin of Success of 3+, the Marksman also makes an additional Critical Hit check against the target (even if armor remains)."],
            description: [
                "They may not be a sharpshooter yet, but the gunner with this SPA is skilled at placing their shots for maximum effect.",
                "As long as this unit stands still during its Movement Phase, any successful weapon attack it executes against a target within its weapon's range will deliver only half damage (rounded down, to a minimum of 1 point)\u2014but if the attack scores a Margin of Success of 3 or more, the Marksman also makes an additional Critical Hit check against its target. This critical check is made even if the target still has armor.",
            ],
        },
    },
    {
        id: "melee_master",
        name: "Melee Master",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 77 }, { book: Rulebook.ASCE, page: 98 }],
        cbt: {
            unitType: "'Mechs, ProtoMechs",
            summary: ["May deliver one extra physical attack per Physical Attack Phase (punch, kick, club, or hatchet), combinable with Charge or Death from Above. For ProtoMechs, doubles Frenzy attack damage."],
            description: [
                "A MechWarrior with the Melee Master Ability has elevated physical combat to blinding new levels, achieving physical combat speeds other warriors can only dream of.",
                "When executing a physical attack, a MechWarrior with this ability can deliver one extra punch, kick, club, or hatchet attack during the Physical Attack Phase (so long as all other restrictions are met, such as not firing weapons in the attacking limb). This attack may even be combined with a Charge or Death from Above attack.",
                "For ProtoMechs, use of this Ability doubles the ProtoMech's total damage in a Frenzy attack.",
            ],
        },
        as: {
            unitType: "'Mechs, ProtoMechs",
            unitTypeFilter: ['BM', 'IM', 'PM'],
            summary: ["Adds additional damage equal to half the unit's Size value (rounded up) to any successful physical attack, including standard, melee, charging, and Death from Above attacks."],
            description: [
                "This MechWarrior is a martial artist who's managed to teach their 'Mech a few of their own tricks.",
                "A pilot with this SPA adds additional damage equal to half their unit's Size value (rounded up), upon delivering a successful physical attack of any kind, including standard, melee, charging, and Death from Above attacks.",
            ],
        },
    },
    {
        id: "melee_specialist",
        name: "Melee Specialist",
        cost: 1,
        rulesRef: [{ book: Rulebook.CO, page: 77 }, { book: Rulebook.ASCE, page: 98 }],
        cbt: {
            unitType: "'Mechs, ProtoMechs",
            summary: ["\u20131 To-Hit for all physical attacks and +1 damage on every successful physical attack."],
            description: [
                "A MechWarrior with the Melee Specialist Ability has perfected the difficult art of melee combat using the arms, legs, fists and feet of his BattleMech or ProtoMech, and is a master of physical attacks of all kinds.",
                "Given the Clans' preferred fighting style, this ability is less common among Clan MechWarriors than among their Inner Sphere counterparts, but some ProtoMech warriors\u2014who are trained to make the most of their machines' smaller stature\u2014have been known to embrace these 'barbarian tactics.'",
                "When executing a physical attack, the warrior with this ability receives a \u20131 To-Hit modifier to the attack roll, and increases by 1 point any damage dealt by a successful physical attack.",
            ],
        },
        as: {
            unitType: "'Mechs, ProtoMechs",
            unitTypeFilter: ['BM', 'IM', 'PM'],
            summary: ["Applies an additional \u20131 Target Number modifier when making any physical attacks."],
            description: [
                "The Melee Specialist SPA reflects a warrior who mastered the use of physical attacks using their machine's arms, legs, hands, and feet\u2014a talent that translates to greater accuracy in a melee.",
                "A pilot with this ability applies an additional \u20131 Target Number modifier when making any physical attacks.",
            ],
        },
    },
    {
        id: "multi_tasker",
        name: "Multi-Tasker",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 78 }, { book: Rulebook.ASCE, page: 98 }],
        cbt: {
            summary: ["Reduces secondary-target penalties by 1 (+0 forward arc, +1 rear/side arcs). Crewed vehicles may reduce required gunners by 1 per 2 Gunnery Skill ratings (minimum 1 gunner)."],
            description: [
                "While well-trained pilots and crews can perform multiple tasks simultaneously, accurately targeting multiple foes isn't something many gunners can do with ease, resulting in the application of a modifier for any secondary targets within the unit's firing arcs.",
                "The Multi-Tasker Ability reduces the penalty modifiers for attacks against multiple targets by 1. Attacks against secondary targets in the unit's forward arc receive a +0 roll modifier, while attacks against secondary targets in the unit's rear and side arcs receive a +1 To-Hit modifier.",
                "In addition, crewed vehicles with multiple weapons can reduce their recommended number of gunners by 1 for every 2 Ratings (or fraction thereof) that the Multi-Tasker gunner has in his Gunnery Skill. A vehicle cannot be reduced to less than 1 gunner in this fashion, however.",
            ],
        },
        as: {
            summary: ["May select two targets in the same Combat Phase, resolving fire against each separately. May await results of the first attack before declaring the second target (same unit may be targeted twice). No additional TN modifiers for divided attack. Each successful attack deals half damage (round down, min 1) at the appropriate range bracket."],
            description: [
                "This battle-focused warrior can engage multiple targets far more accurately than most of their comrades.",
                "At the player's option, any unit whose gunner possesses this SPA may select two targets to attack in the same turn, and resolves fire against each one separately in the same Combat Phase. You may await the results of the first attack before declaring the target of the second, and the same unit may be targeted twice.",
                "Each attack is resolved using the modifiers appropriate to the target's movement, range, and other conditions; the divided attack will not impose any further Target Number modifiers. Each successful attack divided in this way will halve the damage (rounded down, to a minimum of 1) that the unit would ordinarily inflict against a single target at the appropriate range bracket.",
            ],
        },
    },
    {
        id: "natural_grace",
        name: "Natural Grace",
        cost: 3,
        rulesRef: [{ book: Rulebook.CO, page: 78 }, { book: Rulebook.ASCE, page: 98 }],
        cbt: {
            unitType: "'Mechs, ProtoMechs",
            summary: ["\u20131 to fall-avoidance, building-damage, pilot-damage, and minefield rolls. Gains +1 hexside torso twist range. Can arm-flip with one arm or with lower arm/hand actuators. Reduces ultra-heavy woods/jungle/building MP cost by 1. Synergizes with Dodge/Melee Specialist (\u20131 hostile physical damage) and Maneuvering Ace/Speed Demon (backward Running MP)."],
            description: [
                "A MechWarrior or ProtoMech pilot with Natural Grace has combined hundreds (if not thousands) of man-hours of programming with their own knack for piloting his machine. As a result, they have developed and perfected dozens of special maneuvers and combinations that give an incredibly lifelike quality to the way their BattleMech or ProtoMech moves.",
                "The special maneuvers a warrior with the Natural Grace Ability can perform are limited primarily by the player's imagination and the gamemaster or opponent's agreement, but may include the ability to execute complex gestures, handle delicate objects, perform a dance maneuver or execute an unusual acrobatic maneuver.",
                "Bonus capabilities include: an additional \u20131 target modifier to any roll that involves avoiding falls, damage from moving through buildings, pilot damage from falls or setting off minefields; an additional hexside of torso twisting range beyond the 'Mech's current abilities (allowing most bipedal 'Mechs to rotate through 300 degrees, while four-legged 'Mechs can twist left or right like humanoids); the ability to perform an arm flip with only one arm, or with an arm that also has lower arm and/or hand actuators; reducing the movement cost to pass through ultra-heavy woods, ultra-heavy jungle, and buildings by 1 MP per hex traveled.",
                "If the character also possesses the Dodge or Melee Specialist SPAs, hostile physical attack damage is reduced by 1 point. If the character has the Maneuvering Ace or Speed Demon SPAs, they may use Running MP to move backward.",
            ],
        },
        as: {
            unitType: "'Mechs, ProtoMechs",
            unitTypeFilter: ['BM', 'IM', 'PM'],
            summary: ["Unit may attack as if it has a 360-degree firing arc (still suffers 1 extra damage if attacked through rear facing). Reduces Move cost for ultra-heavy woods, ultra-heavy jungle, and buildings by 1\" per inch of movement."],
            description: [
                "They just don't teach the piloting skills this warrior can demonstrate in the normal academies!",
                "This unit may make attacks as if it has a 360-degree firing arc (but still suffers 1 additional damage point if attacked through the rear facing). It also reduces its Move cost for passing through ultra-heavy woods terrain, ultra-heavy jungle terrain, or any buildings by 1 inch per inch of movement.",
            ],
        },
    },
    {
        id: "oblique_artilleryman",
        name: "Oblique Artilleryman",
        cost: 1,
        rulesRef: [{ book: Rulebook.CO, page: 78 }, { book: Rulebook.ASCE, page: 98 }],
        cbt: {
            summary: ["Increases artillery weapon range by 10% (rounded up). On a miss, reduces scatter distance by 2 hexes (minimum 0)."],
            description: [
                "The Oblique Artilleryman Ability grants the operator of any artillery piece the ability to direct strikes against targets farther away than the weapon is normally rated to reach.",
                "Able to quickly sense the optimum trajectory and take weather conditions into account, a gunner with this ability increases the range of his artillery weapon by 10 percent (rounded up) in meters.",
                "In addition to extending the weapon's range, if an artillery attack misses, the Oblique Artilleryman ability reduces the shot's scatter distance by 2 hexes (to a minimum of 0).",
            ],
        },
        as: {
            summary: ["Receives \u20131 TN for indirect and off-board attacks using ART special. On counter-battery fire vs. off-board position: full damage if MoF is 1, half damage (round up) if MoF is 2\u20133, miss entirely if MoF is 4+."],
            description: [
                "The Oblique Artilleryman SPA represents a gunner whose accuracy with indirect artillery weapons is downright uncanny.",
                "A unit that possesses this special pilot ability receives a \u20131 Target Number modifier for indirect and off-board attacks using the ART special ability.",
                "If the Oblique Artilleryman is delivering counter-battery fire against an off-board artillery position, this ability ensures that the artillery weapon will deliver its full damage to its off-board target even if the attack misses by a MoF of 1. If the MoF for a counter-battery attack against an off-board position is 2 or 3, the weapon will deliver half its normal damage (round up) to the off-board target instead. If the Oblique Artilleryman misses by 4 points or more, the shells miss the off-board target entirely.",
            ],
        },
    },
    {
        id: "oblique_attacker",
        name: "Oblique Attacker",
        cost: 1,
        rulesRef: [{ book: Rulebook.CO, page: 78 }, { book: Rulebook.ASCE, page: 98 }],
        cbt: {
            summary: ["\u20131 To-Hit for indirect-fire attacks (LRMs and artillery). Can fire indirectly without a spotter."],
            description: [
                "A MechWarrior or gunner with the Oblique Attacker Ability is well versed at executing indirect-fire attacks using LRMs and artillery.",
                "In addition to receiving a \u20131 To-Hit modifier to their attack when firing indirectly, this warrior can identify the target's location without the benefit of a spotter.",
            ],
        },
        as: {
            summary: ["Receives \u20131 TN for indirect attacks using the IF special. May make indirect fire attacks without a friendly spotter, but trades the \u20131 TN for a +2 modifier (replacing all spotter-related modifiers)."],
            description: [
                "Darting behind cover can't save an enemy from this warrior's missile fire.",
                "This unit receives a \u20131 Target Number modifier for indirect attacks using the IF special ability, and may even make indirect fire attacks without a friendly spotter. If attempting to use indirect fire without a friendly spotter, however, the unit trades its \u20131 Target Number modifier for a +2 modifier (which replaces any and all spotter-related modifiers).",
            ],
        },
    },
    {
        id: "range_master",
        name: "Range Master",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 78 }, { book: Rulebook.ASCE, page: 98 }],
        cbt: {
            summary: ["Choose one range band (Medium, Long, or Extreme): swap its To-Hit modifier with Short range. Attacks at the chosen range use the Short modifier, while Short range uses the chosen band's modifier."],
            description: [
                "The Range Master Ability grants the warrior mastery over any range band except Short (Medium, Long and so forth). Any weapon attacks made in the selected range band swaps range modifiers between that range band and the Short range band.",
                "For example, a Range Master may select the Long range band as their area of mastery (normally a +4 To-Hit modifier), and would receive a +0 modifier at that range, but would now suffer a +4 To-Hit modifier for attack rolls made at Short Range.",
            ],
        },
        as: {
            summary: ["Choose one range bracket other than Short or Horizon: apply \u20132 TN for attacks in the specialized bracket, but +2 TN for attacks at Short range."],
            description: [
                "This warrior's ability to strike at their enemies has a certain comfort zone.",
                "Choose one range bracket other than the Short or Horizon brackets. The gunner for this unit specializes in attacks at that bracket: apply a \u20132 Target Number modifier for attacks in the specialized bracket, but a +2 modifier for any attack made in the Short range bracket.",
            ],
        },
    },
    {
        id: "ride_the_wash",
        name: "Ride the Wash",
        cost: 4,
        rulesRef: [{ book: Rulebook.CO, page: 79 }, { book: Rulebook.ASCE, page: 98 }],
        cbt: {
            unitType: "Any airborne unit except airships",
            summary: ["At Altitude 20 or below using Flank/Max Thrust: VTOLs/WiGEs get a free 1-hexside facing change and +1 elevation per turn. Aerospace/aircraft reduce special maneuver Thrust costs by 1, and can force airborne units along their path (0\u201310 elevations below) to make a Piloting +3 roll or lose altitude. Using the turbulence attack prevents weapon fire and requires a self Piloting roll."],
            description: [
                "A pilot with the Ride the Wash Ability has logged hundreds of flight hours and has learned to use the craft's wake turbulence to enhance maneuverability, or even throw off opposing aircraft that pass too close. All aerospace, aircraft or air vehicle types (except airships) may only attempt to Ride the Wash at Altitude 20 or less, and must use Flanking movement (or Maximum Thrust) when doing so.",
                "VTOLs and WiGE units: Riding the Wash allows the pilot to perform a 30-degree (1-hexside) facing change per turn at no cost in MP. The pilot may also use this ability to increase the aircraft's flight elevation by 1 at no MP cost, even if the craft is in the midst of an accidental sideslip.",
                "Aerospace Fighters, Aircraft: Riding the Wash reduces the Thrust Point cost for any special maneuvers by 1. In addition, the warrior can use his aerospace unit's turbulence to try and send other airborne units out of control\u2014as long as the targeted units are located along their path, and operating within 0 to 10 elevations below it. Any airborne units\u2014friend or foe\u2014that meet these conditions must make an immediate Piloting Skill Roll with a +3 target modifier to maintain control. A failed roll results in an immediate loss of 1 elevation of altitude times the roll's margin of failure. If this would drop the unit to or below Elevation 1, treat the outcome as a crash.",
                "Because this latter use requires precision flying at top speeds, any unit that uses Ride the Wash in this manner may not execute weapon attacks, and must also make a Piloting Skill Roll at the end of the Movement Phase. If the roll fails, the pilot's unit will lose 1 elevation times half the roll's margin of failure (rounding up). If this would drop the unit to or below Elevation 1, treat the outcome as a crash.",
            ],
        },
        as: {
            unitType: "Any airborne unit",
            unitTypeFilter: ['AF', 'CF', 'SC', 'DA', 'DS'],
            summary: ["Reduces Control Roll target modifiers for atmospheric combat from +2 to +0. If an AF or CF is tailing another aerospace unit at Short range in air-to-air combat, may forego weapon attack to force target to make a second Control Roll at +3 TN; failure causes it to fall two altitudes (crash if from Low/Medium altitude)."],
            description: [
                "This pilot has logged hundreds of flight hours with their aircraft, and has learned to use its own unique wake turbulence ('wash') to enhance its maneuverability and even use it as an improvised attack against opposing aerospace that flies too close.",
                "A pilot with this ability reduces the unit's Control Roll target modifiers for atmospheric combat from +2 to +0.",
                "In addition to this, if the unit is an aerospace or conventional fighter (AF or CF) that is tailing another aerospace unit in air-to-air combat, and the engagement is taking place at Short range, this pilot can forego a weapon attack and instead force their target to make a second Control Roll with a +3 Target Number modifier. If the opposing unit fails this roll, it falls two altitudes, and will crash if it falls from Low or Medium altitude.",
            ],
        },
    },
    {
        id: "sandblaster",
        name: "Sandblaster",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 79 }, { book: Rulebook.ASCE, page: 99 }],
        cbt: {
            unitType: "Any non-aero",
            summary: ["Choose one cluster weapon type per scenario: gains +2 on Cluster Hits Table at Long/Extreme range, +3 at Medium, +4 at Short."],
            description: [
                "Similar to the Cluster Hitter, the gunner with the Sandblaster Ability has spent hours mastering the unique properties of one type of clustering weapon, be it a missile or rocket launcher, an ultra or rotary autocannon, or an LB-X style weapon, selected at the beginning of a scenario.",
                "While the Cluster Hitter focuses their shots for tighter grouping, the Sandblaster favors quantity over quality. When using this ability with their favored weapon, the Sandblaster receives a +2 roll modifier on the Cluster Hits Table for any attack that hits at long or extreme range; a +3 modifier if the hit occurs at medium range; and a +4 modifier if hitting a target at short range.",
            ],
        },
        as: {
            summary: ["When this unit makes a standard weapon attack and has one or more of the AC, FLK, IATM, LRM, SRM, or TOR specials, it delivers an additional 1 point of damage (increased to 2 points if the attack is at Short range)."],
            description: [
                "Much like the Cluster Hitter, the gunner with the Sandblaster SPA has honed their accuracy with weapons that normally disperse damage, rather than focus it, but where the Cluster Hitter goes for concentrated fire, the Sandblaster is a specialist who works best with just their cluster weapons.",
                "When this unit makes a standard weapon attack and has one or more of the AC, FLK, IATM, LRM, SRM, or TOR specials, they deliver an additional 1 point of damage (increased to 2 points if the attack is made at Short range).",
            ],
        },
    },
    {
        id: "shaky_stick",
        name: "Shaky Stick",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 79 }, { book: Rulebook.ASCE, page: 99 }],
        cbt: {
            unitType: "Any airborne unit",
            summary: ["+1 To-Hit modifier on all ground-to-air attacks targeting this craft. Does not affect attacks from other airborne units. May combine with Golden Goose or Ground Hugger."],
            description: [
                "A pilot with the Shaky Stick Ability is an expert at performing evasive maneuvers while conducting air-to-ground attacks.",
                "This ability bestows a +1 To-Hit modifier on any attacks made against the pilot's craft by units firing from the ground, but does not affect the targeting ability of any airborne opponents.",
                "This ability may be used in conjunction with Golden Goose or Ground Hugger Abilities.",
            ],
        },
        as: {
            unitType: "Any airborne unit",
            unitTypeFilter: ['AF', 'CF', 'SC', 'DA', 'DS'],
            summary: ["Adds +1 TN to all attacks against this unit from ground-based attackers. Does not affect attacks from other airborne units."],
            description: [
                "This fighter jock has really learned to respect fire when it comes from the ground.",
                "When exposed to ground-to-air fire, this SPA adds a +1 Target Number modifier to all attacks against the unit from ground-based attackers. This modifier will not apply to other airborne units that attack the pilot's craft.",
            ],
        },
    },
    {
        id: "sharpshooter",
        name: "Sharpshooter",
        cost: 4,
        rulesRef: [{ book: Rulebook.CO, page: 79 }, { book: Rulebook.ASCE, page: 99 }],
        cbt: {
            summary: ["While stationary with no physical attacks, may fire one weapon as an Aimed Shot (targeting-computer rules). With actual targeting computer or enhanced imaging, gains \u20132 To-Hit. On any successful Aimed Shot, gains an additional Critical Hit check even if armor remains on the struck location."],
            description: [
                "The Sharpshooter is a master marksman who can strike the weakest spot on a 'Mech or vehicle by aiming for known weak points or exploiting pre-existing damage.",
                "A pilot or gunner with the Sharpshooter SPA can make a special Aimed Shot attack as if using a targeting computer. The pilot's unit must remain stationary and make no physical attacks during the round in which they use this ability. In addition, only one of the unit's weapons may be used; no other weapon may be fired in the same turn.",
                "The Sharpshooter Ability may be combined with a targeting computer or enhanced-imaging technology. If the warrior's unit is equipped with such items and they are active when this ability is used, the Aimed Shot attack receives a \u20132 To-Hit modifier.",
                "A pilot or gunner with the Sharpshooter Special Ability is granted an additional chance for a critical hit on any successful Aimed Shot attack performed with this ability, even if the targeted unit still has armor in the struck area. This additional roll is made using the standard rules for determining critical hits, and occurs in addition to any other Critical Hit checks the target unit would normally suffer from armor loss, location of the hit, or the penetrating critical hit rule.",
            ],
        },
        as: {
            summary: ["If this unit stands still during Movement Phase and delivers an attack that succeeds by a Margin of Success of 3+, the attack receives an additional Critical Hit check even if the target still has armor. Unlike Marksman, delivers full damage at the target's range."],
            description: [
                "The Sharpshooter is an improved version of the Marksman SPA, representing a more accomplished gunner who can strike at his enemy's weakest points with deadly accuracy while still delivering a powerful barrage.",
                "Similar to the Marksman SPA, if this warrior's unit stands still during its Movement Phase, and delivers an attack that succeeds by a margin of 3 or more, the attack receives an additional Critical Hit check, even if the target still has armor. Unlike the Marksman, however, this attack delivers the unit's full damage value at the target's range.",
            ],
        },
    },
    {
        id: "slugger",
        name: "Slugger",
        cost: 1,
        rulesRef: [{ book: Rulebook.CO, page: 80 }, { book: Rulebook.ASCE, page: 99 }],
        cbt: {
            unitType: "'Mechs",
            summary: ["Can wield improvised clubs one-handed (requires only one working hand actuator), freeing the other arm and all torso weapons for normal use. Cannot combine with Zweihander."],
            description: [
                "A pilot with the Slugger Ability has further refined their mastery over their machine's heavy lifting potential to the point where they can find, lift, and wield improvised clubs one-handed.",
                "Aside from reducing the required number of working hand actuators to one when using an improvised club, this enables the Slugger to use any weapons mounted in his 'Mech's torso and free arm when wielding an improvised club.",
                "This ability may not be used in conjunction with the Zweihander Ability.",
            ],
        },
        as: {
            unitType: "'Mechs",
            unitTypeFilter: ['BM', 'IM'],
            summary: ["Unit can obtain an improvised melee weapon by spending 2\" extra movement in woods, jungle, rubble, or building terrain (no roll required, declared during Movement). After obtaining the weapon, may execute physical attacks as if it has the MEL special. No effect if the unit already has MEL."],
            description: [
                "Some 'Mechs have built-in swords and hatchets to fight with, but this MechWarrior knows how to improvise their own.",
                "This unit can make use of an improvised melee weapon by simply spending 2 extra inches of movement in a woods, jungle, rubble, or building terrain to find an appropriate weapon. This action requires no roll and creates no special modifiers, but must be declared during the unit's Movement Phase.",
                "After obtaining a suitable weapon, the unit may execute physical attacks as if it has the MEL special ability, even if it ordinarily does not. This SPA has no effect if the unit already possesses the MEL special.",
            ],
        },
    },
    {
        id: "sniper",
        name: "Sniper",
        cost: 3,
        rulesRef: [{ book: Rulebook.CO, page: 80 }, { book: Rulebook.ASCE, page: 99 }],
        cbt: {
            summary: ["Halves Medium and Long range To-Hit modifiers: +1 at Medium (instead of +2), +2 at Long (instead of +4)."],
            description: [
                "The Sniper Special Pilot Ability reduces the Medium and Long Range Attack modifiers by half, so an attack applies a +1 To-Hit modifier at Medium Range (rather than +2), and a +2 To-Hit modifier at Long Range (rather than +4).",
            ],
        },
        as: {
            summary: ["Reduces range modifiers to +1 (Medium), +2 (Long), and +3 (Extreme). Does not affect Short or Horizon range modifiers, nor indirect fire (IF) or artillery (ART) attacks."],
            description: [
                "The sniper prefers to fight from a distance.",
                "This gunner's SPA reduces their unit's Range Modifiers at Medium, Long, and Extreme range to +1 (Medium), +2 (Long), and +3 (Extreme), but does not affect the Short or Horizon range modifiers. Sniper also has no effect on indirect fire (IF) or artillery (ART) attacks.",
            ],
        },
    },
    {
        id: "speed_demon",
        name: "Speed Demon",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 80 }, { book: Rulebook.ASCE, page: 99 }],
        cbt: {
            summary: ["If the unit makes no weapon or physical attacks, adds +1 MP to Running/Flanking/Maximum Thrust and +2 MP to Sprinting."],
            description: [
                "A pilot with the Speed Demon SPA can really pour it on!",
                "As long as his unit makes no weapon or physical attacks during a turn, a vehicle piloted/driven by a character with the Speed Demon ability adds 1 MP to the unit's Running/Flanking/Maximum Thrust movement and 2 MPs to its Sprinting movement.",
            ],
        },
        as: {
            summary: ["Ground units receive +2\" Move per turn and +4\" Sprinting movement (does not change TMM). Aerospace units receive an effective Thrust value 1 point higher than listed on their stat card."],
            description: [
                "A pilot with the Speed Demon SPA can really pour it on!",
                "Ground units of all motive types (including VTOLs and WiGE vehicles) receive an additional 2 inches of Move per turn when driven by a pilot with this ability, and increase their Sprinting movement by 4 inches per turn. This speed boost will not change the unit's target movement modifier, however.",
                "Aerospace units piloted by a pilot with this ability receive an effective Thrust value 1 point higher than is listed on their stat cards.",
            ],
        },
    },
    {
        id: "stand_aside",
        name: "Stand-Aside",
        cost: 1,
        rulesRef: [{ book: Rulebook.CO, page: 80 }, { book: Rulebook.ASCE, page: 99 }],
        cbt: {
            summary: ["May attempt a Piloting Skill Roll (+2, adjusted by weight class difference) to pass through an enemy-occupied hex at +1 MP cost. On failure, loses half remaining MP and must go around. No damage to either unit."],
            description: [
                "A character with the Stand-Aside Ability uses skill and determination to force their way through occupied terrain. Instead of finding a hex impassable due to the presence of an opposing unit, the Stand-Aside pilot may make a Piloting Skill Roll with a +2 target modifier.",
                "For every weight class by which the opposing pilot's machine outweighs his own, the Stand-Aside pilot applies a +1 modifier to this roll. If the Stand-Aside pilot's machine is heavier, they receive a \u20132 modifier to the roll for every weight class of difference instead.",
                "If the check succeeds, the pilot using the Stand-Aside Ability passes through the enemy-occupied space at a cost of 1 additional MP. Otherwise, the Stand-Aside pilot's unit loses half of its remaining MP (rounding down) and must move around the contested area.",
                "Regardless of the outcome, no damage is applied to either unit for the use of this ability.",
            ],
        },
        as: {
            summary: ["Unit can move through hostile units during Movement Phase at +1\" Move cost, causing no damage to either unit. Also immune to the maneuver-limiting effects of any opposing unit's Zone of Control command ability."],
            description: [
                "This unit can move through hostile units during its Movement Phase, at an additional cost of 1 inch of Move. This action causes no damage to either unit; it simply negates the normal 'stacking restriction' that prevents units from moving directly through enemy-occupied positions on the map.",
                "Zone of Control: A unit piloted by a warrior with this SPA is also immune to the maneuver-limiting effects of any opposing unit using the Zone of Control special command ability against it.",
            ],
        },
    },
    {
        id: "street_fighter",
        name: "Street Fighter",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 80 }, { book: Rulebook.ASCE, page: 99 }],
        cbt: {
            unitType: "'Mechs, ProtoMechs",
            summary: ["May execute physical attacks during the Weapon Attack Phase (with normal restrictions on limb weapons). If used, no physical attacks may be made in the subsequent Physical Attack Phase that turn."],
            description: [
                "A pilot with the Street Fighter ability can conduct physical attacks in the same space of time they fire ranged weapons, combining all of these actions together to execute any punches, kicks, and other melee combat actions before the end of the Weapon Attack Phase.",
                "These physical attack maneuvers retain the same restrictions as normal attacks of that type; weapons mounted in the limbs used for physical attacks may not be fired, and weapon attacks may not be attempted during movement-based physical attacks, such as Death from Above and Charging.",
                "A Street Fighter who uses this ability may not execute a physical attack in the same turn's Physical Attack Phase after having already used Street Fighter to deliver one in the Weapon Attack Phase.",
            ],
        },
        as: {
            unitType: "'Mechs, ProtoMechs",
            unitTypeFilter: ['BM', 'IM', 'PM'],
            summary: ["If an opponent in base contact attempts an attack before this unit, the Street Fighter may attempt a preemptive strike (+1 TN). If successful, deals Short range damage plus normal physical attack damage (including MEL/TSM bonuses) in a single attack. Damage resolved before the opponent's attack. If both units are Street Fighters, the ability cancels out."],
            description: [
                "This unit is able to deliver physical attacks with such blinding speed that it can essentially pre-empt those of an opposing unit once it gets close enough.",
                "If an opponent in base contact with the Street Fighter's unit attempts to make an attack before the Street Fighter has resolved their own, the Street Fighter may attempt a special 'preemptive strike' against that opponent.",
                "This preemptive strike receives a +1 Target Number modifier, and effectively counts as the Street Fighter unit's weapon and physical attack for the turn. If successful, the preemptive strike delivers damage equal to the Street Fighter unit's Short range attack value, plus its normal physical attack damage (including any extra damage provided by a MEL or TSM special ability)\u2014in a single attack.",
                "All damage effects from a Street Fighter's preemptive strike must be determined before the opponent's attack against the Street Fighter is resolved. Thus, it is possible for a Street Fighter to cripple or destroy their opponent before it can even land its blow\u2014regardless of Initiative order.",
                "Dueling Street Fighters: If both units in base contact are Street Fighters, the ability for each to pre-empt the other's attacks will cancel out, and all attacks between them must be resolved normally.",
            ],
        },
    },
    {
        id: "sure_footed",
        name: "Sure-Footed",
        cost: 2,
        rulesRef: [{ book: Rulebook.ASCE, page: 100 }],
        as: {
            unitType: "'Mechs, ProtoMechs",
            unitTypeFilter: ['BM', 'IM', 'PM'],
            summary: ["Receives +2\" Move on paved or ice terrain (plus normal pavement bonus). Sprinting adds +4\" instead. If Skidding rules are in play, applies \u20132 TN to the unit's Control Roll."],
            description: [
                "This unit receives an additional 2 inches to its normal movement allowance any turn it remains entirely on paved or ice terrain (in addition to the normal pavement movement bonus). If Sprinting movement is used, the Sure-Footed unit adds 4 inches (plus any pavement bonus) as long as the unit remains on the paved or ice terrain.",
                "Furthermore, if the Skidding rules are in play, the Sure-Footed SPA applies a \u20132 Target Number modifier to the unit's Control Roll.",
            ],
        },
    },
    {
        id: "swordsman",
        name: "Swordsman",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 80 }, { book: Rulebook.ASCE, page: 100 }],
        cbt: {
            unitType: "'Mechs, ProtoMechs (must have mounted melee weapons)",
            summary: ["With a mounted melee weapon, may deliver either an Aimed Shot (using targeting-computer rules) or a Piercing Strike (+2 To-Hit; on hit, bonus Critical Hit check with \u20131 if armor remains). The two modes cannot be combined in the same action."],
            description: [
                "The pilot with the Swordsman SPA has taken their own advanced understanding of melee weapons outside the cockpit and fused it with their mastery of the physical combat capabilities of their BattleMech or ProtoMech. If the 'Mech or ProtoMech lacks melee weaponry, the Swordsman cannot use this ability in combat.",
                "The Swordsman can use his machine's melee weapons to deliver either an Aimed Shot attack or an armor-piercing strike. These two special attacks may not be combined in the same action.",
                "Aimed Shot: When using melee weapons to deliver an Aimed Shot attack, the Swordsman uses the rules for a targeting computer as if the melee weapon were a standard, direct-fire energy weapon. Any modifiers associated with the melee weapon (such as the \u20131 To-Hit modifier for BattleMech swords, or the +1 To-Hit modifier for BattleMech maces) also apply. Any special Piloting Skill Rolls for missed strikes and other requirements also apply.",
                "Piercing Strike: When using melee weapons to deliver a piercing strike, the Swordsman applies a +2 To-Hit modifier to their attack roll. If the attack hits, the Swordsman makes an additional Critical Hit check for the area struck after assessing the weapon's normal damage. Apply a \u20131 roll modifier to this bonus Critical Hit check if the location is still protected by any armor.",
            ],
        },
        as: {
            unitType: "'Mechs, ProtoMechs",
            unitTypeFilter: ['BM', 'IM', 'PM'],
            summary: ["On a successful MEL physical attack, may choose: deliver +1 extra damage, or roll one additional Critical Hit against the target (even if armor remains). No effect if the unit lacks the MEL special."],
            description: [
                "A MechWarrior or ProtoMech pilot with the Swordsman SPA has taken their own experience with melee weapons and translated it to a finesse rarely seen in a multi-ton war machine, granting its own physical combat weapons enough skill and accuracy to deliver far more telling blows.",
                "On a successful physical attack made while using the unit's MEL special, this pilot may choose one of two options: deliver 1 extra point of damage to the opponent, or roll one additional Critical Hit against the target\u2014even if it still has armor remaining. Note that if the unit lacks the MEL special, the Swordsman SPA will have no effect.",
            ],
        },
    },
    {
        id: "tactical_genius",
        name: "Tactical Genius",
        cost: 3,
        rulesRef: [{ book: Rulebook.CO, page: 80 }, { book: Rulebook.ASCE, page: 100 }],
        cbt: {
            summary: ["Force commander may reroll Initiative once every 2 turns; the second result stands even if worse. Has no effect if the character is not the field commander."],
            description: [
                "A Force commander with the Tactical Genius SPA has a superior grasp of the battlefield situation over and above his own innate combat sense, and can tap into this ability to maintain control in even the most chaotic firefights. This ability has no effect, however, if the character is not the field commander for his Force.",
                "A commander with the Tactical Genius ability may re-roll his force's Initiative once every two turns. However, this second roll stands, even if the result is worse than the first.",
            ],
        },
        as: {
            summary: ["If this unit is the command unit, its player may reroll Initiative once every 2 turns if the first roll was beaten; second result stands even if worse. If Battlefield Intelligence rules are in play, treated as having MHQ4."],
            description: [
                "An officer with this special pilot ability has a superior grasp of the battlefield situation, and can tap into this combat sense to maintain control even under the most chaotic firefights.",
                "If this unit is the command unit for its side, its controlling player may roll a second time for Initiative if the first roll was beaten by their opponent. This Initiative reroll result stands, even if it is worse. An Initiative reroll may only be attempted once every 2 turns.",
                "In addition, if the Battlefield Intelligence rules are in play, this unit is treated as if it has the MHQ4 special ability.",
            ],
        },
    },
    {
        id: "terrain_master_drag_racer",
        name: "Terrain Master (Drag Racer)",
        cost: 1,
        rulesRef: [{ book: Rulebook.CO, page: 81 }, { book: Rulebook.ASCE, page: 100 }],
        cbt: {
            unitType: "Combat Vehicle (tracked or wheeled motive types only)",
            summary: ["Tracked/wheeled vehicle gains extra speed on paved, ice, or black ice surfaces; receives a skid-avoidance bonus and can execute a forward-only Lateral Shift at Flank speed or faster."],
            description: [
                "Can only be used by Tracked and Wheeled Vehicles. Drag Racer Terrain Masters are the terror of urban environments.",
                "This ability provides an extra +1 MP to the Drag Racer's Cruise MP, +2 to the unit's Flank MP, and +3 to its Sprint MP as long as the road surface is Paved, Ice, or even Black Ice. These modifiers are cumulative with the effects of the Speed Demon SPA.",
                "In addition, the Drag Racer receives a \u20132 target modifier to all Driving Skill Rolls made while on such smooth surfaces, including rolls made to avoid skidding.",
                "As a special maneuver, Drag Racers moving at Flank speed or faster can also execute a forward-only Lateral Shift maneuver, similar to four-legged 'Mechs.",
            ],
        },
        as: {
            unitType: "Combat Vehicles (tracked or wheeled)",
            unitTypeFilter: ['CV'],
            summary: ["Receives +4\" Move on paved or ice terrain (plus normal pavement bonus). Sprinting adds +6\" instead. If Skidding rules are in play, applies \u20132 TN to the unit's Control Roll."],
            description: [
                "A vehicle driver with this SPA isn't just a speed demon; he's practically a professional racer.",
                "This unit receives an additional 4 inches to its normal movement allowance any turn it remains entirely on paved or ice terrain (in addition to the normal pavement movement bonus). If Sprinting movement is used, the Drag Racer adds 6 inches (plus any pavement bonus) as long as their vehicle remains on the paved or ice terrain.",
                "Furthermore, if the Skidding rules are in play, the Terrain Master [Drag Racer] SPA applies a \u20132 target number modifier to the unit's Control Roll.",
            ],
        },
    },
    {
        id: "terrain_master_forest_ranger",
        name: "Terrain Master (Forest Ranger)",
        cost: 3,
        rulesRef: [{ book: Rulebook.CO, page: 81 }, { book: Rulebook.ASCE, page: 100 }],
        cbt: {
            unitType: "Any non-airborne unit",
            summary: ["Unit moves more easily through woods/jungle (\u20131 MP cost), gains a Piloting bonus in jungle, and at Walk/Cruise speed gains +1 To-Hit cover modifier in wooded or jungle terrain."],
            description: [
                "Forest Ranger Terrain Masters are skilled at making good choices when moving their vehicles through light or heavy foliage.",
                "This ability subtracts 1 MP from all movement costs the Forest Ranger's unit incurs when crossing through all woods and jungle terrain, and applies a \u20131 target modifier to any Piloting Skill Rolls required when crossing through jungle terrain.",
                "Furthermore, if the Forest Ranger uses Walking or Cruising movement rates, they can use the trees, brush, and uneven ground for better cover than most, imposing an additional +1 To-Hit modifier against any attacks directed against the unit while it is within wooded or jungle terrain.",
            ],
        },
        as: {
            unitType: "Any non-airborne unit",
            unitTypeFilter: ['BM', 'IM', 'PM', 'CV', 'SV', 'BA', 'CI'],
            summary: ["Reduces additional Move costs through woods/jungle terrain (including heavy and ultra-heavy) by 1\" per inch of movement (min +0\"). Attacks against this unit suffer +1 Terrain Modifier if it ends movement in wooded or jungle terrain."],
            description: [
                "This warrior with this ability is truly at home in woodlands.",
                "A unit piloted by a warrior with this SPA reduces its additional Move costs when travelling through woods or jungle terrain (including heavy and ultra-heavy woods and jungle) by 1 inch per inch of movement (to a minimum added cost of +0 inches).",
                "In addition to this, attacks against this warrior's unit suffer an additional +1 Terrain Modifier if it ends its movement inside wooded or jungle terrain.",
            ],
        },
    },
    {
        id: "terrain_master_frogman",
        name: "Terrain Master (Frogman)",
        cost: 3,
        rulesRef: [{ book: Rulebook.CO, page: 81 }, { book: Rulebook.ASCE, page: 100 }],
        cbt: {
            unitType: "'Mechs, ProtoMechs",
            summary: ["'Mech/ProtoMech moves more easily in water deeper than Depth 1 (\u20131 MP cost), gains a Piloting bonus when submerged, and applies +2 to Crush Depth Checks under Extreme Depth rules."],
            description: [
                "Can only be used by 'Mechs and ProtoMechs. Frogman Terrain Masters are skilled at moving through water.",
                "This ability subtracts 1 MP from all movement costs the 'Mech or ProtoMech incurs when maneuvering through water terrain deeper than Depth 1, and applies a \u20131 target modifier to any Piloting Skill Rolls required when submerged, including those used for physical attacks.",
                "Furthermore, if using the Extreme Depth rules (see TO:AR), the Frogman applies a +2 target modifier for any Crush Depth Checks.",
            ],
        },
        as: {
            unitType: "'Mechs, ProtoMechs",
            unitTypeFilter: ['BM', 'IM', 'PM'],
            summary: ["Reduces movement costs for underwater movement by 1\" per inch of travel (min +0\"). Only applies when fully submerged."],
            description: [
                "This MechWarrior or ProtoMech pilot is uncommonly good at maneuvering their machine underwater, even without the benefits of UMU mobility.",
                "This SPA reduces the unit's movement costs for underwater movement by 1 inch per inch of travel, to a minimum added Move cost of +0 inches. This benefit only applies when the unit is fully submerged.",
            ],
        },
    },
    {
        id: "terrain_master_mountaineer",
        name: "Terrain Master (Mountaineer)",
        cost: 3,
        rulesRef: [{ book: Rulebook.CO, page: 81 }, { book: Rulebook.ASCE, page: 100 }],
        cbt: {
            unitType: "Any non-airborne unit",
            summary: ["Unit moves more easily through rough/rubble terrain and level changes (\u20131 MP cost, including sheer cliffs), with a \u20131 Piloting bonus in such terrain."],
            description: [
                "The Mountaineer Terrain Master has extensive experience navigating the rocky features and steep slopes common to mountainous regions.",
                "The Mountaineer subtracts 1 MP from all movement costs their unit incurs when crossing through gravel piles, rough/ultra-rough, or rubble/ultra-rubble terrain, and for any level changes, including those that involve sheer cliffs.",
                "In addition, the Mountaineer Terrain Master applies a \u20131 target modifier to any Piloting Skill Rolls required when crossing through such terrain.",
            ],
        },
        as: {
            unitType: "Any non-airborne unit",
            unitTypeFilter: ['BM', 'IM', 'PM', 'CV', 'SV', 'BA', 'CI'],
            summary: ["Reduces additional Move costs for changing levels, Climbing, or passing through rough/rubble terrain (including ultra-rough/ultra-rubble) by 1\" per inch of travel (min +0\")."],
            description: [
                "The Mountaineer is a warrior or vehicle pilot who has an affinity for steep slopes and rocks.",
                "This SPA reduces the additional Move costs for changing levels, using Climbing movement, or for passing through rough and rubble terrain types (including ultra-rough and ultra-rubble) by 1 inch per inch of travel, to a minimum added Move cost of +0 inches.",
            ],
        },
    },
    {
        id: "terrain_master_nightwalker",
        name: "Terrain Master (Nightwalker)",
        cost: 3,
        rulesRef: [{ book: Rulebook.CO, page: 81 }, { book: Rulebook.ASCE, page: 100 }],
        cbt: {
            unitType: "Any non-airborne unit",
            summary: ["Unit ignores darkness-based MP modifiers at Walk/Cruise speed; at faster speeds reduces them by 1 MP. Does not affect Gunnery Skill."],
            description: [
                "The Nightwalker Terrain Master can ignore all night- or darkness-based MP modifiers imposed by unusual light conditions, including Dawn, Dusk, Glare, Full Moon, Night, Moonless Night, Pitch Black, or Solar Flare, as long as the unit maintains a Walk or Cruise movement rate.",
                "If the unit spends Flank, Jumping, Running, or Sprinting MPs, the Nightwalker may only reduce the MP costs imposed by these conditions by 1 MP (to a minimum of 0).",
                "This ability does not affect the Nightwalker's Gunnery Skill.",
            ],
        },
        as: {
            unitType: "Any non-airborne unit",
            unitTypeFilter: ['BM', 'IM', 'PM', 'CV', 'SV', 'BA', 'CI'],
            summary: ["Ignores all modifiers for darkness without having to activate any searchlight (SRCH) special it may have."],
            description: [
                "The warrior with this special piloting ability likes things nice and dark.",
                "This unit ignores all modifiers for darkness without having to activate any searchlight (SRCH) special ability it may have.",
            ],
        },
    },
    {
        id: "terrain_master_sea_monster",
        name: "Terrain Master (Sea Monster)",
        cost: 3,
        rulesRef: [{ book: Rulebook.ASCE, page: 101 }],
        as: {
            unitType: "Any non-airborne unit",
            unitTypeFilter: ['BM', 'IM', 'PM', 'CV', 'SV', 'BA', 'CI'],
            summary: ["Reduces additional Move costs for water terrain by 1\" per inch of travel (min +0\"). Attacks against this unit suffer +1 Terrain Modifier while in water terrain of depth 1\"\u20132\". Ignores the +1 underwater terrain modifier when attacking."],
            description: [
                "This unit reduces the additional Move costs for passing through water terrain by 1 inch per inch of travel, to a minimum added cost of +0 inches.",
                "In addition to this, attacks against this pilot's unit will suffer an additional +1 Terrain Modifier as long as the unit is occupying water terrain of depth 1\"\u20132\". The Sea Monster ignores the +1 underwater terrain modifier when it is attacking.",
            ],
        },
    },
    {
        id: "terrain_master_swamp_beast",
        name: "Terrain Master (Swamp Beast)",
        cost: 3,
        rulesRef: [{ book: Rulebook.CO, page: 81 }, { book: Rulebook.ASCE, page: 101 }],
        cbt: {
            unitType: "Any non-airborne unit",
            summary: ["Unit moves more easily through mud/swamp (\u20131 MP cost), gains a \u20131 Piloting bonus (including bog-down checks), and at Running/Flank speed can spend 1 extra MP per hex to impose +1 To-Hit against attacks while in muddy or swampy terrain."],
            description: [
                "Swamp Beast Terrain Masters are used to the hindering effects of muddy or swampy terrain.",
                "This ability subtracts 1 MP from all movement costs the Swamp Beast's unit incurs when crossing through mud or swamp land, and applies a \u20131 target modifier to any Piloting Skill Rolls required when crossing such surfaces\u2014including checks needed to avoid bogging down.",
                "In addition to this, if the Swamp Beast uses Running or Flank movement rates, they can spend one extra MP per hex to throw up a cloud of mud, muck, and loose brush around their unit, the result of which imposes an additional +1 target modifier against any attacks directed against the unit while it remains within muddy or swampy terrain.",
            ],
        },
        as: {
            unitType: "Any non-airborne unit",
            unitTypeFilter: ['BM', 'IM', 'PM', 'CV', 'SV', 'BA', 'CI'],
            summary: ["Reduces additional Move costs for swamp terrain by 1\" per inch of travel (min +0\"). Ignores Bogging Down rules in mud/swamp terrain. Attacks against this unit suffer +1 Terrain Modifier while in mud or swamp terrain."],
            description: [
                "Terrain masters have honed their piloting skills under particularly treacherous conditions; the 'swamp beast' knows how to handle mud, marsh\u2014even quicksand, if it comes up.",
                "This unit reduces the additional Move costs for passing through swamp terrain by 1 inch per inch of travel, to a minimum added cost of +0 inches. In addition to this, the Swamp Beast ignores the Bogging Down rules when traveling through mud or swamp terrain.",
                "Finally, attacks against this pilot's unit will suffer an additional +1 Terrain Modifier as long as the unit is occupying mud or swamp terrain.",
            ],
        },
    },
    {
        id: "weapon_specialist",
        name: "Weapon Specialist",
        cost: 3,
        rulesRef: [{ book: Rulebook.CO, page: 82 }, { book: Rulebook.ASCE, page: 101 }],
        cbt: {
            unitType: "Any",
            summary: ["When attacking with a designated weapon type, the Weapon Specialist applies a \u20132 To-Hit modifier."],
            description: [
                "A MechWarrior, ProtoMech pilot, fighter pilot or gunner with the Weapon Specialist ability is exceptionally proficient with a single type of weapon system. When acquiring this ability, the warrior must identify a specific weapon as their ultimate 'weapon of choice' in battle.",
                "For example, a MechWarrior can choose the medium laser, while a vehicle gunner might choose the LRM 10. When making attacks using their chosen weapon, the Weapon Specialist applies a \u20132 To-Hit modifier.",
            ],
        },
        as: {
            summary: ["If the unit makes a standard weapons attack and misses by 1, the attack deals half damage (round down, min 1 point)."],
            description: [
                "The weapon specialist is a superlative expert with certain types of weapons, and can deliver much more accurate fire when he sticks to those guns alone.",
                "If the unit makes a standard weapons attack and misses by 1, the attack deals half damage (round down, to a minimum of 1 point).",
            ],
        },
    },
    {
        id: "wind_walker",
        name: "Wind Walker",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 82 }, { book: Rulebook.ASCE, page: 101 }],
        cbt: {
            unitType: "Any airborne unit",
            summary: ["Receives an additional \u20131 target modifier for all Piloting Skill Rolls required to pass through the Space/Atmosphere Interface (aerospace fighters only), or execute landings of any kind\u2014including crash landings."],
            description: [
                "The Wind Walker ability is most often used by aerospace, aircraft, and WiGE vehicle pilots, but can also be employed by Land-Air 'Mechs, and Glider ProtoMechs. Wind Walkers have the knack for riding thermals and wind currents to produce a smoother ride.",
                "This ability also translates to an additional \u20131 target modifier for all Piloting Skill Rolls required to pass through the Space/Atmosphere Interface (aerospace fighters only), or execute landings of any kind\u2014including crash landings.",
            ],
        },
        as: {
            unitType: "Any airborne unit",
            unitTypeFilter: ['AF', 'CF', 'SC', 'DA', 'DS'],
            summary: ["Ignores the +2 Control Roll target modifier for atmospheric conditions. Receives \u20131 Control Roll TN for all landings and liftoffs."],
            description: [
                "The Wind Walker is an accomplished pilot who has a knack for using thermals and wind currents for a smoother flight and pinpoint landings.",
                "A unit whose pilot has this SPA ignores the +2 Control Roll target modifier for operating in atmospheric conditions, and receives an additional \u20131 Control Roll target modifier for all landings and liftoffs.",
            ],
        },
    },
    {
        id: "zweihander",
        name: "Zweihander",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 82 }, { book: Rulebook.ASCE, page: 101 }],
        cbt: {
            unitType: "'Mechs",
            summary: ["May punch or use any one-handed physical attack weapon with both arms (requires hand actuators in both). Attack must target front arc, applies To-Hit modifiers for both arms' actuator damage. On hit, deals +1 damage per 10 full tons of attacker weight (+2 with active TSM), then attacker must make a Critical Hit check on the attacking arm(s). On miss, attacker must make a Piloting Skill Roll to avoid falling."],
            description: [
                "A MechWarrior with the Zweihander Ability has mastered the ability to use his 'Mech's muscles, melee weapons, and mass to their most devastating effect in close combat. Rather than focusing on speed like the Melee Master, the Zweihander focuses on power attacks, especially when using melee weapons such as clubs, swords, and hatchets.",
                "The Zweihander ability grants the MechWarrior the ability to punch or use any one-handed physical attack weapons with both of his BattleMech's arms, as long as the warrior's 'Mech is equipped with hand actuators on both arms. A two-handed attack can only be delivered to targets in the Zweihander's front arc, and applies all To-Hit modifiers for any damage to actuators in both arms, in addition to the normal modifiers for movement and terrain.",
                "If this attack succeeds, it delivers additional damage equal to 1 point per 10 full tons of the attacker's weight (2 if the attacker's 'Mech has Triple-Strength Myomer active). However, the attacker must then make an immediate Critical Hit check against his own unit on the arm where the attacking weapon is mounted (or on both arms, if the Zweihander attack is delivered unarmed).",
                "Any critical hit effects that occur will apply in the End Phase of the current turn, and will not affect the damage delivered by the Zweihander attack itself.",
                "If a Zweihander attack fails, the MechWarrior must make an immediate Piloting Skill Roll to avoid falling, as if the attacker failed at a kick attack.",
                "This ability can be used with improvised clubs (see pp. 145\u2013146, TW), but automatically destroys such clubs on a successful attack, regardless of the club's construction.",
            ],
        },
        as: {
            unitType: "'Mechs",
            unitTypeFilter: ['BM', 'IM'],
            summary: ["Adds +1 damage to any successful standard- or melee-type physical attack (does not apply to charging or Death from Above). This modifier is in addition to any others from MEL or TSM."],
            description: [
                "This MechWarrior really puts his machine's back into physical combat.",
                "A pilot with this SPA adds +1 damage to the damage delivered by any successful standard- or melee-type physical attacks his 'Mech executes (but does not apply to damage from charging or Death from Above attacks). This damage modifier is in addition to any others provided by special unit abilities such as MEL or TSM.",
            ],
        },
    },
    {
        id: "light_horseman",
        name: "Light Horseman",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 76 }, { book: Rulebook.ASCE, page: 101 }],
        cbt: {
            unitType: "Infantry (conventional, beast-mounted only)",
            summary: ["Beast-mounted infantry squad gains +1 MP and reduces movement penalties for woods and rough terrain by 1 MP."],
            description: [
                "The Light Horseman Ability is only effective when using Beast-Mounted Infantry.",
                "An infantry squad leader with the Light Horseman Ability has combined his natural talent for working with animals with his skills as an infantry leader to create an infantry team capable of pushing its mounts to their limit.",
                "Characters leading a Beast-Mounted unit can coax an additional 1 MP of movement per turn from their beasts, and can reduce by 1 MP the movement penalties for moving through wooded and rough terrain.",
            ],
        },
        as: {
            unitType: "CI (beast-mounted only)",
            unitTypeFilter: ['CI'],
            summary: ["Beast-mounted infantry receives +2\" Move per turn and reduces additional movement costs for wooded or rough terrain by 1\" per inch of travel (min +0\")."],
            description: [
                "Yes, it may be the future, but that doesn\u2019t mean horse (or horse-analog) infantry doesn\u2019t still exist\u2014or that there aren\u2019t troops out there who specialize in their use.",
                "A beast-mounted infantry unit with this SPA receives an additional 2 inches of movement per turn, and reduces the additional movement costs for wooded or rough terrain types by 1 inch per inch of travel (to a minimum added movement cost of +0 inches).",
            ],
        },
    },
    {
        id: "heavy_horse",
        name: "Heavy Horse",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 75 }, { book: Rulebook.ASCE, page: 101 }],
        cbt: {
            unitType: "Infantry (conventional, beast-mounted only)",
            summary: ["Beast-mounted infantry squad deals 50% more damage (rounded down) from additional support weaponry, but loses 1 MP."],
            description: [
                "Like the Light Horseman, the Heavy Horse Ability is only effective when using Beast-Mounted Infantry.",
                "The Heavy Horseman has studied the use of riding animals in combat for years, and has developed a few ways to maximize their abilities. Heavy Horse warriors leading a beast-mounted squad enable the unit to carry additional support weaponry; the unit deals 50 percent more damage (rounded down), but loses 1 MP.",
            ],
        },
        as: {
            unitType: "CI (beast-mounted only)",
            unitTypeFilter: ['CI'],
            summary: ["Beast-mounted infantry delivers 1 additional point of damage on any successful attack against a unit in base contact."],
            description: [
                "Heavy horse infantry have developed ways to maximize the load-bearing capabilities of their mounts to allow for extra support weaponry, and are effective in using it in close combat.",
                "A beast-mounted infantry unit with this SPA delivers 1 additional point of damage upon any successful attack against a unit that it is in base contact with.",
            ],
        },
    },
    {
        id: "foot_cavalry",
        name: "Foot Cavalry",
        cost: 1,
        rulesRef: [{ book: Rulebook.CO, page: 75 }, { book: Rulebook.ASCE, page: 101 }],
        cbt: {
            unitType: "Infantry (conventional, foot motive type only)",
            summary: ["Foot infantry squad gains +1 MP, reduces terrain penalties (rough, woods, jungle, buildings) by 1 MP, and may move and fire even under a Move-or-Fire rule."],
            description: [
                "The Foot Cavalry Ability is only effective with infantry squads who are not equipped with vehicles or mounts to ride upon.",
                "The Foot Cavalry squad leader has trained himself for endurance running, even in full combat gear, and pushes his men hard to keep them up to his level. Squads led by a Foot Cavalry character gain an additional 30 meters (1 MP) of movement per turn, and reduce by 1 MP the movement penalties for moving through rough terrain, woods, jungle, and even buildings.",
                "Additionally, a foot infantry squad with this ability that has a Move-or-Fire rule can move and fire in the same turn.",
            ],
        },
        as: {
            unitType: "CI (foot motive type only)",
            unitTypeFilter: ['CI'],
            summary: ["Foot infantry receives +2\" Move per turn, reduces additional movement costs for woods, jungle, rough, rubble, and building terrain by 1\" per inch of travel, and halves elevation change costs (min +0\")."],
            description: [
                "The foot cavalry\u2019s squad leader has trained for endurance running, even in full combat gear\u2014and pushes their troops hard to keep them up to their level.",
                "A conventional foot infantry unit with this SPA receives an additional 2 inches of movement per turn, and reduces the additional movement costs for all wooded, jungle, rough, rubble, and building terrain types by 1 inch per inch of travel and halves the elevation change movement costs (to a minimum added movement cost of +0 inches).",
            ],
        },
    },
    {
        id: "urban_guerrilla",
        name: "Urban Guerrilla",
        cost: 3,
        rulesRef: [{ book: Rulebook.CO, page: 82 }, { book: Rulebook.ASCE, page: 101 }],
        cbt: {
            unitType: "Infantry (conventional, battle armor)",
            summary: ["Infantry squad gains \u20131 to all incoming weapon attacks and negates double-damage for infantry in the open. Once per scenario in urban terrain, may spawn a Green Rifle (Ballistic) Foot Platoon within 3 hexes that attacks a chosen target until reduced to half strength."],
            description: [
                "The Urban Guerrilla ability is effective with infantry squads that use any motive type, as long as they can function within an urban environment and enter buildings.",
                "Urban Guerrilla squad leaders have trained their troops to use the ambient cover of any urban or suburban setting, from buildings and statues to parked vehicles and street lamps, to maximum effect, enabling them to claim cover even when out in the open. This ability applies a \u20131 roll modifier for all weapon attacks made against members of an infantry squad led by an Urban Guerrilla. It also reduces the damage from vehicular weapons targeting infantry by eliminating the double-damage effect for attacking infantry in the open.",
                "Offensively, an Urban Guerrilla can call upon 'local support' within an urban area once per scenario\u2014typically made up of armed residents ranging from the neighborhood watch to local street thugs. When called up, this 'support' will take the form of a new Rifle (Ballistic) Foot Platoon with a Skill Rating of Green.",
                "This 'supporting infantry' will attack a target of the Urban Guerrilla's choice from any structure within 3 hexes of the Urban Guerrilla's position, but will scatter as soon as their numbers are reduced to half or less.",
            ],
        },
        as: {
            unitType: "CI, BA",
            unitTypeFilter: ['CI', 'BA'],
            summary: ["Attacks against this infantry unit suffer +1 TN and \u20131 damage if in building, rough, rubble, or paved terrain. Once per urban scenario, may spawn a friendly CI unit (2\" Move, 1 armor, 1 structure, 1 damage at Short range, Skill +2) within 6\"."],
            description: [
                "Nobody knows the streets like this infantry force\u2014but is this really a regular outfit, or a street gang?",
                "Attacks against an infantry unit with this SPA suffer a +1 Target Number modifier, and a \u20131 damage point reduction if the unit is occupying building, rough, rubble, or paved terrain types.",
                "In addition, once per any scenario that takes place in urban (or suburban) terrain, this unit can \u201cspawn\u201d a second infantry unit friendly to itself during the turn\u2019s End Phase. This new infantry unit appears within 6 inches of the urban guerrilla unit, and is treated as a conventional infantry unit with 2 inches of Move (using the f movement code), 1 point each of armor and structure, and can deliver 1 point of damage against targets at Short range. The new infantry unit\u2019s Skill Rating is 2 points higher than that of the unit that spawned it (to a maximum Skill Rating of 8). Once created, the new infantry unit operates as a separate unit.",
            ],
        },
    }
]