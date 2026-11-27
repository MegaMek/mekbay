// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { Era } from '../models/eras.model';

export type EraDefinition = Omit<Era, 'factions' | 'units'>;

function defineEra(definition: EraDefinition): Readonly<EraDefinition> {
    return Object.freeze({
        ...definition,
        years: Object.freeze({ ...definition.years }),
    });
}

/**
 * BattleTech eras.
 *
 * Era identity, chronology, and presentation static data. 
 * Runtime faction and unit memberships are derived from faction catalog.
 */
export const ERA_DEFINITIONS: readonly Readonly<EraDefinition>[] = Object.freeze([
    defineEra({
        id: 9,
        name: 'Age of War',
        years: { from: 2005, to: 2570 },
        description: 'Humanity’s first tentative steps off its homeworld leads to political upheavals and the founding of great interstellar empires. War is the inevitable result as these nations clash over resources and territory. An awesome and terrible new invention—the BattleMech—changes the face of warfare forever.',
        img: '/images/eras/era01-age-of-war-star-league.png',
        icon: '/images/eras/era1.png',
    }),
    defineEra({
        id: 10,
        name: 'Star League',
        years: { from: 2571, to: 2780 },
        description: 'The League flourishes under the rule of the First Lords for two hundred years. Technology advances at a prodigious speed and billions enjoy peace and prosperity. Yet a darkness grows within the realm and Ian Cameron’s original sin bears fruit as the Periphery nations rise in revolt.',
        img: '/images/eras/era01-age-of-war-star-league.png',
        icon: '/images/eras/era1.png',
    }),
    defineEra({
        id: 11,
        name: 'Early Succession War',
        shortName: 'Early SW',
        years: { from: 2781, to: 2900 },
        description: 'Minoru Kurita of the Draconis Combine declares himself the new First Lord of the Star League, sparking the First Succession War and drawing all of the Great Houses into conflict. Massive loss of life and technology ensues, due to the liberal use of weapons of mass destruction by all powers. Though the war ends with an uneasy truce, a Second Succession War begins less than a decade later and leads to even more destruction.',
        img: '/images/eras/era02-succession-wars.png',
        icon: '/images/eras/era2.png',
    }),
    defineEra({
        id: 255,
        name: 'Late Succession War - LosTech',
        shortName: 'Late SW LosTech',
        years: { from: 2901, to: 3019 },
        description: 'By this time, the Second Succession War and the beginnings of the Third have reduced most of the advanced technology of the Star League to the status of ’lostech”. The Third war begins with a Draconis Combine attack on the Lyran Commonwealth but soon descends into two hundred years of low-level and constant warfare as the Great Houses suffer the consequences of their folly.',
        img: '/images/eras/era02-succession-wars.png',
        icon: '/images/eras/era2.png',
    }),
    defineEra({
        id: 256,
        name: 'Late Succession War - Renaissance',
        shortName: 'Late SW Renaissance',
        years: { from: 3020, to: 3049 },
        description: 'In the early 31st century the Grey Death Legion discovers the Helm memory core and kickstarts the rediscovery of many lost technologies. In secret Hanse Davion and Katrina Steiner sign the FedCom Accords, a secret pact to join the Federated Suns and Lyran Commonwealth. Using his marriage to Melissa Steiner as cover, Hanse Davion begins the Fourth Succession War by launching a massive invasion against his enemies. The war ends with Davion capturing half of the Capellan Confederation and securing a vital link to the Commonwealth, but fails to defeat the Draconis Combine.',
        img: '/images/eras/era02-succession-wars.png',
        icon: '/images/eras/era2.png',
    }),
    defineEra({
        id: 13,
        name: 'Clan Invasion',
        years: { from: 3050, to: 3061 },
        description: 'A mysterious invading force strikes the coreward region of the Inner Sphere. The invaders, called the Clans, are descendants of Kerensky’s SLDF troops, forged into a society dedicated to becoming the greatest fighting force in history. With vastly superior technology and warriors, the Clans conquer world after world. Eventually this outside threat will forge a new Star League, something hundreds of years of warfare failed to accomplish. In addition, the Clans will act as a catalyst for a technological renaissance.',
        img: '/images/eras/era03-clan-invasion.png',
        icon: '/images/eras/era3.png',
    }),
    defineEra({
        id: 247,
        name: 'Civil War',
        years: { from: 3062, to: 3067 },
        description: 'The Clan threat is eventually lessened with the complete destruction of a Clan. With that massive external threat apparently neutralized, internal conflicts explode around the Inner Sphere. House Liao conquers its former Commonality, the St. Ives Compact; a rebellion of military units belonging to House Kurita sparks a war with their powerful border enemy, Clan Ghost Bear; the fabulously powerful Federated Commonwealth of House Steiner and House Davion collapses into five long years of bitter civil war.',
        img: '/images/eras/era04-civil-war.png',
        icon: '/images/eras/era4.png',
    }),
    defineEra({
        id: 14,
        name: 'Jihad',
        years: { from: 3068, to: 3080 },
        description: 'Following the Federated Commonwealth Civil War, the leaders of the Great Houses meet and disband the new Star League, declaring it a sham. The pseudo-religious Word of Blake—a splinter group of ComStar, the protectors and controllers of interstellar communication—launch the Jihad:an interstellar war that will ultimately pit every faction against each other and even against themselves, as weapons of mass destruction are used for the first time in centuries while new and frightening technologies are likewise unleashed.',
        img: '/images/eras/era05-jihad.png',
        icon: '/images/eras/era5.png',
    }),
    defineEra({
        id: 15,
        name: 'Early Republic',
        years: { from: 3081, to: 3100 },
        description: 'Stone’s Republic leads the way into peace and prosperity in the aftermath of the Jihad. Conflicts still occur, but they are small in scale and the massive wars of the past are not seen.',
        img: '/images/eras/era06-republic-dark-age.png',
        icon: '/images/eras/era6.png',
    }),
    defineEra({
        id: 254,
        name: 'Late Republic',
        years: { from: 3101, to: 3130 },
        description: 'The tides of war rise higher. Sun-Tzu Liao and his son, Daoshen, embark on a campaign of coordinated violence to reclaim their former worlds seized by the Republic. Other conflicts begin to boil over with pockets of fighting in all corners of the Inner Sphere and Periphery. The Second Combine-Dominion War was only the first of many conflicts during this period--the Victoria War, territorial strife between former members of the Free Worlds League, rebellion in the Marian Hegemony, and the ever-present threat of the Clans expanding their occupation zones all conspired to leave Stone\'s carefully crafted era of peace rent and sundered.',
        img: '/images/eras/era06-republic-dark-age.png',
        icon: '/images/eras/era6.png',
    }),
    defineEra({
        id: 16,
        name: 'Dark Age',
        years: { from: 3131, to: 3150 },
        description: 'Two years after Stone’s disappearance, the communications network goes dark. Capitalizing on the confusion, the Great Houses begin taking back the worlds they once gave to the Republic as long-standing hatreds spark to life once more.',
        img: '/images/eras/era06-republic-dark-age.png',
        icon: '/images/eras/era6.png',
    }),
    defineEra({
        id: 257,
        name: 'ilClan',
        years: { from: 3151, to: 9999 },
        description: 'Clan Wolf has conquered Terra. What will follow?',
        img: '/images/eras/era07-ilclan.png',
        icon: '/images/eras/era7.png',
    }),
]);
