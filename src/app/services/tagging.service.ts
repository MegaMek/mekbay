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
import { TagSelectorComponent, TagSelectionEvent } from '../components/tag-selector/tag-selector.component';
import { InputDialogComponent, InputDialogData } from '../components/input-dialog/input-dialog.component';
import { DataService } from './data.service';

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
    private dataService = inject(DataService);
    private overlayManager = inject(OverlayManagerService);
    private dialogsService = inject(DialogsService);
    private overlay = inject(Overlay);
    private injector = inject(Injector);

    /**
     * Opens the tag selector for the given units.
     * Supports both single and multi-unit tagging with name or chassis scope.
     * 
     * @param units Array of units to tag
     * @param anchorElement Optional element to anchor the popup to. If null, uses centered overlay.
     * @returns Promise that resolves when the tagging operation is complete
     */
    async openTagSelector(units: Unit[], anchorElement?: HTMLElement | null): Promise<void> {
        if (units.length === 0) return;

        // Get all unique tags from all units (for both sections)
        const allNameTags = this.filtersService.getAllNameTags();
        const allChassisTags = this.filtersService.getAllChassisTags();

        // Add preconfigured tags to both sections if not present
        for (const preconfiguredTag of PRECONFIGURED_TAGS) {
            if (!allNameTags.includes(preconfiguredTag)) {
                allNameTags.unshift(preconfiguredTag);
            }
            if (!allChassisTags.includes(preconfiguredTag)) {
                allChassisTags.unshift(preconfiguredTag);
            }
        }

        const portal = new ComponentPortal(TagSelectorComponent, null, this.injector);
        const componentRef = this.overlayManager.createManagedOverlay(
            'tagSelector',
            anchorElement ?? null,
            portal,
            {
                scrollStrategy: this.overlay.scrollStrategies.close(),
                hasBackdrop: !anchorElement,
                backdropClass: anchorElement ? undefined : 'cdk-overlay-dark-backdrop',
                panelClass: 'tag-selector-overlay'
            }
        );

        // Pass data to the component
        componentRef.instance.nameTags.set(allNameTags);
        componentRef.instance.chassisTags.set(allChassisTags);

        // Calculate tag states for all selected units
        const updateTagStates = () => {
            const { fullyAssigned: nameFullyAssigned, partiallyAssigned: namePartiallyAssigned } = 
                this.calculateTagStates(units, 'name');
            const { fullyAssigned: chassisFullyAssigned, partiallyAssigned: chassisPartiallyAssigned } = 
                this.calculateTagStates(units, 'chassis');
            
            // Update signals to trigger reactivity
            componentRef.instance.assignedNameTags.set([...nameFullyAssigned]);
            componentRef.instance.partialNameTags.set([...namePartiallyAssigned]);
            componentRef.instance.assignedChassisTags.set([...chassisFullyAssigned]);
            componentRef.instance.partialChassisTags.set([...chassisPartiallyAssigned]);
        };

        updateTagStates();

        // Handle tag removal
        componentRef.instance.tagRemoved.subscribe(async (event: TagSelectionEvent) => {
            await this.dataService.modifyTag(units, event.tag, event.tagType, 'remove');
            updateTagStates();
            this.filtersService.invalidateTagsCache();
        });

        // Handle tag selection
        componentRef.instance.tagSelected.subscribe(async (event: TagSelectionEvent) => {
            let selectedTag = event.tag;
            const tagType = event.tagType;

            // If "Add new tag..." was selected, show text input dialog
            if (selectedTag === '__new__') {
                let newTag : string | null | undefined;
                // Block tag selector from closing while input dialog is open
                this.overlayManager.blockCloseUntil('tagSelector');
                try {
                    const newTagRef = this.dialogsService.createDialog<string | null>(InputDialogComponent, {
                        data: {
                            title: tagType === 'chassis' ? 'Add New Tag to Chassis' : 'Add New Tag to Unit',
                            inputType: 'text',
                            defaultValue: '',
                            placeholder: 'Enter tag...'
                        } as InputDialogData
                    });
    
                    newTag = await firstValueFrom(newTagRef.closed);
                } finally {
                    // Unblock after small delay to prevent immediate close from residual events
                    setTimeout(() => this.overlayManager.unblockClose('tagSelector'), 100);
                }
                

                // User cancelled or entered empty string
                if (!newTag || newTag.trim().length === 0) {
                    return;
                }
                if (newTag.length > 16) {
                    await this.dialogsService.showError('Tag is too long. Maximum length is 16 characters.', 'Invalid Tag');
                    return;
                }

                selectedTag = newTag.trim();

                // Add the new tag to the appropriate list if not already present
                if (tagType === 'name') {
                    if (!componentRef.instance.nameTags().some(t => t.toLowerCase() === selectedTag.toLowerCase())) {
                        componentRef.instance.nameTags.update(tags => [selectedTag, ...tags]);
                    }
                } else {
                    if (!componentRef.instance.chassisTags().some(t => t.toLowerCase() === selectedTag.toLowerCase())) {
                        componentRef.instance.chassisTags.update(tags => [selectedTag, ...tags]);
                    }
                }
            }

            await this.dataService.modifyTag(units, selectedTag, tagType, 'add');
            updateTagStates();
            this.filtersService.invalidateTagsCache();
        });
    }

    /**
     * Calculate which tags are fully assigned (to all units) vs partially assigned (to some units).
     */
    private calculateTagStates(units: Unit[], tagType: 'name' | 'chassis'): { 
        fullyAssigned: string[]; 
        partiallyAssigned: string[]; 
    } {
        if (units.length === 0) return { fullyAssigned: [], partiallyAssigned: [] };

        // Collect all tags and count how many units have each
        const tagCounts = new Map<string, number>();
        
        for (const unit of units) {
            const tags = tagType === 'name' ? (unit._nameTags || []) : (unit._chassisTags || []);
            for (const tag of tags) {
                const lowerTag = tag.toLowerCase();
                tagCounts.set(lowerTag, (tagCounts.get(lowerTag) || 0) + 1);
            }
        }

        const fullyAssigned: string[] = [];
        const partiallyAssigned: string[] = [];

        for (const [lowerTag, count] of tagCounts) {
            // Find original casing from the first unit that has this tag
            let originalTag = lowerTag;
            for (const unit of units) {
                const tags = tagType === 'name' ? (unit._nameTags || []) : (unit._chassisTags || []);
                const found = tags.find(t => t.toLowerCase() === lowerTag);
                if (found) {
                    originalTag = found;
                    break;
                }
            }

            if (count === units.length) {
                fullyAssigned.push(originalTag);
            } else {
                partiallyAssigned.push(originalTag);
            }
        }

        return { fullyAssigned, partiallyAssigned };
    }

    /**
     * Opens the tag selector for a single unit.
     * Convenience wrapper around openTagSelector.
     */
    async openTagSelectorForUnit(unit: Unit, anchorElement?: HTMLElement | null): Promise<void> {
        return this.openTagSelector([unit], anchorElement);
    }
}
