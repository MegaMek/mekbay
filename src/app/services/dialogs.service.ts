// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ConfirmDialogComponent, type ConfirmDialogData } from '../components/confirm-dialog/confirm-dialog.component';
import { InputDialogComponent, type InputDialogData } from '../components/input-dialog/input-dialog.component';
import { Dialog, type DialogRef as CdkDialogRef, type DIALOG_DATA } from '@angular/cdk/dialog';
import type { ComponentType } from '@angular/cdk/portal';

export type PromptOptions = Pick<InputDialogData,
    'buttons' | 'centerInput' | 'inputLabel' | 'maximumLength' | 'minimumLength' | 'pattern' | 'placeholder'>;


export interface DialogRef<T = any, R = any> {
    componentInstance: T;
    closed: CdkDialogRef<R, T>['closed'];
    close: (result?: R) => void;
}

type DialogAutoFocus = boolean | string;

export interface DialogOptions<D = unknown> {
    data?: D;
    panelClass?: string | string[];
    backdropClass?: string | string[];
    disableClose?: boolean;
    hasBackdrop?: boolean;
    width?: string;
    height?: string;
    maxWidth?: string;
    maxHeight?: string;
    autoFocus?: DialogAutoFocus;
}

@Injectable({ providedIn: 'root' })
export class DialogsService {
    private dialog = inject(Dialog);

    // Generic dialog creator using CDK Overlay, compatible with components expecting CDK Dialog
    public createDialog<R = any, T = any, D = unknown>(
        component: ComponentType<T>,
        opts?: DialogOptions<D>
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
            autoFocus: opts?.autoFocus ?? false,
            restoreFocus: false
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

    async requestConfirmation(message: string, title: string, type: 'info' | 'warning' | 'danger'): Promise<boolean> {
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

    async prompt(
        message: string,
        title: string,
        defaultValue = '',
        hint = '',
        options: PromptOptions = {},
    ): Promise<string | null> {
        const ref = this.createDialog<string | null>(InputDialogComponent, {
            disableClose: true,
            autoFocus: 'first-tabbable',
            data: <InputDialogData>{
                title,
                message,
                inputType: 'text',
                defaultValue,
                hint: hint || undefined,
                ...options,
            }
        });
        const result = await firstValueFrom(ref.closed);
        return result ?? null;
    }

    showNextDialog(): void {
        this.showNoticeHtml(
            'You are using the <strong>pre-release</strong> version of MekBay. ' +
            'This build may contain experimental features and bugs.<br><br>' +
            'The stable version is available at <a href="https://mekbay.com" target="_blank" rel="noopener">mekbay.com</a>.',
            'Pre-Release Version'
        );
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
