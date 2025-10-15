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
import { firstValueFrom, Subject } from 'rxjs';
import { ConfirmDialogComponent, ConfirmDialogData } from '../components/confirm-dialog/confirm-dialog.component';
import { Dialog } from '@angular/cdk/dialog';

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
    private dialog: Dialog = inject(Dialog);
    
    async showNotice(message: string, title = 'Notice'): Promise<void> {
        const dialogRef = this.dialog.open(ConfirmDialogComponent, {
            disableClose: true, // Prevents closing by clicking outside or pressing Escape
            data: <ConfirmDialogData<string>>{
                title,
                message,
                buttons: [
                    { label: 'DISMISS', value: 'nop' }
                ]
            }
        });
        // Wait for dialog to close, we don't really care about the result
        await firstValueFrom(dialogRef.closed); 
    }

    async showQuestion(message: string, title: string, type: 'info' | 'danger'): Promise<string | null> {
        const dialogRef = this.dialog.open<string>(ConfirmDialogComponent, {
            disableClose: true, // Prevents closing by clicking outside or pressing Escape
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
        const answer = await firstValueFrom(dialogRef.closed);
        
        if (answer && answer !== null) {
            return answer;
        }
        return null;
    }

    async showError(message: string, title = 'Error'): Promise<void> {
        const dialogRef = this.dialog.open(ConfirmDialogComponent, {
            disableClose: true, // Prevents closing by clicking outside or pressing Escape
            panelClass: 'danger',
            data: <ConfirmDialogData<string>>{
                title,
                message,
                buttons: [
                    { label: 'DISMISS', value: 'nop', class: 'danger' }
                ]
            }
        });
        // Wait for dialog to close, we don't really care about the result
        await firstValueFrom(dialogRef.closed); 
    }
}