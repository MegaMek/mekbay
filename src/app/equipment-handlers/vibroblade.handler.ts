// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { PickerChoice } from '../components/picker/picker.interface';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import type { ToHitAdjustment } from '../models/rules/game-rules';
import { EquipmentInteractionHandler, type HandlerCommandContext, type HandlerQueryContext } from '../services/equipment-interaction-registry.service';
import type { InventoryControlDisplayData, InventoryControlDisplayEffectOptions } from '../utils/inventory-control.util';
import type { InventoryControlPhysicalDamageEffect } from '../utils/inventory-control-physical-damage.util';
import { getVibrobladeProfile } from '../models/rules/vibroblade-rules';
import { EquipmentFlag } from '../models/equipment-flags.type';
import type { InventoryControlHeatEffect } from '../utils/inventory-control-heat.util';

export const VIBROBLADE_MODE_STATE = 'vibroblade_mode';
export const VIBROBLADE_ON_MODE = 'ON';
export const VIBROBLADE_OFF_MODE = 'OFF';

export function getVibrobladeMode(mounted: MountedEquipment): typeof VIBROBLADE_ON_MODE | typeof VIBROBLADE_OFF_MODE {
    return mounted.states.get(VIBROBLADE_MODE_STATE) === VIBROBLADE_ON_MODE
        ? VIBROBLADE_ON_MODE
        : VIBROBLADE_OFF_MODE;
}

export function isActiveVibroblade(mounted: MountedEquipment): boolean {
    return getVibrobladeProfile(mounted.equipment) !== null
        && getVibrobladeMode(mounted) === VIBROBLADE_ON_MODE;
}

export function getVibrobladeBaseDamage(mounted: MountedEquipment): number | null {
    const profile = getVibrobladeProfile(mounted.equipment);
    if (!profile) return null;
    if (getVibrobladeMode(mounted) === VIBROBLADE_ON_MODE) return profile.activeDamage;

    const tonnage = Math.max(0, mounted.owner.getUnit().tons);
    return Math.min(Math.ceil(tonnage / 10) + 1, profile.activeDamage);
}

export class VibrobladeHandler extends EquipmentInteractionHandler {
    readonly id = 'vibroblade-handler';
    override readonly flags: EquipmentFlag[] = ['F_CLUB'];
    override readonly priority = 20;

    override applicableTo(mounted: MountedEquipment): boolean {
        return getVibrobladeProfile(mounted.equipment) !== null;
    }

    override getChoices(mounted: MountedEquipment, _context: HandlerQueryContext): PickerChoice[] {
        return [{
            label: 'Mode',
            value: getVibrobladeMode(mounted),
            displayType: 'dropdown',
            choices: [
                { label: VIBROBLADE_ON_MODE, value: VIBROBLADE_ON_MODE },
                { label: VIBROBLADE_OFF_MODE, value: VIBROBLADE_OFF_MODE },
            ],
            keepOpen: true,
        }];
    }

    override handleSelection(mounted: MountedEquipment, choice: PickerChoice, _context: HandlerCommandContext): boolean {
        const mode = choice.value === VIBROBLADE_ON_MODE ? VIBROBLADE_ON_MODE : VIBROBLADE_OFF_MODE;
        if (mounted.setState(VIBROBLADE_MODE_STATE, mode)) {
            mounted.owner.setInventoryEntry(mounted);
        }
        return false;
    }

    override getToHitAdjustments(mounted: MountedEquipment): readonly ToHitAdjustment[] {
        return [{ kind: 'replace-base', value: -2, label: mounted.equipment?.shortName ?? mounted.name }];
    }

    override applyInventoryControlDisplayEffects(
        mounted: MountedEquipment,
        display: InventoryControlDisplayData,
        _options: InventoryControlDisplayEffectOptions,
        _context: HandlerQueryContext,
    ): InventoryControlDisplayData {
        const profile = getVibrobladeProfile(mounted.equipment);
        if (!profile) return display;
        const active = getVibrobladeMode(mounted) === VIBROBLADE_ON_MODE;
        return {
            ...display,
            heat: active ? `${profile.activeHeat}` : `[${profile.activeHeat}]`,
            damage: active
                ? `${profile.activeDamage}`
                : `${Number.parseInt(display.damage, 10)} [${profile.activeDamage}]`,
        };
    }

    override applyInventoryControlPhysicalDamageEffects(
        mounted: MountedEquipment,
        effect: InventoryControlPhysicalDamageEffect,
        _context: HandlerQueryContext,
    ): InventoryControlPhysicalDamageEffect {
        const profile = getVibrobladeProfile(mounted.equipment);
        const baseDamage = getVibrobladeBaseDamage(mounted);
        if (!profile || baseDamage === null) return effect;
        const active = getVibrobladeMode(mounted) === VIBROBLADE_ON_MODE;
        return {
            baseDamage,
            ignoreMyomer: active,
        };
    }

    override getInventoryControlHeatEffect(mounted: MountedEquipment): InventoryControlHeatEffect | null {
        const profile = getVibrobladeProfile(mounted.equipment);
        if (!profile || getVibrobladeMode(mounted) !== VIBROBLADE_ON_MODE) return null;
        return { value: profile.activeHeat, weakened: false };
    }
}
