import type { PickerChoice } from '../components/picker/picker.interface';
import type { MountedEquipment } from '../models/force-serialization';
import type { TurnState } from '../models/turn-state.model';
import type { UnitHeatSource } from '../models/rules/unit-type-rules';
import { EquipmentInteractionHandler, type HandlerContext } from '../services/equipment-interaction-registry.service';
import type { InventoryControlDisplayData, InventoryControlDisplayEffectOptions } from '../utils/inventory-control.util';
import { addPpcCapacitorBonus, chargedLinkedPpcCapacitor, linkedPpcCapacitor, isPpcCapacitorCharged, isPpcCapacitorUsable, PPC_CAPACITOR_CHARGED_STATE, PPC_CAPACITOR_DAMAGE_BONUS, PPC_CAPACITOR_HEAT_BONUS, setPpcCapacitorCharged } from '../utils/ppc-capacitor.util';

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
            label: charged ? 'Capacitor Charged' : 'Charge Capacitor',
            shortLabel: charged ? 'Charged' : 'Charge',
            value: charged ? 'discharged' : PPC_CAPACITOR_CHARGED_STATE,
            active: charged,
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