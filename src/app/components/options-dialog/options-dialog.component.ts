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

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OptionsService } from '../../services/options.service';
import { BaseDialogComponent } from '../base-dialog/base-dialog.component';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';

/*
 * Author: Drake
 */
@Component({
    selector: 'options-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, BaseDialogComponent],
    templateUrl: './options-dialog.component.html',
    styleUrls: ['./options-dialog.component.css']
})
export class OptionsDialogComponent {
    public optionsService = inject(OptionsService);
    dialogRef = inject(DialogRef<OptionsDialogComponent>);
    data = inject(DIALOG_DATA, { optional: true });

    userUuid = '';
    userUuidError = '';

    constructor() {
        this.userUuid = this.optionsService.options().uuid;
    }

    onClose() {
        this.dialogRef.close();
    }

    onSheetsColorChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'normal' | 'night';
        this.optionsService.setOption('sheetsColor', value);
    }

    onPickerStyleChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'radial' | 'linear';
        this.optionsService.setOption('pickerStyle', value);
    }

    onQuickActionsChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'enabled' | 'disabled';
        this.optionsService.setOption('quickActions', value);
    }

    onUserUuidInput(event: Event) {
        const value = (event.target as HTMLInputElement).value;
        this.userUuid = value;
        if (this.userUuidError) this.userUuidError = '';
    }

    selectAll(event: FocusEvent) {
        const input = event.target as HTMLInputElement;
        input.select();
    }

    onUserUuidKeydown(event: KeyboardEvent) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.userUuid = this.optionsService.options().uuid;
            this.userUuidError = '';
            (event.target as HTMLInputElement).blur();
        }
    }

    async onSetUuid() {
        const trimmed = this.userUuid.trim();
        if (trimmed.length === 0) {
            // Generate a new UUID if input is empty
            this.userUuid = crypto.randomUUID();
            this.userUuid = await this.optionsService.getOrCreateUuid(true);
        } else if (trimmed.length < 10 || trimmed.length > 40) {
            this.userUuidError = 'User Identifier must be between 10 and 40 characters long.';
            return;
        } else {
            this.userUuid = trimmed;
        }
        this.userUuidError = '';
        await this.optionsService.setOption('uuid', this.userUuid);
        window.location.reload();
    }
}