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

import { ForceUnit } from '../models/force-unit.model';

/*
 * Author: Drake
 *
 * Force type identification: shared between force naming and formation naming.
 */

export type ForceType =
    | 'Squad'
    | 'Platoon'
    | 'Flight'
    | 'Squadron'
    | 'Wing'
    | 'Single'
    | 'Lance'
    | 'Company'
    | 'Battalion'
    | 'Regiment'
    | 'Brigade'
    | 'Point'
    | 'Star'
    | 'Nova'
    | 'Binary'
    | 'Supernova Binary'
    | 'Trinary'
    | 'Supernova Trinary'
    | 'Cluster'
    | 'Galaxy'
    | 'Level I'
    | 'Level II'
    | 'Level III'
    | 'Level IV'
    | 'Level V'
    | 'Force'
    | 'Mercenary';

type ForceTypeRange = { type: ForceType; min: number; max: number };

const INNER_SPHERE_FORCE_TYPES: ForceTypeRange[] = [
    { type: 'Lance', min: 4, max: 4 },
    { type: 'Company', min: 12, max: 16 },
    { type: 'Battalion', min: 36, max: 64 },
    { type: 'Regiment', min: 108, max: 256 },
    { type: 'Brigade', min: 324, max: 1536 },
];

const CLAN_FORCE_TYPES: ForceTypeRange[] = [
    { type: 'Point', min: 1, max: 1 },
    { type: 'Star', min: 5, max: 5 },
    { type: 'Binary', min: 10, max: 10 },
    { type: 'Trinary', min: 15, max: 15 },
    { type: 'Cluster', min: 20, max: 45 },
    { type: 'Galaxy', min: 60, max: 225 },
];

const COMSTAR_FORCE_TYPES: ForceTypeRange[] = [
    { type: 'Level I', min: 1, max: 1 },
    { type: 'Level II', min: 6, max: 6 },
    { type: 'Level III', min: 6 * 6, max: 6 * 6 },
    { type: 'Level IV', min: 6 * 6 * 6, max: 6 * 6 * 6 },
    { type: 'Level V', min: 6 * 6 * 6 * 6, max: 6 * 6 * 6 * 6 },
];

/**
 * Determine the force organizational type (Lance, Company, Star, etc.)
 * based on the number of units, tech base, and faction.
 */
export function getForceSizeName(units: ForceUnit[], techBase: string, factionName: string): string {
    let configs: ForceTypeRange[] = [];
    let underLabel = 'Understrength ';
    let halfLabel = 'Demi-';
    let overLabel = 'Reinforced ';
    if (factionName === 'ComStar' || factionName === 'Word of Blake') {
        configs = COMSTAR_FORCE_TYPES;
    } else if (techBase === 'Clan') {
        configs = CLAN_FORCE_TYPES;
    } else if (techBase === 'Inner Sphere') {
        configs = INNER_SPHERE_FORCE_TYPES;
    }

    if (configs.length === 0 || units.length === 0) {
        return 'Force';
    }

    const count = units.length;

    for (const cfg of configs) {
        if (count >= cfg.min && count <= cfg.max) {
            return cfg.type;
        }
    }

    // If no exact match, we check for a match that is EXACTLY twice our count, we use that name and we put the halfLabel
    for (const cfg of configs) {
        if (cfg.min === count * 2 && cfg.max === count * 2) {
            return halfLabel + cfg.type;
        }
    }

    // Otherwise, we find the nearest match and return that with an under/over label as appropriate (with a max distance of 20% of the count, minimum 1, otherwise we just return Force)
    let nearestType = 'Force';
    let minDistance = Infinity;
    let modifier = '';

    for (const cfg of configs) {
        if (count < cfg.min) {
            const dist = cfg.min - count;
            if (dist < minDistance) {
                minDistance = dist;
                nearestType = cfg.type;
                modifier = underLabel;
            }
        } else if (count > cfg.max) {
            const dist = count - cfg.max;
            if (dist < minDistance) {
                minDistance = dist;
                nearestType = cfg.type;
                modifier = overLabel;
            }
        }
    }

    const maxDistance = Math.max(2, count * 0.2);
    if (minDistance <= maxDistance) {
        return modifier + nearestType;
    }

    return 'Force';
}
