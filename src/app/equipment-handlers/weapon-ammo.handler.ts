import { EquipmentInteractionHandler, type HandlerContext } from '../services/equipment-interaction-registry.service';
import type { MountedEquipment } from '../models/force-serialization';
import type { PickerChoice } from '../components/picker/picker.interface';
import { WeaponEquipment } from '../models/equipment.model';
import { AmmoControlDialogComponent, type AmmoControlDialogData } from '../components/ammo-control-dialog/ammo-control-dialog.component';
import { changeAmmoEntryRemaining, getAmmoControlEntriesForWeapon, getAmmoEntryRemaining, setAmmoEntry } from '../utils/ammo-interaction.util';

export class WeaponAmmoHandler extends EquipmentInteractionHandler {
    readonly id = 'weapon-ammo-handler';
    override readonly priority = 1;

    override applicableTo = (equipment: MountedEquipment): boolean => {
        return equipment.equipment instanceof WeaponEquipment
            && equipment.equipment.ammoType !== 'NA'
            && equipment.equipment.rackSize > 0;
    };

    getChoices(equipment: MountedEquipment, context: HandlerContext): PickerChoice[] {
        const entries = getAmmoControlEntriesForWeapon(equipment, context);
        if (entries.length === 0) return [];

        if (entries.length === 1) {
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
                displayType: 'button',
                disabled: entries.every(entry => entry.destroyed)
            }
        ];
    }

    async handleSelection(equipment: MountedEquipment, choice: PickerChoice, context: HandlerContext): Promise<boolean> {
        const entries = getAmmoControlEntriesForWeapon(equipment, context);
        if (entries.length === 0) return false;

        if (choice.value === 'weapon-ammo-dialog') {
            context.dialogsService.createDialog<void>(AmmoControlDialogComponent, {
                data: {
                    title: `${equipment.equipment?.shortName ?? equipment.name} Ammo`,
                    entries,
                    context
                } as AmmoControlDialogData,
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