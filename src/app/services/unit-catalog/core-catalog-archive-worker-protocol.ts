// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { UnitSummary } from '../../models/unit-summary.model';
import type { ApplicationCatalogDependencyBundle } from './application-catalog-dependency-bundle';
import type { CoreUnitsManifest } from './core-unit-manifest';
import type { UnitFileName } from './unit-catalog.types';
import type { CoreUnitSourceReplacement } from './core-unit-archive';

export const CORE_CATALOG_ARCHIVE_SUMMARY_TRANSFER_CHUNK_SIZE = 64;

export type CoreCatalogArchiveWorkerProgress =
    | { readonly phase: 'archive-validation' }
    | { readonly phase: 'dependency-transfer'; readonly completed: number; readonly total: 1 }
    | { readonly phase: 'summary-transfer'; readonly completed: number; readonly total: number };

export type CoreCatalogArchiveWorkerRequest = { readonly sessionId: string } & (
    | {
        readonly type: 'open';
        readonly source: ArrayBuffer;
        readonly checksum: string;
        readonly manifest: CoreUnitsManifest;
    }
    | {
        readonly type: 'open-source';
        readonly source: ArrayBuffer;
        readonly manifest: CoreUnitsManifest;
    }
    | {
        readonly type: 'extract';
        readonly requestId: number;
        readonly file: UnitFileName;
    }
    | {
        readonly type: 'compact-sources';
        readonly requestId: number;
        readonly manifest: CoreUnitsManifest;
        readonly replacements: readonly CoreUnitSourceReplacement[];
    }
    | { readonly type: 'close' }
);

export type CoreCatalogArchiveWorkerResponse = { readonly sessionId: string } & (
    | {
        readonly type: 'progress';
        readonly progress: CoreCatalogArchiveWorkerProgress;
    }
    | {
        readonly type: 'opened';
        readonly files: readonly UnitFileName[];
        readonly summaryUnitCount: number;
        readonly summaryChunkCount: number;
        readonly dependencyBundle: ApplicationCatalogDependencyBundle;
    }
    | {
        readonly type: 'source-opened';
        readonly files: readonly UnitFileName[];
    }
    | {
        readonly type: 'summary-chunk';
        readonly chunkIndex: number;
        readonly chunkCount: number;
        readonly start: number;
        readonly units: readonly UnitSummary[];
    }
    | { readonly type: 'ready'; readonly summaryChunkCount: number }
    | { readonly type: 'source-ready' }
    | {
        readonly type: 'extracted';
        readonly requestId: number;
        readonly bytes: ArrayBuffer;
    }
    | {
        readonly type: 'compacted-sources';
        readonly requestId: number;
        readonly bytes: ArrayBuffer;
    }
    | {
        readonly type: 'error';
        readonly scope: 'open' | 'extract' | 'protocol';
        readonly message: string;
        readonly requestId?: number;
    }
);
