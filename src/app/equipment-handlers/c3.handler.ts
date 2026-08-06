// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { EquipmentInteractionHandler, type HandlerContext } from '../services/equipment-interaction-registry.service';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import type { PickerChoice } from '../components/picker/picker.interface';
import { firstValueFrom } from 'rxjs';
import { EquipmentFlag } from '../models/equipment-flags.type';

export class C3Handler extends EquipmentInteractionHandler {
    readonly id = 'c3-handler';
    override readonly flags: EquipmentFlag[] = ['ANY_C3'];
    override readonly priority = 10;

    getChoices(equipment: MountedEquipment, context: HandlerContext): PickerChoice[] {
        return [
            {
                label: 'Configure',
                value: 'c3-network-configuration',
                disabled: equipment.isUnavailable(),
                displayType: 'button'
            }
        ];
    }

    async handleSelection(equipment: MountedEquipment, choice: PickerChoice, context: HandlerContext): Promise<boolean> {
        if (choice.value !== 'c3-network-configuration') return false;

        const force = equipment.owner.force;
        if (!force) return true;

        const { C3NetworkDialogComponent } = await import('../components/c3-network-dialog/c3-network-dialog.component');
        type C3NetworkDialogData = import('../components/c3-network-dialog/c3-network-dialog.component').C3NetworkDialogData;
        type C3NetworkDialogResult = import('../components/c3-network-dialog/c3-network-dialog.component').C3NetworkDialogResult;
        const ref = context.dialogsService.createDialog<C3NetworkDialogResult>(C3NetworkDialogComponent, {
            data: <C3NetworkDialogData>{
                force: force,
                readOnly: equipment.owner.readOnly()
            },
            width: '100dvw',
            height: '100dvh',
            maxWidth: '100dvw',
            maxHeight: '100dvh',
            panelClass: 'c3-network-dialog-panel'
        });

        const result = await firstValueFrom(ref.closed);
        if (result?.updated) {
            force.setNetwork(result.networks);
            context.toastService.showToast('C3 network configuration changed', 'success');
        }

        return true;
    }
}
