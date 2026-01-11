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

import { ASUnitTypeCode } from "../../models/units.model";

/*
 * Author: Drake
 * 
 * Configuration for Alpha Strike card layouts based on unit type.
 * This system allows different unit types to have different card designs,
 * including support for multi-card units like large aerospace vessels.
 */

/**
 * Defines the critical hits layout variant for different unit types.
 */
export type CriticalHitsVariant = 
    | 'none'
    | 'mek'
    | 'vehicle'
    | 'protomek'
    | 'emplacement'
    | 'aerofighter'
    | 'aerospace-1'
    | 'aerospace-2'
    | 'dropship-1'
    | 'dropship-2';

/**
 * Defines the overall card layout design.
 */
export type CardLayoutDesign = 
    | 'standard'    // Most common single card layout.
    | 'large-vessel-1' // WS, SS, JS, DA, SC - first card (common to all large vessels)
    | 'large-vessel-2' // WS, SS, JS, DA, SC - second card for aerospace vessels

/**
 * Configuration for a single card in the unit's card set.
 */
export interface CardConfig {
    /** The overall layout design for this card */
    design: CardLayoutDesign;
    /** The critical hits variant to display (or 'none' if no crit box) */
    criticalHits: CriticalHitsVariant;
    /** Card label for multi-card units (e.g., "Card 1", "Weapons", etc.) */
    cardLabel?: string;
}

/**
 * Complete layout configuration for a unit type.
 */
export interface UnitTypeLayoutConfig {
    /** Array of cards to render for this unit type (most have 1, large vessels have 2) */
    cards: CardConfig[];
}

/**
 * Maps Alpha Strike unit type codes to their layout configurations.
 * 
 * Unit Type Codes:
 * - BM: BattleMek
 * - IM: IndustrialMek
 * - CV: Combat Vehicle
 * - SV: Support Vehicle
 * - PM: ProtoMek
 * - BA: Battle Armor
 * - CI: Conventional Infantry
 * - AF: Aerospace Fighter
 * - CF: Conventional Fighter
 * - SC: Small Craft
 * - WS: WarShip
 * - SS: Space Station
 * - JS: JumpShip
 * - DA: DropShip (Aerodyne)
 * - DS: DropShip (Spheroid)
 * - MS: Mobile Structure
 */
export const UNIT_TYPE_LAYOUTS: Record<ASUnitTypeCode, UnitTypeLayoutConfig> = {
    // Mek
    'BM': {
        cards: [{
            design: 'standard',
            criticalHits: 'mek'
        }]
    },
    'IM': {
        cards: [{
            design: 'standard',
            criticalHits: 'mek'
        }]
    },

    // Protomek
    'PM': {
        cards: [{
            design: 'standard',
            criticalHits: 'protomek'
        }]
    },

    'BD': {
        cards: [{
            design: 'standard',
            criticalHits: 'emplacement'
        }]
    },
    
    // Combat Vehicles
    'CV': {
        cards: [{
            design: 'standard',
            criticalHits: 'vehicle'
        }]
    },
    'SV': {
        cards: [{
            design: 'standard',
            criticalHits: 'vehicle'
        }]
    },
    
    // Infantry - single card, no critical hits
    'CI': {
        cards: [{
            design: 'standard',
            criticalHits: 'none'
        }]
    },
    'BA': {
        cards: [{
            design: 'standard',
            criticalHits: 'none'
        }]
    },
    
    // Aerospace Fighters
    'AF': {
        cards: [{
            design: 'standard',
            criticalHits: 'aerofighter'
        }]
    },
    'CF': {
        cards: [{
            design: 'standard',
            criticalHits: 'aerofighter'
        }]
    },
    
    // DropShips and Small Craft - two cards with dropship variant
    'DA': {
        cards: [
            {
                design: 'large-vessel-1',
                criticalHits: 'dropship-1',
                cardLabel: 'Card 1'
            },
            {
                design: 'large-vessel-2',
                criticalHits: 'dropship-2',
                cardLabel: 'Card 2'
            }
        ]
    },
    'DS': {
        cards: [
            {
                design: 'large-vessel-1',
                criticalHits: 'dropship-1',
                cardLabel: 'Card 1'
            },
            {
                design: 'large-vessel-2',
                criticalHits: 'dropship-2',
                cardLabel: 'Card 2'
            }
        ]
    },
    'SC': {
        cards: [
            {
                design: 'large-vessel-1',
                criticalHits: 'dropship-1',
                cardLabel: 'Card 1'
            },
            {
                design: 'large-vessel-2',
                criticalHits: 'dropship-2',
                cardLabel: 'Card 2'
            }
        ]
    },

    // Large Aerospace Vessels - two cards
    'WS': {
        cards: [
            {
                design: 'large-vessel-1',
                criticalHits: 'aerospace-1',
                cardLabel: 'Card 1'
            },
            {
                design: 'large-vessel-2',
                criticalHits: 'aerospace-2',
                cardLabel: 'Card 2'
            }
        ]
    },
    'SS': {
        cards: [
            {
                design: 'large-vessel-1',
                criticalHits: 'aerospace-1',
                cardLabel: 'Card 1'
            },
            {
                design: 'large-vessel-2',
                criticalHits: 'aerospace-2',
                cardLabel: 'Card 2'
            }
        ]
    },
    'JS': {
        cards: [
            {
                design: 'large-vessel-1',
                criticalHits: 'aerospace-1',
                cardLabel: 'Card 1'
            },
            {
                design: 'large-vessel-2',
                criticalHits: 'aerospace-2',
                cardLabel: 'Card 2'
            }
        ]
    },

    'MS': {
        cards: [{
            design: 'standard',
            criticalHits: 'none'
        }]
    },
};

/**
 * Default layout for unknown unit types
 */
export const DEFAULT_LAYOUT: UnitTypeLayoutConfig = {
    cards: [{
        design: 'standard',
        criticalHits: 'none'
    }]
};

/**
 * Gets the layout configuration for a given Alpha Strike unit type.
 * @param unitType The Alpha Strike unit type code (e.g., 'BM', 'CV', 'WS')
 * @returns The layout configuration for that unit type
 */
export function getLayoutForUnitType(unitType: ASUnitTypeCode): UnitTypeLayoutConfig {
    return UNIT_TYPE_LAYOUTS[unitType] ?? DEFAULT_LAYOUT;
}

/**
 * Gets the number of cards needed for a unit type.
 * @param unitType The Alpha Strike unit type code
 * @returns The number of cards (1 or 2 for current implementations)
 */
export function getCardCountForUnitType(unitType: ASUnitTypeCode): number {
    return getLayoutForUnitType(unitType).cards.length;
}

/**
 * Checks if a unit type requires multiple cards.
 * @param unitType The Alpha Strike unit type code
 * @returns True if the unit type uses more than one card
 */
export function isMultiCardUnit(unitType: ASUnitTypeCode): boolean {
    return getCardCountForUnitType(unitType) > 1;
}
