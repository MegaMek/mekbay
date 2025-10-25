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

interface ForcePackUnit {
    chassis: string;
    model?: string;
}

interface ForcePack {
    name: string;
    units: ForcePackUnit[];
}

export const FORCE_PACKS: ForcePack[] = [
    {
        "name": "Clan Command Star",
        "units": [
            { "chassis": "Daishi (Dire Wolf)", "model": "Prime" },
            { "chassis": "Ryoken (Stormcrow)", "model": "Prime" },
            { "chassis": "Shadow Cat", "model": "Prime" },
            { "chassis": "Koshi (Mist Lynx)", "model": "Prime" },
            { "chassis": "Thor (Summoner)", "model": "Prime" }
        ]
    },
    {
        "name": "Clan Heavy Striker Star",
        "units": [
            { "chassis": "Man O' War (Gargoyle)", "model": "Prime" },
            { "chassis": "Loki (Hellbringer)", "model": "Prime" },
            { "chassis": "Vulture (Mad Dog)", "model": "Prime" },
            { "chassis": "Fenris (Ice Ferret)", "model": "Prime" },
            { "chassis": "Dragonfly (Viper)", "model": "Prime" }
        ]
    },
    {
        "name": "Clan Fire Star",
        "units": [
            { "chassis": "Masakari (Warhawk)", "model": "Prime" },
            { "chassis": "Nova Cat", "model": "Prime" },
            { "chassis": "Cougar", "model": "Prime" },
            { "chassis": "Uller (Kit Fox)", "model": "Prime" },
            { "chassis": "Dasher (Fire Moth)", "model": "Prime" }
        ]
    },
    {
        "name": "Clan Heavy Star",
        "units": [
            { "chassis": "Behemoth (Stone Rhino)", "model": "" },
            { "chassis": "Supernova", "model": "" },
            { "chassis": "Marauder IIC", "model": "" },
            { "chassis": "Warhammer IIC", "model": "" },
            { "chassis": "Hunchback IIC", "model": "" }
        ]
    },
    {
        "name": "Clan Support Star",
        "units": [
            { "chassis": "Night Gyr", "model": "Prime" },
            { "chassis": "Hankyu (Arctic Cheetah)", "model": "Prime" },
            { "chassis": "Linebacker", "model": "Prime" },
            { "chassis": "Battle Cobra", "model": "Prime" },
            { "chassis": "Black Lanner", "model": "Prime" }
        ]
    },
    {
        "name": "Clan Heavy Battle Star",
        "units": [
            { "chassis": "Turkina", "model": "Prime" },
            { "chassis": "Kingfisher", "model": "Prime" },
            { "chassis": "Cauldron-Born (Ebon Jaguar)", "model": "Prime" },
            { "chassis": "Crossbow", "model": "Prime" },
            { "chassis": "Nobori-nin (Huntsman)", "model": "Prime" }
        ]
    },
    {
        "name": "Clan Striker Star",
        "units": [
            { "chassis": "Goshawk (Vapor Eagle)", "model": "" },
            { "chassis": "Hellhound (Conjurer)", "model": "" },
            { "chassis": "Peregrine (Horned Owl)", "model": "" },
            { "chassis": "Vixen (Incubus)", "model": "" },
            { "chassis": "Piranha", "model": "" }
        ]
    },
    {
        "name": "Clan Ad Hoc Star",
        "units": [
            { "chassis": "Kodiak", "model": "" },
            { "chassis": "Pack Hunter", "model": "" },
            { "chassis": "Hellion", "model": "Prime" },
            { "chassis": "Fire Falcon", "model": "Prime" },
            { "chassis": "Baboon (Howler)", "model": "" }
        ]
    },
    {
        "name": "Clan Elementals",
        "units": [
            { "chassis": "Elemental Battle Armor", "model": "[Laser](sqd5)" },
            { "chassis": "Elemental Battle Armor", "model": "[Laser](sqd5)" },
            { "chassis": "Elemental Battle Armor", "model": "[Laser](sqd5)" },
            { "chassis": "Elemental Battle Armor", "model": "[Laser](sqd5)" },
            { "chassis": "Elemental Battle Armor", "model": "[Laser](sqd5)" }
        ]
    },
    {
        "name": "Inner Sphere Command Lance",
        "units": [
            { "chassis": "Marauder", "model": "MAD-3R" },
            { "chassis": "Archer", "model": "ARC-2R" },
            { "chassis": "Valkyrie", "model": "VLK-QA" },
            { "chassis": "Stinger", "model": "STG-3R" }
        ]
    },
    {
        "name": "Inner Sphere Battle Lance",
        "units": [
            { "chassis": "Warhammer", "model": "WHM-6R" },
            { "chassis": "Rifleman", "model": "RFL-3N" },
            { "chassis": "Phoenix Hawk", "model": "PXH-1" },
            { "chassis": "Wasp", "model": "WSP-1A" }
        ]
    },
    {
        "name": "Inner Sphere Direct Fire Lance",
        "units": [
            { "chassis": "Atlas", "model": "AS7-D" },
            { "chassis": "Marauder II", "model": "MAD-4A" },
            { "chassis": "Orion", "model": "ON1-K" },
            { "chassis": "Crusader", "model": "CRD-3R" }
        ]
    },
    {
        "name": "Inner Sphere Heavy Lance",
        "units": [
            { "chassis": "Banshee", "model": "BNC-3S" },
            { "chassis": "Grasshopper", "model": "GHR-5H" },
            { "chassis": "Centurion", "model": "CN9-A" },
            { "chassis": "Hatchetman", "model": "HCT-3F" }
        ]
    },
    {
        "name": "Inner Sphere Striker Lance",
        "units": [
            { "chassis": "Blackjack", "model": "BJ-1" },
            { "chassis": "Jenner", "model": "JR7-D" },
            { "chassis": "Panther", "model": "PNT-9R" },
            { "chassis": "Wolfhound", "model": "WLF-1" }
        ]
    },
    {
        "name": "Inner Sphere Fire Lance",
        "units": [
            { "chassis": "Longbow", "model": "LGB-0W" },
            { "chassis": "Stalker", "model": "STK-3F" },
            { "chassis": "Zeus", "model": "ZEU-6S" },
            { "chassis": "Trebuchet", "model": "TBT-5N" }
        ]
    },
    {
        "name": "Inner Sphere Heavy Battle Lance",
        "units": [
            { "chassis": "Nightstar", "model": "NSR-9J" },
            { "chassis": "Cataphract", "model": "CTF-1X" },
            { "chassis": "Axman", "model": "AXM-1N" },
            { "chassis": "Bushwacker", "model": "BSW-X1" }
        ]
    },
    {
        "name": "Inner Sphere Urban Lance",
        "units": [
            { "chassis": "Victor", "model": "VTR-9B" },
            { "chassis": "Enforcer", "model": "ENF-4R" },
            { "chassis": "Hunchback", "model": "HBK-4G" },
            { "chassis": "Raven", "model": "RVN-3M" }
        ]
    },
    {
        "name": "Inner Sphere Support Lance",
        "units": [
            { "chassis": "Cyclops", "model": "CP-10-Z" },
            { "chassis": "Thug", "model": "THG-11E" },
            { "chassis": "Dragon", "model": "DRG-1N" },
            { "chassis": "Spider", "model": "SDR-7M" }
        ]
    },
    {
        "name": "Wolf's Dragoons Assault Star",
        "units": [
            { "chassis": "Annihilator", "model": "ANH-2A" },
            { "chassis": "Mad Cat (Timber Wolf)", "model": "Prime" },
            { "chassis": "Rifleman", "model": "RFL-3N" },
            { "chassis": "Archer", "model": "ARC-2W" },
            { "chassis": "Blackjack", "model": "BJ-2" }
        ]
    },
    {
        "name": "Eridani Light Horse Hunter Lance",
        "units": [
            { "chassis": "Thunderbolt", "model": "TDR-5SE" },
            { "chassis": "Cyclops", "model": "CP-11-A" },
            { "chassis": "Banshee", "model": "BNC-3S" },
            { "chassis": "Sagittaire", "model": "SGT-8R" }
        ]
    },
    {
        "name": "Hansen's Roughriders Battle Lance",
        "units": [
            { "chassis": "Penetrator", "model": "PTR-4D" },
            { "chassis": "Hatchetman", "model": "HCT-6D" },
            { "chassis": "Enforcer", "model": "ENF-5D" },
            { "chassis": "Atlas", "model": "AS7-D" }
        ]
    },
    {
        "name": "Northwind Highlanders Command Lance",
        "units": [
            { "chassis": "Grasshopper", "model": "GHR-5J" },
            { "chassis": "Gunslinger", "model": "GUN-1ERD" },
            { "chassis": "Highlander", "model": "HGN-732" },
            { "chassis": "Warhammer", "model": "WHM-7S" }
        ]
    },
    {
        "name": "Kell Hounds Striker Lance",
        "units": [
            { "chassis": "Wolfhound", "model": "WLF-6S" },
            { "chassis": "Griffin", "model": "C" },
            { "chassis": "Crusader", "model": "CRD-8R" },
            { "chassis": "Nightsky", "model": "NGS-7S" }
        ]
    },
    {
        "name": "Gray Death Legion Heavy Battle Lance",
        "units": [
            { "chassis": "Regent", "model": "Prime" },
            { "chassis": "Man O' War (Gargoyle)", "model": "C" },
            { "chassis": "Catapult", "model": "CPLT-K2K" },
            { "chassis": "Shadow Hawk", "model": "SHD-7H" }
        ]
    },
    {
        "name": "Snord's Irregulars Assault Lance",
        "units": [
            { "chassis": "Spartan", "model": "SPT-N2" },
            { "chassis": "Rifleman", "model": "RFL-3N" },
            { "chassis": "Guillotine", "model": "GLT-3N" },
            { "chassis": "Highlander", "model": "HGN-732" }
        ]
    },
    {
        "name": "Somerset Strikers Force Pack",
        "units": [
            { "chassis": "Hatamoto-Chi", "model": "HTM-27T" },
            { "chassis": "Mauler", "model": "MAL-1R" },
            { "chassis": "Axman", "model": "AXM-2N" },
            { "chassis": "Bushwacker", "model": "BSW-X1" },
            { "chassis": "Wolfhound", "model": "WLF-2" }
        ]
    },
    {
        "name": "McCarron's Armored Cavalry Assault Lance",
        "units": [
            { "chassis": "Tian-Zong", "model": "TNZ-N1" },
            { "chassis": "Black Knight", "model": "BL-12-KNT" },
            { "chassis": "Awesome", "model": "AWS-9Q" },
            { "chassis": "Starslayer", "model": "STY-3Dr" }
        ]
    },
    {
        "name": "Black Remnant Command Lance",
        "units": [
            { "chassis": "Cyclops", "model": "CP-11-H" },
            { "chassis": "Flashman", "model": "FLS-10E" },
            { "chassis": "Star Adder (Blood Asp)", "model": "I" },
            { "chassis": "Dragon Fire", "model": "DGR-3F" }
        ]
    },
    {
        "name": "BattleTech: Proliferation Cycle Pack",
        "units": [
            { "chassis": "Battleaxe", "model": "BKX-7K" },
            { "chassis": "Ymir", "model": "BWP-2B" },
            { "chassis": "Coyotl", "model": "D" },
            { "chassis": "Firebee", "model": "FRB-1E (WAM-B)" },
            { "chassis": "Gladiator", "model": "GLD-1R" },
            { "chassis": "Icarus II", "model": "ICR-1S" },
            { "chassis": "Mackie", "model": "MSK-5S" }
        ]
    },
    {
        "name": "BattleTech: UrbanMech Lance",
        "units": [
            { "chassis": "UrbanMech", "model": "UM-R60L" },
            { "chassis": "UrbanMech", "model": "UM-R60" },
            { "chassis": "UrbanMech", "model": "UM-R27" },
            { "chassis": "UrbanMech", "model": "UM-R68" }
        ]
    },
    {
        "name": "ComStar Command Level II",
        "units": [
            { "chassis": "Black Knight", "model": "BL-6-KNT" },
            { "chassis": "Exterminator", "model": "EXT-4A" },
            { "chassis": "Highlander", "model": "HGN-732" },
            { "chassis": "King Crab", "model": "KGC-000" },
            { "chassis": "Mercury", "model": "MCY-98" },
            { "chassis": "Sentinel", "model": "STN-3K" }
        ]
    },
    {
        "name": "ComStar Battle Level II",
        "units": [
            { "chassis": "Crab", "model": "CRB-20" },
            { "chassis": "Crockett", "model": "CRK-5003-0" },
            { "chassis": "Flashman", "model": "FLS-7K" },
            { "chassis": "Guillotine", "model": "GLT-3N" },
            { "chassis": "Lancelot", "model": "LNC25-01" },
            { "chassis": "Mongoose", "model": "MON-66" }
        ]
    },
    {
        "name": "First Star League Command Lance",
        "units": [
            { "chassis": "Atlas II", "model": "AS7-D-H" },
            { "chassis": "Thunder Hawk", "model": "TDK-7S" },
            { "chassis": "Orion", "model": "ON1-K" },
            { "chassis": "Phoenix Hawk", "model": "PXH-1b 'Special'" }
        ]
    },
    {
        "name": "Second Star League Assault Lance",
        "units": [
            { "chassis": "Daishi (Dire Wolf)", "model": "'Prometheus" },
            { "chassis": "Emperor", "model": "EMP-6A" },
            { "chassis": "Argus", "model": "AGS-4D" },
            { "chassis": "Helios", "model": "HEL-3D" },
            { "chassis": "Coolant Truck", "model": "135-K" }
        ]
    },
    {
        "name": "Legendary MechWarriors Pack",
        "units": [
            { "chassis": "Daishi (Dire Wolf)", "model": "'Widowmaker" },
            { "chassis": "Archer", "model": "ARC-2R" },
            { "chassis": "Marauder", "model": "MAD-3R" },
            { "chassis": "Mad Cat (Timber Wolf)", "model": "(Pryde)" }
        ]
    },
    {
        "name": "Legendary MechWarriors Pack II",
        "units": [
            { "chassis": "SM5 Field Commander", "model": "Prime" },
            { "chassis": "Devastator", "model": "DVS-2" },
            { "chassis": "Charger", "model": "CGR-3K" },
            { "chassis": "Marauder", "model": "(Red Hunter-3146)" },
            { "chassis": "Caesar", "model": "CES-3R 'Archangel'" }
        ]
    },
    {
        "name": "Legendary MechWarriors Pack III",
        "units": [
            { "chassis": "Marauder", "model": "(Bounty Hunter-3015)" },
            { "chassis": "Warhammer", "model": "WHM-9K" },
            { "chassis": "Griffin", "model": "GRF-2N" },
            { "chassis": "Mad Cat (Timber Wolf)", "model": "(Bounty Hunter)" },
            { "chassis": "Loki Mk II (Hel)", "model": "(Prime)" },
            { "chassis": "Marauder II", "model": "(Bounty Hunter)" }
        ]
    },
    {
        "name": "Inner Sphere Battle Armor Platoon",
        "units": [
            { "chassis": "IS Standard Battle Armor", "model": "[Laser] (Sqd4)" },
            { "chassis": "IS Standard Battle Armor", "model": "[Laser] (Sqd4)" },
            { "chassis": "IS Standard Battle Armor", "model": "[Laser] (Sqd4)" },
            { "chassis": "IS Standard Battle Armor", "model": "[Laser] (Sqd4)" }
        ]
    },
    {
        "name": "Inner Sphere Security Lance",
        "units": [
            { "chassis": "JagerMech", "model": "JM6-S" },
            { "chassis": "Scorpion", "model": "SCP-1N" },
            { "chassis": "Vulcan", "model": "VL-2T" },
            { "chassis": "Whitworth", "model": "WTH-1" }
        ]
    },
    {
        "name": "Inner Sphere Recon Lance",
        "units": [
            { "chassis": "Firestarter", "model": "FS9-H" },
            { "chassis": "Spector", "model": "SPR-5F" },
            { "chassis": "Ostscout", "model": "OTT-7J" },
            { "chassis": "Javelin", "model": "JVN-10N" }
        ]
    },
    {
        "name": "Inner Sphere Heavy Recon Lance",
        "units": [
            { "chassis": "Charger", "model": "CGR-1A1" },
            { "chassis": "Ostroc", "model": "OSR-2C" },
            { "chassis": "Merlin", "model": "MLN-1A" },
            { "chassis": "Assassin", "model": "ASN-109" }
        ]
    },
    {
        "name": "Battlefield Support: Fire Lance",
        "units": [
            { "chassis": "SRM Carrier", "model": "" },
            { "chassis": "SRM Carrier", "model": "" },
            { "chassis": "LRM Carrier", "model": "" },
            { "chassis": "LRM Carrier", "model": "" }
        ]
    },
    {
        "name": "Battlefield Support: Battle Lance",
        "units": [
            { "chassis": "Manticore Heavy Tank", "model": "" },
            { "chassis": "Manticore Heavy Tank", "model": "" },
            { "chassis": "Vedette Medium Tank", "model": "" },
            { "chassis": "Vedette Medium Tank", "model": "" }
        ]
    },
    {
        "name": "Battlefield Support: Cavalry Lance",
        "units": [
            { "chassis": "Condor Heavy Hover Tank", "model": "" },
            { "chassis": "Condor Heavy Hover Tank", "model": "" },
            { "chassis": "Pegasus Scout Hover Tank", "model": "" },
            { "chassis": "Pegasus Scout Hover Tank", "model": "" }
        ]
    },
    {
        "name": "Battlefield Support: Assault Lance",
        "units": [
            { "chassis": "Schrek PPC Carrier", "model": "" },
            { "chassis": "Schrek PPC Carrier", "model": "" },
            { "chassis": "Demolisher Heavy Tank", "model": "(Defensive)" },
            { "chassis": "Demolisher Heavy Tank", "model": "(Defensive)" }
        ]
    },
    {
        "name": "Battlefield Support: Command Lance",
        "units": [
            { "chassis": "Von Luckner Heavy Tank", "model": "VNL-K65N" },
            { "chassis": "Von Luckner Heavy Tank", "model": "VNL-K65N" },
            { "chassis": "SturmFeur Heavy Tank", "model": "" },
            { "chassis": "SturmFeur Heavy Tank", "model": "" }
        ]
    },
    {
        "name": "Battlefield Support: Rifle Lance",
        "units": [
            { "chassis": "Bulldog Medium Tank", "model": "" },
            { "chassis": "Bulldog Medium Tank", "model": "" },
            { "chassis": "Hetzer Wheeled Assault Gun", "model": "" },
            { "chassis": "Hetzer Wheeled Assault Gun", "model": "" }
        ]
    },
    {
        "name": "Battlefield Support: Sweep Lance",
        "units": [
            { "chassis": "Drillson Heavy Hover Tank", "model": "" },
            { "chassis": "Drillson Heavy Hover Tank", "model": "" },
            { "chassis": "J. Edgar Light Hover Tank", "model": "" },
            { "chassis": "J. Edgar Light Hover Tank", "model": "" }
        ]
    },
    {
        "name": "Battlefield Support: Heavy Battle Lance",
        "units": [
            { "chassis": "Patton Tank", "model": "" },
            { "chassis": "Patton Tank", "model": "" },
            { "chassis": "Pike Support Vehicle", "model": "" },
            { "chassis": "Pike Support Vehicle", "model": "" }
        ]
    },
    {
        "name": "Battlefield Support: Hunter Lance",
        "units": [
            { "chassis": "Ontos Heavy Tank", "model": "" },
            { "chassis": "Ontos Heavy Tank", "model": "" },
            { "chassis": "Behemoth Heavy Tank", "model": "" },
            { "chassis": "Behemoth Heavy Tank", "model": "" }
        ]
    },
    {
        "name": "Battlefield Support: Recon Lance",
        "units": [
            { "chassis": "Warrior Attack Helicopter", "model": "H-7" },
            { "chassis": "Warrior Attack Helicopter", "model": "H-7" },
            { "chassis": "Skulker Wheeled Scout Tank", "model": "" },
            { "chassis": "Skulker Wheeled Scout Tank", "model": "" }
        ]
    },
    {
        "name": "Battlefield Support: Objectives",
        "units": [
            { "chassis": "Mobile Long Tom Artillery", "model": "LT-MOB-95" },
            { "chassis": "Mobile Long Tom Artillery", "model": "LT-MOB-25 (Ammunition Carriage)" },
            { "chassis": "MASH Truck", "model": "" },
            { "chassis": "Mobile Headquarters", "model": "" }
        ]
    }
];