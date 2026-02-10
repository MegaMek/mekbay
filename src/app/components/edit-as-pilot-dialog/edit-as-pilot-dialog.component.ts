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
import { PILOT_ABILITIES, PilotAbility, ASCustomPilotAbility, getAbilityLimitsForSkill, PilotAbilityLimits } from '../../models/pilot-abilities.model';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import { AbilityDropdownPanelComponent } from './ability-dropdown-panel.component';
import { CustomAbilityDialogComponent } from './custom-ability-dialog.component';
import { outputToObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RulesReference } from '../../models/common.model';

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
    dropdownTrigger2 = viewChild<ElementRef<HTMLButtonElement>>('dropdownTrigger2');

    public dialogRef = inject(DialogRef<EditASPilotResult | null, EditASPilotDialogComponent>);
    readonly data: EditASPilotDialogData = inject(DIALOG_DATA) as EditASPilotDialogData;
    private overlayManager = inject(OverlayManagerService);
    private injector = inject(Injector);
    private destroyRef = inject(DestroyRef);

    availableAbilities = signal<PilotAbility[]>(PILOT_ABILITIES);
    selectedAbilities = signal<(AbilitySelection | null)[]>([null, null, null]);
    openDropdown = signal<number | null>(null);
    currentSkill = signal<number>(4);

    abilityLimits = computed<PilotAbilityLimits>(() => {
        return getAbilityLimitsForSkill(this.currentSkill());
    });

    currentAbilityCount = computed(() => {
        return this.selectedAbilities().filter(a => a !== null).length;
    });

    remainingCost = computed(() => {
        return this.abilityLimits().maxCost - this.totalCost();
    });

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
        // Initialize skill first (needed for limits calculation)
        this.currentSkill.set(this.data.skill);

        // Initialize with existing abilities from data (max 3 slots)
        const initialAbilities: (AbilitySelection | null)[] = [null, null, null];
        if (this.data.abilities && this.data.abilities.length > 0) {
            for (let i = 0; i < Math.min(this.data.abilities.length, 3); i++) {
                initialAbilities[i] = this.data.abilities[i] || null;
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
    getAbilityDisplayInfo(ability: AbilitySelection | null): { name: string; cost: number; summary: string; isCustom: boolean; rulesRef?: RulesReference[] } | null {
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
            rulesRef: standardAbility.rulesRef
        };
    }

    private getDropdownTrigger(slot: number): ElementRef<HTMLButtonElement> | undefined {
        switch (slot) {
            case 0: return this.dropdownTrigger0();
            case 1: return this.dropdownTrigger1();
            case 2: return this.dropdownTrigger2();
            default: return undefined;
        }
    }

    private closeDropdownOverlay(): void {
        this.overlayManager.closeManagedOverlay('ability-dropdown');
        this.openDropdown.set(null);
    }

    private closeCustomAbilityOverlay(): void {
        this.overlayManager.closeManagedOverlay('custom-ability-dialog');
    }

    getAbilityById(id: string | null): PilotAbility | undefined {
        if (!id) return undefined;
        return PILOT_ABILITIES.find(a => a.id === id);
    }

    isAbilitySelected(id: string): boolean {
        return this.selectedAbilities().some(ability => ability === id);
    }

    /** Check if an ability can be afforded within remaining cost budget */
    canAffordAbility(cost: number): boolean {
        return cost <= this.remainingCost();
    }

    /** Check if another ability slot can be used */
    canAddMoreAbilities(): boolean {
        return this.currentAbilityCount() < this.abilityLimits().maxAbilities;
    }

    /** Handle skill input change to update limits */
    onSkillChange(event: Event): void {
        const input = event.target as HTMLInputElement;
        const newSkill = Number(input.value);
        if (!isNaN(newSkill) && newSkill >= 0 && newSkill <= 8) {
            this.currentSkill.set(newSkill);
            // Clear abilities that exceed new limits
            this.enforceAbilityLimits();
        }
    }

    /** Remove abilities that exceed current skill limits */
    private enforceAbilityLimits(): void {
        const limits = this.abilityLimits();
        const abilities = [...this.selectedAbilities()];
        let changed = false;

        // Remove abilities beyond max count (from the end)
        const activeAbilities = abilities.filter(a => a !== null);
        if (activeAbilities.length > limits.maxAbilities) {
            let removed = 0;
            for (let i = abilities.length - 1; i >= 0 && removed < activeAbilities.length - limits.maxAbilities; i--) {
                if (abilities[i] !== null) {
                    abilities[i] = null;
                    removed++;
                    changed = true;
                }
            }
        }

        // Check if total cost exceeds limit and remove from end
        let totalCost = this.calculateTotalCost(abilities);
        while (totalCost > limits.maxCost) {
            for (let i = abilities.length - 1; i >= 0; i--) {
                if (abilities[i] !== null) {
                    abilities[i] = null;
                    changed = true;
                    break;
                }
            }
            totalCost = this.calculateTotalCost(abilities);
        }

        if (changed) {
            this.selectedAbilities.set(abilities);
        }
    }

    private calculateTotalCost(abilities: (AbilitySelection | null)[]): number {
        return abilities.reduce((sum, ability) => {
            if (!ability) return sum;
            if (this.isCustomAbility(ability)) {
                return sum + ability.cost;
            }
            const standardAbility = this.getAbilityById(ability);
            return sum + (standardAbility?.cost || 0);
        }, 0);
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
        
        const { componentRef } = this.overlayManager.createManagedOverlay(
            'ability-dropdown',
            trigger,
            portal,
            {
                closeOnOutsideClick: true,
                panelClass: 'ability-dropdown-overlay',
                matchTriggerWidth: true,
                anchorActiveSelector: '.dropdown-option:first-child'
            }
        );

        componentRef.setInput('abilities', this.availableAbilities());
        componentRef.setInput('disabledIds', disabledIds);
        componentRef.setInput('remainingCost', this.remainingCost());

        // Handle standard ability selection - cleanup when dialog closes
        outputToObservable(componentRef.instance.selected).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((abilityId: string) => {
            this.selectAbility(slot, abilityId);
            this.closeDropdownOverlay();
        });

        // Handle custom ability request - cleanup when dialog closes
        outputToObservable(componentRef.instance.addCustom).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
            this.closeDropdownOverlay();
            this.openCustomAbilityDialog(slot);
        });

        this.openDropdown.set(slot);
    }

    private openCustomAbilityDialog(slot: number, existingAbility?: ASCustomPilotAbility): void {
        const portal = new ComponentPortal(CustomAbilityDialogComponent, null, this.injector);
        
        const { componentRef } = this.overlayManager.createManagedOverlay(
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
            componentRef.setInput('initialAbility', existingAbility);
        }

        // Handle submission - cleanup when dialog closes
        outputToObservable(componentRef.instance.submitted).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((customAbility: ASCustomPilotAbility) => {
            this.selectAbility(slot, customAbility);
            this.closeCustomAbilityOverlay();
        });

        // Handle cancellation - cleanup when dialog closes
        outputToObservable(componentRef.instance.cancelled).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
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
