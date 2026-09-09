// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ApplicationCatalogDependencyBundle } from './application-catalog-dependency-bundle';
import type { ProjectedUnitSummary, UnitSummaryProjectionInput } from './entity-summary-projector';

export const UNIT_SUMMARY_PROJECTION_BATCH_SIZE = 64;

export type UnitSummaryProjectionDependencies = Pick<ApplicationCatalogDependencyBundle,
    'equipment' | 'quirks' | 'sourcebooks' | 'spriteManifest'>;

/** A malformed custom design must not discard the other designs in its batch. */
export type UnitSummaryProjectionOutcome =
    | { readonly status: 'projected'; readonly value: ProjectedUnitSummary }
    | { readonly status: 'error'; readonly message: string };

export type UnitSummaryProjectionWorkerRequest =
    | { readonly type: 'initialize'; readonly dependencies: UnitSummaryProjectionDependencies }
    | { readonly type: 'project'; readonly requestId: number; readonly units: readonly UnitSummaryProjectionInput[] };

export type UnitSummaryProjectionWorkerResponse =
    | { readonly type: 'ready' }
    | { readonly type: 'projected'; readonly requestId: number; readonly outcomes: readonly UnitSummaryProjectionOutcome[] }
    | { readonly type: 'error'; readonly message: string };
