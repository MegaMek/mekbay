// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { computed, Injectable, signal } from '@angular/core';
import { uuidv7 } from '../utils/uuid.util';


export interface Toast {
    id: string;
    message: string;
    type: 'info' | 'success' | 'error';
    data?: Record<string, unknown>;
}

const TOAST_DURATION_MS = 3000;
const MAX_TOASTS = 10;
const MAX_VISIBLE_TOASTS = 3;

@Injectable({ providedIn: 'root' })
export class ToastService {
    private toastsSignal = signal<Toast[]>([]);
    public toasts = this.toastsSignal.asReadonly();
    public visibleToasts = computed(() => this.toastsSignal().slice(0, MAX_VISIBLE_TOASTS));
    private timeout?: ReturnType<typeof setTimeout>;

    showToast(message: string, type: Toast['type'], id?: string, data?: Toast['data']): string {
        const toastId = id || uuidv7();
        let toasts = this.toastsSignal();
        
        // If ID provided, check if toast already exists
        if (id) {
            const existingToastIndex = toasts.findIndex(t => t.id === id);
            
            if (existingToastIndex !== -1) {
                // Update existing toast
                const updatedToasts = [...toasts];
                updatedToasts[existingToastIndex] = {
                    ...updatedToasts[existingToastIndex],
                    message: message,
                    type: type,
                    data
                };
                this.toastsSignal.set(updatedToasts);
                if (existingToastIndex === 0) this.restartTimer();
                
                return toastId;
            }
        }
        
        // Create new toast
        let activeToastRemoved = false;
        if (toasts.length >= MAX_TOASTS) {
            toasts = toasts.slice(1); // Remove oldest
            activeToastRemoved = true;
        }
        
        const toast: Toast = { id: toastId, message, type, data };
        this.toastsSignal.set([...toasts, toast]);
        if (activeToastRemoved) {
            this.restartTimer();
        } else {
            this.startTimer();
        }
        
        return toastId;
    }

    dismiss(id: string) {
        const activeToastRemoved = this.toastsSignal()[0]?.id === id;
        this.toastsSignal.update(toasts => toasts.filter(t => t.id !== id));
        if (activeToastRemoved) this.restartTimer();
    }

    private startTimer() {
        if (this.timeout !== undefined || this.toastsSignal().length === 0) return;

        this.timeout = setTimeout(() => {
            this.timeout = undefined;
            const activeToast = this.toastsSignal()[0];
            if (activeToast) this.dismiss(activeToast.id);
        }, TOAST_DURATION_MS);
    }

    private restartTimer() {
        this.stopTimer();
        this.startTimer();
    }

    private stopTimer() {
        if (this.timeout === undefined) return;
        clearTimeout(this.timeout);
        this.timeout = undefined;
    }
}
