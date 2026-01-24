/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import { EquipmentInteractionHandler, HandlerContext } from '../services/equipment-interaction-registry.service';
import { MountedEquipment } from '../models/force-serialization';
import { PickerChoice } from '../components/picker/picker.interface';
import { ALL_C3_FLAGS } from '../models/c3-network.model';
import { C3NetworkDialogComponent, C3NetworkDialogData, C3NetworkDialogResult } from '../components/c3-network-dialog/c3-network-dialog.component';
import { firstValueFrom } from 'rxjs';

export class C3Handler extends EquipmentInteractionHandler {
    readonly id = 'c3-handler';
    readonly flags: string[] = ['ANY_C3'];
    override readonly priority = 10;

    getChoices(equipment: MountedEquipment, context: HandlerContext): PickerChoice[] {
        return [
            {
                label: 'Configure network',
                value: 'c3-network-configuration',
                disabled: equipment.destroyed,
                displayType: 'button'
            }
        ];
    }

    async handleSelection(equipment: MountedEquipment, choice: PickerChoice, context: HandlerContext): Promise<boolean> {
        if (choice.value !== 'c3-network-configuration') return false;

        const force = equipment.owner.force;
        if (!force) return true;

        const ref = context.dialogsService.createDialog<C3NetworkDialogResult>(C3NetworkDialogComponent, {
            data: <C3NetworkDialogData>{
                units: force.units,
                networks: force.c3Networks,
                readOnly: equipment.owner.readOnly(),
                gameSystem: force.gameSystem
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
