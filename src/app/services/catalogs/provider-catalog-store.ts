// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { computed, signal, type Signal } from '@angular/core';
import type { CatalogDiagnostic } from '../../models/presentation-catalog.model';
import type { UnitProviderId } from '../unit-catalog/unit-catalog.types';

export type ProviderCatalogState<T> =
  | { readonly status: 'loading'; readonly provider: UnitProviderId }
  | { readonly status: 'ready'; readonly provider: UnitProviderId; readonly catalog: T }
  | { readonly status: 'unavailable'; readonly provider: UnitProviderId; readonly reason: CatalogDiagnostic };

export class ProviderCatalogStore<T extends { readonly provider: UnitProviderId }> {
  private readonly states = signal<ReadonlyMap<UnitProviderId, ProviderCatalogState<T>>>(new Map());

  watch(provider: UnitProviderId): Signal<ProviderCatalogState<T>> {
    return computed(() => this.get(provider));
  }

  get(provider: UnitProviderId): ProviderCatalogState<T> {
    return this.states().get(provider) ?? { status: 'unavailable', provider, reason: 'not-loaded' };
  }

  beginLoading(provider: UnitProviderId): void {
    if (this.states().get(provider)?.status !== 'ready') {
      this.set(provider, { status: 'loading', provider });
    }
  }

  publish(catalog: T): void {
    this.set(catalog.provider, { status: 'ready', provider: catalog.provider, catalog });
  }

  markUnavailable(provider: UnitProviderId, reason: CatalogDiagnostic): void {
    if (this.states().get(provider)?.status !== 'ready') {
      this.set(provider, { status: 'unavailable', provider, reason });
    }
  }

  private set(provider: UnitProviderId, state: ProviderCatalogState<T>): void {
    const next = new Map(this.states());
    next.set(provider, state);
    this.states.set(next);
  }
}
