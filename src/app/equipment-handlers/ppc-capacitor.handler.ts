import type { PickerChoice } from '../components/picker/picker.interface';
import type { MountedEquipment } from '../models/force-serialization';
import type { TurnState } from '../models/turn-state.model';
import type { UnitHeatSource } from '../models/rules/unit-type-rules';
import { EquipmentInteractionHandler, type HandlerContext } from '../services/equipment-interaction-registry.service';
import type { InventoryControlDisplayData, InventoryControlDisplayEffectOptions } from '../utils/inventory-control.util';

export const PPC_CAPACITOR_STATE_KEY = 'ppc_capacitor_state';
export const PPC_CAPACITOR_CHARGED_STATE = 'charged';
export const PPC_CAPACITOR_HEAT_BONUS = 5;
export const PPC_CAPACITOR_DAMAGE_BONUS = 5;
export const PPC_CAPACITOR_CHARGED_COLOR = '#00a8ff';

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

        const charged = isPpcCapacitorCharged(capacitor);
        return [{
            label: charged ? 'Capacitor Charged!' : 'Charge Capacitor',
            shortLabel: charged ? 'Charged!' : 'Charge',
            value: charged ? 'discharged' : PPC_CAPACITOR_CHARGED_STATE,
            active: charged,
            colors: charged ? { selected: PPC_CAPACITOR_CHARGED_COLOR } : undefined,
            displayType: 'toggle'
        }];
    }

    handleSelection(equipment: MountedEquipment, choice: PickerChoice, context: HandlerContext): boolean {
        const capacitor = linkedPpcCapacitor(equipment);
        if (!capacitor || !isPpcCapacitorUsable(equipment, capacitor)) return true;

        const charged = choice.value === PPC_CAPACITOR_CHARGED_STATE;
        if (setPpcCapacitorCharged(capacitor, charged)) {
            capacitor.owner.setInventoryEntry(capacitor);
        }
        context.toastService.showToast(`PPC Capacitor ${charged ? 'charged' : 'discharged'}`, 'info');
        return true;
    }

    override afterInventoryControlFire(equipment: MountedEquipment, _context: HandlerContext): void {
        const capacitor = linkedPpcCapacitor(equipment);
        if (!capacitor || !isPpcCapacitorUsable(equipment, capacitor)) return;
        if (setPpcCapacitorCharged(capacitor, false)) {
            capacitor.owner.setInventoryEntry(capacitor);
        }
    }

    override applyInventoryControlDisplayEffects(
        equipment: MountedEquipment,
        display: InventoryControlDisplayData,
        _options: InventoryControlDisplayEffectOptions,
        _context: HandlerContext
    ): InventoryControlDisplayData {
        if (!chargedLinkedPpcCapacitor(equipment)) return display;
        const heat = addPpcCapacitorBonus(display.heat, PPC_CAPACITOR_HEAT_BONUS);
        const damage = addPpcCapacitorBonus(display.damage, PPC_CAPACITOR_DAMAGE_BONUS);
        if (heat === null && damage === null) return display;
        return {
            ...display,
            heat: heat ?? display.heat,
            damage: damage ?? display.damage
        };
    }

    override getInventoryHeatSources(equipment: MountedEquipment, _turnState: TurnState): UnitHeatSource[] {
        if (!chargedLinkedPpcCapacitor(equipment)) return [];
        return [{
            id: `ppc-capacitor:${equipment.id}`,
            label: 'PPC Capacitor',
            value: PPC_CAPACITOR_HEAT_BONUS
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
    return capacitor.states.get(PPC_CAPACITOR_STATE_KEY) === PPC_CAPACITOR_CHARGED_STATE;
}

function chargedLinkedPpcCapacitor(weapon: MountedEquipment): MountedEquipment | null {
    const capacitor = linkedPpcCapacitor(weapon);
    if (!capacitor || !isPpcCapacitorUsable(weapon, capacitor)) return null;
    return isPpcCapacitorCharged(capacitor) ? capacitor : null;
}

function setPpcCapacitorCharged(capacitor: MountedEquipment, charged: boolean): boolean {
    if (charged) return capacitor.setState(PPC_CAPACITOR_STATE_KEY, PPC_CAPACITOR_CHARGED_STATE);
    return capacitor.deleteState(PPC_CAPACITOR_STATE_KEY);
}

function addPpcCapacitorBonus(value: string, bonus: number): string | null {
    const match = value.trim().match(/^([+-]?\d+(?:\.\d+)?)(.*)$/);
    if (!match) return null;
    const next = Number.parseFloat(match[1]) + bonus;
    if (!Number.isFinite(next)) return null;
    const nextText = Number.isInteger(next) ? next.toString() : next.toFixed(1).replace(/\.0$/, '');
    return `${nextText}${match[2]}`;
}