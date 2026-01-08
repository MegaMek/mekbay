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

import { inject, Injectable, Injector } from '@angular/core';
import { Overlay } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { firstValueFrom } from 'rxjs';
import { Unit } from '../models/units.model';
import { UnitSearchFiltersService } from './unit-search-filters.service';
import { OverlayManagerService } from './overlay-manager.service';
import { DialogsService } from './dialogs.service';
import { TagSelectorComponent } from '../components/tag-selector/tag-selector.component';
import { InputDialogComponent, InputDialogData } from '../components/input-dialog/input-dialog.component';

const PRECONFIGURED_TAGS = ['Favorites', 'My Collection'];

/**
 * Service for handling unit tagging operations.
 * Provides a unified interface for adding/removing tags from units.
 */
@Injectable({
    providedIn: 'root'
})
export class TaggingService {
    private filtersService = inject(UnitSearchFiltersService);
    private overlayManager = inject(OverlayManagerService);
    private dialogsService = inject(DialogsService);
    private overlay = inject(Overlay);
    private injector = inject(Injector);

    /**
     * Opens the tag selector for the given units.
     * Supports both single and multi-unit tagging.
     * 
     * @param units Array of units to tag
     * @param anchorElement Optional element to anchor the popup to. If null, uses centered overlay.
     * @returns Promise that resolves when the tagging operation is complete
     */
    async openTagSelector(units: Unit[], anchorElement?: HTMLElement | null): Promise<void> {
        if (units.length === 0) return;

        // Collect all unique tags from all units
        const tagOptions = this.filtersService.getAllTags();
        for (const preconfiguredTag of PRECONFIGURED_TAGS) {
            if (!tagOptions.includes(preconfiguredTag)) {
                tagOptions.unshift(preconfiguredTag);
            }
        }

        const portal = new ComponentPortal(TagSelectorComponent, null, this.injector);
        const componentRef = this.overlayManager.createManagedOverlay(
            'tagSelector',
            anchorElement ?? null,
            portal,
            {
                scrollStrategy: this.overlay.scrollStrategies.reposition(),
                hasBackdrop: !anchorElement,
                backdropClass: anchorElement ? undefined : 'cdk-overlay-dark-backdrop',
                panelClass: 'tag-selector-overlay'
            }
        );

        // Pass data to the component
        componentRef.instance.tags = tagOptions;

        // Show tags that are common to all selected units
        const commonTags = units
            .map(u => u._tags || [])
            .reduce((a, b) => a.filter(tag => b.includes(tag)), units[0]._tags || []);
        componentRef.instance.assignedTags = commonTags;

        // Handle tag removal for all selected units
        componentRef.instance.tagRemoved.subscribe(async (tagToRemove: string) => {
            for (const u of units) {
                if (u._tags) {
                    const index = u._tags.findIndex(t => t.toLowerCase() === tagToRemove.toLowerCase());
                    if (index !== -1) {
                        u._tags.splice(index, 1);
                    }
                }
            }
            // Update the component's assigned tags
            const updatedCommon = units
                .map(u => u._tags || [])
                .reduce((a, b) => a.filter(tag => b.includes(tag)), units[0]._tags || []);
            componentRef.instance.assignedTags = updatedCommon;

            await this.filtersService.saveTagsToStorage();
            this.filtersService.invalidateTagsCache();
        });

        // Handle tag selection for all selected units
        componentRef.instance.tagSelected.subscribe(async (selectedTag: string) => {
            this.overlayManager.closeManagedOverlay('tagSelector');

            // If "Add new tag..." was selected, show text input dialog
            if (selectedTag === '__new__') {
                const newTagRef = this.dialogsService.createDialog<string | null>(InputDialogComponent, {
                    data: {
                        title: 'Add New Tag',
                        inputType: 'text',
                        defaultValue: '',
                        placeholder: 'Enter tag...'
                    } as InputDialogData
                });

                const newTag = await firstValueFrom(newTagRef.closed);

                // User cancelled or entered empty string
                if (!newTag || newTag.trim().length === 0) {
                    return;
                }
                if (newTag.length > 16) {
                    await this.dialogsService.showError('Tag is too long. Maximum length is 16 characters.', 'Invalid Tag');
                    return;
                }

                selectedTag = newTag;
            }

            const trimmedTag = selectedTag.trim();

            for (const u of units) {
                if (!u._tags) {
                    u._tags = [];
                }
                if (!u._tags.some(tag => tag.toLowerCase() === trimmedTag.toLowerCase())) {
                    u._tags.push(trimmedTag);
                }
            }

            await this.filtersService.saveTagsToStorage();
            this.filtersService.invalidateTagsCache();
        });
    }

    /**
     * Opens the tag selector for a single unit.
     * Convenience wrapper around openTagSelector.
     */
    async openTagSelectorForUnit(unit: Unit, anchorElement?: HTMLElement | null): Promise<void> {
        return this.openTagSelector([unit], anchorElement);
    }
}
