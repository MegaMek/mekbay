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

import { Component, inject, signal, ChangeDetectionStrategy, computed, Injector, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ComponentPortal } from '@angular/cdk/portal';
import { outputToObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { BaseDialogComponent } from '../base-dialog/base-dialog.component';
import { DataService } from '../../services/data.service';
import { ForceBuilderService } from '../../services/force-builder.service';
import { DialogsService } from '../../services/dialogs.service';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import { LayoutService } from '../../services/layout.service';
import { TaggingService } from '../../services/tagging.service';
import { UnitCardCompactComponent } from '../unit-card-compact/unit-card-compact.component';
import { UnitDetailsDialogComponent, UnitDetailsDialogData } from '../unit-details-dialog/unit-details-dialog.component';
import { VariantDropdownPanelComponent } from './variant-dropdown-panel.component';
import { Unit } from '../../models/units.model';
import { PackUnitEntry, ResolvedPack } from '../../utils/force-pack.util';
import { compareUnitsByName } from '../../utils/sort.util';
import { TagClickEvent } from '../unit-tags/unit-tags.component';
import { GameSystem } from '../../models/common.model';

/*
 * Author: Drake
 */

export interface CustomizeForcePackDialogData {
    pack: ResolvedPack;
}

export interface CustomizeForcePackDialogResult {
    units: PackUnitEntry[];
}

interface CustomizableUnit extends PackUnitEntry {
    originalUnit: Unit | null;  // The original unit from the force pack
    index: number;              // Position in the pack
}

@Component({
    selector: 'customize-force-pack-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, BaseDialogComponent, UnitCardCompactComponent, VariantDropdownPanelComponent],
    templateUrl: './customize-force-pack-dialog.component.html',
    styleUrls: ['./customize-force-pack-dialog.component.css']
})
export class CustomizeForcePackDialogComponent {
    private dialogRef = inject(DialogRef<CustomizeForcePackDialogResult | null>);
    private data = inject<CustomizeForcePackDialogData>(DIALOG_DATA);
    private dataService = inject(DataService);
    private dialogsService = inject(DialogsService);
    private overlayManager = inject(OverlayManagerService);
    private injector = inject(Injector);
    private destroyRef = inject(DestroyRef);
    private taggingService = inject(TaggingService);
    layoutService = inject(LayoutService);
    forceBuilderService = inject(ForceBuilderService);
    ALPHA_STRIKE = GameSystem.ALPHA_STRIKE;

    // The pack we're customizing
    pack = this.data.pack;

    // Editable units (copy of pack units with tracking)
    customizableUnits = signal<CustomizableUnit[]>(
        this.pack.units.map((u, i) => ({
            ...u,
            originalUnit: u.unit ?? null,
            index: i
        }))
    );

    // Track which unit has dropdown open (used for both docked panel and overlay)
    openDropdownIndex = signal<number | null>(null);

    // Variants for selected unit (used by docked panel on non-phone layouts)
    variantsForSelected = computed<Unit[]>(() => {
        const idx = this.openDropdownIndex();
        if (idx === null) return [];
        
        const unit = this.customizableUnits()[idx];
        if (!unit?.unit) return [];
        
        const targetType = unit.unit.type;
        const targetChassis = unit.unit.chassis;
        
        return this.dataService.getUnits()
            .filter(u => u.type === targetType && u.chassis === targetChassis)
            .sort((a, b) => {
                // Sort by year first, then by name
                const yearDiff = (a.year ?? 0) - (b.year ?? 0);
                if (yearDiff !== 0) return yearDiff;
                return compareUnitsByName(a, b);
            });
    });

    // Computed total BV/PV
    totalBV = computed(() => 
        this.customizableUnits().reduce((sum, u) => sum + (u.unit?.bv ?? 0), 0)
    );
    
    totalPV = computed(() => 
        this.customizableUnits().reduce((sum, u) => sum + (u.unit?.as?.PV ?? 0), 0)
    );

    // Check if any unit has been modified
    hasChanges = computed(() => {
        const units = this.customizableUnits();
        return units.some(u => u.unit?.name !== u.originalUnit?.name);
    });

    constructor() {
        this.destroyRef.onDestroy(() => this.closeDropdown());
    }

    onUnitClick(index: number): void {
        const current = this.openDropdownIndex();
        if (current === index) {
            // Clicking same unit closes the picker
            this.closeDropdown();
        } else {
            this.openDropdown(index);
        }
    }

    private openDropdown(index: number): void {
        this.closeDropdown();
        
        const unit = this.customizableUnits()[index];
        if (!unit?.unit) return;

        // On non-phone layouts, just set the index - the docked panel will show via template
        if (!this.layoutService.isPhone()) {
            this.openDropdownIndex.set(index);
            return;
        }

        // Phone mode: use centered overlay
        const targetType = unit.unit.type;
        const targetChassis = unit.unit.chassis;
        const variants = this.dataService.getUnits()
            .filter(u => u.type === targetType && u.chassis === targetChassis)
            .sort(compareUnitsByName);

        if (variants.length === 0) return;

        // Create portal
        const portal = new ComponentPortal(
            VariantDropdownPanelComponent,
            null,
            this.injector
        );

        // Create overlay centered in viewport (pass null for target)
        const { componentRef } = this.overlayManager.createManagedOverlay(
            'variant-dropdown',
            null,
            portal,
            {
                closeOnOutsideClick: true,
                panelClass: 'variant-dropdown-overlay',
                hasBackdrop: true,
                backdropClass: 'cdk-overlay-dark-backdrop'
            }
        );
        
        // Set inputs
        componentRef.setInput('variants', variants);
        componentRef.setInput('originalUnitName', unit.originalUnit?.name ?? null);
        componentRef.setInput('currentUnitName', unit.unit?.name ?? null);

        // Handle selection - cleanup when dialog closes
        outputToObservable(componentRef.instance.selected).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((variant: Unit) => {
            this.selectVariant(index, variant);
            this.closeDropdown();
        });

        // Handle info request - cleanup when dialog closes
        outputToObservable(componentRef.instance.infoRequested).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((variant: Unit) => {
            this.showVariantInfo(variant, variants, index);
        });

        this.openDropdownIndex.set(index);
    }

    private closeDropdown(): void {
        this.overlayManager.closeManagedOverlay('variant-dropdown');
        this.openDropdownIndex.set(null);
    }

    private selectVariant(index: number, variant: Unit): void {
        this.customizableUnits.update(units => {
            const updated = [...units];
            updated[index] = {
                ...updated[index],
                unit: variant,
                chassis: variant.chassis,
                model: variant.model
            };
            return updated;
        });
    }

    /** Handler for docked panel variant selection */
    onDockedVariantSelect(variant: Unit): void {
        const idx = this.openDropdownIndex();
        if (idx === null) return;
        this.selectVariant(idx, variant);
        this.closeDropdown();
    }

    /** Handler for docked panel info request */
    onDockedVariantInfo(variant: Unit): void {
        const idx = this.openDropdownIndex();
        if (idx === null) return;
        this.showVariantInfo(variant, this.variantsForSelected(), idx);
    }

    onReset(): void {
        this.closeDropdown();
        this.customizableUnits.set(
            this.pack.units.map((u, i) => ({
                ...u,
                originalUnit: u.unit ?? null,
                index: i
            }))
        );
    }

    onAdd(): void {
        this.closeDropdown();
        const result: CustomizeForcePackDialogResult = {
            units: this.customizableUnits().map(u => ({
                chassis: u.chassis,
                model: u.model,
                unit: u.unit
            }))
        };
        this.dialogRef.close(result);
    }

    onDismiss(): void {
        this.closeDropdown();
        this.dialogRef.close(null);
    }

    /** Open unit details for a variant in the dropdown - SELECT selects the unit */
    private async showVariantInfo(variant: Unit, variants: Unit[], unitIndex: number): Promise<void> {
        const variantIdx = variants.findIndex(v => v.name === variant.name);

        const ref = this.dialogsService.createDialog(
            UnitDetailsDialogComponent,
            {
                data: {
                    unitList: variants,
                    unitIndex: variantIdx >= 0 ? variantIdx : 0,
                    hideAddButton: true,
                    selectMode: true
                } as UnitDetailsDialogData
            }
        );

        // When SELECT is clicked in unit-details, select that variant
        outputToObservable(ref.componentInstance!.select).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((selectedUnit: Unit) => {
            this.selectVariant(unitIndex, selectedUnit);
            this.closeDropdown();
            ref.close();
        });
    }

    /** Open unit details for a unit in the force pack view - ADD is hidden */
    async onForcePackUnitInfo(unitIndex: number): Promise<void> {
        this.closeDropdown();
        
        const units = this.customizableUnits()
            .map(u => u.unit)
            .filter((u): u is Unit => u !== null && u !== undefined);
        
        if (units.length === 0) return;

        // Find the actual index in the filtered list
        let actualIndex = 0;
        let count = 0;
        for (let i = 0; i < this.customizableUnits().length; i++) {
            if (this.customizableUnits()[i].unit) {
                if (i === unitIndex) {
                    actualIndex = count;
                    break;
                }
                count++;
            }
        }

        const ref = this.dialogsService.createDialog<UnitDetailsDialogComponent>(
            UnitDetailsDialogComponent,
            {
                data: {
                    unitList: units,
                    unitIndex: actualIndex,
                    hideAddButton: true
                } as UnitDetailsDialogData
            }
        );

        await firstValueFrom(ref.closed);
    }

    /** Handle tag click on a unit */
    async onAddTag({ unit, event }: TagClickEvent): Promise<void> {
        const evtTarget = (event.currentTarget as HTMLElement) || (event.target as HTMLElement);
        const anchorEl = (evtTarget.closest('.add-tag-btn') as HTMLElement) || evtTarget;
        await this.taggingService.openTagSelectorForUnit(unit, anchorEl);
    }
}
