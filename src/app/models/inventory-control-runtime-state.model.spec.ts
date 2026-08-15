// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { WeaponEquipment } from './equipment.model';
import type { MountedEquipment } from './mounted-equipment.model';
import {
    INVENTORY_CONTROL_NARC_BUILDING_TARGET_REASON,
    INVENTORY_CONTROL_NARC_INFANTRY_TARGET_REASON,
    INVENTORY_CONTROL_TAG_INFANTRY_TARGET_REASON,
    inventoryControlEntryTargetDisabledReason,
    type InventoryControlRuntimeTarget,
} from './inventory-control-runtime-state.model';
import { CORE_2026_GAME_RULES, TW_GAME_RULES } from './rules/game-rules';

function narcEntry(attackerCover?: 'building-1'): MountedEquipment {
    const equipment = new WeaponEquipment({
        id: 'narc-launcher',
        name: 'NARC Missile Beacon',
        type: 'weapon',
        flags: ['F_NARC'],
        weapon: { ammoType: 'NARC', ranges: [3, 6, 9, 12] },
    });
    return {
        equipment,
        owner: {
            gameRules: TW_GAME_RULES,
            getInventoryControlSelectedAmmo: () => null,
            isEquipmentSubmerged: () => false,
            turnState: () => ({ cover: () => attackerCover }),
        },
    } as unknown as MountedEquipment;
}

function tagEntry(): MountedEquipment {
    const equipment = new WeaponEquipment({
        id: 'tag',
        name: 'TAG',
        type: 'weapon',
        flags: ['F_TAG'],
        weapon: { ammoType: 'NA', ranges: [5, 10, 15, 20] },
    });
    return {
        equipment,
        owner: {
            gameRules: TW_GAME_RULES,
            getInventoryControlSelectedAmmo: () => null,
            isEquipmentSubmerged: () => false,
        },
    } as unknown as MountedEquipment;
}

function target(
    unitType: InventoryControlRuntimeTarget['unitType'],
    buildingCover?: 'building-1',
): Pick<InventoryControlRuntimeTarget, 'manualTnModifier' | 'tnCalculator' | 'unitType'> {
    return {
        unitType,
        tnCalculator: buildingCover ? { buildingCover } : {},
    };
}

describe('inventory-control NARC target restrictions', () => {
    it('blocks both conventional infantry and battle armor under Total Warfare rules', () => {
        const entry = narcEntry();

        for (const unitType of ['infantry', 'battle-armor'] as const) {
            expect(inventoryControlEntryTargetDisabledReason(entry, target(unitType), null, TW_GAME_RULES))
                .withContext(unitType)
                .toBe(INVENTORY_CONTROL_NARC_INFANTRY_TARGET_REASON);
        }
    });

    it('blocks firing into a building but permits firing out of one under Total Warfare rules', () => {
        expect(inventoryControlEntryTargetDisabledReason(
            narcEntry(), target('mek-biped', 'building-1'), null, TW_GAME_RULES,
        )).toBe(INVENTORY_CONTROL_NARC_BUILDING_TARGET_REASON);
        expect(inventoryControlEntryTargetDisabledReason(
            narcEntry('building-1'), target('mek-biped'), null, TW_GAME_RULES,
        )).toBeNull();
    });

    it('still permits firing at a building itself under Total Warfare rules', () => {
        expect(inventoryControlEntryTargetDisabledReason(
            narcEntry(), target('building'), null, TW_GAME_RULES,
        )).toBeNull();
    });

    it('does not apply the Total Warfare restrictions under Core 2026 rules', () => {
        expect(inventoryControlEntryTargetDisabledReason(
            narcEntry('building-1'), target('infantry', 'building-1'), null, CORE_2026_GAME_RULES,
        )).toBeNull();
    });
});

describe('inventory-control TAG target restrictions', () => {
    it('blocks conventional infantry and battle armor under Total Warfare rules', () => {
        const entry = tagEntry();

        for (const unitType of ['infantry', 'battle-armor'] as const) {
            expect(inventoryControlEntryTargetDisabledReason(entry, target(unitType), null, TW_GAME_RULES))
                .withContext(unitType)
                .toBe(INVENTORY_CONTROL_TAG_INFANTRY_TARGET_REASON);
        }
    });

    it('does not apply the Total Warfare restriction under Core 2026 rules', () => {
        expect(inventoryControlEntryTargetDisabledReason(
            tagEntry(), target('infantry'), null, CORE_2026_GAME_RULES,
        )).toBeNull();
    });
});
