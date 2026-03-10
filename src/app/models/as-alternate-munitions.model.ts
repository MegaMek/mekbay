/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
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

import type { ASSpecialAbility } from './as-abilities.model';

/**
 * Author: Drake
 */

export interface AlternateMunition {
    id: string;
    name: string;
    description: string;
}

export const ALTERNATE_MUNITIONS: Record<string, AlternateMunition> = {
    // Artillery
    'art-air-defense-arrow-iv': { id: 'art-air-defense-arrow-iv', name: 'Air-Defense Arrow IV', description: 'Direct-fire ground-to-air attacks against airborne targets.' },
    'art-cluster': { id: 'art-cluster', name: 'Cluster', description: 'Increases AoE radius.' },
    'art-copperhead': { id: 'art-copperhead', name: 'Copperhead', description: 'Homing rounds.' },
    'art-flechette': { id: 'art-flechette', name: 'Flechette', description: 'Double damage against infantry/woods.' },
    'art-illumination': { id: 'art-illumination', name: 'Illumination', description: 'Lights up the area of effect.' },
    'art-inferno-iv': { id: 'art-inferno-iv', name: 'Inferno IV', description: 'Ignites all terrain within the area of effect.' },
    'art-smoke': { id: 'art-smoke', name: 'Smoke', description: 'Fills the area of effect with smoke.' },
    'art-thunder': { id: 'art-thunder', name: 'Thunder', description: 'Delivers minefields.' },
    
    // Autocannon
    'ac-armor-piercing': { id: 'ac-armor-piercing', name: 'Armor Piercing', description: 'Armor Piercing rounds.' },
    'ac-flak': { id: 'ac-flak', name: 'Flak', description: 'Flak rounds.' },
    'ac-flechette': { id: 'ac-flechette', name: 'Flechette', description: 'Flechette rounds.' },
    'ac-precision': { id: 'ac-precision', name: 'Precision', description: 'Precision rounds.' },
    'ac-tracer': { id: 'ac-tracer', name: 'Tracer', description: 'Tracer rounds.' },

    // Bombs
    'bomb-air-to-air-arrow-iv': { id: 'bomb-air-to-air-arrow-iv', name: 'Air-to-Air Arrow IV', description: 'Air-to-Air Arrow IV.' },
    'bomb-arrow-iv': { id: 'bomb-arrow-iv', name: 'Arrow IV', description: 'Arrow IV.' },
    'bomb-inferno': { id: 'bomb-inferno', name: 'Inferno', description: 'Inferno.' },
    'bomb-laser-guided': { id: 'bomb-laser-guided', name: 'Laser-Guided', description: 'Laser-Guided.' },
    'bomb-light-air-to-air-arrow': { id: 'bomb-light-air-to-air-arrow', name: 'Light Air-to-Air Arrow', description: 'Light Air-to-Air Arrow.' },
    'bomb-rocket-launcher': { id: 'bomb-rocket-launcher', name: 'Rocket Launcher', description: 'Rocket Launcher.' },
    'bomb-tag': { id: 'bomb-tag', name: 'TAG', description: 'TAG.' },
    'bomb-thunder': { id: 'bomb-thunder', name: 'Thunder', description: 'Thunder.' },
    'bomb-torpedo': { id: 'bomb-torpedo', name: 'Torpedo', description: 'Torpedo.' },

    // Narc/iNarc
    'narc-ecm': { id: 'narc-ecm', name: 'ECM', description: 'ECM.' },
    'narc-explosive': { id: 'narc-explosive', name: 'Explosive', description: 'Explosive.' },
    'narc-haywire': { id: 'narc-haywire', name: 'Haywire', description: 'Haywire.' },

    // LRM/SRM
    'msl-heat-seeking': { id: 'msl-heat-seeking', name: 'Heat-Seeking', description: 'Heat-Seeking.' },
    'msl-inferno': { id: 'msl-inferno', name: 'Inferno', description: 'Inferno.' },
    'msl-magnetic-pulse': { id: 'msl-magnetic-pulse', name: 'Magnetic Pulse', description: 'Magnetic Pulse.' },
    'msl-mine-clearance': { id: 'msl-mine-clearance', name: 'Mine Clearance', description: 'Mine Clearance.' },
    'msl-semi-guided': { id: 'msl-semi-guided', name: 'Semi-Guided', description: 'Semi-Guided.' },
    'msl-smoke': { id: 'msl-smoke', name: 'Smoke', description: 'Smoke.' },
    'msl-swarm': { id: 'msl-swarm', name: 'Swarm/Swarmsl-I', description: 'Swarm/Swarmsl-I.' },
    'msl-tandemsl-charge': { id: 'msl-tandemsl-charge', name: 'Tandem Charge', description: 'Tandem Charge.' },
    'msl-thunder': { id: 'msl-thunder', name: 'Thunder', description: 'Thunder.' }
};

export const ABILITY_MUNITIONS_MAP: Record<string, string[]> = {
    'ARTAIS': ['art-air-defense-arrow-iv', 'art-cluster', 'art-illumination', 'art-inferno-iv', 'art-smoke', 'art-thunder'],
    'ARTAC': ['art-air-defense-arrow-iv', 'art-cluster', 'art-illumination', 'art-inferno-iv', 'art-smoke', 'art-thunder'],
    'ARTT': ['art-cluster', 'art-copperhead', 'art-flechette', 'art-illumination', 'art-smoke'],
    'ARTS': ['art-cluster', 'art-copperhead', 'art-flechette', 'art-illumination', 'art-smoke'],
    'ARTLT': ['art-cluster', 'art-copperhead', 'art-flechette', 'art-illumination', 'art-smoke'],
    'AC': ['ac-armor-piercing', 'ac-flak', 'ac-flechette', 'ac-precision', 'ac-tracer'],
    'BOMB': ['bomb-air-to-air-arrow-iv', 'bomb-arrow-iv', 'bomb-inferno', 'bomb-laser-guided', 'bomb-light-air-to-air-arrow', 'bomb-rocket-launcher', 'bomb-tag', 'bomb-thunder', 'bomb-torpedo'],
    'INARC': ['narc-ecm', 'narc-explosive', 'narc-haywire'],
    'CNARC': ['narc-explosive'],
    'SNARC': ['narc-explosive'],
    'LRM': ['msl-heat-seeking', 'msl-magnetic-pulse', 'msl-mine-clearance', 'msl-semi-guided', 'msl-smoke', 'msl-swarm', 'msl-thunder'],
    'SRM': ['msl-heat-seeking', 'msl-inferno', 'msl-magnetic-pulse', 'msl-mine-clearance', 'msl-smoke', 'msl-tandemsl-charge']
};

export function getAlternateMunitionsForAbility(ability: ASSpecialAbility): AlternateMunition[] | undefined {
    const tags = Array.isArray(ability.tag) ? ability.tag : [ability.tag];
    
    for (const tag of tags) {
        // Extract base tag (e.g., ART-LT from ART-LT-#, AC from AC#/#/#)
        const baseTagMatch = tag.match(/^([A-Z-]+)/);
        if (baseTagMatch) {
            const baseTag = baseTagMatch[1];
            const munitionIds = ABILITY_MUNITIONS_MAP[baseTag];
            if (munitionIds && munitionIds.length > 0) {
                const munitions = munitionIds.map(id => ALTERNATE_MUNITIONS[id]).filter(m => !!m);
                if (munitions.length > 0) {
                    return munitions;
                }
            }
        }
    }
    
    return undefined;
}
