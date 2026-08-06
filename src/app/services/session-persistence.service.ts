// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable } from '@angular/core';

/**
 * 
 * A wrapper around sessionStorage that falls back to an in-memory store if sessionStorage is unavailable.
 */
@Injectable({
    providedIn: 'root'
})
export class SessionPersistenceService {
    private readonly fallbackStore = new Map<string, string>();
    private usingFallback = false;

    getItem(key: string): string | null {
        if (this.usingFallback) {
            return this.fallbackStore.get(key) ?? null;
        }

        try {
            return sessionStorage.getItem(key);
        } catch {
            this.usingFallback = true;
            return this.fallbackStore.get(key) ?? null;
        }
    }

    setItem(key: string, value: string): void {
        this.fallbackStore.set(key, value);

        if (this.usingFallback) {
            return;
        }

        try {
            sessionStorage.setItem(key, value);
        } catch {
            this.usingFallback = true;
            // Best effort only; callers should not depend on session storage availability.
        }
    }

    removeItem(key: string): void {
        this.fallbackStore.delete(key);

        if (this.usingFallback) {
            return;
        }

        try {
            sessionStorage.removeItem(key);
        } catch {
            this.usingFallback = true;
            // Best effort only; callers should not depend on session storage availability.
        }
    }
}