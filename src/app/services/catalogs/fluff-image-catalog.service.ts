// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { computed, Injectable, type Signal } from '@angular/core';
import type {
  CatalogDiagnostic,
  FluffImageCatalog,
  FluffImageResolution,
} from '../../models/presentation-catalog.model';
import type { DesignIdentity, UnitProviderId } from '../unit-catalog/unit-catalog.types';
import {
  buildFluffImageIndex,
  resolveFluffImage,
  type FluffImageFacts,
  type FluffImageIndex,
} from '../../utils/fluff-image-resolver';
import { ProviderCatalogStore } from './provider-catalog-store';

@Injectable({ providedIn: 'root' })
export class FluffImageCatalogService {
  private readonly catalogs = new ProviderCatalogStore<FluffImageCatalog>();
  private readonly indexes = new Map<UnitProviderId, FluffImageIndex>();

  beginLoading(provider: UnitProviderId): void {
    this.catalogs.beginLoading(provider);
  }

  publish(catalog: FluffImageCatalog): void {
    this.indexes.set(catalog.provider, buildFluffImageIndex(catalog.paths));
    this.catalogs.publish(catalog);
  }

  markUnavailable(provider: UnitProviderId, reason: CatalogDiagnostic): void {
    this.catalogs.markUnavailable(provider, reason);
  }

  watchUnitImage(design: DesignIdentity, facts: FluffImageFacts): Signal<FluffImageResolution> {
    return computed(() => this.resolveUnitImage(design, facts));
  }

  resolveUnitImage(design: DesignIdentity, facts: FluffImageFacts): FluffImageResolution {
    const state = this.catalogs.get(design.provider);
    if (state.status !== 'ready') return state;
    const index = this.indexes.get(design.provider);
    if (!index) return { status: 'unavailable', provider: design.provider, reason: 'invalid-catalog' };
    const match = resolveFluffImage(facts, index);
    return match
      ? {
          status: 'matched',
          asset: {
            provider: design.provider,
            baseUrl: state.catalog.baseUrl,
            path: match.path,
          },
        }
      : { status: 'no-match', provider: design.provider };
  }
}
