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

import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild, computed, DestroyRef, Injector } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ComponentPortal } from '@angular/cdk/portal';
import { AS_PILOT_ABILITIES, ASPilotAbility } from '../../models/as-abilities.model';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import { AbilityDropdownPanelComponent } from './ability-dropdown-panel.component';

/*
 * Author: Drake
 */

export interface EditASPilotDialogData {
    name: string;
    skill: number;
    abilities: string[]; // Array of ability IDs
}

export interface EditASPilotResult {
    name: string;
    skill: number;
    abilities: string[]; // Array of ability IDs
}

@Component({
    selector: 'edit-as-pilot-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    templateUrl: './edit-as-pilot-dialog.component.html',
    styleUrl: './edit-as-pilot-dialog.component.scss'
})
export class EditASPilotDialogComponent {
    nameInput = viewChild.required<ElementRef<HTMLInputElement>>('nameInput');
    skillInput = viewChild.required<ElementRef<HTMLInputElement>>('skillInput');
    dropdownTrigger0 = viewChild<ElementRef<HTMLButtonElement>>('dropdownTrigger0');
    dropdownTrigger1 = viewChild<ElementRef<HTMLButtonElement>>('dropdownTrigger1');

    public dialogRef = inject(DialogRef<EditASPilotResult | null, EditASPilotDialogComponent>);
    readonly data: EditASPilotDialogData = inject(DIALOG_DATA) as EditASPilotDialogData;
    private overlayManager = inject(OverlayManagerService);
    private injector = inject(Injector);
    private destroyRef = inject(DestroyRef);

    availableAbilities = signal<ASPilotAbility[]>(AS_PILOT_ABILITIES);
    selectedAbilities = signal<(string | null)[]>([null, null]);
    openDropdown = signal<number | null>(null);

    totalCost = computed(() => {
        return this.selectedAbilities().reduce((sum, id) => {
            if (!id) return sum;
            const ability = this.getAbilityById(id);
            return sum + (ability?.cost || 0);
        }, 0);
    });

    constructor() {
        // Initialize with existing abilities from data
        const initialAbilities: (string | null)[] = [null, null];
        if (this.data.abilities && this.data.abilities.length > 0) {
            initialAbilities[0] = this.data.abilities[0] || null;
            if (this.data.abilities.length > 1) {
                initialAbilities[1] = this.data.abilities[1] || null;
            }
        }
        this.selectedAbilities.set(initialAbilities);

        // Cleanup overlays when dialog is destroyed
        this.destroyRef.onDestroy(() => {
            this.closeDropdownOverlay();
        });
    }

    private getDropdownTrigger(slot: number): ElementRef<HTMLButtonElement> | undefined {
        return slot === 0 ? this.dropdownTrigger0() : this.dropdownTrigger1();
    }

    private closeDropdownOverlay(): void {
        this.overlayManager.closeManagedOverlay('ability-dropdown');
        this.openDropdown.set(null);
    }

    getAbilityById(id: string | null): ASPilotAbility | undefined {
        if (!id) return undefined;
        return AS_PILOT_ABILITIES.find(a => a.id === id);
    }

    isAbilitySelected(id: string): boolean {
        return this.selectedAbilities().includes(id);
    }

    toggleDropdown(slot: number): void {
        if (this.openDropdown() === slot) {
            this.closeDropdownOverlay();
            return;
        }

        // Close any existing dropdown first
        this.closeDropdownOverlay();

        const trigger = this.getDropdownTrigger(slot);
        if (!trigger) return;

        // Get disabled ability IDs (abilities already selected in other slots)
        const disabledIds = this.selectedAbilities()
            .filter((id, idx) => id !== null && idx !== slot) as string[];

        const portal = new ComponentPortal(AbilityDropdownPanelComponent, null, this.injector);
        
        const compRef = this.overlayManager.createManagedOverlay(
            'ability-dropdown',
            trigger,
            portal,
            {
                closeOnOutsideClick: true,
                panelClass: 'ability-dropdown-overlay',
                matchTriggerWidth: true,
                fullHeight: true
            }
        );

        compRef.setInput('abilities', this.availableAbilities());
        compRef.setInput('disabledIds', disabledIds);

        // Handle selection
        compRef.instance.selected.subscribe((abilityId: string) => {
            this.selectAbility(slot, abilityId);
            this.closeDropdownOverlay();
        });

        this.openDropdown.set(slot);
    }

    selectAbility(slot: number, abilityId: string | null): void {
        // Don't allow selecting an already selected ability (unless it's the same slot)
        if (abilityId && this.isAbilitySelected(abilityId) && this.selectedAbilities()[slot] !== abilityId) {
            return;
        }

        const abilities = [...this.selectedAbilities()];
        abilities[slot] = abilityId;
        this.selectedAbilities.set(abilities);
    }

    removeAbility(slot: number): void {
        const abilities = [...this.selectedAbilities()];
        abilities[slot] = null;
        this.selectedAbilities.set(abilities);
    }

    submit() {
        const name = this.nameInput().nativeElement.value.trim();
        const skillValue = this.skillInput().nativeElement.value;
        const skill = Number(skillValue === '' ? this.data.skill : skillValue);
        const abilities = this.selectedAbilities().filter((a): a is string => a !== null);
        this.dialogRef.close({ name, skill, abilities });
    }

    close(value: null = null) {
        this.dialogRef.close(value);
    }
}
