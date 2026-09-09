// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { inject, Injector } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { RedirectCommand, Router, type CanActivateFn, type ResolveFn, type Routes } from '@angular/router';
import { filter, map, take } from 'rxjs';
import { DataService } from './services/data.service';
import { ToastService } from './services/toast.service';
import { CustomUnitSyncService } from './services/custom-unit-sync.service';
import { asUnitUuid } from './services/unit-catalog/unit-catalog.types';
import { CBTForceMember } from './models/force-member.model';
import type { UnitSummary } from './models/unit-summary.model';

/**
 * Holds page activation (and therefore its dialog) until the unit data is
 * loaded. The app shell renders independently, so deep links simply open
 * their page once data is ready.
 */
const dataReadyGuard: CanActivateFn = () => {
  const dataService = inject(DataService);
  return toObservable(dataService.isDataReady).pipe(
    filter((ready) => ready),
    take(1),
    map(() => true),
  );
};

const constructionUnitResolver: ResolveFn<UnitSummary | CBTForceMember> = async (route) => {
  const router = inject(Router);
  const data = inject(DataService);
  const toast = inject(ToastService);
  const injector = inject(Injector);
  try {
    const uuid = asUnitUuid(route.paramMap.get('uuid')!);
    const member = router.currentNavigation()?.extras.info;
    if (member instanceof CBTForceMember && member.entity.uuid() === uuid) {
      if (member.force.readOnly() || member.force.getCBTMember(member.id) !== member) {
        throw new Error('This force unit is no longer available for refitting.');
      }
      return member;
    }
    let unit = data.getUnitByUuid(uuid);
    if (!unit) {
      await injector.get(CustomUnitSyncService).openShared(uuid);
      unit = data.getUnitByUuid(uuid);
    }
    if (!unit) throw new Error('This unit is not available on this device.');
    return unit;
  } catch (error) {
    toast.showToast(error instanceof Error ? error.message : 'Unit construction could not be opened', 'error');
    return new RedirectCommand(
      router.createUrlTree(['/'], {
        queryParams: route.queryParams,
      }),
      { replaceUrl: true },
    );
  }
};

/**
 * App pages: fullscreen dialogs that own a URL path while they are open.
 * To add a new page, create a `RoutedDialogPage` component and register it here.
 */
export const routes: Routes = [
  {
    path: 'meklab/:uuid',
    canActivate: [dataReadyGuard],
    canDeactivate: [(component: { canDeactivate(): boolean | Promise<boolean> }) => component.canDeactivate()],
    resolve: { unit: constructionUnitResolver },
    loadComponent: () =>
      import('./pages/unit-construction-page.component').then((m) => m.UnitConstructionPageComponent),
  },
  {
    path: 'meklab',
    canActivate: [dataReadyGuard],
    canDeactivate: [(component: { canDeactivate(): boolean | Promise<boolean> }) => component.canDeactivate()],
    loadComponent: () =>
      import('./pages/unit-construction-page.component').then((m) => m.UnitConstructionPageComponent),
  },
  {
    path: 'toe',
    canActivate: [dataReadyGuard],
    loadComponent: () => import('./pages/toe-page.component').then((m) => m.ToePageComponent),
  },
  {
    path: 'forcegenerator',
    canActivate: [dataReadyGuard],
    loadComponent: () => import('./pages/force-generator-page.component').then((m) => m.ForceGeneratorPageComponent),
  },
  {
    path: 'collection',
    canActivate: [dataReadyGuard],
    loadComponent: () => import('./pages/collection-page.component').then((m) => m.CollectionPageComponent),
  },
  { path: '', pathMatch: 'full', children: [] },
  { path: '**', redirectTo: '' },
];
