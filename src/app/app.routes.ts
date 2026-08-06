// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { type CanActivateFn, type Routes } from '@angular/router';
import { filter, map, take } from 'rxjs';
import { DataService } from './services/data.service';

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
