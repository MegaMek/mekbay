// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { EquipmentInteractionHandler, type HandlerChoice, type HandlerCommandContext, type HandlerQueryContext } from '../services/equipment-interaction-registry.service';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import type { PickerChoice } from '../components/picker/picker.interface';
import { firstValueFrom } from 'rxjs';
import { EquipmentFlag } from '../models/equipment-flags.type';

export class C3Handler extends EquipmentInteractionHandler {
    readonly id = 'c3-handler';
    override readonly flags: EquipmentFlag[] = ['ANY_C3'];
    override readonly priority = 10;

    getChoices(_equipment: MountedEquipment, _context: HandlerQueryContext): HandlerChoice[] {
        return [
            {
                label: 'Configure',
                value: 'c3-network-configuration',
                action: 'configure-network',
                readOnlySafe: true,
                displayType: 'button'
            }
        ];
    }

    async handleSelection(equipment: MountedEquipment, choice: PickerChoice, context: HandlerCommandContext): Promise<boolean> {
        if (choice.value !== 'c3-network-configuration') return false;

        const force = equipment.owner.force;
        if (!force) return true;

        const { C3NetworkDialogComponent } = await import('../components/c3-network-dialog/c3-network-dialog.component');
        type C3NetworkDialogData = import('../components/c3-network-dialog/c3-network-dialog.component').C3NetworkDialogData;
        type C3NetworkDialogResult = import('../components/c3-network-dialog/c3-network-dialog.component').C3NetworkDialogResult;
        const readOnly = equipment.owner.readOnly();
        const ref = context.dialogsService.createDialog<C3NetworkDialogResult>(C3NetworkDialogComponent, {
            data: <C3NetworkDialogData>{
                force: force,
                readOnly
            },
            width: '100dvw',
            height: '100dvh',
            maxWidth: '100dvw',
            maxHeight: '100dvh',
            panelClass: 'c3-network-dialog-panel'
        });

        const result = await firstValueFrom(ref.closed);
        if (!readOnly && result?.updated) {
            force.setNetwork(result.networks);
            context.toastService.showToast('C3 network configuration changed', 'success');
        }

        return true;
    }
}
