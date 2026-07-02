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

import { ChangeDetectionStrategy, Component, computed, type ElementRef, inject, signal, viewChild } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import type { AmmoEquipment } from '../../models/equipment.model';
import type { Era } from '../../models/eras.model';
import type { MountedEquipment } from '../../models/force-serialization';
import type { UnitType } from '../../models/units.model';
import { DialogsService } from '../../services/dialogs.service';
import { AmmoValidityUtil } from '../../utils/ammo-validity.util';
import { SetAmmoDropdownComponent } from './set-ammo-dropdown.component';
import { AdvancementTimelineComponent, getEquipmentAdvancementTimeline, type EquipmentAdvancementTimeline } from './advancement-timeline.component';

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
    unitType?: UnitType;
    era?: Era | null;
    inventory?: readonly MountedEquipment[];
}

@Component({
    selector: 'set-ammo-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [SetAmmoDropdownComponent, AdvancementTimelineComponent],
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    template: `
    <div class="wide-dialog">
        <div class="wide-dialog-body">
            <div class="form-row">
                <div class="form-fields">
                    <label class="field-label">Ammo Type</label>
                    <set-ammo-dropdown
                        class="ammo-select"
                        controlId="inputName"
                        label="Ammo Type"
                        [options]="ammoOptions()"
                        [ammoSelectionStatus]="ammoSelectionStatus()"
                        [value]="selectedAmmoName()"
                        [currentAmmo]="data.currentAmmo"
                        [originalAmmo]="data.originalAmmo"
                        (valueChange)="setSelectedAmmo($event)"
                    />
                </div>
                <div class="form-fields ammo-quantity">
                    <label class="field-label">Quantity</label>
                    <div class="quantity-group">
                    <button class="bt-button square-small quantity-adjust" type="button" (click)="adjustQuantity(-1)">-</button>
                    <input
                        class="field-input"
                        #inputQuantityRef
                        type="number"
                        id="inputQuantity"
                        autocomplete="off"
                        [placeholder]="data.quantity"
                        [value]="data.quantity"
                        [attr.min]="0"
                        [attr.max]="currentMaxQuantity()"
                        (keydown.enter)="submit()"
                        required
                    />
                    <button class="bt-button square-small quantity-adjust" type="button" (click)="adjustQuantity(1)">+</button>
                    <span class="max-quantity">/{{ currentMaxQuantity() }}</span>
                    </div>
                </div>
            </div>
            <div class="ammo-info-section">
                @let issues = selectedAmmoSelectionIssues();
                @if (issues.length > 0) {
                    <div class="ammo-selection-issues">
                        @for (issue of issues; track issue.reason) {
                            <span class="ammo-selection-issue">{{ issue.message }}</span>
                        }
                    </div>
                }
                @let timeline = advancement();
                @if (timeline.timelines.length > 0) {
                    <advancement-timeline [slots]="timeline.slots" [timelines]="timeline.timelines" />
                }
                <!-- @for (group of selectedAmmoInfo(); track group.group) {
                    @if (group.group === 'History') {
                    } @else {
                        <div class="ammo-info-spec-grid">
                            @for (item of group.items; track item.label) {
                                <div class="ammo-info-spec">
                                    <span class="ammo-info-spec-label">{{ item.label }}</span>
                                    <span class="ammo-info-spec-value">{{ item.value }}</span>
                                </div>
                            }
                        </div>
                    }
                } -->
            </div>
        </div>
        <div class="wide-dialog-actions">
            <button (click)="submit()" class="bt-button">CONFIRM</button>
            <button (click)="dump()" class="bt-button danger">DUMP</button>
            <button (click)="close()" class="bt-button cancel">DISMISS</button>
        </div>
    </div>
    `,
    styles: [`
        @container (max-width: 400px) {
            .ammo-quantity {
                align-self: center;
            }
        }

        .ammo-select {
            width: 100%;
        }
        
        .ammo-quantity {
            flex: 0 0 auto;
        }

        .quantity-group {
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .max-quantity {
            font-size: 1.2em;
            color: var(--text-color-secondary);
            -webkit-user-select: none;
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

        #inputQuantity::-webkit-outer-spin-button,
        #inputQuantity::-webkit-inner-spin-button {
            -webkit-appearance: none;
            margin: 0;
        }

        .quantity-adjust {
            width: 32px;
            height: 32px;
            min-width: 32px;
        }

        .ammo-info-section {
            display: grid;
            gap: 8px;
            color: var(--text-color-secondary);
        }

        .ammo-selection-issues {
            display: grid;
            gap: 4px;
        }

        .ammo-selection-issue {
            display: block;
            color: re;
            font-size: 0.92em;
        }

        .ammo-info-spec-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
            gap: 8px;
        }

        .ammo-info-spec {
            display: grid;
            gap: 3px;
            min-width: 0;
            padding: 9px 10px;
            border: 1px solid rgba(255, 255, 255, 0.08);
            background: rgba(0, 0, 0, 0.22);
        }

        .ammo-info-spec-label {
            color: var(--text-color-secondary);
            font-size: 0.72em;
            font-weight: 700;
            letter-spacing: 0.04em;
            line-height: 1.1;
            text-transform: uppercase;
        }

        .ammo-info-spec-value {
            min-width: 0;
            color: var(--text-color);
            font-size: 1.02em;
            line-height: 1.2;
            overflow-wrap: anywhere;
        }

    `]
})

export class SetAmmoDialogComponent {
    private dialogsService = inject(DialogsService)
    inputQuantityRef = viewChild.required<ElementRef<HTMLInputElement>>('inputQuantityRef');
    public dialogRef: DialogRef<{name: string; quantity: number, totalAmmo: number} | null, SetAmmoDialogComponent> = inject(DialogRef);
    readonly data: SetAmmoDialogData = inject(DIALOG_DATA);
    public totalKgAvailable: number;
    
    selectedAmmoName = signal(this.data.currentAmmo.internalName);
    ammoOptions = computed(() => this.data.ammoOptions);
    ammoSelectionStatus = computed(() => AmmoValidityUtil.getAmmoSelectionStatus(this.ammoOptions(), this.data));
    selectedAmmo = computed(() => this.ammoOptions().find(
        ammo => ammo.internalName === this.selectedAmmoName()
    ) ?? this.data.currentAmmo);
    selectedAmmoSelectionIssues = computed(() => this.ammoSelectionStatus()[this.selectedAmmo().internalName]?.issues ?? []);
    advancement = computed<EquipmentAdvancementTimeline>(() => getEquipmentAdvancementTimeline(this.selectedAmmo()));
    
    public currentMaxQuantity = computed(() => {
        return Math.floor(this.totalKgAvailable / this.selectedAmmo().kgPerShot);
    });

    constructor() {
        this.totalKgAvailable = this.data.originalAmmo.kgPerShot * this.data.originalTotalAmmo;
    }

    setSelectedAmmo(internalName: string) {
        const previousMaxQuantity = this.currentMaxQuantity();
        this.selectedAmmoName.set(internalName);
        
        const nativeEl = this.inputQuantityRef().nativeElement;
        const currentQuantity = Number(nativeEl.value);
        const newMaxQuantity = this.currentMaxQuantity();
        if (currentQuantity === previousMaxQuantity) {
            nativeEl.value = newMaxQuantity.toString();
        } else if (currentQuantity > newMaxQuantity) {
            nativeEl.value = newMaxQuantity.toString();
        }
    }

    adjustQuantity(delta: number) {
        const nativeEl = this.inputQuantityRef().nativeElement;
        const currentQuantity = nativeEl.value === '' ? this.data.quantity : Number(nativeEl.value);
        if (isNaN(currentQuantity)) return;

        const nextQuantity = Math.max(0, Math.min(this.currentMaxQuantity(), currentQuantity + delta));
        nativeEl.value = nextQuantity.toString();
    }

    async dump() {
        const result = await this.dialogsService.requestConfirmation('Are you sure you want to dump all ammo?', 'Confirm Dump', 'danger')
        if (result) {
            this.dialogRef.close({ name: this.data.currentAmmo.internalName, quantity: 0, totalAmmo: this.data.quantity });
        }
    }

    submit() {
        const selectedInternalName = this.selectedAmmoName();
        let selectedAmmo = this.ammoOptions().find(
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