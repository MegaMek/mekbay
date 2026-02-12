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

import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ConfirmDialogComponent, ConfirmDialogData } from '../components/confirm-dialog/confirm-dialog.component';
import { InputDialogComponent, InputDialogData } from '../components/input-dialog/input-dialog.component';
import { Dialog, DialogRef as CdkDialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ComponentType } from '@angular/cdk/portal';

/*
 * Author: Drake
 */
export interface DialogRef<T = any, R = any> {
    componentInstance: T;
    closed: CdkDialogRef<R, T>['closed'];
    close: (result?: R) => void;
}

@Injectable({ providedIn: 'root' })
export class DialogsService {
    private dialog = inject(Dialog);

    // Generic dialog creator using CDK Overlay, compatible with components expecting CDK Dialog
    public createDialog<R = any, T = any, D = unknown>(
        component: ComponentType<T>,
        opts?: {
            data?: D;
            panelClass?: string | string[];
            backdropClass?: string | string[];
            disableClose?: boolean;
            hasBackdrop?: boolean;
            width?: string;
            height?: string;
            maxWidth?: string;
            maxHeight?: string;
        }
    ): DialogRef<T, R> {
        const cdkRef = this.dialog.open<R, D, T>(component, {
            data: opts?.data,
            panelClass: opts?.panelClass,
            backdropClass: opts?.backdropClass ?? 'cdk-overlay-dark-backdrop',
            disableClose: opts?.disableClose,
            hasBackdrop: opts?.hasBackdrop ?? true,
            width: opts?.width,
            height: opts?.height,
            maxWidth: opts?.maxWidth ?? '100dvw',
            maxHeight: opts?.maxHeight ?? '100dvh',
            autoFocus: 'first-tabbable'
        });

        return {
            componentInstance: cdkRef.componentInstance!,
            closed: cdkRef.closed,
            close: (result?: R) => cdkRef.close(result)
        };
    }

    async showNoticeHtml(messageHtml: string, title = 'Notice'): Promise<void> {
        const ref = this.createDialog(ConfirmDialogComponent, {
            disableClose: true,
            data: <ConfirmDialogData<string>>{
                title,
                messageHtml,
                buttons: [{ label: 'DISMISS', value: 'nop' }]
            }
        });
        await firstValueFrom(ref.closed);
    }

    async showNotice(message: string, title = 'Notice'): Promise<void> {
        const ref = this.createDialog(ConfirmDialogComponent, {
            disableClose: true,
            data: <ConfirmDialogData<string>>{
                title,
                message,
                buttons: [{ label: 'DISMISS', value: 'nop' }]
            }
        });
        await firstValueFrom(ref.closed);
    }

    async requestConfirmation(message: string, title: string, type: 'info' | 'danger'): Promise<boolean> {
        const ref = this.createDialog<string>(ConfirmDialogComponent, {
            disableClose: true,
            panelClass: type,
            data: <ConfirmDialogData<string>>{
                title,
                message,
                buttons: [
                    { label: 'CONFIRM', value: 'yes' },
                    { label: 'DISMISS', value: 'no' }
                ]
            }
        });
        const answer = await firstValueFrom(ref.closed);
        return answer === 'yes';
    }

    async showError(message: string, title = 'Error'): Promise<void> {
        const ref = this.createDialog(ConfirmDialogComponent, {
            disableClose: true,
            panelClass: 'danger',
            data: <ConfirmDialogData<string>>{
                title,
                message,
                buttons: [{ label: 'DISMISS', value: 'nop', class: 'danger' }]
            }
        });
        await firstValueFrom(ref.closed);
    }

    async prompt(message: string, title: string, defaultValue = '', hint = ''): Promise<string | null> {
        const ref = this.createDialog<string | null>(InputDialogComponent, {
            disableClose: true,
            data: <InputDialogData>{
                title,
                message,
                inputType: 'text',
                defaultValue,
                hint: hint || undefined
            }
        });
        const result = await firstValueFrom(ref.closed);
        return result ?? null;
    }

    /**
     * Show a dialog with arbitrary buttons and return the chosen value.
     * @param title Dialog title
     * @param message Dialog message (plain text)
     * @param buttons Array of buttons with labels and values
     * @param defaultValue Value to return if dialog is dismissed without selection
     * @param opts Additional dialog options (panelClass, messageHtml, etc.)
     */
    async choose<T>(
        title: string,
        message: string,
        buttons: { label: string; value: T; class?: string }[],
        defaultValue: T,
        opts?: { panelClass?: string; messageHtml?: string }
    ): Promise<T> {
        const ref = this.createDialog<T>(ConfirmDialogComponent, {
            disableClose: true,
            panelClass: opts?.panelClass,
            data: <ConfirmDialogData<T>>{
                title,
                message: opts?.messageHtml ? undefined : message,
                messageHtml: opts?.messageHtml,
                buttons
            }
        });
        const result = await firstValueFrom(ref.closed);
        return result ?? defaultValue;
    }
}