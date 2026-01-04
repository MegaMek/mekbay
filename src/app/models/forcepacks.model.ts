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
    name: string;
    chassis: string;
    model?: string;
}

export interface ForcePack {
    name: string;
    units: ForcePackUnit[];
    bv?: number;
}

export const FORCE_PACKS: ForcePack[] = [
  {
    "name": "Clan Command Star",
    "units": [
      {
        "chassis": "Daishi (Dire Wolf)",
        "model": "Prime",
        "name": "BMDaishi_Prime"
      },
      {
        "chassis": "Ryoken (Stormcrow)",
        "model": "Prime",
        "name": "BMRyoken_Prime"
      },
      {
        "chassis": "Shadow Cat",
        "model": "Prime",
        "name": "BMShadowCat_Prime"
      },
      {
        "chassis": "Koshi (Mist Lynx)",
        "model": "Prime",
        "name": "BMKoshi_Prime"
      },
      {
        "chassis": "Thor (Summoner)",
        "model": "Prime",
        "name": "BMThor_Prime"
      }
    ]
  },
  {
    "name": "Clan Heavy Striker Star",
    "units": [
      {
        "chassis": "Man O' War (Gargoyle)",
        "model": "Prime",
        "name": "BMManOWar_Prime"
      },
      {
        "chassis": "Loki (Hellbringer)",
        "model": "Prime",
        "name": "BMLoki_Prime"
      },
      {
        "chassis": "Vulture (Mad Dog)",
        "model": "Prime",
        "name": "BMVulture_Prime"
      },
      {
        "chassis": "Fenris (Ice Ferret)",
        "model": "Prime",
        "name": "BMFenris_Prime"
      },
      {
        "chassis": "Dragonfly (Viper)",
        "model": "Prime",
        "name": "BMDragonfly_Prime"
      }
    ]
  },
  {
    "name": "Clan Fire Star",
    "units": [
      {
        "chassis": "Masakari (Warhawk)",
        "model": "Prime",
        "name": "BMMasakari_Prime"
      },
      {
        "chassis": "Nova Cat",
        "model": "Prime",
        "name": "BMNovaCat_Prime"
      },
      {
        "chassis": "Cougar",
        "model": "Prime",
        "name": "BMCougar_Prime"
      },
      {
        "chassis": "Uller (Kit Fox)",
        "model": "Prime",
        "name": "BMUller_Prime"
      },
      {
        "chassis": "Dasher (Fire Moth)",
        "model": "Prime",
        "name": "BMDasher_Prime"
      }
    ]
  },
  {
    "name": "Clan Heavy Star",
    "units": [
      {
        "chassis": "Behemoth (Stone Rhino)",
        "model": "",
        "name": "BMBehemoth"
      },
      {
        "chassis": "Supernova",
        "model": "",
        "name": "BMSupernova"
      },
      {
        "chassis": "Marauder IIC",
        "model": "",
        "name": "BMMarauderIIC"
      },
      {
        "chassis": "Warhammer IIC",
        "model": "",
        "name": "BMWarhammerIIC"
      },
      {
        "chassis": "Hunchback IIC",
        "model": "",
        "name": "BMHunchbackIIC"
      }
    ]
  },
  {
    "name": "Clan Support Star",
    "units": [
      {
        "chassis": "Night Gyr",
        "model": "Prime",
        "name": "BMNightGyr_Prime"
      },
      {
        "chassis": "Hankyu (Arctic Cheetah)",
        "model": "Prime",
        "name": "BMHankyu_Prime"
      },
      {
        "chassis": "Linebacker",
        "model": "Prime",
        "name": "BMLinebacker_Prime"
      },
      {
        "chassis": "Battle Cobra",
        "model": "Prime",
        "name": "BMBattleCobra_Prime"
      },
      {
        "chassis": "Black Lanner",
        "model": "Prime",
        "name": "BMBlackLanner_Prime"
      }
    ]
  },
  {
    "name": "Clan Heavy Battle Star",
    "units": [
      {
        "chassis": "Turkina",
        "model": "Prime",
        "name": "BMTurkina_Prime"
      },
      {
        "chassis": "Kingfisher",
        "model": "Prime",
        "name": "BMKingfisher_Prime"
      },
      {
        "chassis": "Cauldron-Born (Ebon Jaguar)",
        "model": "Prime",
        "name": "BMCauldronBorn_Prime"
      },
      {
        "chassis": "Crossbow",
        "model": "Prime",
        "name": "BMCrossbow_Prime"
      },
      {
        "chassis": "Nobori-nin (Huntsman)",
        "model": "Prime",
        "name": "BMNoborinin_Prime"
      }
    ]
  },
  {
    "name": "Clan Striker Star",
    "units": [
      {
        "chassis": "Goshawk (Vapor Eagle)",
        "model": "",
        "name": "BMGoshawk"
      },
      {
        "chassis": "Hellhound (Conjurer)",
        "model": "",
        "name": "BMHellhound"
      },
      {
        "chassis": "Peregrine (Horned Owl)",
        "model": "",
        "name": "BMPeregrine"
      },
      {
        "chassis": "Vixen (Incubus)",
        "model": "",
        "name": "BMVixen"
      },
      {
        "chassis": "Piranha",
        "model": "",
        "name": "BMPiranha"
      }
    ]
  },
  {
    "name": "Clan Ad Hoc Star",
    "units": [
      {
        "chassis": "Kodiak",
        "model": "",
        "name": "BMKodiak"
      },
      {
        "chassis": "Pack Hunter",
        "model": "",
        "name": "BMPackHunter"
      },
      {
        "chassis": "Hellion",
        "model": "Prime",
        "name": "BMHellion_Prime"
      },
      {
        "chassis": "Fire Falcon",
        "model": "Prime",
        "name": "BMFireFalcon_Prime"
      },
      {
        "chassis": "Baboon (Howler)",
        "model": "",
        "name": "BMBaboon"
      }
    ]
  },
  {
    "name": "Clan Elementals",
    "units": [
      {
        "chassis": "Elemental Battle Armor",
        "model": "[Laser](sqd5)",
        "name": "BAElementalBattleArmor_HeadhunterSqd4"
      },
      {
        "chassis": "Elemental Battle Armor",
        "model": "[Laser](sqd5)",
        "name": "BAElementalBattleArmor_HeadhunterSqd4"
      },
      {
        "chassis": "Elemental Battle Armor",
        "model": "[Laser](sqd5)",
        "name": "BAElementalBattleArmor_HeadhunterSqd4"
      },
      {
        "chassis": "Elemental Battle Armor",
        "model": "[Laser](sqd5)",
        "name": "BAElementalBattleArmor_HeadhunterSqd4"
      },
      {
        "chassis": "Elemental Battle Armor",
        "model": "[Laser](sqd5)",
        "name": "BAElementalBattleArmor_HeadhunterSqd4"
      }
    ]
  },
  {
    "name": "Inner Sphere Command Lance",
    "units": [
      {
        "chassis": "Marauder",
        "model": "MAD-3R",
        "name": "BMMarauder_MAD3R"
      },
      {
        "chassis": "Archer",
        "model": "ARC-2R",
        "name": "BMArcher_ARC2R"
      },
      {
        "chassis": "Valkyrie",
        "model": "VLK-QA",
        "name": "BMValkyrie_VLKQA"
      },
      {
        "chassis": "Stinger",
        "model": "STG-3R",
        "name": "BMStinger_STG3R"
      }
    ]
  },
  {
    "name": "Inner Sphere Battle Lance",
    "units": [
      {
        "chassis": "Warhammer",
        "model": "WHM-6R",
        "name": "BMWarhammer_WHM6R"
      },
      {
        "chassis": "Rifleman",
        "model": "RFL-3N",
        "name": "BMRifleman_RFL3N"
      },
      {
        "chassis": "Phoenix Hawk",
        "model": "PXH-1",
        "name": "BMPhoenixHawk_PXH1"
      },
      {
        "chassis": "Wasp",
        "model": "WSP-1A",
        "name": "BMWasp_WSP1A"
      }
    ]
  },
  {
    "name": "Inner Sphere Direct Fire Lance",
    "units": [
      {
        "chassis": "Atlas",
        "model": "AS7-D",
        "name": "BMAtlas_AS7D"
      },
      {
        "chassis": "Marauder II",
        "model": "MAD-4A",
        "name": "BMMarauderII_MAD4A"
      },
      {
        "chassis": "Orion",
        "model": "ON1-K",
        "name": "BMOrion_ON1K"
      },
      {
        "chassis": "Crusader",
        "model": "CRD-3R",
        "name": "BMCrusader_CRD3R"
      }
    ]
  },
  {
    "name": "Inner Sphere Heavy Lance",
    "units": [
      {
        "chassis": "Banshee",
        "model": "BNC-3S",
        "name": "BMBanshee_BNC3S"
      },
      {
        "chassis": "Grasshopper",
        "model": "GHR-5H",
        "name": "BMGrasshopper_GHR5H"
      },
      {
        "chassis": "Centurion",
        "model": "CN9-A",
        "name": "BMCenturion_CN9A"
      },
      {
        "chassis": "Hatchetman",
        "model": "HCT-3F",
        "name": "BMHatchetman_HCT3F"
      }
    ]
  },
  {
    "name": "Inner Sphere Striker Lance",
    "units": [
      {
        "chassis": "Blackjack",
        "model": "BJ-1",
        "name": "BMBlackjack_BJ1"
      },
      {
        "chassis": "Jenner",
        "model": "JR7-D",
        "name": "BMJenner_JR7D"
      },
      {
        "chassis": "Panther",
        "model": "PNT-9R",
        "name": "BMPanther_PNT9R"
      },
      {
        "chassis": "Wolfhound",
        "model": "WLF-1",
        "name": "BMWolfhound_WLF1"
      }
    ]
  },
  {
    "name": "Inner Sphere Fire Lance",
    "units": [
      {
        "chassis": "Longbow",
        "model": "LGB-0W",
        "name": "BMLongbow_LGB0W"
      },
      {
        "chassis": "Stalker",
        "model": "STK-3F",
        "name": "BMStalker_STK3F"
      },
      {
        "chassis": "Zeus",
        "model": "ZEU-6S",
        "name": "BMZeus_ZEU6S"
      },
      {
        "chassis": "Trebuchet",
        "model": "TBT-5N",
        "name": "BMTrebuchet_TBT5N"
      }
    ]
  },
  {
    "name": "Inner Sphere Heavy Battle Lance",
    "units": [
      {
        "chassis": "Nightstar",
        "model": "NSR-9J",
        "name": "BMNightstar_NSR9J"
      },
      {
        "chassis": "Cataphract",
        "model": "CTF-1X",
        "name": "BMCataphract_CTF1X"
      },
      {
        "chassis": "Axman",
        "model": "AXM-1N",
        "name": "BMAxman_AXM1N"
      },
      {
        "chassis": "Bushwacker",
        "model": "BSW-X1",
        "name": "BMBushwacker_BSWX1"
      }
    ]
  },
  {
    "name": "Inner Sphere Urban Lance",
    "units": [
      {
        "chassis": "Victor",
        "model": "VTR-9B",
        "name": "BMVictor_VTR9B"
      },
      {
        "chassis": "Enforcer",
        "model": "ENF-4R",
        "name": "BMEnforcer_ENF4R"
      },
      {
        "chassis": "Hunchback",
        "model": "HBK-4G",
        "name": "BMHunchback_HBK4G"
      },
      {
        "chassis": "Raven",
        "model": "RVN-3M",
        "name": "BMRaven_RVN3M"
      }
    ]
  },
  {
    "name": "Inner Sphere Support Lance",
    "units": [
      {
        "chassis": "Cyclops",
        "model": "CP-10-Z",
        "name": "BMCyclops_CP10Z"
      },
      {
        "chassis": "Thug",
        "model": "THG-11E",
        "name": "BMThug_THG11E"
      },
      {
        "chassis": "Dragon",
        "model": "DRG-1N",
        "name": "BMDragon_DRG1N"
      },
      {
        "chassis": "Spider",
        "model": "SDR-7M",
        "name": "BMSpider_SDR7M"
      }
    ]
  },
  {
    "name": "Wolf's Dragoons Assault Star",
    "units": [
      {
        "chassis": "Annihilator",
        "model": "ANH-2A",
        "name": "BMAnnihilator_ANH2A"
      },
      {
        "chassis": "Mad Cat (Timber Wolf)",
        "model": "Prime",
        "name": "BMMadCat_Prime"
      },
      {
        "chassis": "Rifleman",
        "model": "RFL-3N",
        "name": "BMRifleman_RFL3N"
      },
      {
        "chassis": "Archer",
        "model": "ARC-2W",
        "name": "BMArcher_ARC2W"
      },
      {
        "chassis": "Blackjack",
        "model": "BJ-2",
        "name": "BMBlackjack_BJ2"
      }
    ]
  },
  {
    "name": "Eridani Light Horse Hunter Lance",
    "units": [
      {
        "chassis": "Thunderbolt",
        "model": "TDR-5SE",
        "name": "BMThunderbolt_TDR5SE"
      },
      {
        "chassis": "Cyclops",
        "model": "CP-11-A",
        "name": "BMCyclops_CP11A"
      },
      {
        "chassis": "Banshee",
        "model": "BNC-3S",
        "name": "BMBanshee_BNC3S"
      },
      {
        "chassis": "Sagittaire",
        "model": "SGT-8R",
        "name": "BMSagittaire_SGT8R"
      }
    ]
  },
  {
    "name": "Hansen's Roughriders Battle Lance",
    "units": [
      {
        "chassis": "Penetrator",
        "model": "PTR-4D",
        "name": "BMPenetrator_PTR4D"
      },
      {
        "chassis": "Hatchetman",
        "model": "HCT-6D",
        "name": "BMHatchetman_HCT6D"
      },
      {
        "chassis": "Enforcer",
        "model": "ENF-5D",
        "name": "BMEnforcer_ENF5D"
      },
      {
        "chassis": "Atlas",
        "model": "AS7-D",
        "name": "BMAtlas_AS7D"
      }
    ]
  },
  {
    "name": "Northwind Highlanders Command Lance",
    "units": [
      {
        "chassis": "Grasshopper",
        "model": "GHR-5J",
        "name": "BMGrasshopper_GHR5J"
      },
      {
        "chassis": "Gunslinger",
        "model": "GUN-1ERD",
        "name": "BMGunslinger_GUN1ERD"
      },
      {
        "chassis": "Highlander",
        "model": "HGN-732",
        "name": "BMHighlander_HGN732"
      },
      {
        "chassis": "Warhammer",
        "model": "WHM-7S",
        "name": "BMWarhammer_WHM7S"
      }
    ]
  },
  {
    "name": "Kell Hounds Striker Lance",
    "units": [
      {
        "chassis": "Wolfhound",
        "model": "WLF-6S",
        "name": "BMWolfhound_WLF6S"
      },
      {
        "chassis": "Griffin",
        "model": "C",
        "name": "BMGriffin_C"
      },
      {
        "chassis": "Crusader",
        "model": "CRD-8R",
        "name": "BMCrusader_CRD8R"
      },
      {
        "chassis": "Nightsky",
        "model": "NGS-7S",
        "name": "BMNightsky_NGS7S"
      }
    ]
  },
  {
    "name": "Gray Death Legion Heavy Battle Lance",
    "units": [
      {
        "chassis": "Regent",
        "model": "Prime",
        "name": "BMRegent_Prime"
      },
      {
        "chassis": "Man O' War (Gargoyle)",
        "model": "C",
        "name": "BMManOWar_C"
      },
      {
        "chassis": "Catapult",
        "model": "CPLT-K2K",
        "name": "BMCatapult_CPLTK2K"
      },
      {
        "chassis": "Shadow Hawk",
        "model": "SHD-7H",
        "name": "BMShadowHawk_SHD7H"
      }
    ]
  },
  {
    "name": "Snord's Irregulars Assault Lance",
    "units": [
      {
        "chassis": "Spartan",
        "model": "SPT-N2",
        "name": "BMSpartan_SPTN2"
      },
      {
        "chassis": "Rifleman",
        "model": "RFL-3N",
        "name": "BMRifleman_RFL3N"
      },
      {
        "chassis": "Guillotine",
        "model": "GLT-3N",
        "name": "BMGuillotine_GLT3N"
      },
      {
        "chassis": "Highlander",
        "model": "HGN-732",
        "name": "BMHighlander_HGN732"
      }
    ]
  },
  {
    "name": "Somerset Strikers Force Pack",
    "units": [
      {
        "chassis": "Hatamoto-Chi",
        "model": "HTM-27T",
        "name": "BMHatamotoChi_HTM27T"
      },
      {
        "chassis": "Mauler",
        "model": "MAL-1R",
        "name": "BMMauler_MAL1R"
      },
      {
        "chassis": "Axman",
        "model": "AXM-2N",
        "name": "BMAxman_AXM2N"
      },
      {
        "chassis": "Bushwacker",
        "model": "BSW-X1",
        "name": "BMBushwacker_BSWX1"
      },
      {
        "chassis": "Wolfhound",
        "model": "WLF-2",
        "name": "BMWolfhound_WLF2"
      }
    ]
  },
  {
    "name": "McCarron's Armored Cavalry Assault Lance",
    "units": [
      {
        "chassis": "Tian-Zong",
        "model": "TNZ-N1",
        "name": "BMTianZong_TNZN1"
      },
      {
        "chassis": "Black Knight",
        "model": "BL-12-KNT",
        "name": "BMBlackKnight_BL12KNT"
      },
      {
        "chassis": "Awesome",
        "model": "AWS-9Q",
        "name": "BMAwesome_AWS9Q"
      },
      {
        "chassis": "Starslayer",
        "model": "STY-3Dr",
        "name": "BMStarslayer_STY3Dr"
      }
    ]
  },
  {
    "name": "Black Remnant Command Lance",
    "units": [
      {
        "chassis": "Cyclops",
        "model": "CP-11-H",
        "name": "BMCyclops_CP11H"
      },
      {
        "chassis": "Flashman",
        "model": "FLS-10E",
        "name": "BMFlashman_FLS10E"
      },
      {
        "chassis": "Star Adder (Blood Asp)",
        "model": "I",
        "name": "BMStarAdder_I"
      },
      {
        "chassis": "Dragon Fire",
        "model": "DGR-3F",
        "name": "BMDragonFire_DGR3F"
      }
    ]
  },
  {
    "name": "BattleTech: Proliferation Cycle Pack",
    "units": [
      {
        "chassis": "Battleaxe",
        "model": "BKX-7K",
        "name": "BMBattleAxe_BKX7K"
      },
      {
        "chassis": "Ymir",
        "model": "BWP-2B",
        "name": "BMYmir_BWP2B"
      },
      {
        "chassis": "Coyotl",
        "model": "D",
        "name": "BMCoyotl_D"
      },
      {
        "chassis": "Firebee",
        "model": "FRB-1E (WAM-B)",
        "name": "BMFirebee_FRB1EWAMB"
      },
      {
        "chassis": "Gladiator",
        "model": "GLD-1R",
        "name": "BMGladiator_GLD1R"
      },
      {
        "chassis": "Icarus II",
        "model": "ICR-1S",
        "name": "BMIcarusII_ICR1S"
      },
      {
        "chassis": "Mackie",
        "model": "MSK-5S",
        "name": "BMMackie_MSK5S"
      }
    ]
  },
  {
    "name": "BattleTech: UrbanMech Lance",
    "units": [
      {
        "chassis": "UrbanMech",
        "model": "UM-R60L",
        "name": "BMUrbanMech_UMR60L"
      },
      {
        "chassis": "UrbanMech",
        "model": "UM-R60",
        "name": "BMUrbanMech_UMR60"
      },
      {
        "chassis": "UrbanMech",
        "model": "UM-R27",
        "name": "BMUrbanMech_UMR27"
      },
      {
        "chassis": "UrbanMech",
        "model": "UM-R68",
        "name": "BMUrbanMech_UMR68"
      }
    ]
  },
  {
    "name": "ComStar Command Level II",
    "units": [
      {
        "chassis": "Black Knight",
        "model": "BL-6-KNT",
        "name": "BMBlackKnight_BL6KNT"
      },
      {
        "chassis": "Exterminator",
        "model": "EXT-4A",
        "name": "BMExterminator_EXT4A"
      },
      {
        "chassis": "Highlander",
        "model": "HGN-732",
        "name": "BMHighlander_HGN732"
      },
      {
        "chassis": "King Crab",
        "model": "KGC-000",
        "name": "BMKingCrab_KGC000"
      },
      {
        "chassis": "Mercury",
        "model": "MCY-98",
        "name": "BMMercury_MCY98"
      },
      {
        "chassis": "Sentinel",
        "model": "STN-3K",
        "name": "BMSentinel_STN3K"
      }
    ]
  },
  {
    "name": "ComStar Battle Level II",
    "units": [
      {
        "chassis": "Crab",
        "model": "CRB-20",
        "name": "BMCrab_CRB20"
      },
      {
        "chassis": "Crockett",
        "model": "CRK-5003-0",
        "name": "BMCrockett_CRK50030"
      },
      {
        "chassis": "Flashman",
        "model": "FLS-7K",
        "name": "BMFlashman_FLS7K"
      },
      {
        "chassis": "Guillotine",
        "model": "GLT-3N",
        "name": "BMGuillotine_GLT3N"
      },
      {
        "chassis": "Lancelot",
        "model": "LNC25-01",
        "name": "BMLancelot_LNC2501"
      },
      {
        "chassis": "Mongoose",
        "model": "MON-66",
        "name": "BMMongoose_MON66"
      }
    ]
  },
  {
    "name": "First Star League Command Lance",
    "units": [
      {
        "chassis": "Atlas II",
        "model": "AS7-D-H",
        "name": "BMAtlasII_AS7DH"
      },
      {
        "chassis": "Thunder Hawk",
        "model": "TDK-7S",
        "name": "BMThunderHawk_TDK7S"
      },
      {
        "chassis": "Orion",
        "model": "ON1-K",
        "name": "BMOrion_ON1K"
      },
      {
        "chassis": "Phoenix Hawk",
        "model": "PXH-1b 'Special'",
        "name": "BMPhoenixHawk_PXH1bSpecial"
      }
    ]
  },
  {
    "name": "Second Star League Assault Lance",
    "units": [
      {
        "chassis": "Daishi (Dire Wolf)",
        "model": "'Prometheus",
        "name": "BMDaishi_A"
      },
      {
        "chassis": "Emperor",
        "model": "EMP-6A",
        "name": "BMEmperor_EMP6A"
      },
      {
        "chassis": "Argus",
        "model": "AGS-4D",
        "name": "BMArgus_AGS4D"
      },
      {
        "chassis": "Helios",
        "model": "HEL-3D",
        "name": "BMHelios_HEL3D"
      },
      {
        "chassis": "Coolant Truck",
        "model": "135-K",
        "name": "CVCoolantTruck_135K"
      }
    ]
  },
  {
    "name": "Legendary MechWarriors Pack",
    "units": [
      {
        "chassis": "Daishi (Dire Wolf)",
        "model": "'Widowmaker",
        "name": "BMDaishi_A"
      },
      {
        "chassis": "Archer",
        "model": "ARC-2R",
        "name": "BMArcher_ARC2R"
      },
      {
        "chassis": "Marauder",
        "model": "MAD-3R",
        "name": "BMMarauder_MAD3R"
      },
      {
        "chassis": "Mad Cat (Timber Wolf)",
        "model": "(Pryde)",
        "name": "BMMadCat_Pryde"
      }
    ]
  },
  {
    "name": "Legendary MechWarriors Pack II",
    "units": [
      {
        "chassis": "SM5 Field Commander",
        "model": "Prime",
        "name": "CVSM5FieldCommander_Prime"
      },
      {
        "chassis": "Devastator",
        "model": "DVS-2",
        "name": "BMDevastator_DVS2"
      },
      {
        "chassis": "Charger",
        "model": "CGR-3K",
        "name": "BMCharger_CGR3K"
      },
      {
        "chassis": "Marauder",
        "model": "(Red Hunter-3146)",
        "name": "BMMarauder_RedHunter3146"
      },
      {
        "chassis": "Caesar",
        "model": "CES-3R 'Archangel'",
        "name": "BMCaesar_CES3RArchangel"
      }
    ]
  },
  {
    "name": "Legendary MechWarriors Pack III",
    "units": [
      {
        "chassis": "Marauder",
        "model": "(Bounty Hunter-3015)",
        "name": "BMMarauder_BountyHunter3015"
      },
      {
        "chassis": "Warhammer",
        "model": "WHM-9K",
        "name": "BMWarhammer_WHM9K"
      },
      {
        "chassis": "Griffin",
        "model": "GRF-2N",
        "name": "BMGriffin_GRF2N"
      },
      {
        "chassis": "Mad Cat (Timber Wolf)",
        "model": "(Bounty Hunter)",
        "name": "BMMadCat_BountyHunter"
      },
      {
        "chassis": "Loki Mk II (Hel)",
        "model": "(Prime)",
        "name": "BMLokiMkII_Prime"
      },
      {
        "chassis": "Marauder II",
        "model": "(Bounty Hunter)",
        "name": "BMMarauderII_BountyHunter"
      }
    ]
  },
  {
    "name": "Inner Sphere Battle Armor Platoon",
    "units": [
      {
        "chassis": "IS Standard Battle Armor",
        "model": "[Laser] (Sqd4)",
        "name": "BAISStandardBattleArmor_FlamerSqd4"
      },
      {
        "chassis": "IS Standard Battle Armor",
        "model": "[Laser] (Sqd4)",
        "name": "BAISStandardBattleArmor_FlamerSqd4"
      },
      {
        "chassis": "IS Standard Battle Armor",
        "model": "[Laser] (Sqd4)",
        "name": "BAISStandardBattleArmor_FlamerSqd4"
      },
      {
        "chassis": "IS Standard Battle Armor",
        "model": "[Laser] (Sqd4)",
        "name": "BAISStandardBattleArmor_FlamerSqd4"
      }
    ]
  },
  {
    "name": "Inner Sphere Security Lance",
    "units": [
      {
        "chassis": "JagerMech",
        "model": "JM6-S",
        "name": "BMJagerMech_JM6S"
      },
      {
        "chassis": "Scorpion",
        "model": "SCP-1N",
        "name": "BMScorpion_SCP1N"
      },
      {
        "chassis": "Vulcan",
        "model": "VL-2T",
        "name": "BMVulcan_VL2T"
      },
      {
        "chassis": "Whitworth",
        "model": "WTH-1",
        "name": "BMWhitworth_WTH1"
      }
    ]
  },
  {
    "name": "Inner Sphere Recon Lance",
    "units": [
      {
        "chassis": "Firestarter",
        "model": "FS9-H",
        "name": "BMFirestarter_FS9H"
      },
      {
        "chassis": "Spector",
        "model": "SPR-5F",
        "name": "BMSpector_SPR5F"
      },
      {
        "chassis": "Ostscout",
        "model": "OTT-7J",
        "name": "BMOstscout_OTT7J"
      },
      {
        "chassis": "Javelin",
        "model": "JVN-10N",
        "name": "BMJavelin_JVN10N"
      }
    ]
  },
  {
    "name": "Inner Sphere Heavy Recon Lance",
    "units": [
      {
        "chassis": "Charger",
        "model": "CGR-1A1",
        "name": "BMCharger_CGR1A1"
      },
      {
        "chassis": "Ostroc",
        "model": "OSR-2C",
        "name": "BMOstroc_OSR2C"
      },
      {
        "chassis": "Merlin",
        "model": "MLN-1A",
        "name": "BMMerlin_MLN1A"
      },
      {
        "chassis": "Assassin",
        "model": "ASN-109",
        "name": "BMAssassin_ASN109"
      }
    ]
  },
  {
    "name": "Battlefield Support: Fire Lance",
    "units": [
      {
        "chassis": "SRM Carrier",
        "model": "",
        "name": "CVSRMCarrier"
      },
      {
        "chassis": "SRM Carrier",
        "model": "",
        "name": "CVSRMCarrier"
      },
      {
        "chassis": "LRM Carrier",
        "model": "",
        "name": "CVLRMCarrier"
      },
      {
        "chassis": "LRM Carrier",
        "model": "",
        "name": "CVLRMCarrier"
      }
    ]
  },
  {
    "name": "Battlefield Support: Battle Lance",
    "units": [
      {
        "chassis": "Manticore Heavy Tank",
        "model": "",
        "name": "CVManticoreHeavyTank"
      },
      {
        "chassis": "Manticore Heavy Tank",
        "model": "",
        "name": "CVManticoreHeavyTank"
      },
      {
        "chassis": "Vedette Medium Tank",
        "model": "",
        "name": "CVVedetteMediumTank"
      },
      {
        "chassis": "Vedette Medium Tank",
        "model": "",
        "name": "CVVedetteMediumTank"
      }
    ]
  },
  {
    "name": "Battlefield Support: Cavalry Lance",
    "units": [
      {
        "chassis": "Condor Heavy Hover Tank",
        "model": "",
        "name": "CVCondorHeavyHoverTank"
      },
      {
        "chassis": "Condor Heavy Hover Tank",
        "model": "",
        "name": "CVCondorHeavyHoverTank"
      },
      {
        "chassis": "Pegasus Scout Hover Tank",
        "model": "",
        "name": "CVPegasusScoutHoverTank"
      },
      {
        "chassis": "Pegasus Scout Hover Tank",
        "model": "",
        "name": "CVPegasusScoutHoverTank"
      }
    ]
  },
  {
    "name": "Battlefield Support: Assault Lance",
    "units": [
      {
        "chassis": "Schrek PPC Carrier",
        "model": "",
        "name": "CVSchrekPPCCarrier"
      },
      {
        "chassis": "Schrek PPC Carrier",
        "model": "",
        "name": "CVSchrekPPCCarrier"
      },
      {
        "chassis": "Demolisher Heavy Tank",
        "model": "(Defensive)",
        "name": "CVDemolisherHeavyTank_Defensive"
      },
      {
        "chassis": "Demolisher Heavy Tank",
        "model": "(Defensive)",
        "name": "CVDemolisherHeavyTank_Defensive"
      }
    ]
  },
  {
    "name": "Battlefield Support: Command Lance",
    "units": [
      {
        "chassis": "Von Luckner Heavy Tank",
        "model": "VNL-K65N",
        "name": "CVVonLucknerHeavyTank_VNLK65N"
      },
      {
        "chassis": "Von Luckner Heavy Tank",
        "model": "VNL-K65N",
        "name": "CVVonLucknerHeavyTank_VNLK65N"
      },
      {
        "chassis": "SturmFeur Heavy Tank",
        "model": "",
        "name": "CVSturmFeurHeavyTank"
      },
      {
        "chassis": "SturmFeur Heavy Tank",
        "model": "",
        "name": "CVSturmFeurHeavyTank"
      }
    ]
  },
  {
    "name": "Battlefield Support: Rifle Lance",
    "units": [
      {
        "chassis": "Bulldog Medium Tank",
        "model": "",
        "name": "CVBulldogMediumTank"
      },
      {
        "chassis": "Bulldog Medium Tank",
        "model": "",
        "name": "CVBulldogMediumTank"
      },
      {
        "chassis": "Hetzer Wheeled Assault Gun",
        "model": "",
        "name": "CVHetzerWheeledAssaultGun"
      },
      {
        "chassis": "Hetzer Wheeled Assault Gun",
        "model": "",
        "name": "CVHetzerWheeledAssaultGun"
      }
    ]
  },
  {
    "name": "Battlefield Support: Sweep Lance",
    "units": [
      {
        "chassis": "Drillson Heavy Hover Tank",
        "model": "",
        "name": "CVDrillsonHeavyHoverTank"
      },
      {
        "chassis": "Drillson Heavy Hover Tank",
        "model": "",
        "name": "CVDrillsonHeavyHoverTank"
      },
      {
        "chassis": "J. Edgar Light Hover Tank",
        "model": "",
        "name": "CVJEdgarLightHoverTank"
      },
      {
        "chassis": "J. Edgar Light Hover Tank",
        "model": "",
        "name": "CVJEdgarLightHoverTank"
      }
    ]
  },
  {
    "name": "Battlefield Support: Heavy Battle Lance",
    "units": [
      {
        "chassis": "Patton Tank",
        "model": "",
        "name": "CVPattonTank"
      },
      {
        "chassis": "Patton Tank",
        "model": "",
        "name": "CVPattonTank"
      },
      {
        "chassis": "Pike Support Vehicle",
        "model": "",
        "name": "CVPikeSupportVehicle"
      },
      {
        "chassis": "Pike Support Vehicle",
        "model": "",
        "name": "CVPikeSupportVehicle"
      }
    ]
  },
  {
    "name": "Battlefield Support: Hunter Lance",
    "units": [
      {
        "chassis": "Ontos Heavy Tank",
        "model": "",
        "name": "CVOntosHeavyTank"
      },
      {
        "chassis": "Ontos Heavy Tank",
        "model": "",
        "name": "CVOntosHeavyTank"
      },
      {
        "chassis": "Behemoth Heavy Tank",
        "model": "",
        "name": "CVBehemothHeavyTank"
      },
      {
        "chassis": "Behemoth Heavy Tank",
        "model": "",
        "name": "CVBehemothHeavyTank"
      }
    ]
  },
  {
    "name": "Battlefield Support: Recon Lance",
    "units": [
      {
        "chassis": "Warrior Attack Helicopter",
        "model": "H-7",
        "name": "CVWarriorAttackHelicopter_H7"
      },
      {
        "chassis": "Warrior Attack Helicopter",
        "model": "H-7",
        "name": "CVWarriorAttackHelicopter_H7"
      },
      {
        "chassis": "Skulker Wheeled Scout Tank",
        "model": "",
        "name": "CVSkulkerWheeledScoutTank"
      },
      {
        "chassis": "Skulker Wheeled Scout Tank",
        "model": "",
        "name": "CVSkulkerWheeledScoutTank"
      }
    ]
  },
  {
    "name": "Battlefield Support: Objectives",
    "units": [
      {
        "chassis": "Mobile Long Tom Artillery",
        "model": "LT-MOB-95",
        "name": "CVMobileLongTomArtillery_LTMOB95"
      },
      {
        "chassis": "Mobile Long Tom Artillery",
        "model": "LT-MOB-25 (Ammunition Carriage)",
        "name": "CVMobileLongTomArtillery_LTMOB25AmmunitionCarriage"
      },
      {
        "chassis": "MASH Truck",
        "model": "",
        "name": "CVMASHTruck"
      },
      {
        "chassis": "Mobile Headquarters",
        "model": "",
        "name": "CVMobileHeadquarters"
      }
    ]
  },
  {
    "name": "Beginner Box 1st Edition",
    "units": [
      {
        "chassis": "Griffin",
        "model": "'GRF-1N",
        "name": "BMGriffin_GRF1N"
      },
      {
        "chassis": "Wolverine",
        "model": "WVR-6R",
        "name": "BMWolverine_WVR6R"
      },      
    ]
  }
];
