// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { WeaponEquipment, type AmmoEquipment } from './equipment.model';
import type { AmmoMunitionFlag } from './ammo-munition-flags.type';
import type { MountedEquipment } from './mounted-equipment.model';
import {
    INVENTORY_CONTROL_BOMBAST_SECONDARY_TARGET_REASON,
    INVENTORY_CONTROL_NARC_BUILDING_TARGET_REASON,
    INVENTORY_CONTROL_NARC_INFANTRY_TARGET_REASON,
    INVENTORY_CONTROL_TAG_INFANTRY_TARGET_REASON,
    INVENTORY_CONTROL_THUNDER_TERRAIN_TARGET_REASON,
    inventoryControlEntryTargetDisabledReason,
    type InventoryControlRuntimeTarget,
} from './inventory-control-runtime-state.model';
import { CORE_2026_GAME_RULES, TW_GAME_RULES, type CBTGameRules } from './rules/game-rules';

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

function bombastEntry(gameRules: CBTGameRules): MountedEquipment {
    const equipment = new WeaponEquipment({
        id: 'Bombast Laser',
        name: 'Bombast Laser',
        type: 'weapon',
        flags: ['F_BOMBAST_LASER'],
        weapon: { ammoType: 'NA', damage: 16, heat: 12 },
    });
    return {
        equipment,
        owner: {
            gameRules,
            getInventoryControlSelectedAmmo: () => null,
            isEquipmentSubmerged: () => false,
        },
    } as unknown as MountedEquipment;
}

function missileEntry(): MountedEquipment {
    const equipment = new WeaponEquipment({
        id: 'lrm-20',
        name: 'LRM 20',
        type: 'weapon',
        flags: ['F_INDIRECT_FIRE'],
        weapon: { ammoType: 'LRM', rackSize: 20, ranges: [7, 14, 21, 28] },
    });
    return {
        equipment,
        owner: {
            gameRules: CORE_2026_GAME_RULES,
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

function ammo(munitionTypes: readonly AmmoMunitionFlag[]): AmmoEquipment {
    return {
        hasMunitionType: (munitionType: AmmoMunitionFlag) => munitionTypes.includes(munitionType),
    } as AmmoEquipment;
}

describe('inventory-control Thunder missile target restrictions', () => {
    const entry = missileEntry();
    const thunderAmmo = ammo(['M_THUNDER']);

    it('allows Thunder missiles to target only terrain under both rulesets', () => {
        for (const gameRules of [CORE_2026_GAME_RULES, TW_GAME_RULES]) {
            expect(inventoryControlEntryTargetDisabledReason(
                entry, target('terrain'), thunderAmmo, gameRules,
            )).withContext(gameRules.id).toBeNull();

            for (const unitType of ['mek-biped', 'infantry', 'aero', 'building'] as const) {
                expect(inventoryControlEntryTargetDisabledReason(
                    entry, target(unitType), thunderAmmo, gameRules,
                )).withContext(`${gameRules.id}: ${unitType}`)
                    .toBe(INVENTORY_CONTROL_THUNDER_TERRAIN_TARGET_REASON);
            }
        }
    });

    it('does not restrict ordinary ammunition or other Thunder-family flags', () => {
        expect(inventoryControlEntryTargetDisabledReason(
            entry, target('mek-biped'), ammo([]), CORE_2026_GAME_RULES,
        )).toBeNull();
        expect(inventoryControlEntryTargetDisabledReason(
            entry, target('mek-biped'), ammo(['M_THUNDER_ACTIVE']), CORE_2026_GAME_RULES,
        )).toBeNull();
    });

    it('still enforces terrain-only targeting when the target TN is manually overridden', () => {
        expect(inventoryControlEntryTargetDisabledReason(
            entry,
            { unitType: 'mek-biped', manualTnModifier: -4 },
            thunderAmmo,
            CORE_2026_GAME_RULES,
        )).toBe(INVENTORY_CONTROL_THUNDER_TERRAIN_TARGET_REASON);
    });
});

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

describe('inventory-control Bombast Laser target restrictions', () => {
    const secondaryTarget = {
        unitType: 'mek-biped' as const,
        tnCalculator: { secondaryTarget: true },
    };

    it('blocks secondary targets under Total Warfare rules', () => {
        expect(inventoryControlEntryTargetDisabledReason(
            bombastEntry(TW_GAME_RULES), secondaryTarget, null, TW_GAME_RULES,
        )).toBe(INVENTORY_CONTROL_BOMBAST_SECONDARY_TARGET_REASON);
        expect(inventoryControlEntryTargetDisabledReason(
            bombastEntry(TW_GAME_RULES), {
                unitType: 'mek-biped',
                tnCalculator: { secondaryTargetSideBack: true },
            }, null, TW_GAME_RULES,
        )).toBe(INVENTORY_CONTROL_BOMBAST_SECONDARY_TARGET_REASON);
    });

    it('allows secondary targets under Core 2026 rules', () => {
        expect(inventoryControlEntryTargetDisabledReason(
            bombastEntry(CORE_2026_GAME_RULES), secondaryTarget, null, CORE_2026_GAME_RULES,
        )).toBeNull();
    });
});
