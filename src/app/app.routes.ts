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

import { inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { type CanActivateFn, type Routes } from '@angular/router';
import { filter, map, take } from 'rxjs';
import { DataService } from './services/data.service';

/*
 * Author: Drake
 */

/**
 * Holds page activation (and therefore its dialog) until the unit data is
 * loaded. The app shell renders independently, so deep links simply open
 * their page once data is ready.
 */
const dataReadyGuard: CanActivateFn = () => {
    const dataService = inject(DataService);
    return toObservable(dataService.isDataReady).pipe(
        filter(ready => ready),
        take(1),
        map(() => true),
    );
};

/**
 * App pages: fullscreen dialogs that own a URL path while they are open.
 * To add a new page, create a `RoutedDialogPage` component and register it here.
 */
export const routes: Routes = [
    {
        path: 'toe',
        canActivate: [dataReadyGuard],
        loadComponent: () => import('./pages/toe-page.component').then(m => m.ToePageComponent),
    },
    {
        path: 'forcegenerator',
        canActivate: [dataReadyGuard],
        loadComponent: () => import('./pages/force-generator-page.component').then(m => m.ForceGeneratorPageComponent),
    },
    {
        path: 'collection',
        canActivate: [dataReadyGuard],
        loadComponent: () => import('./pages/collection-page.component').then(m => m.CollectionPageComponent),
    },
    { path: '', pathMatch: 'full', children: [] },
    { path: '**', redirectTo: '' },
];
