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

// ── Special Command Abilities (SCAs) ─────────────────────────────────────────

/**
 * Represents a Special Command Ability (SCA) - a force-level ability
 * that applies to an entire force or formation, as opposed to pilot-level SPAs.
 * Sourced primarily from Alpha Strike: Commander's Edition, pp. 118-128.
 */
export interface ASCommandAbility {
    id: string;
    name: string;
    summary: string[];
    rulesBook: string;
    rulesPage: number;
}

const ASCE = "Alpha Strike: Commander's Edition";

export const AS_COMMAND_ABILITIES: ASCommandAbility[] = [
    {
        id: "adjusting_fire",
        name: "Adjusting Fire",
        rulesBook: ASCE,
        rulesPage: 118,
        summary: [
            "If two artillery units in this Force fire at the same target, the second and successive units receive a -2 successive shots modifier.",
            "Applies once per turn but is cumulative over multiple turns."
        ],
    },
    {
        id: "anti_aircraft_specialists",
        name: "Anti-Aircraft Specialists",
        rulesBook: ASCE,
        rulesPage: 118,
        summary: [
            "-2 TN modifier to attacks against airborne targets (VTOL, WiGE, aerospace, Small Craft, DropShips, etc.).",
            "+1 TN modifier against ground-based units or grounded airborne-capable units.",
            "Aerospace units may not use this ability."
        ],
    },
    {
        id: "anti_mech_training",
        name: "Anti-'Mech Training",
        rulesBook: ASCE,
        rulesPage: 118,
        summary: ["Infantry units receive a -1 TN modifier on anti-'Mech attacks."],
    },
    {
        id: "banking_initiative",
        name: "Banking Initiative",
        rulesBook: ASCE,
        rulesPage: 118,
        summary: [
            "Yield Initiative before rolling to let opponent auto-win at 1-point margin.",
            "Every 2 yielded turns banks 1 auto-success (max 2 banked). Banked successes declared before rolling.",
            "Does not carry over between scenarios."
        ],
    },
    {
        id: "berserkers",
        name: "Berserkers",
        rulesBook: ASCE,
        rulesPage: 119,
        summary: [
            "At start of any turn, may elect to go berserk for the rest of the battle.",
            "-1 TN modifier for all attacks, but target movement modifier reduced by 1 (min 0)."
        ],
    },
    {
        id: "brawlers",
        name: "Brawlers",
        rulesBook: ASCE,
        rulesPage: 119,
        summary: [
            "Replace normal range modifiers: Short -1, Medium +2, Long +5, Extreme +10.",
            "Limit to no more than one-third of a deployed force."
        ],
    },
    {
        id: "camouflage",
        name: "Camouflage",
        rulesBook: ASCE,
        rulesPage: 119,
        summary: [
            "Ground units using Stand Still receive +2 target movement modifier (instead of +0).",
            "May place half starting units as Hidden Units regardless of scenario or terrain."
        ],
    },
    {
        id: "combat_drop_specialists",
        name: "Combat Drop Specialists",
        rulesBook: ASCE,
        rulesPage: 119,
        summary: [
            "All Drop rolls automatically succeed.",
            "+2 Initiative modifier the turn after a Combat Drop of at least half the Force's units."
        ],
    },
    {
        id: "communications_disruption",
        name: "Communications Disruption",
        rulesBook: ASCE,
        rulesPage: 119,
        summary: [
            "Each turn roll 1D6; on a 6, one random enemy lance/Star/Level II reduces Move by 4\" (min 1\") for the turn.",
            "Aerospace elements reduce base Thrust by 1 instead.",
            "Requires 2:1 Battlefield Intelligence ratio if BI rules are in play."
        ],
    },
    {
        id: "counterparts",
        name: "Counterparts",
        rulesBook: ASCE,
        rulesPage: 120,
        summary: [
            "Paired unit types during Setup: +1 Initiative for the entire battle.",
            "Failing to pair: -1 Initiative for the entire battle."
        ],
    },
    {
        id: "direct_fire_artillery_specialists",
        name: "Direct Fire Artillery Specialists",
        rulesBook: ASCE,
        rulesPage: 120,
        summary: ["Add 2\"/1 hex to the diameter of any Artillery area of effect when using direct fire."],
    },
    {
        id: "enemy_specialization",
        name: "Enemy Specialization",
        rulesBook: ASCE,
        rulesPage: 120,
        summary: [
            "Designate one enemy faction or group before play.",
            "Regular: +1 Init vs chosen enemy, -1 vs others. Veteran: double modifiers or pick second enemy.",
            "Elite: also negate one enemy SCA. Heroic/Legendary: negate two or gain an SCA vs that enemy."
        ],
    },
    {
        id: "environmental_specialization",
        name: "Environmental Specialization",
        rulesBook: ASCE,
        rulesPage: 121,
        summary: [
            "Designate terrain type or environmental condition before play.",
            "Benefits (Improved Mobility / Combat / Initiative) scale with average skill rating.",
            "-1 Initiative when specialized terrain/environment is not present.",
            "Terrain types: Clear, Desert, Urban, Vacuum, Winter, Woods."
        ],
    },
    {
        id: "esprit_de_corps",
        name: "Esprit de Corps",
        rulesBook: ASCE,
        rulesPage: 122,
        summary: ["Force is never subject to Forced Withdrawal or Morale checks."],
    },
    {
        id: "false_flag",
        name: "False Flag",
        rulesBook: ASCE,
        rulesPage: 122,
        summary: [
            "Requires Off-Map Movement SCA. Up to 1/3 of units kept off-map until turn 3+.",
            "On entry, roll 2D6: on 8+ enter from any edge (including opponent's home edge); on 7 or less enter from own half.",
            "+2 Initiative on the turn False Flag units enter."
        ],
    },
    {
        id: "fast_withdrawal",
        name: "Fast Withdrawal",
        rulesBook: ASCE,
        rulesPage: 122,
        summary: ["Units may exit any edge (except opponent's home edge) at any time without being considered destroyed or captured."],
    },
    {
        id: "flankers",
        name: "Flankers",
        rulesBook: ASCE,
        rulesPage: 122,
        summary: ["Units may enter via any non-home map edge instead of the specified edge."],
    },
    {
        id: "focus",
        name: "Focus",
        rulesBook: ASCE,
        rulesPage: 122,
        summary: [
            "During setup, assign 1 unit per 4 (round down) the named SPA.",
            "May be taken twice for double the number. Max 1 SPA per unit from this SCA.",
            "Two different Focus SCAs may not give both SPAs to the same unit."
        ],
    },
    {
        id: "forcing_the_initiative",
        name: "Forcing the Initiative",
        rulesBook: ASCE,
        rulesPage: 122,
        summary: [
            "Initiative modifier = (enemy units destroyed last turn minus own units lost last turn).",
            "Declared before rolling. Cannot be used on the first turn."
        ],
    },
    {
        id: "ground_attack_specialists",
        name: "Ground Attack Specialists",
        rulesBook: ASCE,
        rulesPage: 123,
        summary: [
            "-2 TN modifier vs ground-based targets (including jumping units and grounded air-capable units).",
            "+1 TN modifier vs airborne aerospace units and VTOL/WiGE units.",
            "Ground units without VTOL, WiGE, or aerospace movement may not use this."
        ],
    },
    {
        id: "highlander_burial",
        name: "Highlander Burial",
        rulesBook: ASCE,
        rulesPage: 123,
        summary: ["-1 TN modifier and +1 damage on Death From Above attacks."],
    },
    {
        id: "hit_and_run",
        name: "Hit and Run",
        rulesBook: ASCE,
        rulesPage: 123,
        summary: [
            "When outnumbered at start of a turn, units ignore Attacker Movement Modifier for jumping,",
            "or receive -1 Attacker Movement Modifier if not standing still or immobile."
        ],
    },
    {
        id: "infantry_defensive_experts",
        name: "Infantry Defensive Experts",
        rulesBook: ASCE,
        rulesPage: 123,
        summary: [
            "Infantry may be Hidden (even without scenario rules) and in prepared positions.",
            "Positions act as light buildings (CF 2); no map placement needed; lost once unit moves."
        ],
    },
    {
        id: "infantry_dragoons",
        name: "Infantry Dragoons",
        rulesBook: ASCE,
        rulesPage: 123,
        summary: ["Mounted infantry may move their full movement (instead of half) after dismounting."],
    },
    {
        id: "infiltrators",
        name: "Infiltrators",
        rulesBook: ASCE,
        rulesPage: 123,
        summary: [
            "As Attacker, deploy Hidden units in Defender's zone (or within 4\" of home edge).",
            "Level 1: infantry + light (Size 1) vehicles. Level 2: + medium (Size 2) vehicles + light 'Mechs.",
            "Level 3: + heavy (Size 3) vehicles + medium 'Mechs."
        ],
    },
    {
        id: "in_the_moment",
        name: "In the Moment",
        rulesBook: ASCE,
        rulesPage: 124,
        summary: [
            "After opponent sets up, may swap this SCA for another available SCA.",
            "If swapped, -1 Initiative for the first two turns."
        ],
    },
    {
        id: "intelligence_specialists",
        name: "Intelligence Specialists",
        rulesBook: ASCE,
        rulesPage: 124,
        summary: ["Add the MHQ5 special ability to one unit in the Force."],
    },
    {
        id: "loppers",
        name: "Loppers",
        rulesBook: ASCE,
        rulesPage: 124,
        summary: [
            "MEL attack (instead of weapon attacks): +1 damage and an extra Critical Hit roll (even with armor remaining).",
            "After hit, roll 1D6: on 6 the hatchet breaks and the unit loses MEL for the rest of the battle."
        ],
    },
    {
        id: "off_map_movement",
        name: "Off-Map Movement",
        rulesBook: ASCE,
        rulesPage: 124,
        summary: [
            "Units designate exit and reentry points; minimum off-map turns = distance / Move (round up).",
            "Returning units placed at edge during End Phase. Off-map units not counted for Initiative.",
            "If all on-map units lost while units are off-map, those units are considered withdrawn."
        ],
    },
    {
        id: "overrun_combat",
        name: "Overrun Combat",
        rulesBook: ASCE,
        rulesPage: 125,
        summary: [
            "When winning Initiative by 2+, move and attack with (margin / 2, round down) units before any opponent acts.",
            "Overrunning units act outside normal alternation; remaining units alternate normally."
        ],
    },
    {
        id: "rapid_strike",
        name: "Rapid Strike",
        rulesBook: ASCE,
        rulesPage: 125,
        summary: [
            "As Attacker, only half the opposing Force deploys at start.",
            "Remaining enemy units enter in two equal groups on turns 2 and 3 (randomly chosen)."
        ],
    },
    {
        id: "regional_specialization",
        name: "Regional Specialization",
        rulesBook: ASCE,
        rulesPage: 125,
        summary: [
            "+1 Initiative and -1 Morale in preferred region (system, duchy, district, etc.).",
            "May be taken twice to double the modifiers."
        ],
    },
    {
        id: "savages",
        name: "Savages",
        rulesBook: ASCE,
        rulesPage: 126,
        summary: [
            "All units receive Blood Stalker SPA. Each must target a different enemy unit.",
            "Units without a valid target suffer the Blood Stalker penalty; may re-target if an enemy becomes available."
        ],
    },
    {
        id: "sharp_shooters",
        name: "Sharp Shooters",
        rulesBook: ASCE,
        rulesPage: 126,
        summary: [
            "Replace normal range modifiers: Short +1, Medium +2, Long +3, Extreme +4.",
            "Limit to no more than one-third of a deployed force."
        ],
    },
    {
        id: "shielding",
        name: "Shielding",
        rulesBook: ASCE,
        rulesPage: 126,
        summary: ["Opponents must fire on a 'Mech before targeting a vehicle or infantry unit, if the 'Mech is closer and in LOS."],
    },
    {
        id: "speed_fire",
        name: "Speed Fire",
        rulesBook: ASCE,
        rulesPage: 126,
        summary: ["-1 TN modifier when using full Move in a direct line away from starting location."],
    },
    {
        id: "strategic_command",
        name: "Strategic Command",
        rulesBook: ASCE,
        rulesPage: 126,
        summary: [
            "May alter home edge choice and reposition terrain up to 6\" from Setup position.",
            "If using mapsheets, may rearrange them while keeping the same overall shape."
        ],
    },
    {
        id: "strategic_planning",
        name: "Strategic Planning",
        rulesBook: ASCE,
        rulesPage: 126,
        summary: [
            "+2 Initiative bonus.",
            "Only available to Forces with an average Experience Rating of Veteran, Elite, Heroic, or Legendary."
        ],
    },
    {
        id: "tactical_adjustments",
        name: "Tactical Adjustments",
        rulesBook: ASCE,
        rulesPage: 127,
        summary: ["After turn 3, the opposing Force gains no Initiative bonuses from Command Abilities or SPAs."],
    },
    {
        id: "tactical_experts_combined_fire",
        name: "Tactical Experts (Combined Fire)",
        rulesBook: ASCE,
        rulesPage: 127,
        summary: ["If an entire Formation of 3+ units attacks the same opposing unit, their attacks gain a -1 TN modifier."],
    },
    {
        id: "tactical_experts_dogfighting",
        name: "Tactical Experts (Dogfighting)",
        rulesBook: ASCE,
        rulesPage: 127,
        summary: ["-2 penalty to enemy units making Control Rolls for forming and avoiding engagements."],
    },
    {
        id: "tactical_experts_engineers",
        name: "Tactical Experts (Engineers)",
        rulesBook: ASCE,
        rulesPage: 127,
        summary: [
            "During setup, place 1 light building (2\" / 1 hex) or 5 minefield density points per Formation with 4+ units.",
            "Buildings and minefields must be placed on the Engineers' half of the play area."
        ],
    },
    {
        id: "tactical_experts_hidden_units",
        name: "Tactical Experts (Hidden Units)",
        rulesBook: ASCE,
        rulesPage: 127,
        summary: [
            "In scenarios allowing Hidden Units, may place twice as many (max +4 extra).",
            "If scenario does not allow Hidden Units, may place up to 4 on own half, at least 12\" from enemies."
        ],
    },
    {
        id: "tactical_experts_physical",
        name: "Tactical Experts (Physical)",
        rulesBook: ASCE,
        rulesPage: 127,
        summary: [
            "Each turn (Combat Phase, before attacks), may choose: +1 TN for weapon attacks, -1 TN for physical/melee attacks.",
            "Applies to all units in the Force for that turn."
        ],
    },
    {
        id: "tactical_experts_siege",
        name: "Tactical Experts (Siege)",
        rulesBook: ASCE,
        rulesPage: 127,
        summary: ["Halve building Damage Absorption (round down). Non-infantry in light buildings have 0 Damage Absorption."],
    },
    {
        id: "tactical_specialization",
        name: "Tactical Specialization",
        rulesBook: ASCE,
        rulesPage: 128,
        summary: [
            "Choose benefits from Tactical Specialist Benefits List based on average skill rating.",
            "Attack Specialization: +1 Init as Attacker, -1 as Defender.",
            "Defense Specialization: +1 Init as Defender, -1 as Attacker.",
            "Scenario Specialization: +1 Init in specified scenario type, -1 in all others.",
            "Attack + Defense cancel when equal; unequal levels yield net effect."
        ],
    },
    {
        id: "tactical_specialization_combined_arms",
        name: "Tactical Specialization (Combined Arms)",
        rulesBook: ASCE,
        rulesPage: 128,
        summary: [
            "+1 Initiative if Force contains at least one 'Mech, one vehicle, and one infantry.",
            "May be taken twice to also grant Tactical Experts (Attack or Defense, choose one)."
        ],
    },
    {
        id: "tactical_specialization_small_unit_actions",
        name: "Tactical Specialization (Small Unit Actions)",
        rulesBook: ASCE,
        rulesPage: 128,
        summary: [
            "+2 Initiative if total friendly Force < 12 units.",
            "+1 Initiative if total friendly Force < 24 units.",
            "-1 Initiative if total friendly Force is 24+ units."
        ],
    },
    {
        id: "warrior_code",
        name: "Warrior Code",
        rulesBook: ASCE,
        rulesPage: 128,
        summary: [
            "Designate 1 Champion per legal Formation (3+ units). Champion receives Blood Stalker SPA (target must be same Size or larger).",
            "Champion destroyed by target: -1 Initiative. Champion destroys target: +1 Initiative.",
            "Modifiers apply only to first target per Champion; stackable across multiple Champions."
        ],
    },
    {
        id: "zone_of_control",
        name: "Zone of Control",
        rulesBook: ASCE,
        rulesPage: 128,
        summary: [
            "Unit ending Move in base contact with unmoving opponents (forward arc, 2\"+ Move remaining) exerts a zone of control.",
            "Affected units must spend +4\" Move for any direction except directly away (unless jumping/VTOL).",
            "Infantry may only exert zone of control over other infantry."
        ],
    },
];
