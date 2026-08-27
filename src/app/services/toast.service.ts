// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable, signal } from '@angular/core';
import { uuidv7 } from '../utils/uuid.util';


export interface Toast {
    id: string;
    message: string;
    type: 'info' | 'success' | 'error';
    data?: Record<string, unknown>;
}

const TOAST_DURATION_MS = 4000;
const MAX_TOASTS = 4;

@Injectable({ providedIn: 'root' })
export class ToastService {
    private toastsSignal = signal<Toast[]>([]);
    public toasts = this.toastsSignal.asReadonly();
    private timeouts = new Map<string, any>();

    showToast(message: string, type: Toast['type'], id?: string, data?: Toast['data']): string {
        const toastId = id || uuidv7();
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
                    message: message,
                    type: type,
                    data
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
        
        const toast: Toast = { id: toastId, message, type, data };
        this.toastsSignal.set([...toasts, toast]);
        
        const timeout = setTimeout(() => this.dismiss(toastId), TOAST_DURATION_MS);
        this.timeouts.set(toastId, timeout);
        
        return toastId;
    }

    dismiss(id: string) {
        this.clearTimeout(id);
        this.toastsSignal.update(toasts => toasts.filter(t => t.id !== id));
    }

    private clearTimeout(id: string) {
        const timeout = this.timeouts.get(id);
        if (timeout) {
            clearTimeout(timeout);
            this.timeouts.delete(id);
        }
    }
}