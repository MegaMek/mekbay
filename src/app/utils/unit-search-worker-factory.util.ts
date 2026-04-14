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

import { InjectionToken } from '@angular/core';
import { isIOS } from './platform.util';
import type { SearchWorkerLike } from './unit-search-worker-client.util';

export type SearchWorkerFactory = (() => SearchWorkerLike) | null;

export interface SearchWorkerSupportOptions {
    workerAvailable: boolean;
    iOS: boolean;
}

export function shouldUseSearchWorker(options: SearchWorkerSupportOptions = {
    workerAvailable: typeof Worker !== 'undefined',
    iOS: isIOS(),
}): boolean {
    return options.workerAvailable && !options.iOS; // Disable service worker on iOS.
}

export const SEARCH_WORKER_FACTORY = new InjectionToken<SearchWorkerFactory>('SEARCH_WORKER_FACTORY', {
    providedIn: 'root',
    factory: () => {
        if (!shouldUseSearchWorker()) {
            return null;
        }

        return () => new Worker(new URL('../unit-search.worker', import.meta.url), { type: 'module' });
    },
});