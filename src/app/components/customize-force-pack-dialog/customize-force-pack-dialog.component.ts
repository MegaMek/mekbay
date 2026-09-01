// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Component, inject, signal, ChangeDetectionStrategy, computed, Injector, DestroyRef } from '@angular/core';
import { DecimalPipe } from '@angular/common';
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
import { UnitDetailsDialogComponent, type UnitDetailsDialogData } from '../unit-details-dialog/unit-details-dialog.component';
import { VariantDropdownPanelComponent } from './variant-dropdown-panel.component';
import type { UnitSummary } from '../../models/unit-summary.model';
import { type PackUnitEntry, type ResolvedPack } from '../../utils/force-pack.util';
import { isSameVariantGroup } from '../../utils/unit-variant.util';
import { compareUnitsByName } from '../../utils/sort.util';
import type { TagClickEvent } from '../unit-tags/unit-tags.component';
import { GameSystem } from '../../models/common.model';
import { GameService } from '../../services/game.service';



export interface CustomizeForcePackDialogData {
    pack: ResolvedPack;
}

export interface CustomizeForcePackDialogResult {
    units: PackUnitEntry[];
}

interface CustomizableUnit extends PackUnitEntry {
    originalUnit: UnitSummary | null;  // The original unit from the force pack
    index: number;              // Position in the pack
}

@Component({
    selector: 'customize-force-pack-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DecimalPipe, BaseDialogComponent, UnitCardCompactComponent, VariantDropdownPanelComponent],
    templateUrl: './customize-force-pack-dialog.component.html',
    styleUrl: './customize-force-pack-dialog.component.css'
})
export class CustomizeForcePackDialogComponent {
    private dialogRef = inject(DialogRef<CustomizeForcePackDialogResult | null>);
    private data = inject<CustomizeForcePackDialogData>(DIALOG_DATA);
    private dataService = inject(DataService);
    private gameService = inject(GameService);
    private dialogsService = inject(DialogsService);
    private overlayManager = inject(OverlayManagerService);
    private injector = inject(Injector);
    private destroyRef = inject(DestroyRef);
    private taggingService = inject(TaggingService);
    layoutService = inject(LayoutService);
    forceBuilderService = inject(ForceBuilderService);
    ALPHA_STRIKE = GameSystem.AS;

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
    variantsForSelected = computed<UnitSummary[]>(() => {
        const idx = this.openDropdownIndex();
        if (idx === null) return [];
        
        const unit = this.customizableUnits()[idx];
        if (!unit?.unit) return [];

        return this.getVariantsForUnit(unit.unit)
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

    gameSystem = computed(() => {
        return this.gameService.currentGameSystem();
    });

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
        const variants = this.getVariantsForUnit(unit.unit)
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
        outputToObservable(componentRef.instance.selected).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((variant: UnitSummary) => {
            this.selectVariant(index, variant);
            this.closeDropdown();
        });

        // Handle info request - cleanup when dialog closes
        outputToObservable(componentRef.instance.infoRequested).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((variant: UnitSummary) => {
            this.showVariantInfo(variant, variants, index);
        });

        this.openDropdownIndex.set(index);
    }

    private getVariantsForUnit(unit: UnitSummary): UnitSummary[] {
        return this.dataService.getUnits()
            .filter(candidate => isSameVariantGroup(candidate, unit));
    }

    private closeDropdown(): void {
        this.overlayManager.closeManagedOverlay('variant-dropdown');
        this.openDropdownIndex.set(null);
    }

    private selectVariant(index: number, variant: UnitSummary): void {
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
    onDockedVariantSelect(variant: UnitSummary): void {
        const idx = this.openDropdownIndex();
        if (idx === null) return;
        this.selectVariant(idx, variant);
        this.closeDropdown();
    }

    /** Handler for docked panel info request */
    onDockedVariantInfo(variant: UnitSummary): void {
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
    private async showVariantInfo(variant: UnitSummary, variants: UnitSummary[], unitIndex: number): Promise<void> {
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
        outputToObservable(ref.componentInstance!.select).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((selectedUnit: UnitSummary) => {
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
            .filter((u): u is UnitSummary => u !== null && u !== undefined);
        
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
