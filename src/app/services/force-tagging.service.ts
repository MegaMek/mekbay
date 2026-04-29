/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
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
import { outputToObservable } from '@angular/core/rxjs-interop';
import { Overlay } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { firstValueFrom, takeUntil } from 'rxjs';

import {
    FORCE_TAG_SELECTOR_NEW_TAG,
    ForceTagSelectorComponent,
} from '../components/force-tag-selector/force-tag-selector.component';
import type { ForceTaggableEntry } from '../components/force-tags/force-tags.component';
import { InputDialogComponent, type InputDialogData } from '../components/input-dialog/input-dialog.component';
import { sanitizeForceTags } from '../models/force-serialization';
import { DataService } from './data.service';
import { DialogsService } from './dialogs.service';
import { ForceBuilderService } from './force-builder.service';
import { OverlayManagerService } from './overlay-manager.service';

interface ForceTagState {
    fullyAssigned: string[];
    partiallyAssigned: string[];
}

export interface ForceTagSelectorOptions {
    /** Existing force tags to show in the selector without reloading the hangar list. */
    availableTags?: readonly string[];
    /** Whether to update cloud storage. Defaults to the force cloud flag, or true when unknown. */
    updateCloud?: boolean;
    /** Called after a force entry's tags are changed. */
    onTagsChanged?: (force: ForceTaggableEntry, tags: string[]) => void;
}

const FORCE_TAG_SELECTOR_OVERLAY_KEY = 'forceTagSelector';

@Injectable({
    providedIn: 'root'
})
export class ForceTaggingService {
    private dataService = inject(DataService);
    private forceBuilderService = inject(ForceBuilderService);
    private overlayManager = inject(OverlayManagerService);
    private dialogsService = inject(DialogsService);
    private overlay = inject(Overlay);
    private injector = inject(Injector);

    async openForceTagSelector(
        forces: ForceTaggableEntry[],
        anchorElement?: HTMLElement | null,
        options: ForceTagSelectorOptions = {},
    ): Promise<void> {
        if (this.overlayManager.has(FORCE_TAG_SELECTOR_OVERLAY_KEY)) {
            this.overlayManager.closeManagedOverlay(FORCE_TAG_SELECTOR_OVERLAY_KEY);
            return;
        }

        const editableForces = forces.filter(force => this.isEditableForce(force));
        if (editableForces.length === 0) {
            await this.dialogsService.showError('Only saved forces you own can be retagged.', 'Force Tags');
            return;
        }

        const allTags = this.collectAvailableTags(editableForces, options.availableTags);
        const portal = new ComponentPortal(ForceTagSelectorComponent, null, this.injector);
        const { componentRef, closed } = this.overlayManager.createManagedOverlay(
            FORCE_TAG_SELECTOR_OVERLAY_KEY,
            anchorElement ?? null,
            portal,
            {
                scrollStrategy: this.overlay.scrollStrategies.close(),
                hasBackdrop: !anchorElement,
                backdropClass: anchorElement ? undefined : 'cdk-overlay-dark-backdrop',
                panelClass: 'tag-selector-overlay'
            }
        );

        componentRef.instance.tags.set(allTags);

        const updateAvailableTags = () => {
            componentRef.instance.tags.set(this.collectAvailableTags(editableForces, options.availableTags));
        };

        const updateTagStates = () => {
            const { fullyAssigned, partiallyAssigned } = this.calculateTagStates(editableForces);
            componentRef.instance.assignedTags.set([...fullyAssigned]);
            componentRef.instance.partialTags.set([...partiallyAssigned]);
        };

        updateTagStates();

        outputToObservable(componentRef.instance.tagRemoved).pipe(takeUntil(closed)).subscribe(async (tag: string) => {
            await this.updateForces(editableForces, options, force => this.removeTag(force, tag));
            updateAvailableTags();
            updateTagStates();
        });

        outputToObservable(componentRef.instance.tagSelected).pipe(takeUntil(closed)).subscribe(async (tag: string) => {
            let selectedTag = tag;

            if (selectedTag === FORCE_TAG_SELECTOR_NEW_TAG) {
                const newTag = await this.promptForNewTag();
                if (!newTag) {
                    return;
                }

                selectedTag = this.normalizeTagLabel(newTag, componentRef.instance.tags());
            }

            await this.updateForces(editableForces, options, force => this.addTag(force, selectedTag));
            updateAvailableTags();
            updateTagStates();
        });
    }

    private isEditableForce(force: ForceTaggableEntry): boolean {
        return !!force.instanceId && force.owned !== false;
    }

    private collectAvailableTags(forces: ForceTaggableEntry[], availableTags?: readonly string[]): string[] {
        const labels = new Map<string, string>();
        const addTags = (tags: readonly string[] | null | undefined) => {
            for (const tag of sanitizeForceTags(tags ?? [])) {
                const key = tag.toLocaleLowerCase();
                if (!labels.has(key)) {
                    labels.set(key, tag);
                }
            }
        };

        addTags(availableTags);
        for (const force of forces) {
            addTags(force.tags);
        }

        addTags(this.dataService.getCachedForceTagLabels());

        return Array.from(labels.values())
            .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
    }

    private calculateTagStates(forces: ForceTaggableEntry[]): ForceTagState {
        if (forces.length === 0) {
            return { fullyAssigned: [], partiallyAssigned: [] };
        }

        const tagCounts = new Map<string, { label: string; count: number }>();

        for (const force of forces) {
            const seen = new Set<string>();
            for (const tag of sanitizeForceTags(force.tags ?? [])) {
                const key = tag.toLocaleLowerCase();
                if (seen.has(key)) {
                    continue;
                }

                seen.add(key);
                const existing = tagCounts.get(key);
                if (existing) {
                    existing.count += 1;
                } else {
                    tagCounts.set(key, { label: tag, count: 1 });
                }
            }
        }

        const fullyAssigned: string[] = [];
        const partiallyAssigned: string[] = [];
        for (const { label, count } of tagCounts.values()) {
            if (count === forces.length) {
                fullyAssigned.push(label);
            } else {
                partiallyAssigned.push(label);
            }
        }

        fullyAssigned.sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
        partiallyAssigned.sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
        return { fullyAssigned, partiallyAssigned };
    }

    private async promptForNewTag(): Promise<string | null> {
        let newTag: string | null | undefined;
        this.overlayManager.blockCloseUntil(FORCE_TAG_SELECTOR_OVERLAY_KEY);
        try {
            const ref = this.dialogsService.createDialog<string | null>(InputDialogComponent, {
                data: {
                    title: 'Add New Tag to Force',
                    inputType: 'text',
                    defaultValue: '',
                    placeholder: 'Enter tag...',
                } as InputDialogData
            });

            newTag = await firstValueFrom(ref.closed);
        } finally {
            setTimeout(() => this.overlayManager.unblockClose(FORCE_TAG_SELECTOR_OVERLAY_KEY), 100);
        }

        if (!newTag || newTag.trim().length === 0) {
            return null;
        }

        const normalizedTag = sanitizeForceTags([newTag])[0];
        if (!normalizedTag) {
            await this.dialogsService.showError('Tag names cannot be empty.', 'Invalid Tag');
            return null;
        }

        return normalizedTag;
    }

    private normalizeTagLabel(tag: string, existingTags: readonly string[]): string {
        const normalized = sanitizeForceTags([tag])[0];
        if (!normalized) {
            throw new Error('Tag names cannot be empty.');
        }

        return existingTags.find(existing => this.sameTag(existing, normalized)) ?? normalized;
    }

    private sameTag(left: string, right: string): boolean {
        return left.toLocaleLowerCase() === right.toLocaleLowerCase();
    }

    private addTag(force: ForceTaggableEntry, tag: string): string[] {
        const currentTags = sanitizeForceTags(force.tags ?? []);
        if (currentTags.some(existing => this.sameTag(existing, tag))) {
            return currentTags;
        }

        return sanitizeForceTags([...currentTags, tag]);
    }

    private removeTag(force: ForceTaggableEntry, tag: string): string[] {
        return sanitizeForceTags(force.tags ?? [])
            .filter(existing => !this.sameTag(existing, tag));
    }

    private async updateForces(
        forces: ForceTaggableEntry[],
        options: ForceTagSelectorOptions,
        getNextTags: (force: ForceTaggableEntry) => string[],
    ): Promise<void> {
        for (const force of forces) {
            const nextTags = getNextTags(force);
            await this.persistForceTags(force, nextTags, options);
        }
    }

    private async persistForceTags(
        force: ForceTaggableEntry,
        nextTags: readonly string[],
        options: ForceTagSelectorOptions,
    ): Promise<void> {
        if (!force.instanceId) {
            await this.dialogsService.showError('The selected force must be saved before it can be tagged.', 'Force Tags');
            return;
        }

        if (force.owned === false) {
            await this.dialogsService.showError('Shared forces cannot be retagged.', 'Force Tags');
            return;
        }

        try {
            const updateCloud = options.updateCloud ?? force.cloud ?? true;
            const normalizedTags = await this.dataService.updateForceTags(force.instanceId, nextTags, updateCloud);
            force.tags = normalizedTags.length > 0 ? normalizedTags : undefined;

            for (const loadedForce of this.forceBuilderService.loadedForces()) {
                if (loadedForce.force.instanceId() === force.instanceId) {
                    loadedForce.force.setTags(normalizedTags, false);
                }
            }

            options.onTagsChanged?.(force, normalizedTags);
        } catch (error) {
            await this.dialogsService.showError((error as Error).message, 'Force Tags');
        }
    }
}