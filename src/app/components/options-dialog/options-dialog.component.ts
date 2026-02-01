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

import { ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OptionsService } from '../../services/options.service';
import { BaseDialogComponent } from '../base-dialog/base-dialog.component';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { DbService } from '../../services/db.service';
import { UserStateService } from '../../services/userState.service';
import { DialogsService } from '../../services/dialogs.service';
import { isIOS } from '../../utils/platform.util';
import { LoggerService } from '../../services/logger.service';
import { GameService } from '../../services/game.service';
import { GameSystem } from '../../models/common.model';
import { SpriteStorageService } from '../../services/sprite-storage.service';
import { DataService } from '../../services/data.service';
import { PublicTagsService } from '../../services/public-tags.service';
import { TagsService } from '../../services/tags.service';
import { TaggingService } from '../../services/tagging.service';
import { ToastService } from '../../services/toast.service';

/*
 * Author: Drake
 */
@Component({
    selector: 'options-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, BaseDialogComponent],
    templateUrl: './options-dialog.component.html',
    styleUrls: ['./options-dialog.component.css']
})
export class OptionsDialogComponent {
    logger = inject(LoggerService)
    optionsService = inject(OptionsService);
    gameSystem = inject(GameService);
    dbService = inject(DbService);
    dialogRef = inject(DialogRef<OptionsDialogComponent>);
    userStateService = inject(UserStateService);
    dialogsService = inject(DialogsService);
    spriteStorageService = inject(SpriteStorageService);
    dataService = inject(DataService);
    publicTagsService = inject(PublicTagsService);
    tagsService = inject(TagsService);
    taggingService = inject(TaggingService);
    toastService = inject(ToastService);
    destroyRef = inject(DestroyRef);
    isIOS = isIOS();
    
    tabs = computed(() => {
        return ['General', 'Tags', 'Sheets', 'Alpha Strike', 'Advanced', 'Logs'];
    });
    activeTab = signal(this.tabs()[0]);

    uuidInput = viewChild<ElementRef<HTMLInputElement>>('uuidInput');
    subscriptionInput = viewChild<ElementRef<HTMLInputElement>>('subscriptionInput');
    userUuid = computed(() => this.userStateService.uuid() || '');
    userPublicId = computed(() => this.userStateService.publicId() || 'Not registered');
    subscribedTags = computed(() => {
        this.publicTagsService.version(); // depend on version for reactivity
        return this.publicTagsService.getSubscribedTags();
    });
    userOwnTags = computed(() => {
        this.tagsService.version(); // depend on version for reactivity
        const nameTags = this.tagsService.getNameTags();
        const chassisTags = this.tagsService.getChassisTags();
        const allTags = new Set([...Object.keys(nameTags), ...Object.keys(chassisTags)]);
        return Array.from(allTags).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    });
    showSubscriptionInput = signal(false);
    subscriptionError = signal('');
    userUuidError = '';
    sheetCacheSize = signal(0);
    sheetCacheCount = signal(0);
    canvasMemorySize = signal(0);
    unitIconsCount = signal(0);
    unitsCount = computed(() => this.dataService.getUnits().length);
    equipmentCount = computed(() => Object.keys(this.dataService.getEquipments()).length);

    /** Subscriber counts for own tags: tagId (lowercase) -> count */
    tagSubscriberCounts = signal<Record<string, number>>({});
    /** Whether subscriber counts are loading */
    subscriberCountsLoading = signal(false);

    constructor() {
        this.updateSheetCacheSize();
        this.updateCanvasMemorySize();
        this.updateUnitIconsCount();
        this.loadTagSubscriberCounts();
    }

    /**
     * Load subscriber counts for the user's own tags.
     * Uses a flag to prevent using results if the dialog is closed before completion.
     */
    private loadTagSubscriberCounts(): void {
        let cancelled = false;
        this.destroyRef.onDestroy(() => { cancelled = true; });

        this.subscriberCountsLoading.set(true);
        this.publicTagsService.getOwnTagSubscriberCounts().then(counts => {
            if (cancelled) return;
            if (counts) {
                this.tagSubscriberCounts.set(counts);
            }
            this.subscriberCountsLoading.set(false);
        }).catch(() => {
            if (cancelled) return;
            this.subscriberCountsLoading.set(false);
        });
    }

    /**
     * Get subscriber count for a specific tag.
     * @param tagName The tag name (display name, not necessarily lowercase)
     * @returns Subscriber count, or 0 if not found
     */
    getSubscriberCount(tagName: string): number {
        return this.tagSubscriberCounts()[tagName.toLowerCase()] || 0;
    }

    updateSheetCacheSize() {
        this.dbService.getSheetsStoreSize().then(({ memorySize, count }) => {
            this.sheetCacheSize.set(memorySize);
            this.sheetCacheCount.set(count);
        });
    }

    updateCanvasMemorySize() {
        this.dbService.getCanvasStoreSize().then(size => {
            this.canvasMemorySize.set(size);
        });
    }

    async updateUnitIconsCount() {
        const count = await this.spriteStorageService.getIconCount();
        this.unitIconsCount.set(count);
    }

    formatBytes(bytes: number, decimals = 2) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    onClose() {
        this.dialogRef.close();
    }

    onGameSystemChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as GameSystem;
        this.optionsService.setOption('gameSystem', value);
    }

    onSheetsColorChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'normal' | 'night';
        this.optionsService.setOption('sheetsColor', value);
    }

    onRecordSheetCenterPanelContentChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'fluffImage' | 'clusterTable';
        this.optionsService.setOption('recordSheetCenterPanelContent', value);
    }

    onSyncZoomBetweenSheetsChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value === 'true';
        this.optionsService.setOption('syncZoomBetweenSheets', value);
    }

    onAllowMultipleActiveSheetsChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value === 'true';
        this.optionsService.setOption('allowMultipleActiveSheets', value);
    }

    onPickerStyleChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'radial' | 'linear';
        this.optionsService.setOption('pickerStyle', value);
    }

    onUnitDisplayNameChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'chassisModel' | 'alias' | 'both';
        this.optionsService.setOption('unitDisplayName', value);
    }

    onAutoConvertFiltersChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value === 'true';
        this.optionsService.setOption('automaticallyConvertFiltersToSemantic', value);
    }

    onQuickActionsChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'enabled' | 'disabled';
        this.optionsService.setOption('quickActions', value);
    }

    onunitSearchExpandedViewLayoutChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'panel-list-filters' | 'filters-list-panel';
        this.optionsService.setOption('unitSearchExpandedViewLayout', value);
    }

    onCanvasInputChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'all' | 'touch' | 'pen';
        this.optionsService.setOption('canvasInput', value);
    }

    onSwipeToNextSheetChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'vertical' | 'horizontal' | 'disabled';
        this.optionsService.setOption('swipeToNextSheet', value);
    }

    onUseAutomationsChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value === 'true';
        this.optionsService.setOption('useAutomations', value);
    }

    onASUseHexChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value === 'true';
        this.optionsService.setOption('ASUseHex', value);
    }

    onASCardStyleChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'colored' | 'monochrome';
        this.optionsService.setOption('ASCardStyle', value);
    }

    onASPrintPageBreakOnGroupsChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value === 'true';
        this.optionsService.setOption('ASPrintPageBreakOnGroups', value);
    }

    onASUnifiedDamagePickerChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value === 'true';
        this.optionsService.setOption('ASUnifiedDamagePicker', value);
    }

    onASUseAutomationsChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value === 'true';
        this.optionsService.setOption('ASUseAutomations', value);
    }

    onVehiclesCriticalHitTableChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'default' | 'scouringSands';
        this.optionsService.setOption('ASVehiclesCriticalHitTable', value);
    }

    selectAll(event: FocusEvent) {
        const input = event.target as HTMLInputElement;
        input.select();
    }

    async onPurgeCache() {
        const confirmed = await this.dialogsService.requestConfirmation(
            'Are you sure you want to delete all cached record sheets? They will be redownloaded as needed.',
            'Confirm Purge Cache',
            'info'
        );
        if (confirmed) {
            await this.dbService.clearSheetsStore();
            this.updateSheetCacheSize();

            if ('caches' in window) {
                const keys = await window.caches.keys();
                await Promise.all(keys.map(key => window.caches.delete(key)));
            }

            window.location.reload();
        }
    }

    async onPurgeCanvas() {
        const confirmed = await this.dialogsService.requestConfirmation(
            'Are you sure you want to delete all drawings? This action cannot be undone.',
            'Confirm Purge Drawings',
            'danger'
        );
        if (confirmed) {
            await this.dbService.clearCanvasStore();
            this.updateCanvasMemorySize();
        }
    }

    async onPurgeIcons() {
        const confirmed = await this.dialogsService.requestConfirmation(
            'Are you sure you want to delete all stored unit icons? They will be re-downloaded as needed.',
            'Confirm Purge Unit Icons',
            'info'
        );
        if (confirmed) {
            await this.spriteStorageService.clearSpritesStore();
            await this.updateUnitIconsCount();
            await this.spriteStorageService.reinitialize();
            await this.updateUnitIconsCount();
        }
    }

    async onUserUuidKeydown(event: KeyboardEvent) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.userUuidError = '';
            this.resetUserUuidInput();
        }
    }

    private resetUserUuidInput() {
        const uuidInput = this.uuidInput();
        if (!uuidInput) return;
        this.userUuidError = '';
        const el = uuidInput.nativeElement;
        el.value = this.userUuid();
        el.blur();
    }

    async onSetUuid(value: string) {
        this.userUuidError = '';
        const trimmed = value.trim();
        if (trimmed === this.userUuid()) {
            // No change
            return;
        }
        if (trimmed.length === 0) {
            // Generate a new UUID if input is empty
            const confirmed = await this.dialogsService.requestConfirmation(
                'Are you sure you want to generate a new User Identifier? This will disconnect you from your cloud data. Your local data will remain intact.',
                'Confirm New Identifier', 'danger');
            if (!confirmed) {
                this.resetUserUuidInput();
                return;
            }
            await this.userStateService.createNewUUID();
            window.location.reload();
            return;
        }
        try {
            const confirmed = await this.dialogsService.requestConfirmation(
                'Are you sure you want to set a new User Identifier? This will disconnect you from your cloud data. Your local data will remain intact.',
                'Confirm New Identifier', 'danger');
            if (!confirmed) {
                this.resetUserUuidInput();
                return;
            }
            await this.userStateService.setUuid(trimmed);
            window.location.reload();
        } catch (e: any) {
            this.userUuidError = e?.message || 'An unknown error occurred.';
            return;
        }
    }

    async onUnsubscribePublicTag(publicId: string, tagName: string) {
        await this.publicTagsService.unsubscribeWithConfirmation(publicId, tagName);
    }

    onShowSubscriptionInput() {
        this.showSubscriptionInput.set(true);
        this.subscriptionError.set('');
        // Focus input after render
        setTimeout(() => {
            this.subscriptionInput()?.nativeElement.focus();
        }, 0);
    }

    onCancelSubscription() {
        this.showSubscriptionInput.set(false);
        this.subscriptionError.set('');
        const input = this.subscriptionInput();
        if (input) input.nativeElement.value = '';
    }

    async onSubscriptionKeydown(event: KeyboardEvent) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.onCancelSubscription();
        } else if (event.key === 'Enter') {
            event.preventDefault();
            const input = this.subscriptionInput();
            if (input) {
                await this.onAddSubscription(input.nativeElement.value);
            }
        }
    }

    async onAddSubscription(value: string) {
        this.subscriptionError.set('');
        const trimmed = value.trim();
        
        if (!trimmed) {
            this.subscriptionError.set('Please enter a subscription in the format publicId:tagName');
            return;
        }

        // Parse publicId:tagName format
        const colonIndex = trimmed.indexOf(':');
        if (colonIndex === -1) {
            this.subscriptionError.set('Invalid format. Use publicId:tagName (e.g., abc123:MyTag)');
            return;
        }

        const publicId = trimmed.substring(0, colonIndex).trim();
        const tagName = trimmed.substring(colonIndex + 1).trim();

        if (!publicId || !tagName) {
            this.subscriptionError.set('Both publicId and tagName are required');
            return;
        }

        // Check if trying to subscribe to own tags
        if (publicId === this.userPublicId()) {
            this.subscriptionError.set('You cannot subscribe to your own tags');
            return;
        }

        // Check if already subscribed
        if (this.publicTagsService.isTagSubscribed(publicId, tagName)) {
            this.subscriptionError.set('Already subscribed to this tag');
            return;
        }

        try {
            const success = await this.publicTagsService.subscribe(publicId, tagName);
            if (success) {
                this.showSubscriptionInput.set(false);
                const input = this.subscriptionInput();
                if (input) input.nativeElement.value = '';
            } else {
                this.subscriptionError.set('Failed to subscribe. The tag may not exist or is not public.');
            }
        } catch (e: any) {
            this.subscriptionError.set(e?.message || 'Failed to subscribe');
        }
    }

    async onCopyTagLink(tagName: string) {
        const publicId = this.userPublicId();
        if (publicId === 'Not registered') {
            this.toastService.showToast('You need to be registered to share tags', 'error');
            return;
        }
        const link = `${publicId}:${tagName}`;
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(link);
            } else {
                // Fallback for older browsers (iOS < 13.4, older Firefox)
                const textArea = document.createElement('textarea');
                textArea.value = link;
                textArea.style.position = 'fixed';
                textArea.style.opacity = '0';
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
            }
            this.toastService.showToast(`Copied: ${link}`, 'success');
        } catch {
            this.toastService.showToast('Failed to copy to clipboard', 'error');
        }
    }

    async onDeleteTag(tagName: string) {
        const confirmed = await this.dialogsService.requestConfirmation(
            `Are you sure you want to delete the tag "${tagName}"? This will remove the tag from all units.`,
            'Delete Tag',
            'danger'
        );
        if (!confirmed) return;

        await this.tagsService.deleteTag(tagName);
        this.toastService.showToast(`Tag "${tagName}" deleted`, 'success');
    }

    async onRenameTag(tagName: string) {
        await this.taggingService.renameTag(tagName);
    }
}