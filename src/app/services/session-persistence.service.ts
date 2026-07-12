/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
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

import { Injectable } from '@angular/core';

/**
 * Author: Drake
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