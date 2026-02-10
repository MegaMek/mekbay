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

export interface PilotAbility {
    id: string;
    name: string;
    cost: number;
    /** Eligible unit types for this ability. If omitted, any unit may use it. */
    unitType?: string;
    summary: string[];
    /** Extended rules description paragraphs (more comprehensive than summary). */
    description?: string[];
    /** Multiple rulebook references (e.g. CO p.72, AS:CE p.92). */
    rulesRef: RulesReference[];
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
        summary: ["Quadruped unit gains mobility bonus and ability to demoralize opponents"],
    },
    {
        id: "antagonizer",
        name: "Antagonizer",
        cost: 3,
        rulesRef: [{ book: Rulebook.CO, page: 73 }, { book: Rulebook.ASCE, page: 92 }],
        summary: ["Unit can enrage an opponent for a brief period"],
    },
    {
        id: "blood_stalker",
        name: "Blood Stalker",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 73 }, { book: Rulebook.ASCE, page: 93 }],
        summary: ["Unit may focus its attacks better on a preferred target until it is destroyed"],
    },
    {
        id: "cluster_hitter",
        name: "Cluster Hitter",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 73 }, { book: Rulebook.ASCE, page: 93 }],
        summary: ["Unit can deliver extra damage in an attack using missiles or flak weapons"],
    },
    {
        id: "combat_intuition",
        name: "Combat Intuition",
        cost: 3,
        rulesRef: [{ book: Rulebook.CO, page: 73 }, { book: Rulebook.ASCE, page: 93 }],
        summary: ["Unit may move and resolve fire before any other unit acts"],
    },
    {
        id: "cross_country",
        name: "Cross-Country",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 73 }, { book: Rulebook.ASCE, page: 93 }],
        summary: ["Ground vehicle unit may enter some illegal terrain types, but at high Move cost"],
    },
    {
        id: "demoralizer",
        name: "Demoralizer",
        cost: 3,
        rulesRef: [{ book: Rulebook.CO, page: 74 }, { book: Rulebook.ASCE, page: 93 }],
        summary: ["Unit can intimidate an opponent for a brief period"],
    },
    {
        id: "dodge",
        name: "Dodge",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 74 }, { book: Rulebook.ASCE, page: 95 }],
        summary: ["Unit can attempt to evade physical attacks"],
    },
    {
        id: "dust_off",
        name: "Dust-Off",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 74 }, { book: Rulebook.ASCE, page: 95 }],
        summary: ["Enables airborne unit types to land or liftoff in non-clear terrain"],
    },
    {
        id: "eagles_eyes",
        name: "Eagle's Eyes",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 74 }, { book: Rulebook.ASCE, page: 95 }],
        summary: ["Unit gains (or augments) its ability to spot hidden units and avoid mines"],
    },
    {
        id: "environmental_specialist",
        name: "Environmental Specialist",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 74 }, { book: Rulebook.ASCE, page: 95 }],
        summary: ["Reduces movement and combat modifiers in a preferred environment"],
    },
    {
        id: "fist_fire",
        name: "Fist Fire",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 75 }, { book: Rulebook.ASCE, page: 96 }],
        summary: ["Unit delivers extra damage in physical attacks"],
    },
    {
        id: "float_like_a_butterfly",
        name: "Float Like a Butterfly",
        cost: 1,
        rulesRef: [{ book: Rulebook.ASCE, page: 96 }],
        summary: ["Unit may force an opponent to reroll an attack with this unit as the target"],
    },
    {
        id: "float_like_a_butterfly2",
        name: "Float Like a Butterfly",
        cost: 2,
        rulesRef: [{ book: Rulebook.ASCE, page: 96 }],
        summary: ["Unit may force an opponent to reroll an attack with this unit as the target"],
    },
    {
        id: "float_like_a_butterfly3",
        name: "Float Like a Butterfly",
        cost: 3,
        rulesRef: [{ book: Rulebook.ASCE, page: 96 }],
        summary: ["Unit may force an opponent to reroll an attack with this unit as the target"],
    },
    {
        id: "float_like_a_butterfly4",
        name: "Float Like a Butterfly",
        cost: 4,
        rulesRef: [{ book: Rulebook.ASCE, page: 96 }],
        summary: ["Unit may force an opponent to reroll an attack with this unit as the target"],
    },
    {
        id: "forward_observer",
        name: "Forward Observer",
        cost: 1,
        rulesRef: [{ book: Rulebook.CO, page: 75 }, { book: Rulebook.ASCE, page: 96 }],
        summary: ["Unit improves accuracy of indirect fire when used as a spotter"],
    },
    {
        id: "golden_goose",
        name: "Golden Goose",
        cost: 3,
        rulesRef: [{ book: Rulebook.CO, page: 75 }, { book: Rulebook.ASCE, page: 96 }],
        summary: ["Improves accuracy for air-to-ground strafing, strike, and bombing attacks"],
    },
    {
        id: "ground_hugger",
        name: "Ground-Hugger",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 75 }, { book: Rulebook.ASCE, page: 96 }],
        summary: ["Airborne unit may execute a double-strafe or double-strike air-to-ground attack"],
    },
    {
        id: "headhunter",
        name: "Headhunter",
        cost: 2,
        rulesRef: [{ book: Rulebook.ASCE, page: 96 }],
        summary: ["Can automatically identify enemy command units"],
    },
    {
        id: "heavy_lifter",
        name: "Heavy Lifter",
        cost: 1,
        rulesRef: [{ book: Rulebook.CO, page: 76 }, { book: Rulebook.ASCE, page: 97 }],
        summary: ["Enables increased carrying capacity with External Cargo rules"],
    },
    {
        id: "hopper",
        name: "Hopper",
        cost: 1,
        rulesRef: [{ book: Rulebook.CO, page: 76 }, { book: Rulebook.ASCE, page: 97 }],
        summary: ["Unit may avoid being reduced below 1 inch of Move by MP Hits"],
    },
    {
        id: "hot_dog",
        name: "Hot Dog",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 76 }, { book: Rulebook.ASCE, page: 97 }],
        summary: ["Increases the Heat a unit can sustain before shutdown"],
    },
    {
        id: "human_tro",
        name: "Human TRO",
        cost: 1,
        rulesRef: [{ book: Rulebook.CO, page: 76 }, { book: Rulebook.ASCE, page: 97 }],
        summary: ["Unit can ignore the Concealing Unit Data rules vs. non-hidden opponents"],
    },
    {
        id: "iron_will",
        name: "Iron Will",
        cost: 1,
        rulesRef: [{ book: Rulebook.CO, page: 76 }, { book: Rulebook.ASCE, page: 97 }],
        summary: ["Unit can resist psychological attacks and receives a bonus during Morale checks"],
    },
    {
        id: "jumping_jack",
        name: "Jumping Jack",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 76 }, { book: Rulebook.ASCE, page: 97 }],
        summary: ["Improves accuracy of any attack made when the unit uses jumping Move"],
    },
    {
        id: "lucky",
        name: "Lucky",
        cost: 1,
        rulesRef: [{ book: Rulebook.CO, page: 77 }, { book: Rulebook.ASCE, page: 97 }],
        summary: ["Unit may reroll a limited number of failed attacks and Control Rolls per scenario"],
    },
    {
        id: "lucky2",
        name: "Lucky",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 77 }, { book: Rulebook.ASCE, page: 97 }],
        summary: ["Unit may reroll a limited number of failed attacks and Control Rolls per scenario"],
    },
    {
        id: "lucky3",
        name: "Lucky",
        cost: 3,
        rulesRef: [{ book: Rulebook.CO, page: 77 }, { book: Rulebook.ASCE, page: 97 }],
        summary: ["Unit may reroll a limited number of failed attacks and Control Rolls per scenario"],
    },
    {
        id: "lucky4",
        name: "Lucky",
        cost: 4,
        rulesRef: [{ book: Rulebook.CO, page: 77 }, { book: Rulebook.ASCE, page: 97 }],
        summary: ["Unit may reroll a limited number of failed attacks and Control Rolls per scenario"],
    },
    {
        id: "maneuvering_ace",
        name: "Maneuvering Ace",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 77 }, { book: Rulebook.ASCE, page: 97 }],
        summary: ["Reduces Move costs for woods/jungle terrain and aerospace atmospheric control"],
    },
    {
        id: "marksman",
        name: "Marksman",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 77 }, { book: Rulebook.ASCE, page: 97 }],
        summary: ["If unit attacks while stationary, may score extra critical after delivering 1 damage"],
    },
    {
        id: "melee_master",
        name: "Melee Master",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 77 }, { book: Rulebook.ASCE, page: 98 }],
        summary: ["Unit increases its physical attack damage by half its Size (round up)"],
    },
    {
        id: "melee_specialist",
        name: "Melee Specialist",
        cost: 1,
        rulesRef: [{ book: Rulebook.CO, page: 77 }, { book: Rulebook.ASCE, page: 98 }],
        summary: ["Unit delivers physical attacks with greater accuracy"],
    },
    {
        id: "multi_tasker",
        name: "Multi-Tasker",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 78 }, { book: Rulebook.ASCE, page: 98 }],
        summary: ["Unit can divide its weapon attack between two targets per turn"],
    },
    {
        id: "natural_grace",
        name: "Natural Grace",
        cost: 3,
        rulesRef: [{ book: Rulebook.CO, page: 78 }, { book: Rulebook.ASCE, page: 98 }],
        summary: ["Unit gains 360-degree field of fire; reduces Move costs in ultra-heavy terrain"],
    },
    {
        id: "oblique_artilleryman",
        name: "Oblique Artilleryman",
        cost: 1,
        rulesRef: [{ book: Rulebook.CO, page: 78 }, { book: Rulebook.ASCE, page: 98 }],
        summary: ["Improves accuracy and reduces scatter for all artillery weapon attacks"],
    },
    {
        id: "oblique_attacker",
        name: "Oblique Attacker",
        cost: 1,
        rulesRef: [{ book: Rulebook.CO, page: 78 }, { book: Rulebook.ASCE, page: 98 }],
        summary: ["Improves accuracy for indirect fire, and enables indirect attacks without a spotter"],
    },
    {
        id: "range_master",
        name: "Range Master",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 78 }, { book: Rulebook.ASCE, page: 98 }],
        summary: ["Unit swaps normal range modifier for Medium, Long, or Extreme range with Short"],
    },
    {
        id: "ride_the_wash",
        name: "Ride the Wash",
        cost: 4,
        rulesRef: [{ book: Rulebook.CO, page: 79 }, { book: Rulebook.ASCE, page: 98 }],
        summary: ["Unit reduces atmospheric combat modifiers; may execute special air-to-air attack"],
    },
    {
        id: "sandblaster",
        name: "Sandblaster",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 79 }, { book: Rulebook.ASCE, page: 99 }],
        summary: ["Unit improves accuracy and damage when only using AC and missile weapons"],
    },
    {
        id: "shaky_stick",
        name: "Shaky Stick",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 79 }, { book: Rulebook.ASCE, page: 99 }],
        summary: ["Airborne unit is harder to hit from the ground during air-to-ground attacks"],
    },
    {
        id: "sharpshooter",
        name: "Sharpshooter",
        cost: 4,
        rulesRef: [{ book: Rulebook.CO, page: 79 }, { book: Rulebook.ASCE, page: 99 }],
        summary: ["If unit attacks while stationary, may score an extra critical after delivering full damage"],
    },
    {
        id: "slugger",
        name: "Slugger",
        cost: 1,
        rulesRef: [{ book: Rulebook.CO, page: 80 }, { book: Rulebook.ASCE, page: 99 }],
        summary: ["'Mech unit can improvise its own melee weapons from suitable terrain"],
    },
    {
        id: "sniper",
        name: "Sniper",
        cost: 3,
        rulesRef: [{ book: Rulebook.CO, page: 80 }, { book: Rulebook.ASCE, page: 99 }],
        summary: ["Unit reduces Medium, Long, and Extreme range modifiers by half."],
    },
    {
        id: "speed_demon",
        name: "Speed Demon",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 80 }, { book: Rulebook.ASCE, page: 99 }],
        summary: ["Unit can move faster than normal"],
    },
    {
        id: "stand_aside",
        name: "Stand-Aside",
        cost: 1,
        rulesRef: [{ book: Rulebook.CO, page: 80 }, { book: Rulebook.ASCE, page: 99 }],
        summary: ["Unit can pass directly through enemy units at extra Move cost"],
    },
    {
        id: "street_fighter",
        name: "Street Fighter",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 80 }, { book: Rulebook.ASCE, page: 99 }],
        summary: ["Unit may pre-empt an attack against it by enemies in base contact"],
    },
    {
        id: "sure_footed",
        name: "Sure-Footed",
        cost: 2,
        rulesRef: [{ book: Rulebook.ASCE, page: 100 }],
        summary: ["Unit receives bonus movement on paved or ice terrain and ignores skidding"],
    },
    {
        id: "swordsman",
        name: "Swordsman",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 80 }, { book: Rulebook.ASCE, page: 100 }],
        summary: ["Unit can deliver improved damage or critical hits when using MEL special"],
    },
    {
        id: "tactical_genius",
        name: "Tactical Genius",
        cost: 3,
        rulesRef: [{ book: Rulebook.CO, page: 80 }, { book: Rulebook.ASCE, page: 100 }],
        summary: ["Enables command unit to reroll Initiatives once every 2 turns"],
    },
    {
        id: "terrain_master_drag_racer",
        name: "Terrain Master (Drag Racer)",
        cost: 1,
        unitType: "Combat Vehicle (tracked or wheeled motive types only)",
        rulesRef: [{ book: Rulebook.CO, page: 81 }, { book: Rulebook.ASCE, page: 100 }],
        summary: ["Tracked/wheeled vehicle gains extra speed on paved, ice, or black ice surfaces; receives a skid-avoidance bonus and can execute a forward-only Lateral Shift at Flank speed or faster."],
        description: [
            "Can only be used by Tracked and Wheeled Vehicles. Drag Racer Terrain Masters are the terror of urban environments.",
            "This ability provides an extra +1 MP to the Drag Racer's Cruise MP, +2 to the unit's Flank MP, and +3 to its Sprint MP as long as the road surface is Paved, Ice, or even Black Ice. These modifiers are cumulative with the effects of the Speed Demon SPA.",
            "In addition, the Drag Racer receives a \u20132 target modifier to all Driving Skill Rolls made while on such smooth surfaces, including rolls made to avoid skidding.",
            "As a special maneuver, Drag Racers moving at Flank speed or faster can also execute a forward-only Lateral Shift maneuver, similar to four-legged 'Mechs.",
        ],
    },
    {
        id: "terrain_master_forest_ranger",
        name: "Terrain Master (Forest Ranger)",
        cost: 3,
        unitType: "Any non-airborne unit",
        rulesRef: [{ book: Rulebook.CO, page: 81 }, { book: Rulebook.ASCE, page: 100 }],
        summary: ["Unit moves more easily through woods/jungle (\u20131 MP cost), gains a Piloting bonus in jungle, and at Walk/Cruise speed gains +1 To-Hit cover modifier in wooded or jungle terrain."],
        description: [
            "Forest Ranger Terrain Masters are skilled at making good choices when moving their vehicles through light or heavy foliage.",
            "This ability subtracts 1 MP from all movement costs the Forest Ranger's unit incurs when crossing through all woods and jungle terrain, and applies a \u20131 target modifier to any Piloting Skill Rolls required when crossing through jungle terrain.",
            "Furthermore, if the Forest Ranger uses Walking or Cruising movement rates, they can use the trees, brush, and uneven ground for better cover than most, imposing an additional +1 To-Hit modifier against any attacks directed against the unit while it is within wooded or jungle terrain.",
        ],
    },
    {
        id: "terrain_master_frogman",
        name: "Terrain Master (Frogman)",
        cost: 3,
        unitType: "'Mechs, ProtoMechs",
        rulesRef: [{ book: Rulebook.CO, page: 81 }, { book: Rulebook.ASCE, page: 100 }],
        summary: ["'Mech/ProtoMech moves more easily in water deeper than Depth 1 (\u20131 MP cost), gains a Piloting bonus when submerged, and applies +2 to Crush Depth Checks under Extreme Depth rules."],
        description: [
            "Can only be used by 'Mechs and ProtoMechs. Frogman Terrain Masters are skilled at moving through water.",
            "This ability subtracts 1 MP from all movement costs the 'Mech or ProtoMech incurs when maneuvering through water terrain deeper than Depth 1, and applies a \u20131 target modifier to any Piloting Skill Rolls required when submerged, including those used for physical attacks.",
            "Furthermore, if using the Extreme Depth rules (see TO:AR), the Frogman applies a +2 target modifier for any Crush Depth Checks.",
        ],
    },
    {
        id: "terrain_master_mountaineer",
        name: "Terrain Master (Mountaineer)",
        cost: 3,
        unitType: "Any non-airborne unit",
        rulesRef: [{ book: Rulebook.CO, page: 81 }, { book: Rulebook.ASCE, page: 100 }],
        summary: ["Unit moves more easily through rough/rubble terrain and level changes (\u20131 MP cost, including sheer cliffs), with a \u20131 Piloting bonus in such terrain."],
        description: [
            "The Mountaineer Terrain Master has extensive experience navigating the rocky features and steep slopes common to mountainous regions.",
            "The Mountaineer subtracts 1 MP from all movement costs their unit incurs when crossing through gravel piles, rough/ultra-rough, or rubble/ultra-rubble terrain, and for any level changes, including those that involve sheer cliffs.",
            "In addition, the Mountaineer Terrain Master applies a \u20131 target modifier to any Piloting Skill Rolls required when crossing through such terrain.",
        ],
    },
    {
        id: "terrain_master_nightwalker",
        name: "Terrain Master (Nightwalker)",
        cost: 3,
        unitType: "Any non-airborne unit",
        rulesRef: [{ book: Rulebook.CO, page: 81 }, { book: Rulebook.ASCE, page: 100 }],
        summary: ["Unit ignores darkness-based MP modifiers at Walk/Cruise speed; at faster speeds reduces them by 1 MP. Does not affect Gunnery Skill."],
        description: [
            "The Nightwalker Terrain Master can ignore all night- or darkness-based MP modifiers imposed by unusual light conditions, including Dawn, Dusk, Glare, Full Moon, Night, Moonless Night, Pitch Black, or Solar Flare, as long as the unit maintains a Walk or Cruise movement rate.",
            "If the unit spends Flank, Jumping, Running, or Sprinting MPs, the Nightwalker may only reduce the MP costs imposed by these conditions by 1 MP (to a minimum of 0).",
            "This ability does not affect the Nightwalker's Gunnery Skill.",
        ],
    },
    {
        id: "terrain_master_sea_monster",
        name: "Terrain Master (Sea Monster)",
        cost: 3,
        unitType: "Any non-airborne unit",
        rulesRef: [{ book: Rulebook.ASCE, page: 101 }],
        summary: ["Unit moves more easily and ignores attack penalties in water terrain"],
    },
    {
        id: "terrain_master_swamp_beast",
        name: "Terrain Master (Swamp Beast)",
        cost: 3,
        unitType: "Any non-airborne unit",
        rulesRef: [{ book: Rulebook.CO, page: 81 }, { book: Rulebook.ASCE, page: 101 }],
        summary: ["Unit moves more easily through mud/swamp (\u20131 MP cost), gains a \u20131 Piloting bonus (including bog-down checks), and at Running/Flank speed can spend 1 extra MP per hex to impose +1 To-Hit against attacks while in muddy or swampy terrain."],
        description: [
            "Swamp Beast Terrain Masters are used to the hindering effects of muddy or swampy terrain.",
            "This ability subtracts 1 MP from all movement costs the Swamp Beast's unit incurs when crossing through mud or swamp land, and applies a \u20131 target modifier to any Piloting Skill Rolls required when crossing such surfaces\u2014including checks needed to avoid bogging down.",
            "In addition to this, if the Swamp Beast uses Running or Flank movement rates, they can spend one extra MP per hex to throw up a cloud of mud, muck, and loose brush around their unit, the result of which imposes an additional +1 target modifier against any attacks directed against the unit while it remains within muddy or swampy terrain.",
        ],
    },
    {
        id: "weapon_specialist",
        name: "Weapon Specialist",
        cost: 3,
        rulesRef: [{ book: Rulebook.ASCE, page: 101 }],
        summary: ["Unit can deliver a more accurate attack as long as it uses only half its firepower"],
    },
    {
        id: "wind_walker",
        name: "Wind Walker",
        cost: 2,
        rulesRef: [{ book: Rulebook.ASCE, page: 101 }],
        summary: ["Unit ignores atmospheric combat modifiers and gains a bonus to landing and liftoff"],
    },
    {
        id: "zweihander",
        name: "Zweihander",
        cost: 2,
        rulesRef: [{ book: Rulebook.ASCE, page: 101 }],
        summary: ["’Mech unit delivers more damage in physical attacks"],
    },
    {
        id: "light_horseman",
        name: "Light Horseman",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 76 }, { book: Rulebook.ASCE, page: 101 }],
        summary: ["Beast-mounted infantry unit moves faster, even through difficult terrain"],
    },
    {
        id: "heavy_horse",
        name: "Heavy Horse",
        cost: 2,
        rulesRef: [{ book: Rulebook.CO, page: 75 }, { book: Rulebook.ASCE, page: 101 }],
        summary: ["Beast-mounted infantry unit can inflict extra damage at point-blank range"],
    },
    {
        id: "foot_cavalry",
        name: "Foot Cavalry",
        cost: 1,
        rulesRef: [{ book: Rulebook.CO, page: 75 }, { book: Rulebook.ASCE, page: 101 }],
        summary: ["Foot-based infantry unit moves faster, even through difficult terrain"],
    },
    {
        id: "urban_guerrilla",
        name: "Urban Guerrilla",
        cost: 3,
        rulesRef: [{ book: Rulebook.CO, page: 82 }, { book: Rulebook.ASCE, page: 101 }],
        summary: ["Infantry unit is harder to attack in urban terrain, and may “spawn” support"],
    }
]