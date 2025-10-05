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

import { Injectable, signal } from '@angular/core';
import { generateUUID } from './ws.service';

/*
 * Author: Drake
 */
export interface Toast {
    id: string;
    message: string;
    type: 'info' | 'success' | 'error';
}

const TOAST_DURATION_MS = 3000;
const MAX_TOASTS = 3;

@Injectable({ providedIn: 'root' })
export class ToastService {
    private toastsSignal = signal<Toast[]>([]);
    public toasts = this.toastsSignal.asReadonly();
    private timeouts = new Map<string, any>();

    show(message: string, type: Toast['type'], id?: string): string {
        const toastId = id || generateUUID();
        let toasts = this.toastsSignal();
        
        // If ID provided, check if toast already exists
        if (id) {
            const existingToastIndex = toasts.findIndex(t => t.id === id);
            
            if (existingToastIndex !== -1) {
                // Clear existing timeout
                this.clearTimeout(id);
                
                // Update existing toast
                const updatedToasts = [...toasts];
                updatedToasts[existingToastIndex] = {
                    ...updatedToasts[existingToastIndex],
                    message: message
                };
                this.toastsSignal.set(updatedToasts);
                
                // Set new timeout
                const timeout = setTimeout(() => this.dismiss(toastId), TOAST_DURATION_MS);
                this.timeouts.set(toastId, timeout);
                
                return toastId;
            }
        }
        
        // Create new toast
        if (toasts.length >= MAX_TOASTS) {
            const removedToast = toasts[0];
            this.clearTimeout(removedToast.id);
            toasts = toasts.slice(1); // Remove oldest
        }
        
        const toast: Toast = { id: toastId, message, type };
        this.toastsSignal.set([...toasts, toast]);
        
        const timeout = setTimeout(() => this.dismiss(toastId), TOAST_DURATION_MS);
        this.timeouts.set(toastId, timeout);
        
        return toastId;
    }

    dismiss(id: string) {
        this.clearTimeout(id);
        this.toastsSignal.set(this.toastsSignal().filter(t => t.id !== id));
    }

    private clearTimeout(id: string) {
        const timeout = this.timeouts.get(id);
        if (timeout) {
            clearTimeout(timeout);
            this.timeouts.delete(id);
        }
    }
}