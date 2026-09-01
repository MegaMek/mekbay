// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { PickerChoice } from '../components/picker/picker.interface';
import type { WeaponDamage } from '../models/equipment.model';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import type {
    HandlerQueryContext,
} from '../services/equipment-interaction-registry.service';
import type { InventoryControlDamageContext } from '../utils/inventory-control-damage.util';
import type { InventoryControlDisplayData, InventoryControlDisplayEffectOptions } from '../utils/inventory-control.util';
import type { InventoryControlHeatEffect } from '../utils/inventory-control-heat.util';
import {
    isMachineGunArray,
    isMachineGunArrayEffectivelyActive,
    isMachineGunArrayMember,
    machineGunArrayActivationState,
    machineGunArrayController,
    MGA_ACTIVATION_STATE_KEY,
    MGA_ACTIVE_STATE,
    MGA_OFF_STATE,
    MGA_TURNING_OFF_STATE,
    MGA_TURNING_ON_STATE,
    operationalMachineGunArrayMembers,
} from '../utils/mga-state.util';
import { ToggleHandler } from './base/toggle.handler';

/** Implements Total Warfare's End-Phase Activated/Off state for Machine Gun Arrays. */
export class MgaActivationHandler extends ToggleHandler {
    readonly id = 'mga-activation-handler';

    protected override readonly stateKey = MGA_ACTIVATION_STATE_KEY;
    protected override readonly toggleMode = 'transient' as const;
    protected override readonly enabledState = MGA_ACTIVE_STATE;
    protected override readonly enablingState = MGA_TURNING_ON_STATE;
    protected override readonly disabledState = MGA_OFF_STATE;
    protected override readonly disablingState = MGA_TURNING_OFF_STATE;
    protected override readonly defaultEnabled = true;
    protected override readonly enabledLabel = 'Array linked';
    protected override readonly enablingLabel = 'Links at End Phase…';
    protected override readonly disabledLabel = 'Array unlinked';
    protected override readonly disablingLabel = 'Unlinked at End Phase…';
    protected override readonly enabledToastVerb = 'active';
    protected override readonly enablingToastVerb = 'scheduled to link at End Phase';
    protected override readonly disabledToastVerb = 'off';
    protected override readonly disablingToastVerb = 'scheduled to unlink at End Phase';

    override applicableTo(equipment: MountedEquipment): boolean {
        return isMachineGunArray(equipment) || isMachineGunArrayMember(equipment);
    }

    override getChoices(equipment: MountedEquipment, context: HandlerQueryContext): PickerChoice[] {
        return isMachineGunArray(equipment) ? super.getChoices(equipment, context) : [];
    }

    protected override getToggleState(equipment: MountedEquipment): string {
        return machineGunArrayActivationState(equipment);
    }

    override isInventoryControlSelectable(
        equipment: MountedEquipment,
        context: HandlerQueryContext,
    ): boolean | null {
        if (isMachineGunArray(equipment)) {
            if (context.getStatus(equipment) !== 'available'
                || !isMachineGunArrayEffectivelyActive(equipment)) return false;
            return operationalMachineGunArrayMembers(
                equipment,
                member => context.getStatus(member) === 'available',
            ).length > 0 ? null : false;
        }

        const array = machineGunArrayController(equipment);
        return array
            && context.getStatus(array) === 'available'
            && isMachineGunArrayEffectivelyActive(array)
            ? false
            : null;
    }

    override applyInventoryControlAmmoConsumption(
        equipment: MountedEquipment,
        count: number,
        context: HandlerQueryContext,
    ): number {
        if (!isMachineGunArray(equipment)) return count;
        return count * operationalMachineGunArrayMembers(
            equipment,
            member => context.getStatus(member) === 'available',
        ).length;
    }

    override applyInventoryControlDamageEffects(
        equipment: MountedEquipment,
        damage: WeaponDamage,
        _damageContext: InventoryControlDamageContext,
        context: HandlerQueryContext,
    ): WeaponDamage {
        if (!isMachineGunArray(equipment)) return damage;
        const memberCount = operationalMachineGunArrayMembers(
            equipment,
            member => context.getStatus(member) === 'available',
        ).length;
        return memberCount > 0
            ? { ...damage, maximum: damage.maximum * memberCount, unit: 'shot' }
            : damage;
    }

    override applyInventoryControlHeatEffects(
        equipment: MountedEquipment,
        effect: InventoryControlHeatEffect,
        context: HandlerQueryContext,
    ): InventoryControlHeatEffect {
        if (!isMachineGunArray(equipment)) return effect;
        const memberCount = operationalMachineGunArrayMembers(
            equipment,
            member => context.getStatus(member) === 'available',
        ).length;
        return memberCount > 1
            ? { ...effect, value: effect.value * memberCount, displayValue: effect.value }
            : effect;
    }
}
