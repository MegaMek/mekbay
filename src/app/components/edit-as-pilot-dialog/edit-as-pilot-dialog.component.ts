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
import { AS_PILOT_ABILITIES, ASPilotAbility, ASCustomPilotAbility } from '../../models/as-abilities.model';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import { AbilityDropdownPanelComponent } from './ability-dropdown-panel.component';
import { CustomAbilityDialogComponent } from './custom-ability-dialog.component';

/*
 * Author: Drake
 */

/** Represents either a standard ability (by ID) or a custom ability (object) */
export type AbilitySelection = string | ASCustomPilotAbility;

export interface EditASPilotDialogData {
    name: string;
    skill: number;
    abilities: AbilitySelection[]; // Array of ability IDs or custom abilities
}

export interface EditASPilotResult {
    name: string;
    skill: number;
    abilities: AbilitySelection[]; // Array of ability IDs or custom abilities
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
    selectedAbilities = signal<(AbilitySelection | null)[]>([null, null]);
    openDropdown = signal<number | null>(null);

    totalCost = computed(() => {
        return this.selectedAbilities().reduce((sum, ability) => {
            if (!ability) return sum;
            if (this.isCustomAbility(ability)) {
                return sum + ability.cost;
            }
            const standardAbility = this.getAbilityById(ability);
            return sum + (standardAbility?.cost || 0);
        }, 0);
    });

    constructor() {
        // Initialize with existing abilities from data
        const initialAbilities: (AbilitySelection | null)[] = [null, null];
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
            this.closeCustomAbilityOverlay();
        });
    }

    /** Type guard: check if an ability selection is a custom ability */
    isCustomAbility(ability: AbilitySelection | null): ability is ASCustomPilotAbility {
        return ability !== null && typeof ability === 'object';
    }

    /** Get display info for any ability selection */
    getAbilityDisplayInfo(ability: AbilitySelection | null): { name: string; cost: number; summary: string; isCustom: boolean; rulesInfo?: string } | null {
        if (!ability) return null;
        
        if (this.isCustomAbility(ability)) {
            return {
                name: ability.name,
                cost: ability.cost,
                summary: ability.summary,
                isCustom: true
            };
        }
        
        const standardAbility = this.getAbilityById(ability);
        if (!standardAbility) return null;
        
        return {
            name: standardAbility.name,
            cost: standardAbility.cost,
            summary: standardAbility.summary[0],
            isCustom: false,
            rulesInfo: `${standardAbility.rulesBook}, p.${standardAbility.rulesPage}`
        };
    }

    private getDropdownTrigger(slot: number): ElementRef<HTMLButtonElement> | undefined {
        return slot === 0 ? this.dropdownTrigger0() : this.dropdownTrigger1();
    }

    private closeDropdownOverlay(): void {
        this.overlayManager.closeManagedOverlay('ability-dropdown');
        this.openDropdown.set(null);
    }

    private closeCustomAbilityOverlay(): void {
        this.overlayManager.closeManagedOverlay('custom-ability-dialog');
    }

    getAbilityById(id: string | null): ASPilotAbility | undefined {
        if (!id) return undefined;
        return AS_PILOT_ABILITIES.find(a => a.id === id);
    }

    isAbilitySelected(id: string): boolean {
        return this.selectedAbilities().some(ability => ability === id);
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

        // Get disabled ability IDs (standard abilities already selected in other slots)
        const disabledIds = this.selectedAbilities()
            .filter((ability, idx): ability is string => 
                ability !== null && typeof ability === 'string' && idx !== slot
            );

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

        // Handle standard ability selection
        compRef.instance.selected.subscribe((abilityId: string) => {
            this.selectAbility(slot, abilityId);
            this.closeDropdownOverlay();
        });

        // Handle custom ability request
        compRef.instance.addCustom.subscribe(() => {
            this.closeDropdownOverlay();
            this.openCustomAbilityDialog(slot);
        });

        this.openDropdown.set(slot);
    }

    private openCustomAbilityDialog(slot: number, existingAbility?: ASCustomPilotAbility): void {
        const portal = new ComponentPortal(CustomAbilityDialogComponent, null, this.injector);
        
        const compRef = this.overlayManager.createManagedOverlay(
            'custom-ability-dialog',
            null, // centered
            portal,
            {
                hasBackdrop: true,
                backdropClass: 'cdk-overlay-dark-backdrop',
                closeOnOutsideClick: true
            }
        );

        // Set initial ability if editing
        if (existingAbility) {
            compRef.setInput('initialAbility', existingAbility);
        }

        compRef.instance.submitted.subscribe((customAbility: ASCustomPilotAbility) => {
            this.selectAbility(slot, customAbility);
            this.closeCustomAbilityOverlay();
        });

        compRef.instance.cancelled.subscribe(() => {
            this.closeCustomAbilityOverlay();
        });
    }

    /** Opens the edit dialog for a custom ability in the specified slot */
    editCustomAbility(slot: number): void {
        const ability = this.selectedAbilities()[slot];
        if (this.isCustomAbility(ability)) {
            this.openCustomAbilityDialog(slot, ability);
        }
    }

    selectAbility(slot: number, ability: AbilitySelection | null): void {
        // For standard abilities, don't allow selecting an already selected one
        if (typeof ability === 'string' && this.isAbilitySelected(ability) && this.selectedAbilities()[slot] !== ability) {
            return;
        }

        const abilities = [...this.selectedAbilities()];
        abilities[slot] = ability;
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
        const abilities = this.selectedAbilities().filter((a): a is AbilitySelection => a !== null);
        this.dialogRef.close({ name, skill, abilities });
    }

    close(value: null = null) {
        this.dialogRef.close(value);
    }
}
