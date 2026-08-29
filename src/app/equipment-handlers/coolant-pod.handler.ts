// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { PickerChoice } from '../components/picker/picker.interface';
import { isCoolantPodEquipment } from '../models/equipment.model';
import { MountedAmmo, type MountedEquipment } from '../models/mounted-equipment.model';
import type { HeatDissipationState } from '../models/rules/heat-management';
import {
    EquipmentInteractionHandler,
    type HandlerCommandContext,
    type HandlerQueryContext,
} from '../services/equipment-interaction-registry.service';
import { RadicalHeatSinkHandler } from './radical-heat-sink.handler';

export const COOLANT_POD_ACTIVE_STATE_KEY = 'coolantPodActive';

export class CoolantPodHandler extends EquipmentInteractionHandler {
    readonly id = 'coolant-pod-handler';

    override applicableTo(equipment: MountedEquipment): boolean {
        return isCoolantPodEquipment(equipment.equipment);
    }

    override getChoices(equipment: MountedEquipment, _context: HandlerQueryContext): PickerChoice[] {
        const expended = this.remaining(equipment) === 0;
        const podAlreadyUsedThisTurn = equipment.owner.getInventory().some(entry =>
            this.isActive(entry));
        return [{
            label: expended ? 'Coolant Pod Expended' : 'Use Coolant Pod',
            value: 'use',
            active: this.isActive(equipment),
            disabled: expended || podAlreadyUsedThisTurn,
            displayType: 'toggle',
        }];
    }

    override handleSelection(
        equipment: MountedEquipment,
        choice: PickerChoice,
        context: HandlerCommandContext,
    ): boolean {
        if (choice.value !== 'use' || this.remaining(equipment) === 0) return true;
        if (equipment.owner.getInventory().some(entry =>
            this.isActive(entry))) {
            context.toastService.showToast('Only one Coolant Pod may be used per turn', 'error');
            return true;
        }

        const consumed = this.consumed(equipment) + 1;
        equipment.setAmmoState({ consumed });
        this.syncCriticalSlotConsumption(equipment, consumed);
        equipment.setState(COOLANT_POD_ACTIVE_STATE_KEY, 'true');
        equipment.owner.setInventoryEntry(equipment);
        equipment.owner.turnState().markEquipmentStateChanged();
        context.toastService.showToast(
            this.hasActiveRadicalHeatSink(equipment)
                ? 'Coolant Pod triggered, but the active Radical Heat Sink prevents its effect'
                : 'Coolant Pod triggered',
            this.hasActiveRadicalHeatSink(equipment) ? 'error' : 'info',
        );
        return true;
    }

    override getHeatDissipationBonus(
        equipment: MountedEquipment,
        dissipation: HeatDissipationState,
        context: HandlerQueryContext,
    ): number {
        if (!this.isActive(equipment)
            || context.getStatus(equipment) !== 'available'
            || this.hasActiveRadicalHeatSink(equipment)) return 0;
        return Math.max(0, dissipation.healthyPips - dissipation.heatsinksOff);
    }

    override onEndTurn(equipment: MountedEquipment): void {
        if (equipment.deleteState(COOLANT_POD_ACTIVE_STATE_KEY)) {
            equipment.owner.setInventoryEntry(equipment);
        }
    }

    private remaining(equipment: MountedEquipment): number {
        const capacity = equipment.originalTotalAmmo
            ?? equipment.totalAmmo
            ?? (equipment instanceof MountedAmmo ? equipment.getMaxShots() : 1);
        return Math.max(0, capacity - this.consumed(equipment));
    }

    private consumed(equipment: MountedEquipment): number {
        const mountedSlots = equipment.critSlots ?? [];
        if (mountedSlots.length === 0) return equipment.consumed ?? 0;
        return mountedSlots.reduce((total, mountedSlot) => {
            const current = mountedSlot.loc !== undefined && mountedSlot.slot !== undefined
                ? equipment.owner.getCritSlot(mountedSlot.loc, mountedSlot.slot)
                : null;
            return total + (current?.consumed ?? mountedSlot.consumed ?? 0);
        }, 0);
    }

    private isActive(equipment: MountedEquipment): boolean {
        return equipment.states.get(COOLANT_POD_ACTIVE_STATE_KEY) === 'true'
            && this.consumed(equipment) > 0;
    }

    private syncCriticalSlotConsumption(equipment: MountedEquipment, consumed: number): void {
        const mountedSlots = equipment.critSlots ?? [];
        if (mountedSlots.length === 0) return;
        const positions = new Set(mountedSlots
            .filter(slot => slot.loc !== undefined && slot.slot !== undefined)
            .map(slot => `${slot.loc}:${slot.slot}`));
        if (positions.size === 0) return;

        let remaining = consumed;
        const critSlots = equipment.owner.getCritSlots().map(slot => {
            if (!positions.has(`${slot.loc}:${slot.slot}`)) return slot;
            const capacity = slot.totalAmmo
                || Number(slot.el?.getAttribute('totalAmmo') ?? 0)
                || 1;
            const slotConsumed = Math.min(capacity, remaining);
            remaining -= slotConsumed;
            return { ...slot, consumed: slotConsumed };
        });
        equipment.owner.setCritSlots(critSlots);
    }

    private hasActiveRadicalHeatSink(equipment: MountedEquipment): boolean {
        return equipment.owner.getInventory().some(entry =>
            entry.equipment?.hasFlag('F_RADICAL_HEATSINK') === true
            && entry.owner.isEquipmentOperational(entry)
            && RadicalHeatSinkHandler.isActive(entry));
    }
}
