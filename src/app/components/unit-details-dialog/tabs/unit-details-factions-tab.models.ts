// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { TooltipLine } from '../../tooltip/tooltip.component';
import {
    type MegaMekAvailabilityFrom,
    MEGAMEK_AVAILABILITY_RARITY_OPTIONS,
} from '../../../models/megamek/availability.model';

export const CATCH_ALL_FACTIONS: Readonly<Record<string, string>> = {
    'Inner Sphere General': 'Inner Sphere',
    'IS Clan General': 'IS Clan',
    'HW Clan General': 'HW Clan',
    'Periphery General': 'Periphery',
};

export const PREFIX_CATCH_ALL = 'Star League General';
export const PREFIX_CATCH_ALL_PREFIX = 'Star League';

export function isCatchAllFaction(name: string): boolean {
    return CATCH_ALL_FACTIONS[name] !== undefined || name === PREFIX_CATCH_ALL;
}

export interface FactionMegaMekAvailability {
    source: MegaMekAvailabilityFrom;
    rarity: typeof MEGAMEK_AVAILABILITY_RARITY_OPTIONS[number];
    color: string;
    label: string;
}

export interface FactionNameWrapParts {
    head: string;
    middle: string;
    tail: string;
    hasMultipleWords: boolean;
}

export interface FactionAvailabilityItem {
    id: number;
    name: string;
    nameParts: FactionNameWrapParts;
    img: string;
    megaMekAvailability: FactionMegaMekAvailability[];
    megaMekTooltip: TooltipLine[] | null;
    isCatchAll?: boolean;
    collapsedFactions?: FactionAvailabilityItem[];
}

export interface FactionAvailability {
    eraId: number;
    eraName: string;
    eraIcon?: string;
    eraImg?: string;
    eraYearFrom?: number;
    eraYearTo?: number;
    factions: FactionAvailabilityItem[];
}
