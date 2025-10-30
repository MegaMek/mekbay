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

import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { AmmoEquipment } from '../../models/equipment.model';
import { DialogsService } from '../../services/dialogs.service';

/*
 * Author: Drake
 */
export interface SetAmmoDialogData {
    currentAmmo: AmmoEquipment;
    originalAmmo: AmmoEquipment;
    originalTotalAmmo: number;
    ammoOptions: AmmoEquipment[];
    quantity: number;
    maxQuantity: number;
}

@Component({
    selector: 'set-ammo-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule],
    template: `
    <div class="content">
        <div dialog-content>
            <select
                #inputNameRef
                id="inputName"
                (change)="onAmmoTypeChange($event)"
                required
            >
                @for (ammo of data.ammoOptions; let i = $index; track i) {
                    <option
                        [value]="ammo.internalName"
                        [selected]="ammo.internalName === data.currentAmmo.internalName"
                    >
                    @if (mixedTechBase() && ammo.base !== 'All') {
                        [{{ ammo.base === 'IS' ? 'IS' : ammo.base === 'Clan' ? 'CL' : '*' }}]&nbsp;
                    }
                    {{ ammo.shortName }}
                    @if (data.ammoOptions.length > 1 
                    && ammo.internalName === data.originalAmmo.internalName 
                    && data.originalAmmo.internalName != data.currentAmmo.internalName){&nbsp;★}
                    </option>
                }
            </select>
            <div class="quantity-group">
                <input
                    #inputQuantityRef
                    type="number"
                    id="inputQuantity"
                    [placeholder]="data.quantity"
                    [value]="data.quantity"
                    [attr.min]="0"
                    [attr.max]="currentMaxQuantity()"
                    (keydown.enter)="submit()"
                    required
                />
                <span class="max-quantity">/{{ currentMaxQuantity() }}</span>
            </div>
        </div>
        <div dialog-actions>
            <button (click)="submit()" class="bt-button">CONFIRM</button>
            <button (click)="dump()" class="bt-button danger">DUMP</button>
            <button (click)="close()" class="bt-button cancel">DISMISS</button>
        </div>
    </div>
    `,
    styles: [`
        :host {
            display: flex;
            justify-content: center;
            box-sizing: border-box;
            background-color: rgba(45, 45, 45, 0.8);
            backdrop-filter: blur(5px);
            width: 100vw;
            pointer-events: auto;
            padding: 16px;
        }

        :host-context(.cdk-overlay-pane) {
            transform: translateY(-10vh);
        }

        .content {
            display: block;
            max-width: 1000px;
            text-align: center;
        }

        h2 {
            margin-top: 8px;
            margin-bottom: 8px;
        }

        [dialog-content] {
            display: flex;
            flex-direction: row;
            align-items: center;    
            justify-content: center;
            max-width: 500px;
            width: 90vw;
            gap: 8px;
            flex-wrap: wrap;
        }

        [dialog-content] input,
        [dialog-content] select {
            margin-bottom: 16px;
            font-size: 1.5em;
            background: var(--background-input);
            color: white;
            border: 0;
            border-bottom: 1px solid #666;
            outline: none;
            transition: all 0.2s ease-in-out;    
        }

        [dialog-content] input:focus,
        [dialog-content] select:focus {
            border-bottom: 1px solid #fff;
            outline: none;
        }

        #inputName {
            text-align: left;
            flex: 1 1 auto;
            min-width: 200px;
            max-width: 500px;
        }

        .quantity-group {
            display: flex;
            align-items: baseline;
            gap: 2px;
        }
                    
        .max-quantity {
            font-size: 1.2em;
            color: var(--text-color-secondary);
            user-select: none;
            pointer-events: none;
        }

        #inputQuantity {
            text-align: right;
            flex: 0 0 auto;
            min-width: 60px;
            max-width: 60px;
            width: 60px;
            -webkit-appearance: none;
            -moz-appearance: textfield;
            appearance: textfield;
        }

        [dialog-content] input[type="number"]::-webkit-outer-spin-button,
        [dialog-content] input[type="number"]::-webkit-inner-spin-button {
            -webkit-appearance: none;
            margin: 0;
        }

        [dialog-actions] {
            padding-top: 8px;
            display: flex;
            gap: 8px;
            justify-content: center;
            flex-wrap: wrap;
        }

        [dialog-actions] button {
            padding: 8px;
            min-width: 100px;
        }
            
        @media (max-width: 500px) {
            [dialog-content] {
                flex-direction: column;
            }            
            #inputName {
                text-align: center;
                width: 100%;
            }
        }
    `]
})

export class SetAmmoDialogComponent {
    private dialogsService = inject(DialogsService)
    inputNameRef = viewChild.required<ElementRef<HTMLSelectElement>>('inputNameRef');
    inputQuantityRef = viewChild.required<ElementRef<HTMLInputElement>>('inputQuantityRef');
    public dialogRef: DialogRef<{name: string; quantity: number, totalAmmo: number} | null, SetAmmoDialogComponent> = inject(DialogRef);
    readonly data: SetAmmoDialogData = inject(DIALOG_DATA);
    public totalKgAvailable: number;
    
    // Add a signal to track the currently selected ammo
    private selectedAmmoName = signal(this.data.currentAmmo.internalName);
    mixedTechBase = computed(() => {
        return this.data.ammoOptions.some(ammo => ammo.base === 'Clan') &&
            this.data.ammoOptions.some(ammo => ammo.base === 'IS');
    });
    
    // Computed property for current max quantity
    public currentMaxQuantity = computed(() => {
        const selectedAmmo = this.data.ammoOptions.find(
            ammo => ammo.internalName === this.selectedAmmoName()
        );
        if (selectedAmmo) {
            return Math.floor(this.totalKgAvailable / selectedAmmo.kgPerShot);
        }
        return this.data.maxQuantity;
    });

    constructor() {
        this.totalKgAvailable = this.data.originalAmmo.kgPerShot * this.data.originalTotalAmmo;
    }

    // Add method to handle ammo type change
    onAmmoTypeChange(event: Event) {
        const selectElement = event.target as HTMLSelectElement;
        const previousMaxQuantity = this.currentMaxQuantity();
        this.selectedAmmoName.set(selectElement.value);
        
        // Reset quantity input to not exceed new max
        const nativeEl = this.inputQuantityRef().nativeElement;
        const currentQuantity = Number(nativeEl.value);
        const newMaxQuantity = this.currentMaxQuantity();
        if (currentQuantity === previousMaxQuantity) {
            nativeEl.value = newMaxQuantity.toString();
        } else if (currentQuantity > newMaxQuantity) {
            nativeEl.value = newMaxQuantity.toString();
        }
    }

    async dump() {
        const result = await this.dialogsService.showQuestion('Are you sure you want to dump all ammo?', 'Confirm Dump', 'danger')
        if (result === 'yes') {
            this.dialogRef.close({ name: this.data.currentAmmo.internalName, quantity: 0, totalAmmo: this.data.quantity });
        }
    }

    submit() {
        const selectedInternalName = this.inputNameRef().nativeElement.value;
        let selectedAmmo = this.data.ammoOptions.find(
            ammo => ammo.internalName === selectedInternalName
        );
        let quantity = this.inputQuantityRef().nativeElement.value;
        let num: number;
        if (quantity === '') {
            num = this.data.quantity;
        } else {
            num = Number(quantity);
        }
        if (isNaN(num)) return;
        if (!selectedAmmo) {
            selectedAmmo = this.data.originalAmmo;
        }
        this.dialogRef.close({ name: selectedAmmo.internalName, quantity: num, totalAmmo: num });
    }

    close() {
        this.dialogRef.close(null);
    }
}