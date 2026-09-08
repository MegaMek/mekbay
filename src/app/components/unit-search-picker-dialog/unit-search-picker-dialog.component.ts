// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import { UnitSearchComponent } from '../unit-search/unit-search.component';
import { UnitSearchFiltersService } from '../../services/unit-search-filters.service';

/** A single-unit destination for the existing search, filters, cards and keyboard controls. */
@Component({
    selector: 'unit-search-picker-dialog',
    imports: [UnitSearchComponent],
    template: '<unit-search [selectionMode]="true" (unitSelected)="dialogRef.close($event)" (selectionCanceled)="dialogRef.close()" />',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { class: 'fullscreen-dialog-host nopadding fullheight', 'aria-label': 'Select a unit for construction' },
})
export class UnitSearchPickerDialogComponent {
    readonly dialogRef = inject(DialogRef);
    constructor() {
        const filters = inject(UnitSearchFiltersService);
        const wasExpanded = filters.expandedView();
        filters.expandedView.set(true);
        inject(DestroyRef).onDestroy(() => filters.expandedView.set(wasExpanded));
    }
}
