// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { getMekLocationAbbreviation } from '../models/entity/types/mek';

export const MAX_DISPLAYED_EQUIPMENT_LOCATIONS = 3;

/** Compact, shared inventory location display for sheets and live views. */
export function formatEquipmentLocationCodes(
    codes: Iterable<string>,
    separator = '/',
    empty = '—',
): string {
    const locations = [...new Set(
        [...codes]
            .map(code => getMekLocationAbbreviation(code.trim()))
            .filter(code => code.length > 0),
    )];
    if (locations.length > MAX_DISPLAYED_EQUIPMENT_LOCATIONS) return '*';
    return locations.join(separator) || empty;
}
