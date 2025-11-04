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

import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OptionsService } from '../../services/options.service';
import { BaseDialogComponent } from '../base-dialog/base-dialog.component';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { DbService } from '../../services/db.service';
import { UserStateService } from '../../services/userState.service';
import { DialogsService } from '../../services/dialogs.service';
import { isIOS } from '../../utils/platform.util';
import { LoggerService } from '../../services/logger.service';

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
    dbService = inject(DbService);
    dialogRef = inject(DialogRef<OptionsDialogComponent>);
    userStateService = inject(UserStateService);
    dialogsService = inject(DialogsService);
    isIOS = isIOS();
    
    tabs = ['General', 'Sheets', 'Advanced', 'Experimental', 'Debug'];
    activeTab = signal(this.tabs[0]);

    uuidInput = viewChild<ElementRef<HTMLInputElement>>('uuidInput');
    userUuid = computed(() => this.userStateService.uuid() || '');
    userUuidError = '';
    sheetCacheSize = signal(0);
    sheetCacheCount = signal(0);
    canvasMemorySize = signal(0);


    constructor() {
        this.updateSheetCacheSize();
        this.updateCanvasMemorySize();
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
        const value = (event.target as HTMLSelectElement).value as 'cbt' | 'as';
        this.optionsService.setOption('gameSystem', value);
    }

    onSheetsColorChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'normal' | 'night';
        this.optionsService.setOption('sheetsColor', value);
    }

    onFluffImageInSheetChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value === 'true';
        this.optionsService.setOption('fluffImageInSheet', value);
    }

    onSyncZoomBetweenSheetsChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value === 'true';
        this.optionsService.setOption('syncZoomBetweenSheets', value);
    }

    onPickerStyleChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'radial' | 'linear';
        this.optionsService.setOption('pickerStyle', value);
    }

    onUnitDisplayNameChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'chassisModel' | 'alias' | 'both';
        this.optionsService.setOption('unitDisplayName', value);
    }

    onQuickActionsChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'enabled' | 'disabled';
        this.optionsService.setOption('quickActions', value);
    }

    onCanvasInputChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'all' | 'touch' | 'pen';
        this.optionsService.setOption('canvasInput', value);
    }

    onSwipeToNextSheetChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'vertical' | 'horizontal' | 'disabled';
        this.optionsService.setOption('swipeToNextSheet', value);
    }
    
    selectAll(event: FocusEvent) {
        const input = event.target as HTMLInputElement;
        input.select();
    }

    async onPurgeCache() {
        const confirmed = await this.dialogsService.showQuestion(
            'Are you sure you want to delete all cached record sheets? They will be redownloaded as needed.',
            'Confirm Purge Cache',
            'info'
        );
        if (confirmed === 'yes') {
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
        const confirmed = await this.dialogsService.showQuestion(
            'Are you sure you want to delete all drawings? This action cannot be undone.',
            'Confirm Purge Drawings',
            'danger'
        );
        if (confirmed === 'yes') {
            await this.dbService.clearCanvasStore();
            this.updateCanvasMemorySize();
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
            const confirmed = await this.dialogsService.showQuestion(
                'Are you sure you want to generate a new User Identifier? This will disconnect you from your cloud data. Your local data will remain intact.',
                'Confirm New Identifier', 'danger');
            if (confirmed !== 'yes') {
                this.resetUserUuidInput();
                return;
            }
            await this.userStateService.createNewUUID();
            window.location.reload();
            return;
        }
        try {
            const confirmed = await this.dialogsService.showQuestion(
                'Are you sure you want to set a new User Identifier? This will disconnect you from your cloud data. Your local data will remain intact.',
                'Confirm New Identifier', 'danger');
            if (confirmed !== 'yes') {
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
}