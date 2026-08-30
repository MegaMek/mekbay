// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { createHandlerQueryContext, EquipmentInteractionHandler, type HandlerChoice, type HandlerCommandContext, type HandlerQueryContext } from '../services/equipment-interaction-registry.service';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import type { PickerChoice } from '../components/picker/picker.interface';
import { WeaponEquipment } from '../models/equipment.model';
import { EquipmentDialogComponent } from '../components/equipment-dialog/equipment-dialog.component';
import type { EquipmentDialogData } from '../components/equipment-dialog/equipment-dialog.model';
import { changeAmmoEntryRemaining, getAmmoControlEntriesForWeapon, getAmmoEntryRemaining, isAmmoControlEntryUsable, setAmmoEntry } from '../utils/ammo-interaction.util';

export class WeaponAmmoHandler extends EquipmentInteractionHandler {
    readonly id = 'weapon-ammo-handler';
    override readonly priority = 1;

    override applicableTo = (equipment: MountedEquipment): boolean => {
        return equipment.equipment instanceof WeaponEquipment
            && equipment.equipment.ammoType !== 'NA';
    };

    getChoices(equipment: MountedEquipment, context: HandlerQueryContext): HandlerChoice[] {
        const entries = getAmmoControlEntriesForWeapon(equipment, context.equipmentCatalog);
        if (entries.length === 0) return [];

        if (entries.length === 1 && !context.isReadOnly(equipment)) {
            const entry = entries[0];
            const remaining = getAmmoEntryRemaining(entry);
            return [
                { label: '-1', value: 'weapon-ammo-decrement', keepOpen: true, disabled: !isAmmoControlEntryUsable(entry) || remaining <= 0 },
                { label: '+1', value: 'weapon-ammo-increment', keepOpen: true, disabled: !isAmmoControlEntryUsable(entry) || remaining >= entry.totalAmmo },
                { label: 'Set Ammo', value: 'weapon-ammo-set', disabled: !isAmmoControlEntryUsable(entry) }
            ];
        }

        return [
            {
                label: 'Ammo',
                value: 'weapon-ammo-dialog',
                displayType: 'button',
                readOnlySafe: context.isReadOnly(equipment),
            }
        ];
    }

    async handleSelection(equipment: MountedEquipment, choice: PickerChoice, context: HandlerCommandContext): Promise<boolean> {
        const equipmentCatalog = context.equipmentCatalog;
        const entries = getAmmoControlEntriesForWeapon(equipment, equipmentCatalog);
        if (entries.length === 0) return false;

        if (choice.value === 'weapon-ammo-dialog') {
            context.dialogsService.createDialog<void>(EquipmentDialogComponent, {
                data: {
                    unit: equipment.owner,
                    readOnly: equipment.owner.readOnly(),
                    context: {
                        registry: {
                            getChoices: () => [],
                            handleSelection: () => false,
                            afterInventoryControlFire: async () => [],
                            inventoryControlRules: () => ({})
                        },
                        queryContext: createHandlerQueryContext(equipmentCatalog),
                        commandContext: context,
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
