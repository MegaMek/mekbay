// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { UnitProviderId } from '../services/unit-catalog/unit-catalog.types';
import type { FluffImagePath } from '../utils/fluff-image-resolver';

export interface FluffImageCatalog {
  readonly provider: UnitProviderId;
  readonly baseUrl: string;
  readonly paths: readonly FluffImagePath[];
}

export interface FluffImageAssetRef {
  readonly provider: UnitProviderId;
  readonly baseUrl: string;
  readonly path: FluffImagePath;
}

export type CatalogDiagnostic = 'not-loaded' | 'invalid-catalog' | 'offline-no-cache';

export type FluffImageResolution =
  | { readonly status: 'loading'; readonly provider: UnitProviderId }
  | { readonly status: 'matched'; readonly asset: FluffImageAssetRef }
  | { readonly status: 'no-match'; readonly provider: UnitProviderId }
  | { readonly status: 'unavailable'; readonly provider: UnitProviderId; readonly reason: CatalogDiagnostic };
