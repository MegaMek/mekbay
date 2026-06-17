import { EquipmentInteractionHandler, type HandlerContext } from '../services/equipment-interaction-registry.service';
import type { MountedEquipment } from '../models/force-serialization';
import type { PickerChoice } from '../components/picker/picker.interface';
import { WeaponEquipment } from '../models/equipment.model';
import { EquipmentDialogComponent } from '../components/equipment-dialog/equipment-dialog.component';
import type { EquipmentDialogData } from '../components/equipment-dialog/equipment-dialog.model';
import { changeAmmoEntryRemaining, getAmmoControlEntriesForWeapon, getAmmoEntryRemaining, setAmmoEntry } from '../utils/ammo-interaction.util';

export class WeaponAmmoHandler extends EquipmentInteractionHandler {
    readonly id = 'weapon-ammo-handler';
    override readonly priority = 1;

    override applicableTo = (equipment: MountedEquipment): boolean => {
        return equipment.equipment instanceof WeaponEquipment
            && equipment.equipment.ammoType !== 'NA';
    };

    getChoices(equipment: MountedEquipment, context: HandlerContext): PickerChoice[] {
        const entries = getAmmoControlEntriesForWeapon(equipment, context);
        if (entries.length === 0) return [];

        if (entries.length === 1 && !equipment.owner.readOnly()) {
            const entry = entries[0];
            const remaining = getAmmoEntryRemaining(entry);
            return [
                { label: '-1', value: 'weapon-ammo-decrement', keepOpen: true, disabled: entry.destroyed || remaining <= 0 },
                { label: '+1', value: 'weapon-ammo-increment', keepOpen: true, disabled: entry.destroyed || remaining >= entry.totalAmmo },
                { label: 'Set Ammo', value: 'weapon-ammo-set', disabled: entry.destroyed }
            ];
        }

        return [
            {
                label: 'Ammo',
                value: 'weapon-ammo-dialog',
                displayType: 'button'
            }
        ];
    }

    async handleSelection(equipment: MountedEquipment, choice: PickerChoice, context: HandlerContext): Promise<boolean> {
        const entries = getAmmoControlEntriesForWeapon(equipment, context);
        if (entries.length === 0) return false;

        if (choice.value === 'weapon-ammo-dialog') {
            context.dialogsService.createDialog<void>(EquipmentDialogComponent, {
                data: {
                    unit: equipment.owner,
                    readOnly: equipment.owner.readOnly(),
                    context: {
                        ...context,
                        registry: {
                            getChoices: () => [],
                            handleSelection: () => false
                        }
                    },
                    initialTab: 'ammo'
                } as EquipmentDialogData,
            });
            return true;
        }

        const entry = entries[0];
        if (!entry) return false;

        if (choice.value === 'weapon-ammo-decrement') {
            return changeAmmoEntryRemaining(entry, -1, context);
        }
        if (choice.value === 'weapon-ammo-increment') {
            return changeAmmoEntryRemaining(entry, 1, context);
        }
        if (choice.value === 'weapon-ammo-set') {
            return setAmmoEntry(entry, context);
        }

        return false;
    }
}