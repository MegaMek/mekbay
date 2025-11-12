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

import { Injectable, inject, Injector, afterNextRender } from '@angular/core';
import { firstValueFrom, Subject } from 'rxjs';
import { ConfirmDialogComponent, ConfirmDialogData } from '../components/confirm-dialog/confirm-dialog.component';
import { InputDialogComponent, InputDialogData } from '../components/input-dialog/input-dialog.component';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { DIALOG_DATA, DialogRef as CdkDialogRef } from '@angular/cdk/dialog';
import { ComponentType } from '@angular/cdk/portal';

/*
 * Author: Drake
 */
export interface DialogRef<T = any, R = any> {
    componentInstance: T;
    closed: Subject<R | undefined>;
    close: (result?: R) => void;
}

@Injectable({ providedIn: 'root' })
export class DialogsService {
    private overlay = inject(Overlay);
    private injector = inject(Injector);

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
        const positionStrategy = this.overlay.position().global()
            .centerHorizontally()
            .centerVertically();

        const overlayRef = this.overlay.create({
            positionStrategy,
            hasBackdrop: opts?.hasBackdrop ?? true,
            backdropClass: opts?.backdropClass ?? 'cdk-overlay-dark-backdrop',
            panelClass: opts?.panelClass,
            scrollStrategy: this.overlay.scrollStrategies.block(),
            width: opts?.width,
            height: opts?.height,
            maxWidth: opts?.maxWidth ?? '100dvw',
            maxHeight: opts?.maxHeight ?? '100dvh'
        });

        const closed = new Subject<R | undefined>();
        const close = (result?: R) => {
            try {
                if (!closed.closed) {
                    closed.next(result);
                    closed.complete();
                }
            } finally {
                // Dispose after notifying listeners
                if (overlayRef?.hasAttached()) {
                    overlayRef.dispose();
                }
            }
        };

        const injector = Injector.create({
            parent: this.injector,
            providers: [
                { provide: CdkDialogRef, useValue: { close, closed } as Partial<CdkDialogRef<R>> },
                { provide: DIALOG_DATA, useValue: opts?.data }
            ]
        });

        const portal = new ComponentPortal<T>(component, null, injector);
        const compRef = overlayRef.attach(portal);

        if (opts?.hasBackdrop ?? true) {
            overlayRef.backdropClick().subscribe(() => {
                if (!opts?.disableClose) close(undefined);
            });
        }
        overlayRef.keydownEvents().subscribe(ev => {
            if (!opts?.disableClose && (ev.key === 'Escape' || ev.key === 'Esc')) {
                ev.preventDefault();
                close(undefined);
            }
        });
        afterNextRender(() => {
            try {
                const panel = overlayRef.overlayElement as HTMLElement;
                const focusable = panel.querySelector<HTMLElement>(
                    'input, select, textarea, [contenteditable="true"], button, [href], [tabindex]:not([tabindex="-1"])'
                );
                if (focusable) {
                    focusable.focus();
                } else {
                    // If no focusable element found, focus the first child to trap focus
                    const firstChild = panel.firstElementChild as HTMLElement;
                    if (firstChild) {
                        firstChild.setAttribute('tabindex', '-1');
                        firstChild.focus();
                    }
                }
            } catch { /* ignore */ }
        }, { injector: this.injector });
        overlayRef.detachments().subscribe(() => {
            if (!closed.closed) {
                closed.next(undefined);
                closed.complete();
            }
        });

        return {
            componentInstance: compRef.instance as T,
            closed,
            close
        };
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

    async prompt(message: string, title: string, defaultValue = ''): Promise<string | null> {
        const ref = this.createDialog<string | null>(InputDialogComponent, {
            disableClose: true,
            data: <InputDialogData>{
                title,
                message,
                inputType: 'text',
                defaultValue
            }
        });
        const result = await firstValueFrom(ref.closed);
        return result ?? null;
    }
}