// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { PickerChoice } from '../components/picker/picker.interface';
import type { EquipmentFlag } from '../models/equipment-flags.type';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import { EQUIPMENT_HEAT_SOURCE_GROUP, type UnitHeatSource } from '../models/rules/unit-type-rules';
import type { TurnState } from '../models/turn-state.model';
import { isFusionUnitEngine } from '../models/unit-summary.model';
import {
    EquipmentInteractionHandler,
    type HandlerCommandContext,
    type HandlerQueryContext,
} from '../services/equipment-interaction-registry.service';
import {
    HPG_CHARGED_STATE,
    HPG_CHARGING_STATE,
    HPG_COOLDOWN_STATE,
    HPG_COOLDOWN_TURNS_STATE_KEY,
    HPG_IDLE_STATE,
    HPG_STATE_KEY,
    HPG_TRANSMITTING_STATE,
    hpgState,
    isGroundMobileHpg,
    unitHasSelectedWeaponAttack,
} from '../utils/hpg-state.util';

export class MobileHpgHandler extends EquipmentInteractionHandler {
    readonly id = 'mobile-hpg-handler';
    override readonly flags: EquipmentFlag[] = ['F_MOBILE_HPG'];

    override getChoices(equipment: MountedEquipment, _context: HandlerQueryContext): PickerChoice[] {
        const state = hpgState(equipment);
        const noFusionEngine = !this.hasFusionEngine(equipment);
        if (!isGroundMobileHpg(equipment)) {
            const transmitting = state === HPG_TRANSMITTING_STATE;
            return [{
                label: transmitting ? 'Stop HPG Transmission' : 'Start HPG Transmission',
                value: transmitting ? HPG_IDLE_STATE : HPG_TRANSMITTING_STATE,
                active: transmitting,
                disabled: noFusionEngine || (!transmitting && unitHasSelectedWeaponAttack(equipment.owner)),
                displayType: 'toggle',
            }];
        }

        if (state === HPG_IDLE_STATE) {
            return [{
                label: 'Charge HPG',
                value: HPG_CHARGING_STATE,
                active: false,
                disabled: noFusionEngine || unitHasSelectedWeaponAttack(equipment.owner),
                displayType: 'toggle',
            }];
        }
        if (state === HPG_CHARGED_STATE) {
            return [{
                label: 'Transmit HPG',
                value: HPG_TRANSMITTING_STATE,
                active: false,
                disabled: noFusionEngine
                    || !this.canTransmitGroundMobile(equipment)
                    || unitHasSelectedWeaponAttack(equipment.owner),
                displayType: 'toggle',
            }];
        }
        if (state === HPG_COOLDOWN_STATE) {
            return [{
                label: `HPG Cooldown (${this.cooldownTurns(equipment)})`,
                value: HPG_COOLDOWN_STATE,
                active: false,
                disabled: true,
                displayType: 'toggle',
            }];
        }
        return [{
            label: state === HPG_CHARGING_STATE ? 'HPG Charging…' : 'HPG Transmitting…',
            value: state,
            active: true,
            disabled: true,
            displayType: 'toggle',
        }];
    }

    override handleSelection(
        equipment: MountedEquipment,
        choice: PickerChoice,
        context: HandlerCommandContext,
    ): boolean {
        const next = String(choice.value);
        if (!this.hasFusionEngine(equipment)) {
            context.toastService.showToast('A Mobile HPG requires a fusion engine', 'error');
            return true;
        }
        if ((next === HPG_CHARGING_STATE || next === HPG_TRANSMITTING_STATE)
            && unitHasSelectedWeaponAttack(equipment.owner)) {
            context.toastService.showToast('An HPG cannot charge or transmit in a turn with weapon attacks', 'error');
            return true;
        }
        if (isGroundMobileHpg(equipment)
            && next === HPG_TRANSMITTING_STATE
            && !this.canTransmitGroundMobile(equipment)) {
            context.toastService.showToast('A Ground-Mobile HPG can transmit only after spending 0 MP', 'error');
            return true;
        }
        const state = hpgState(equipment);
        const allowed = !isGroundMobileHpg(equipment)
            ? (state === HPG_IDLE_STATE && next === HPG_TRANSMITTING_STATE)
                || (state === HPG_TRANSMITTING_STATE && next === HPG_IDLE_STATE)
            : (state === HPG_IDLE_STATE && next === HPG_CHARGING_STATE)
                || (state === HPG_CHARGED_STATE && next === HPG_TRANSMITTING_STATE);
        if (!allowed || !equipment.setState(HPG_STATE_KEY, next)) return true;

        equipment.owner.setInventoryEntry(equipment);
        equipment.owner.turnState().markEquipmentStateChanged();
        context.toastService.showToast(`${equipment.getDisplayName()}: ${choice.label}`, 'info');
        return true;
    }

    override getInventoryHeatSources(
        equipment: MountedEquipment,
        _turnState: TurnState,
        context: HandlerQueryContext,
    ): UnitHeatSource[] {
        if (context.getStatus(equipment) !== 'available' || !this.hasFusionEngine(equipment)) return [];
        const state = hpgState(equipment);
        const groundMobile = isGroundMobileHpg(equipment);
        const active = state === HPG_TRANSMITTING_STATE || (groundMobile && state === HPG_CHARGING_STATE);
        if (!active) return [];
        return [{
            id: `mobile-hpg:${equipment.id}`,
            label: state === HPG_CHARGING_STATE ? 'HPG Charging' : 'HPG Transmission',
            value: groundMobile ? 20 : 40,
            group: EQUIPMENT_HEAT_SOURCE_GROUP,
        }];
    }

    override onEndTurn(equipment: MountedEquipment): void {
        if (!isGroundMobileHpg(equipment)) return;
        const state = hpgState(equipment);
        let changed = false;
        if (state === HPG_CHARGING_STATE) {
            changed = equipment.setState(HPG_STATE_KEY, HPG_CHARGED_STATE);
        } else if (state === HPG_TRANSMITTING_STATE) {
            if (equipment.owner.getUnit().weightClass === 'Large Support Vehicle') {
                changed = equipment.setState(HPG_STATE_KEY, HPG_IDLE_STATE);
            } else {
                changed = equipment.setState(HPG_STATE_KEY, HPG_COOLDOWN_STATE);
                changed = equipment.setState(HPG_COOLDOWN_TURNS_STATE_KEY, '3') || changed;
            }
        } else if (state === HPG_COOLDOWN_STATE) {
            const remaining = Math.max(0, this.cooldownTurns(equipment) - 1);
            if (remaining === 0) {
                changed = equipment.setState(HPG_STATE_KEY, HPG_IDLE_STATE);
                changed = equipment.deleteState(HPG_COOLDOWN_TURNS_STATE_KEY) || changed;
            } else {
                changed = equipment.setState(HPG_COOLDOWN_TURNS_STATE_KEY, String(remaining));
            }
        }
        if (changed) equipment.owner.setInventoryEntry(equipment);
    }

    private canTransmitGroundMobile(equipment: MountedEquipment): boolean {
        const turnState = equipment.owner.turnState();
        return turnState.effectiveMoveMode() === 'stationary' && (turnState.moveDistance() ?? 0) === 0;
    }

    private hasFusionEngine(equipment: MountedEquipment): boolean {
        return isFusionUnitEngine(equipment.owner.getUnit().engine);
    }

    private cooldownTurns(equipment: MountedEquipment): number {
        const turns = Number(equipment.states.get(HPG_COOLDOWN_TURNS_STATE_KEY));
        return Number.isInteger(turns) && turns > 0 ? turns : 0;
    }
}
