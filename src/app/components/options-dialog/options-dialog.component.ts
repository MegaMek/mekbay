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

import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OptionsService } from '../../services/options.service';
import { BaseDialogComponent } from '../base-dialog/base-dialog.component';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { DbService } from '../../services/db.service';
import { UserStateService } from '../../services/userState.service';

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
    optionsService = inject(OptionsService);
    dbService = inject(DbService);
    dialogRef = inject(DialogRef<OptionsDialogComponent>);
    userStateService = inject(UserStateService);
    
    tabs = ['General', 'Advanced', 'Debug'];
    activeTab = signal(this.tabs[0]);

    userUuid = '';
    userUuidError = '';
    sheetCacheSize = signal(0);

    constructor() {
        this.userUuid = this.userStateService.uuid();
        this.updateSheetCacheSize();
        // Debug tab event listeners
        window.addEventListener('pointerdown', this.pointerListener, true);
        window.addEventListener('keydown', this.keyListener, true);
        window.addEventListener('click', this.clickListener, true);

    }

    updateSheetCacheSize() {
        this.dbService.getSheetsStoreSize().then(size => {
            this.sheetCacheSize.set(size);
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

    onSheetsColorChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'normal' | 'night';
        this.optionsService.setOption('sheetsColor', value);
    }

    onPickerStyleChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'radial' | 'linear';
        this.optionsService.setOption('pickerStyle', value);
    }

    onQuickActionsChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'enabled' | 'disabled';
        this.optionsService.setOption('quickActions', value);
    }

    onCanvasModeChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'raster' | 'vector';
        this.optionsService.setOption('canvasMode', value);
    }

    onCanvasInputChange(event: Event) {
        const value = (event.target as HTMLSelectElement).value as 'all' | 'touch' | 'pen';
        this.optionsService.setOption('canvasInput', value);
    }
    
    onUserUuidInput(event: Event) {
        const value = (event.target as HTMLInputElement).value;
        this.userUuid = value;
        if (this.userUuidError) this.userUuidError = '';
    }

    selectAll(event: FocusEvent) {
        const input = event.target as HTMLInputElement;
        input.select();
    }

    async onPurgeCache() {
        if (confirm('Are you sure you want to delete all cached record sheets? They will be redownloaded as needed.')) {
            await this.dbService.clearSheetsStore();
            this.updateSheetCacheSize();

            if ('caches' in window) {
                const keys = await window.caches.keys();
                await Promise.all(keys.map(key => window.caches.delete(key)));
            }

            window.location.reload();
        }
    }

    onUserUuidKeydown(event: KeyboardEvent) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.userUuid = this.userStateService.uuid();
            this.userUuidError = '';
            (event.target as HTMLInputElement).blur();
        }
    }

    async onSetUuid() {
        const trimmed = this.userUuid.trim();
        if (trimmed.length === 0) {
            // Generate a new UUID if input is empty
            this.userUuid = await this.userStateService.getOrCreateUuid(true);
        }
        this.userUuid = trimmed;
        this.userUuidError = '';
        try {
            await this.userStateService.setUuid(this.userUuid);
            window.location.reload();
        } catch (e: any) {
            this.userUuidError = e?.message || 'An unknown error occurred.';
            return;
        }
    }


    /* Debug Tab */
    
    debugLogs = signal<string[]>([]);

    private pointerListener = (event: PointerEvent) => {
        this.addDebugLog(`pointerdown: button=${event.button} pointerType=${event.pointerType} isPrimary=${event.isPrimary} ctrlKey=${event.ctrlKey} shiftKey=${event.shiftKey} altKey=${event.altKey} metaKey=${event.metaKey}`);
    };

    private keyListener = (event: KeyboardEvent) => {
        this.addDebugLog(`keydown: key=${event.key}, code=${event.code} ctrlKey=${event.ctrlKey} shiftKey=${event.shiftKey} altKey=${event.altKey} metaKey=${event.metaKey}`);
    };

    private clickListener = (event: MouseEvent) => {
        this.addDebugLog(`click: button=${event.button} ctrlKey=${event.ctrlKey} shiftKey=${event.shiftKey} altKey=${event.altKey} metaKey=${event.metaKey}`);
    };

    private addDebugLog(msg: string) {
        const logs = this.debugLogs().slice(0, 99); // Keep only the latest 100 logs
        logs.unshift(`[${new Date().toLocaleTimeString()}] ${msg}`);
        this.debugLogs.set(logs);
    }

    ngOnDestroy() {
        if (typeof window !== 'undefined') {
            window.removeEventListener('pointerdown', this.pointerListener, true);
            window.removeEventListener('keydown', this.keyListener, true);
            window.removeEventListener('click', this.clickListener, true);
        }
    }

    clearDebugLogs() {
        this.debugLogs.set([]);
    }
}