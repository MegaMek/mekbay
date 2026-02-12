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
}

export interface ForcePack {
    name: string;
    units: ForcePackUnit[];
    bv?: number;
    variants?: Array<{
      name: string;
      units: Array<ForcePackUnit>;
    }>;
}

export const getForcePacks = (): ForcePack[] => sortedForcePacks;

const FORCE_PACKS: ForcePack[] = [
  {
    "name": "Clan Command Star",
    "units": [
      {
        "name": "BMDaishi_Prime"
      },
      {
        "name": "BMRyoken_Prime"
      },
      {
        "name": "BMShadowCat_Prime"
      },
      {
        "name": "BMKoshi_Prime"
      },
      {
        "name": "BMThor_Prime"
      }
    ]
  },
  {
    "name": "Clan Heavy Striker Star",
    "units": [
      {
        "name": "BMManOWar_Prime"
      },
      {
        "name": "BMLoki_Prime"
      },
      {
        "name": "BMVulture_Prime"
      },
      {
        "name": "BMFenris_Prime"
      },
      {
        "name": "BMDragonfly_Prime"
      }
    ]
  },
  {
    "name": "Clan Fire Star",
    "units": [
      {
        "name": "BMMasakari_Prime"
      },
      {
        "name": "BMNovaCat_Prime"
      },
      {
        "name": "BMCougar_Prime"
      },
      {
        "name": "BMUller_Prime"
      },
      {
        "name": "BMDasher_Prime"
      }
    ]
  },
  {
    "name": "Clan Heavy Star",
    "units": [
      {
        "name": "BMBehemoth"
      },
      {
        "name": "BMSupernova"
      },
      {
        "name": "BMMarauderIIC"
      },
      {
        "name": "BMWarhammerIIC"
      },
      {
        "name": "BMHunchbackIIC"
      }
    ]
  },
  {
    "name": "Clan Support Star",
    "units": [
      {
        "name": "BMNightGyr_Prime"
      },
      {
        "name": "BMHankyu_Prime"
      },
      {
        "name": "BMLinebacker_Prime"
      },
      {
        "name": "BMBattleCobra_Prime"
      },
      {
        "name": "BMBlackLanner_Prime"
      }
    ]
  },
  {
    "name": "Clan Heavy Battle Star",
    "units": [
      {
        "name": "BMTurkina_Prime"
      },
      {
        "name": "BMKingfisher_Prime"
      },
      {
        "name": "BMCauldronBorn_Prime"
      },
      {
        "name": "BMCrossbow_Prime"
      },
      {
        "name": "BMNoborinin_Prime"
      }
    ]
  },
  {
    "name": "Clan Striker Star",
    "units": [
      {
        "name": "BMGoshawk"
      },
      {
        "name": "BMHellhound"
      },
      {
        "name": "BMPeregrine"
      },
      {
        "name": "BMVixen"
      },
      {
        "name": "BMPiranha"
      }
    ]
  },
  {
    "name": "Clan Ad Hoc Star",
    "units": [
      {
        "name": "BMKodiak"
      },
      {
        "name": "BMPackHunter"
      },
      {
        "name": "BMHellion_Prime"
      },
      {
        "name": "BMFireFalcon_Prime"
      },
      {
        "name": "BMBaboon"
      }
    ]
  },
  {
    "name": "Clan Elemental Star",
    "units": [
      {
        "name": "BAElementalBattleArmor_LaserSqd5"
      },
      {
        "name": "BAElementalBattleArmor_LaserSqd5"
      },
      {
        "name": "BAElementalBattleArmor_LaserSqd5"
      },
      {
        "name": "BAElementalBattleArmor_LaserSqd5"
      },
      {
        "name": "BAElementalBattleArmor_LaserSqd5"
      }
    ]
  },
  {
    "name": "Inner Sphere Command Lance",
    "units": [
      {
        "name": "BMMarauder_MAD3R"
      },
      {
        "name": "BMArcher_ARC2R"
      },
      {
        "name": "BMValkyrie_VLKQA"
      },
      {
        "name": "BMStinger_STG3R"
      }
    ]
  },
  {
    "name": "Inner Sphere Battle Lance",
    "units": [
      {
        "name": "BMWarhammer_WHM6R"
      },
      {
        "name": "BMRifleman_RFL3N"
      },
      {
        "name": "BMPhoenixHawk_PXH1"
      },
      {
        "name": "BMWasp_WSP1A"
      }
    ]
  },
  {
    "name": "Inner Sphere Direct Fire Lance",
    "units": [
      {
        "name": "BMAtlas_AS7D"
      },
      {
        "name": "BMMarauderII_MAD4A"
      },
      {
        "name": "BMOrion_ON1K"
      },
      {
        "name": "BMCrusader_CRD3R"
      }
    ]
  },
  {
    "name": "Inner Sphere Heavy Lance",
    "units": [
      {
        "name": "BMBanshee_BNC3S"
      },
      {
        "name": "BMGrasshopper_GHR5H"
      },
      {
        "name": "BMCenturion_CN9A"
      },
      {
        "name": "BMHatchetman_HCT3F"
      }
    ]
  },
  {
    "name": "Inner Sphere Striker Lance",
    "units": [
      {
        "name": "BMBlackjack_BJ1"
      },
      {
        "name": "BMJenner_JR7D"
      },
      {
        "name": "BMPanther_PNT9R"
      },
      {
        "name": "BMWolfhound_WLF1"
      }
    ]
  },
  {
    "name": "Inner Sphere Fire Lance",
    "units": [
      {
        "name": "BMLongbow_LGB0W"
      },
      {
        "name": "BMStalker_STK3F"
      },
      {
        "name": "BMZeus_ZEU6S"
      },
      {
        "name": "BMTrebuchet_TBT5N"
      }
    ]
  },
  {
    "name": "Inner Sphere Heavy Battle Lance",
    "units": [
      {
        "name": "BMNightstar_NSR9J"
      },
      {
        "name": "BMCataphract_CTF1X"
      },
      {
        "name": "BMAxman_AXM1N"
      },
      {
        "name": "BMBushwacker_BSWX1"
      }
    ]
  },
  {
    "name": "Inner Sphere Urban Lance",
    "units": [
      {
        "name": "BMVictor_VTR9B"
      },
      {
        "name": "BMEnforcer_ENF4R"
      },
      {
        "name": "BMHunchback_HBK4G"
      },
      {
        "name": "BMRaven_RVN3M"
      }
    ]
  },
  {
    "name": "Inner Sphere Support Lance",
    "units": [
      {
        "name": "BMCyclops_CP10Z"
      },
      {
        "name": "BMThug_THG11E"
      },
      {
        "name": "BMDragon_DRG1N"
      },
      {
        "name": "BMSpider_SDR7M"
      }
    ]
  },
  {
    "name": "Wolf's Dragoons Assault Star",
    "units": [
      {
        "name": "BMAnnihilator_ANH2A"
      },
      {
        "name": "BMMadCat_Prime"
      },
      {
        "name": "BMRifleman_RFL3N"
      },
      {
        "name": "BMArcher_ARC2W"
      },
      {
        "name": "BMBlackjack_BJ2"
      }
    ]
  },
  {
    "name": "Eridani Light Horse Hunter Lance",
    "units": [
      {
        "name": "BMThunderbolt_TDR5SE"
      },
      {
        "name": "BMCyclops_CP11A"
      },
      {
        "name": "BMBanshee_BNC3S"
      },
      {
        "name": "BMSagittaire_SGT8R"
      }
    ]
  },
  {
    "name": "Hansen's Roughriders Battle Lance",
    "units": [
      {
        "name": "BMPenetrator_PTR4D"
      },
      {
        "name": "BMHatchetman_HCT6D"
      },
      {
        "name": "BMEnforcer_ENF5D"
      },
      {
        "name": "BMAtlas_AS7D"
      }
    ]
  },
  {
    "name": "Northwind Highlanders Command Lance",
    "units": [
      {
        "name": "BMGrasshopper_GHR5J"
      },
      {
        "name": "BMGunslinger_GUN1ERD"
      },
      {
        "name": "BMHighlander_HGN732"
      },
      {
        "name": "BMWarhammer_WHM7S"
      }
    ]
  },
  {
    "name": "Kell Hounds Striker Lance",
    "units": [
      {
        "name": "BMWolfhound_WLF6S"
      },
      {
        "name": "BMGriffin_C"
      },
      {
        "name": "BMCrusader_CRD8R"
      },
      {
        "name": "BMNightsky_NGS7S"
      }
    ]
  },
  {
    "name": "Gray Death Legion Heavy Battle Lance",
    "units": [
      {
        "name": "BMRegent_Prime"
      },
      {
        "name": "BMManOWar_C"
      },
      {
        "name": "BMCatapult_CPLTK2K"
      },
      {
        "name": "BMShadowHawk_SHD7H"
      }
    ]
  },
  {
    "name": "Snord's Irregulars Assault Lance",
    "units": [
      {
        "name": "BMSpartan_SPTN2"
      },
      {
        "name": "BMRifleman_RFL3N"
      },
      {
        "name": "BMGuillotine_GLT3N"
      },
      {
        "name": "BMHighlander_HGN732"
      }
    ]
  },
  {
    "name": "1st Somerset Strikers",
    "units": [
      {
        "name": "BMHatamotoChi_HTM27T"
      },
      {
        "name": "BMMauler_MAL1R"
      },
      {
        "name": "BMAxman_AXM2N"
      },
      {
        "name": "BMBushwacker_BSWX1"
      },
      {
        "name": "BMWolfhound_WLF2"
      }
    ]
  },
  {
    "name": "McCarron's Armored Cavalry Assault Lance",
    "units": [
      {
        "name": "BMTianZong_TNZN1"
      },
      {
        "name": "BMBlackKnight_BL12KNT"
      },
      {
        "name": "BMAwesome_AWS9Q"
      },
      {
        "name": "BMStarslayer_STY3Dr"
      }
    ]
  },
  {
    "name": "Black Remnant Command Lance",
    "units": [
      {
        "name": "BMCyclops_CP11H"
      },
      {
        "name": "BMFlashman_FLS10E"
      },
      {
        "name": "BMStarAdder_I"
      },
      {
        "name": "BMDragonFire_DGR3F"
      }
    ]
  },
  {
    "name": "BattleTech: Proliferation Cycle Pack",
    "units": [
      {
        "name": "BMBattleAxe_BKX7K"
      },
      {
        "name": "BMYmir_BWP2B"
      },
      {
        "name": "BMCoyotl_D"
      },
      {
        "name": "BMFirebee_FRB1EWAMB"
      },
      {
        "name": "BMGladiator_GLD1R"
      },
      {
        "name": "BMIcarusII_ICR1S"
      },
      {
        "name": "BMMackie_MSK5S"
      }
    ]
  },
  {
    "name": "BattleTech: UrbanMech Lance",
    "units": [
      {
        "name": "BMUrbanMech_UMR60L"
      },
      {
        "name": "BMUrbanMech_UMR60"
      },
      {
        "name": "BMUrbanMech_UMR27"
      },
      {
        "name": "BMUrbanMech_UMR68"
      }
    ]
  },
  {
    "name": "ComStar Command Level II",
    "units": [
      {
        "name": "BMBlackKnight_BL6KNT"
      },
      {
        "name": "BMExterminator_EXT4A"
      },
      {
        "name": "BMHighlander_HGN732"
      },
      {
        "name": "BMKingCrab_KGC000"
      },
      {
        "name": "BMMercury_MCY98"
      },
      {
        "name": "BMSentinel_STN3K"
      }
    ]
  },
  {
    "name": "ComStar Battle Level II",
    "units": [
      {
        "name": "BMCrab_CRB20"
      },
      {
        "name": "BMCrockett_CRK50030"
      },
      {
        "name": "BMFlashman_FLS7K"
      },
      {
        "name": "BMGuillotine_GLT3N"
      },
      {
        "name": "BMLancelot_LNC2501"
      },
      {
        "name": "BMMongoose_MON66"
      }
    ]
  },
  {
    "name": "First Star League Command Lance",
    "units": [
      {
        "name": "BMAtlasII_AS7DH"
      },
      {
        "name": "BMThunderHawk_TDK7S"
      },
      {
        "name": "BMOrion_ON1K"
      },
      {
        "name": "BMPhoenixHawk_PXH1bSpecial"
      }
    ]
  },
  {
    "name": "Second Star League Assault Lance",
    "units": [
      {
        "name": "BMDaishi_A"
      },
      {
        "name": "BMEmperor_EMP6A"
      },
      {
        "name": "BMArgus_AGS4D"
      },
      {
        "name": "BMHelios_HEL3D"
      },
      {
        "name": "CVCoolantTruck_135K"
      }
    ]
  },
  {
    "name": "Legendary MechWarriors Pack",
    "units": [
      {
        "name": "BMDaishi_Widowmaker"
      },
      {
        "name": "BMArcher_ARC2R"
      },
      {
        "name": "BMMarauder_MAD3R"
      },
      {
        "name": "BMMadCat_Pryde"
      }
    ]
  },
  {
    "name": "Legendary MechWarriors Pack II",
    "units": [
      {
        "name": "CVSM5FieldCommander_Prime"
      },
      {
        "name": "BMDevastator_DVS2"
      },
      {
        "name": "BMCharger_CGR3K"
      },
      {
        "name": "BMMarauder_RedHunter3146"
      },
      {
        "name": "BMCaesar_CES3RArchangel"
      }
    ]
  },
  {
    "name": "Legendary MechWarriors Pack III",
    "units": [
      {
        "name": "BMMarauder_BountyHunter3015"
      },
      {
        "name": "BMWarhammer_WHM9K"
      },
      {
        "name": "BMGriffin_GRF2N"
      },
      {
        "name": "BMMadCat_BountyHunter"
      },
      {
        "name": "BMLokiMkII_Prime"
      },
      {
        "name": "BMMarauderII_BountyHunter"
      }
    ]
  },
  {
    "name": "Inner Sphere Battle Armor Platoon",
    "units": [
      {
        "name": "BAISStandardBattleArmor_FlamerSqd4"
      },
      {
        "name": "BAISStandardBattleArmor_FlamerSqd4"
      },
      {
        "name": "BAISStandardBattleArmor_FlamerSqd4"
      },
      {
        "name": "BAISStandardBattleArmor_FlamerSqd4"
      }
    ]
  },
  {
    "name": "Inner Sphere Security Lance",
    "units": [
      {
        "name": "BMJagerMech_JM6S"
      },
      {
        "name": "BMScorpion_SCP1N"
      },
      {
        "name": "BMVulcan_VL2T"
      },
      {
        "name": "BMWhitworth_WTH1"
      }
    ]
  },
  {
    "name": "Inner Sphere Recon Lance",
    "units": [
      {
        "name": "BMFirestarter_FS9H"
      },
      {
        "name": "BMSpector_SPR5F"
      },
      {
        "name": "BMOstscout_OTT7J"
      },
      {
        "name": "BMJavelin_JVN10N"
      }
    ]
  },
  {
    "name": "Inner Sphere Heavy Recon Lance",
    "units": [
      {
        "name": "BMCharger_CGR1A1"
      },
      {
        "name": "BMOstroc_OSR2C"
      },
      {
        "name": "BMMerlin_MLN1A"
      },
      {
        "name": "BMAssassin_ASN109"
      }
    ]
  },
  {
    "name": "Battlefield Support: Fire Lance",
    "units": [
      {
        "name": "CVSRMCarrier"
      },
      {
        "name": "CVSRMCarrier"
      },
      {
        "name": "CVLRMCarrier"
      },
      {
        "name": "CVLRMCarrier"
      }
    ]
  },
  {
    "name": "Battlefield Support: Battle Lance",
    "units": [
      {
        "name": "CVManticoreHeavyTank"
      },
      {
        "name": "CVManticoreHeavyTank"
      },
      {
        "name": "CVVedetteMediumTank"
      },
      {
        "name": "CVVedetteMediumTank"
      }
    ]
  },
  {
    "name": "Battlefield Support: Cavalry Lance",
    "units": [
      {
        "name": "CVCondorHeavyHoverTank"
      },
      {
        "name": "CVCondorHeavyHoverTank"
      },
      {
        "name": "CVPegasusScoutHoverTank"
      },
      {
        "name": "CVPegasusScoutHoverTank"
      }
    ]
  },
  {
    "name": "Battlefield Support: Assault Lance",
    "units": [
      {
        "name": "CVSchrekPPCCarrier"
      },
      {
        "name": "CVSchrekPPCCarrier"
      },
      {
        "name": "CVDemolisherHeavyTank_Defensive"
      },
      {
        "name": "CVDemolisherHeavyTank_Defensive"
      }
    ]
  },
  {
    "name": "Battlefield Support: Command Lance",
    "units": [
      {
        "name": "CVVonLucknerHeavyTank_VNLK65N"
      },
      {
        "name": "CVVonLucknerHeavyTank_VNLK65N"
      },
      {
        "name": "CVSturmFeurHeavyTank"
      },
      {
        "name": "CVSturmFeurHeavyTank"
      }
    ]
  },
  {
    "name": "Battlefield Support: Rifle Lance",
    "units": [
      {
        "name": "CVBulldogMediumTank"
      },
      {
        "name": "CVBulldogMediumTank"
      },
      {
        "name": "CVHetzerWheeledAssaultGun"
      },
      {
        "name": "CVHetzerWheeledAssaultGun"
      }
    ]
  },
  {
    "name": "Battlefield Support: Sweep Lance",
    "units": [
      {
        "name": "CVDrillsonHeavyHoverTank"
      },
      {
        "name": "CVDrillsonHeavyHoverTank"
      },
      {
        "name": "CVJEdgarLightHoverTank"
      },
      {
        "name": "CVJEdgarLightHoverTank"
      }
    ]
  },
  {
    "name": "Battlefield Support: Heavy Battle Lance",
    "units": [
      {
        "name": "CVPattonTank"
      },
      {
        "name": "CVPattonTank"
      },
      {
        "name": "CVPikeSupportVehicle"
      },
      {
        "name": "CVPikeSupportVehicle"
      }
    ]
  },
  {
    "name": "Battlefield Support: Hunter Lance",
    "units": [
      {
        "name": "CVOntosHeavyTank"
      },
      {
        "name": "CVOntosHeavyTank"
      },
      {
        "name": "CVBehemothHeavyTank"
      },
      {
        "name": "CVBehemothHeavyTank"
      }
    ]
  },
  {
    "name": "Battlefield Support: Recon Lance",
    "units": [
      {
        "name": "CVWarriorAttackHelicopter_H7"
      },
      {
        "name": "CVWarriorAttackHelicopter_H7"
      },
      {
        "name": "CVSkulkerWheeledScoutTank"
      },
      {
        "name": "CVSkulkerWheeledScoutTank"
      }
    ]
  },
  {
    "name": "Battlefield Support: Objectives",
    "units": [
      {
        "name": "CVMobileLongTomArtillery_LTMOB95"
      },
      {
        "name": "CVMobileLongTomArtillery_LTMOB25AmmunitionCarriage"
      },
      {
        "name": "CVMASHTruck"
      },
      {
        "name": "CVMobileHeadquarters"
      }
    ]
  },
  {
    "name": "Beginner Box Set, 1st Edition",
    "units": [
      {
        "name": "BMGriffin_GRF1N"
      },
      {
        "name": "BMWolverine_WVR6R"
      }      
    ]
  },
  {
    "name": "Beginner Box Set, 2nd Edition",
    "units": [
      {
        "name": "BMGriffin_GRF1N"
      },
      {
        "name": "BMVindicator_VND1R"
      }, 
        {
        "name": "BMLocust_LCT1V"
      },  
        {
        "name": "BMThunderbolt_TDR5S"
      }
    ]
  },
  {
    "name": "A Game of Armored Combat Box Set",
    "units": [
      {
        "name": "BMAwesome_AWS8Q"
      },
      {
        "name": "BMBattleMaster_BLR1G"
      },
      {
        "name": "BMCatapult_CPLTC1"
      },
      {
        "name": "BMCommando_COM2D"
      },
      {
        "name": "BMLocust_LCT1V"
      },
      {
        "name": "BMShadowHawk_SHD2H"
      },
      {
        "name": "BMThunderbolt_TDR5S"
      },
      {
        "name": "BMWolverine_WVR6R"
      }
    ],
    "variants": [
      {
        "name": "IlClan",
        "units": [
          { "name": "BMAwesome_AWS11H" },
          { "name": "BMBattleMaster_BLR6G" },
          { "name": "BMCatapult_CPLTK6" },
          { "name": "BMCommando_COM9S" },
          { "name": "BMLocust_LCT7S" },
          { "name": "BMShadowHawk_SHD7M" },
          { "name": "BMThunderbolt_TDR7S" },
          { "name": "BMWolverine_WVR9R" }
        ]
      }
    ]
  },
  {
    "name": "Essentials Box Set",
    "units": [
      {
        "name": "BMCenturion_CN9A"
      },
      {
        "name": "BMRifleman_RFL3N"
      }, 
        {
        "name": "BMCenturion_CN9YLWYenLoWang"
      },  
    ]
  },    
  {
    "name": "Alpha Strike Box Set",
    "units": [
      {
        "name": "BMArcher_ARC5R"
      },
      {
        "name": "BMAtlas_AS7S"
      },
      {
        "name": "BMBlackjack_BJ3"
      },
      {
        "name": "BMDasher_D"
      },
      {
        "name": "BMLocust_LCT3M"
      },
      {
        "name": "BMBlackHawk_Prime"
      },
      {
        "name": "BMPhoenixHawk_PXH3K"
      },
      {
        "name": "BMPouncer_Prime"
      },
      {
        "name": "BMMadCat_Prime"
      },
      {
        "name": "BMWarhammer_WHM6R"
      },
      {
        "name": "BMMasakari_C"
      },
      {
        "name": "BMWasp_WSP3W"
      },
      {
        "name": "BMWraith_TR1"
      }
    ]
  },    
  {
    "name": "Clan Invasion Box Set",
    "units": [
      {
        "name": "BMPuma_Prime"
      },
      {
        "name": "BMGladiator_Prime"
      },
      {
        "name": "BMGrendel_Prime"
      },
      {
        "name": "BMBlackHawk_Prime"
      },
      {
        "name": "BMMadCat_Prime"
      },
      {
        "name": "BAElementalBattleArmor_LaserSqd5"
      },
      {
        "name": "BAElementalBattleArmor_LaserSqd5"
      }
    ]
  },    
  {
    "name": "Mercenaries Box Set",
    "units": [
      {
        "name": "BMCaesar_CES3R"
      },
      {
        "name": "BMChameleon_CLN7V"
      },
      {
        "name": "BMDevastator_DVS2"
      },
      {
        "name": "BMFlea_FLE17"
      },
      {
        "name": "BMFirefly_FFL4C"
      },
      {
        "name": "BMOstsol_OTL4D"
      },
      {
        "name": "BMQuickdraw_QKD4G"
      },
      {
        "name": "BMStarslayer_STY3C"
      },
      {
        "name": "CVGalleonLightTank_GAL100"
      },
      {
        "name": "CVGalleonLightTank_GAL102"
      },
      {
        "name": "CVMaximHeavyHoverTransport"
      },
      {
        "name": "CVMaximHeavyHoverTransport_Escort"
      }
    ]
  },    
  {
    "name": "Solaris VII: The Game World",
    "units": [
      {
        "name": "BMMantis_SAMN"
      },
      {
        "name": "BMRonin_SARN"
      },
      {
        "name": "BMOnslaught_SAOS"
      },
      {
        "name": "BMJuggernaut_JGR9T1"
      },
      {
        "name": "BMLongshot_LNG1B"
      },
      {
        "name": "BMDaedalus_DAD3C"
      },
      {
        "name": "BMPaladin_PAL1"
      },
      {
        "name": "BMCudgel_CDG1B"
      },
      {
        "name": "BMKoto_KTP2"
      },
      {
        "name": "BMTsunami_TSP1"
      },
      {
        "name": "BMMorpheus_MRP1"
      },
      {
        "name": "BMColossus_CLP3"
      }
    ]
  },    
  {
    "name": "Aces: Scouring Sands",
    "units": [
      {
        "name": "BMThunderboltIIC"
      },
      {
        "name": "BMThor_H"
      },
      {
        "name": "BMBaboon_6"
      },
      {
        "name": "BMKraken_3"
      },
      {
        "name": "BMRifleman_C2"
      },
      {
        "name": "BMLocustIIC"
      },
      {
        "name": "BMMarauderIIC_10"
      },
      {
        "name": "CVFulcrumHeavyHovertank"
      },
      {
        "name": "CVFulcrumHeavyHovertank"
      }
    ]
  },    
  {
    "name": "Third Star League Strike Team",
    "units": [
      {
        "name": "BMLament_LMT2R"
      },
      {
        "name": "BMJackalope_JLPBD"
      },
      {
        "name": "BMKintaro_KTO20"
      },
      {
        "name": "BMHammerhead"
      },
      {
        "name": "BMHavoc_HVCP6"
      },
      {
        "name": "CVJ27OrdnanceTransport"
      }
    ]
  },    
  {
    "name": "Third Star League Battle Group",
    "units": [
      {
        "name": "BMMadCatMkIV_A"
      },
      {
        "name": "BMWendigo_Prime"
      },
      {
        "name": "BMExcalibur_EXCB2"
      },
      {
        "name": "BMPeacekeeper_PKP1A"
      },
      {
        "name": "BMMalice_MALXT"
      },
      {
        "name": "SVSaviorRepairVehicle"
      }
    ]
  },
  {
    "name": "Clan Cavalry Star",
    "units": [
      {
        "name": "BMLocustIIC"
      },
      {
        "name": "BMJennerIIC"
      },
      {
        "name": "BMGriffinIIC"
      },
	  {
        "name": "BMShadowHawkIIC"
      },
      {
        "name": "BMViper"
      }
    ]
  },
  {
    "name": "Clan Direct Fire Star",
    "units": [
      {
        "name": "BMKraken"
      },
      {
        "name": "BMHighlanderIIC"
      },
      {
        "name": "BMPhoenixHawkIIC"
      },
      {
        "name": "BMGrizzly"
      },
      {
        "name": "BMRiflemanIIC"
      }
    ]
  },
  {
    "name": "Inner Sphere Pursuit Lance",
    "units": [
      {
        "name": "BMCicada_CDA2A"
      },
      {
        "name": "BMClint_CLNT23T"
      },
      {
        "name": "BMHermesII_HER2S"
      },
      {
        "name": "BMDervish_DV6M"
      }
    ]
  },
  {
    "name": "Inner Sphere Assault Lance",
    "units": [
      {
        "name": "BMPillager_PLG3Z"
      },
      {
        "name": "BMGoliath_GOL1H"
      },
      {
        "name": "BMShogun_SHG2F"
      },
      {
        "name": "BMHoplite_HOP4D"
      }
    ]
  },
  {
    "name": "21st Centauri Lancers Command Lance",
    "units": [
      {
        "name": "BMShadowCat_Prime"
      },
      {
        "name": "BMShockwave_SKW2F"
      },
      {
        "name": "BMStalker_STK8S"
      },
      {
        "name": "BMJadeHawk_JHK03"
      }
    ]
  },
  {
    "name": "Illician Lancers Command Lance",
    "units": [
      {
        "name": "BMScarabus_SCB9A"
      },
      {
        "name": "BMOstroc_OSR3M"
      },
      {
        "name": "BMOstsol_OTL9R"
      },
      {
        "name": "BMOstwar_OWR2Mb"
      }
    ]
  },
  {
    "name": "House Davion Heavy Battle Lance",
    "units": [
      {
        "name": "BMTemplar_TLR1O"
      },
      {
        "name": "BMFalconer_FLC8R"
      },
      {
        "name": "BMThanatos_TNS4S"
      },
      {
        "name": "BMThunderbolt_TDR9NAIS"
      }
    ]
  },
  {
    "name": "House Davion Cavalry Lance",
    "units": [
      {
        "name": "BMEnforcer_ENF5D"
      },
      {
        "name": "BMGunsmith_CH11NG"
      },
      {
        "name": "BMHellspawn_HSN7D"
      },
      {
        "name": "BMLegionnaire_LGN2D"
      }
    ]
  },
  {
    "name": "House Kurita Ranger Lance",
    "units": [
      {
        "name": "BMVenom_SDR9KC"
      },
      {
        "name": "BMChimera_CMA2K"
      },
      {
        "name": "BMPanther_PNT9R"
      },
      {
        "name": "BMAvatar_AV1OJ"
      }
    ]
  },
  {
    "name": "House Kurita Command Lance",
    "units": [
      {
        "name": "BMRokurokubi_RK4X"
      },
      {
        "name": "BMAkuma_AKU2XC"
      },
      {
        "name": "BMShiro_SH2P"
      },
      {
        "name": "BMGrandDragon_DRG10K"
      }
    ]
  },
  {
    "name": "Aces: Snowblind",
    "units": [
      {
        "name": "BMDasher_G"
      },
      {
        "name": "BMHankyu_A"
      },
      {
        "name": "BMRimeOtter_Prime"
      },
      {
        "name": "BMGrendel_A"
      },
      {
        "name": "BMNovaCat_B"
      },
      {
        "name": "BMKingfisher_C"
      },
      {
        "name": "BMGrizzly_3"
      },
      {
        "name": "BMVikingIIC"
      }
    ]
  }
];

// Sort once at module load and cache
const sortedForcePacks = [...FORCE_PACKS].sort((a, b) => a.name.localeCompare(b.name));
