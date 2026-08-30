// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EquipmentRawData, RawEquipmentMap } from './equipment.model';
import { battleArmorMinesweeperToolFlags } from './battle-armor-equipment.model';
import { equipmentPlatformFlag } from './equipment-platform.model';

/**
 * Canonical equipment referenced by exported unit files but omitted from the
 * MegaMekLab equipment export because that export filters unofficial records.
 * Source-catalog entries take precedence when MegaMekLab eventually exports
 * one of these records itself.
 */
const LIGHT_MINESWEEPER: EquipmentRawData = {
    version: '1.0',
    type: 'misc',
    id: 'Light Minesweeper',
    name: 'Light Minesweeper',
    rulesRefs: [],
    stats: {
        tonnage: 0,
        cost: 0,
        bv: 0,
        criticalSlots: 0,
        hittable: false,
        toHitModifier: 1,
        tankSlots: 1,
    },
    tech: {
        base: 'IS',
        rating: 'D',
        level: 'Unofficial',
        availability: { sl: 'D', sw: 'D', clan: 'D', da: 'X' },
        advancement: { is: { production: '2720' } },
    },
    flags: [
        equipmentPlatformFlag('battle-armor'),
        ...battleArmorMinesweeperToolFlags(),
    ],
};

const EQUIPMENT_CATALOG_SUPPLEMENTS: Readonly<RawEquipmentMap> = Object.freeze({
    'Light Minesweeper': LIGHT_MINESWEEPER,
});

export function equipmentCatalogEntriesIncludingSupplements(
    equipment: RawEquipmentMap | undefined,
): Array<[string, EquipmentRawData]> {
    return Object.entries({
        ...EQUIPMENT_CATALOG_SUPPLEMENTS,
        ...(equipment ?? {}),
    });
}
