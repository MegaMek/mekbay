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

import {
    parseTechDate,
    type ComponentTechLevel,
    type EquipmentTechBase,
    type TechAdvancementDates,
    type TechAvailability,
    type TechData,
    type TechRating,
} from './entity/types/tech';

/** Date fields exactly as represented in equipment JSON. */
export interface WireTechDates {
    readonly prototype?: string;
    readonly production?: string;
    readonly common?: string;
    readonly extinct?: string;
    readonly reintroduced?: string;
}

/** Split IS and Clan date fields exactly as represented in equipment JSON. */
export interface WireSplitTechDates {
    readonly is?: WireTechDates;
    readonly clan?: WireTechDates;
}

/** Technology data at the equipment JSON boundary. */
export interface WireEquipmentTechData {
    readonly base: EquipmentTechBase;
    readonly rating: TechRating;
    readonly level: ComponentTechLevel;
    readonly availability: TechAvailability;
    readonly advancement: WireSplitTechDates;
}

function decodeTechDates(wire: WireTechDates | undefined): TechAdvancementDates | undefined {
    if (!wire) return undefined;
    return {
        prototype: parseTechDate(wire.prototype),
        production: parseTechDate(wire.production),
        common: parseTechDate(wire.common),
        extinct: parseTechDate(wire.extinct),
        reintroduced: parseTechDate(wire.reintroduced),
    };
}

/** Decode equipment JSON technology into its effective domain representation. */
export function decodeEquipmentTechData(wire: WireEquipmentTechData): TechData {
    return {
        base: wire.base,
        rating: wire.rating,
        level: wire.level,
        availability: wire.availability,
        advancement: {
            is: decodeTechDates(wire.advancement.is),
            clan: decodeTechDates(wire.advancement.clan),
        },
    };
}
