// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

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
