import type { PickerChoice } from '../components/picker/picker.interface';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import type { TurnState } from '../models/turn-state.model';
import type { UnitHeatSource } from '../models/rules/unit-type-rules';
import { EquipmentInteractionHandler, type HandlerContext } from '../services/equipment-interaction-registry.service';
import type { InventoryControlDamage, InventoryControlDamageContext } from '../utils/inventory-control-damage.util';
import type { InventoryControlHeatEffect } from '../utils/inventory-control-heat.util';

export const PPC_CAPACITOR_STATE_KEY = 'ppc_capacitor_state';
export const PPC_CAPACITOR_CHARGING_STATE = 'charging';
export const PPC_CAPACITOR_CHARGED_STATE = 'charged';
export const PPC_CAPACITOR_FIRED_STATE_KEY = 'ppc_capacitor_fired';
export const PPC_CAPACITOR_HEAT_BONUS = 5;
export const PPC_CAPACITOR_DAMAGE_BONUS = 5;
export const PPC_CAPACITOR_CHARGED_COLOR = '#00a8ff';
export const PPC_CAPACITOR_CHARGED_TEXT_COLOR = '#001829';

export class PpcCapacitorHandler extends EquipmentInteractionHandler {
    readonly id = 'ppc-capacitor-handler';
    override readonly flags = ['F_PPC'];
    override readonly priority = 20;

    override applicableTo(equipment: MountedEquipment): boolean {
        return linkedPpcCapacitor(equipment) !== null;
    }

    getChoices(equipment: MountedEquipment, _context: HandlerContext): PickerChoice[] {
        const capacitor = linkedPpcCapacitor(equipment);
        if (!capacitor || !isPpcCapacitorUsable(equipment, capacitor)) return [];

        const state = ppcCapacitorState(capacitor);
        const active = state !== null;
        return [{
            label: state === PPC_CAPACITOR_CHARGED_STATE
                ? 'Capacitor Charged!'
                : state === PPC_CAPACITOR_CHARGING_STATE ? 'Capacitor Charging' : 'Charge Capacitor',
            shortLabel: state === PPC_CAPACITOR_CHARGED_STATE
                ? 'Charged!'
                : state === PPC_CAPACITOR_CHARGING_STATE ? 'Charging' : 'Charge',
            value: active ? 'discharged' : PPC_CAPACITOR_CHARGING_STATE,
            active,
            disabled: capacitor.states.has(PPC_CAPACITOR_FIRED_STATE_KEY),
            colors: active ? { selected: PPC_CAPACITOR_CHARGED_COLOR, selectedText: PPC_CAPACITOR_CHARGED_TEXT_COLOR } : undefined,
            displayType: 'toggle'
        }];
    }

    handleSelection(equipment: MountedEquipment, choice: PickerChoice, context: HandlerContext): boolean {
        const capacitor = linkedPpcCapacitor(equipment);
        if (!capacitor || !isPpcCapacitorUsable(equipment, capacitor)) return true;

        const charging = choice.value === PPC_CAPACITOR_CHARGING_STATE;
        if (charging && capacitor.states.has(PPC_CAPACITOR_FIRED_STATE_KEY)) {
            context.toastService.showToast('A fired PPC cannot charge its capacitor this turn.', 'error');
            return true;
        }
        if (setPpcCapacitorState(capacitor, charging ? PPC_CAPACITOR_CHARGING_STATE : null)) {
            capacitor.owner.setInventoryEntry(capacitor);
        }
        context.toastService.showToast(`PPC Capacitor ${charging ? 'charging' : 'discharged'}`, 'info');
        return true;
    }

    override afterInventoryControlFire(equipment: MountedEquipment, _context: HandlerContext): void {
        const capacitor = linkedPpcCapacitor(equipment);
        if (!capacitor || !isPpcCapacitorUsable(equipment, capacitor)) return;
        const discharged = setPpcCapacitorState(capacitor, null);
        const markedFired = capacitor.setState(PPC_CAPACITOR_FIRED_STATE_KEY, '1');
        const changed = discharged || markedFired;
        if (changed) {
            capacitor.owner.setInventoryEntry(capacitor);
        }
    }

    override onEndTurn(equipment: MountedEquipment, _context: HandlerContext): void {
        const capacitor = linkedPpcCapacitor(equipment);
        if (!capacitor) return;
        let changed = capacitor.deleteState(PPC_CAPACITOR_FIRED_STATE_KEY);
        if (isPpcCapacitorUsable(equipment, capacitor) && ppcCapacitorState(capacitor) === PPC_CAPACITOR_CHARGING_STATE) {
            changed = setPpcCapacitorState(capacitor, PPC_CAPACITOR_CHARGED_STATE) || changed;
        }
        if (changed) capacitor.owner.setInventoryEntry(capacitor);
    }

    override isInventoryControlSelectable(equipment: MountedEquipment, _context: HandlerContext): boolean | null {
        const capacitor = linkedPpcCapacitor(equipment);
        return capacitor && ppcCapacitorState(capacitor) === PPC_CAPACITOR_CHARGING_STATE ? false : null;
    }

    override applyInventoryControlHeatEffects(equipment: MountedEquipment, effect: InventoryControlHeatEffect, _context: HandlerContext): InventoryControlHeatEffect {
        return chargedLinkedPpcCapacitor(equipment)
            ? { ...effect, value: effect.value + PPC_CAPACITOR_HEAT_BONUS }
            : effect;
    }

    override applyInventoryControlDamageEffects(
        equipment: MountedEquipment,
        damage: InventoryControlDamage,
        _damageContext: InventoryControlDamageContext,
        _context: HandlerContext
    ): InventoryControlDamage {
        if (!chargedLinkedPpcCapacitor(equipment)) return damage;
        return addDamageBonus(damage, PPC_CAPACITOR_DAMAGE_BONUS);
    }

    override getInventoryHeatSources(equipment: MountedEquipment, _turnState: TurnState): UnitHeatSource[] {
        const capacitor = linkedPpcCapacitor(equipment);
        if (!capacitor || !isPpcCapacitorUsable(equipment, capacitor) || ppcCapacitorState(capacitor) === null) return [];
        return [{
            id: `ppc-capacitor:${equipment.id}`,
            label: 'PPC Capacitor',
            value: PPC_CAPACITOR_HEAT_BONUS,
            replacedByFiringEntryId: ppcCapacitorState(capacitor) === PPC_CAPACITOR_CHARGED_STATE
                ? equipment.id
                : undefined
        }];
    }
}

function isPpcCapacitor(entry: MountedEquipment): boolean {
    return entry.equipment?.hasFlag('F_WEAPON_ENHANCEMENT') === true
        && entry.equipment.hasFlag('F_PPC_CAPACITOR');
}

function linkedPpcCapacitor(weapon: MountedEquipment): MountedEquipment | null {
    return weapon.linkedWith?.find(isPpcCapacitor) ?? null;
}

function isPpcCapacitorUsable(weapon: MountedEquipment, capacitor: MountedEquipment): boolean {
    return isPpcCapacitor(capacitor)
        && !weapon.isUnavailable()
        && !capacitor.isUnavailable();
}

function isPpcCapacitorCharged(capacitor: MountedEquipment): boolean {
    return ppcCapacitorState(capacitor) === PPC_CAPACITOR_CHARGED_STATE;
}

function ppcCapacitorState(capacitor: MountedEquipment): typeof PPC_CAPACITOR_CHARGING_STATE | typeof PPC_CAPACITOR_CHARGED_STATE | null {
    const state = capacitor.states.get(PPC_CAPACITOR_STATE_KEY);
    return state === PPC_CAPACITOR_CHARGING_STATE || state === PPC_CAPACITOR_CHARGED_STATE ? state : null;
}

function chargedLinkedPpcCapacitor(weapon: MountedEquipment): MountedEquipment | null {
    const capacitor = linkedPpcCapacitor(weapon);
    if (!capacitor || !isPpcCapacitorUsable(weapon, capacitor)) return null;
    return isPpcCapacitorCharged(capacitor) ? capacitor : null;
}

function setPpcCapacitorState(
    capacitor: MountedEquipment,
    state: typeof PPC_CAPACITOR_CHARGING_STATE | typeof PPC_CAPACITOR_CHARGED_STATE | null
): boolean {
    if (state !== null) return capacitor.setState(PPC_CAPACITOR_STATE_KEY, state);
    return capacitor.deleteState(PPC_CAPACITOR_STATE_KEY);
}

function addDamageBonus(damage: InventoryControlDamage, bonus: number): InventoryControlDamage {
    if (damage.kind === 'simple') return { kind: 'simple', value: damage.value + bonus };
    if (damage.kind === 'profile') { // not used
        return { kind: 'profile', values: damage.values.map(value => addDamageBonus(value, bonus)) };
    }
    return damage;
}