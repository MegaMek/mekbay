// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { PickerChoice } from '../components/picker/picker.interface';
import type { EquipmentFlag } from '../models/equipment-flags.type';
import { WeaponEquipment, type WeaponDamage } from '../models/equipment.model';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import type { ToHitAdjustment } from '../models/rules/game-rules';
import {
    EquipmentInteractionHandler,
    type HandlerCommandContext,
    type HandlerQueryContext,
    type ToHitAdjustmentContext,
} from '../services/equipment-interaction-registry.service';
import type { AerospaceAttackValues } from '../utils/aerospace-range.util';
import type { InventoryControlDamageContext } from '../utils/inventory-control-damage.util';
import type { InventoryControlHeatEffect } from '../utils/inventory-control-heat.util';
import { INVENTORY_CONTROL_MODE_STATE, setInventoryControlMode } from '../utils/inventory-control.util';

export const TW_BOMBAST_LASER_DAMAGE_7_MODE = 'Damage 7';
export const TW_BOMBAST_LASER_DAMAGE_8_MODE = 'Damage 8';
export const TW_BOMBAST_LASER_DAMAGE_9_MODE = 'Damage 9';
export const TW_BOMBAST_LASER_DAMAGE_10_MODE = 'Damage 10';
export const TW_BOMBAST_LASER_DAMAGE_11_MODE = 'Damage 11';
export const TW_BOMBAST_LASER_DAMAGE_12_MODE = 'Damage 12';

export type TwBombastLaserMode =
    | typeof TW_BOMBAST_LASER_DAMAGE_7_MODE
    | typeof TW_BOMBAST_LASER_DAMAGE_8_MODE
    | typeof TW_BOMBAST_LASER_DAMAGE_9_MODE
    | typeof TW_BOMBAST_LASER_DAMAGE_10_MODE
    | typeof TW_BOMBAST_LASER_DAMAGE_11_MODE
    | typeof TW_BOMBAST_LASER_DAMAGE_12_MODE;

interface TwBombastLaserProfile {
    readonly damage: number;
    readonly toHitModifier: number;
}

const TW_BOMBAST_LASER_PROFILES: Readonly<Record<TwBombastLaserMode, TwBombastLaserProfile>> = {
    [TW_BOMBAST_LASER_DAMAGE_7_MODE]: { damage: 7, toHitModifier: 0 },
    [TW_BOMBAST_LASER_DAMAGE_8_MODE]: { damage: 8, toHitModifier: 1 },
    [TW_BOMBAST_LASER_DAMAGE_9_MODE]: { damage: 9, toHitModifier: 1 },
    [TW_BOMBAST_LASER_DAMAGE_10_MODE]: { damage: 10, toHitModifier: 2 },
    [TW_BOMBAST_LASER_DAMAGE_11_MODE]: { damage: 11, toHitModifier: 2 },
    [TW_BOMBAST_LASER_DAMAGE_12_MODE]: { damage: 12, toHitModifier: 3 },
};

const TW_BOMBAST_LASER_MODES = Object.keys(TW_BOMBAST_LASER_PROFILES) as TwBombastLaserMode[];

export class TwBombastLaserHandler extends EquipmentInteractionHandler {
    readonly id = 'tw-bombast-laser-handler';
    override readonly flags: EquipmentFlag[] = ['F_BOMBAST_LASER'];
    override readonly priority = 105;

    override applicableTo(equipment: MountedEquipment): boolean {
        return equipment.owner.gameRules.id === 'tw'
            && equipment.equipment instanceof WeaponEquipment;
    }

    override getChoices(equipment: MountedEquipment, _context: HandlerQueryContext): PickerChoice[] {
        return [{
            label: 'Mode',
            value: selectedTwBombastLaserMode(equipment),
            displayType: 'dropdown',
            choices: TW_BOMBAST_LASER_MODES.map(mode => ({
                label: `${TW_BOMBAST_LASER_PROFILES[mode].damage} DMG`,
                value: mode,
            })),
            keepOpen: true,
        }];
    }

    override handleSelection(
        equipment: MountedEquipment,
        choice: PickerChoice,
        _context: HandlerCommandContext,
    ): boolean {
        const mode = validTwBombastLaserMode(String(choice.value));
        if (mode) setInventoryControlMode(equipment, mode);
        return true;
    }

    override applyInventoryControlDamageEffects(
        equipment: MountedEquipment,
        damage: WeaponDamage,
        _damageContext: InventoryControlDamageContext,
        _context: HandlerQueryContext,
    ): WeaponDamage {
        const selectedDamage = selectedTwBombastLaserProfile(equipment).damage;
        return { ...damage, values: damage.values.map(() => selectedDamage), maximum: selectedDamage };
    }

    override applyInventoryControlAerospaceAttackValueEffects(
        equipment: MountedEquipment,
        values: AerospaceAttackValues,
        _context: HandlerQueryContext,
    ): AerospaceAttackValues {
        const selectedDamage = selectedTwBombastLaserProfile(equipment).damage;
        const selectedValue = (value: number): number => value > 0 ? selectedDamage : 0;
        return [
            selectedValue(values[0]),
            selectedValue(values[1]),
            selectedValue(values[2]),
            selectedValue(values[3]),
        ];
    }

    override applyInventoryControlHeatEffects(
        equipment: MountedEquipment,
        effect: InventoryControlHeatEffect,
        _context: HandlerQueryContext,
    ): InventoryControlHeatEffect {
        return { ...effect, value: selectedTwBombastLaserProfile(equipment).damage };
    }

    override getToHitAdjustments(
        equipment: MountedEquipment,
        _adjustmentContext: ToHitAdjustmentContext,
        _context: HandlerQueryContext,
    ): readonly ToHitAdjustment[] {
        const mode = selectedTwBombastLaserMode(equipment);
        const modifier = equipment.owner.getUnit().type === 'Aero'
            ? 3
            : TW_BOMBAST_LASER_PROFILES[mode].toHitModifier;
        return modifier === 0
            ? []
            : [{
                kind: 'replace-base',
                value: modifier,
                label: `${equipment.equipment?.shortName ?? equipment.name} (${mode})`,
            }];
    }
}

export function selectedTwBombastLaserMode(equipment: MountedEquipment): TwBombastLaserMode {
    return validTwBombastLaserMode(equipment.states.get(INVENTORY_CONTROL_MODE_STATE))
        ?? TW_BOMBAST_LASER_DAMAGE_12_MODE;
}

function selectedTwBombastLaserProfile(equipment: MountedEquipment): TwBombastLaserProfile {
    return TW_BOMBAST_LASER_PROFILES[selectedTwBombastLaserMode(equipment)];
}

function validTwBombastLaserMode(mode: string | undefined): TwBombastLaserMode | null {
    return mode !== undefined && Object.hasOwn(TW_BOMBAST_LASER_PROFILES, mode)
        ? mode as TwBombastLaserMode
        : null;
}
