// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

export type StartupCoreCatalogPhase =
    | 'local-database'
    | 'local-generation'
    | 'local-bundle'
    | 'dependency-cache'
    | 'dependency-fetch'
    | 'dependency-validation'
    | 'dependency-staging'
    | 'manifest'
    | 'archive'
    | 'archive-compaction'
    | 'summary-extraction'
    | 'projecting'
    | 'publication'
    | 'complete';

export interface StartupCoreCatalogProgress {
    readonly phase: StartupCoreCatalogPhase;
    readonly completed: number;
    readonly total: number;
    readonly transferredBytes?: number;
}

/** The small public core-catalog surface needed by startup presentation. */
export type StartupCoreCatalogState =
    | { readonly status: 'idle'; readonly availableUnits: number }
    | {
        readonly status: 'loading';
        readonly availableUnits: number;
        readonly progress?: StartupCoreCatalogProgress;
    }
    | {
        /** This tab is following a catalog publication owned by another tab. */
        readonly status: 'waiting';
        readonly availableUnits: number;
        readonly reason: 'catalog-leader';
    }
    | { readonly status: 'ready'; readonly availableUnits: number }
    | { readonly status: 'error'; readonly availableUnits: number; readonly error: string };

export type RuntimeCatalogProgressState =
    | { readonly status: 'idle' }
    | {
        readonly status: 'running';
        readonly completed: number;
        readonly total: number;
        readonly detail: string;
    }
    | { readonly status: 'error'; readonly detail: string };

export interface BackgroundCatalogProgressInput {
    readonly dataReady: boolean;
    readonly coreCatalog: StartupCoreCatalogState;
    readonly runtimeCatalog?: RuntimeCatalogProgressState;
    readonly auxiliaryCatalog?: RuntimeCatalogProgressState;
}

export type BackgroundCatalogProgressView =
    | { readonly kind: 'hidden' }
    | {
        readonly kind: 'notice';
        readonly tone: 'warning';
        readonly title: string;
        readonly detail: string;
    }
    | {
        readonly kind: 'progress';
        readonly mode: 'indeterminate';
        readonly title: string;
        readonly detail: string;
    }
    | {
        readonly kind: 'progress';
        readonly mode: 'determinate';
        readonly title: string;
        readonly detail: string;
        readonly completed: number;
        readonly total: number;
        readonly percent: number;
        readonly ariaValueText: string;
    };

export type CoreCatalogPhaseProgressView =
    | {
        readonly mode: 'indeterminate';
        readonly title: string;
        readonly detail: string;
    }
    | {
        readonly mode: 'determinate';
        readonly title: string;
        readonly detail: string;
        readonly completed: number;
        readonly total: number;
        readonly percent: number;
        readonly ariaValueText: string;
    };

interface PhaseCopy {
    readonly title: string;
    readonly completedLabel: string;
    readonly zeroDetail: string;
}

const HIDDEN = Object.freeze({ kind: 'hidden' as const });

const PHASE: Readonly<Record<Exclude<StartupCoreCatalogPhase, 'complete'>, PhaseCopy>> = Object.freeze({
    'local-database': Object.freeze({
        title: 'Opening the local catalog database',
        completedLabel: 'local catalog database opens complete',
        zeroDetail: 'Waiting for IndexedDB to open the local catalog database.',
    }),
    'local-generation': Object.freeze({
        title: 'Opening the saved catalog generation',
        completedLabel: 'saved catalog generations opened',
        zeroDetail: 'Reading unit summaries and manifests from their dedicated IndexedDB rows.',
    }),
    'local-bundle': Object.freeze({
        title: 'Preparing saved catalog members',
        completedLabel: 'saved catalog members ready',
        zeroDetail: 'Preparing equipment, quirks, sourcebooks, eras, factions, sheets, and sprites.',
    }),
    'dependency-cache': Object.freeze({
        title: 'Checking saved catalog inputs',
        completedLabel: 'catalog inputs checked',
        zeroDetail: 'Checking which required catalog inputs are already available.',
    }),
    'dependency-fetch': Object.freeze({
        title: 'Preparing required catalog data',
        completedLabel: 'catalog inputs ready',
        zeroDetail: 'Comparing saved catalog rows with the repository asset hashes.',
    }),
    'dependency-validation': Object.freeze({
        title: 'Preparing catalog members in parallel',
        completedLabel: 'catalog members ready',
        zeroDetail: 'Preparing equipment, quirks, sourcebooks, eras, factions, sheets, and sprites.',
    }),
    'dependency-staging': Object.freeze({
        title: 'Staging changed catalogs',
        completedLabel: 'catalog staging steps complete',
        zeroDetail: 'Preparing only changed catalog rows for activation.',
    }),
    manifest: Object.freeze({
        title: 'Verifying the pinned core release',
        completedLabel: 'manifest checks complete',
        zeroDetail: 'Preparing to verify the pinned core manifest.',
    }),
    archive: Object.freeze({
        title: 'Preparing the core unit ZIP',
        completedLabel: 'source entries prepared',
        zeroDetail: 'Reusing the installed units-only core archive.',
    }),
    'archive-compaction': Object.freeze({
        title: 'Saving the units-only core ZIP',
        completedLabel: 'archive replacement steps complete',
        zeroDetail: 'Copying unchanged compressed members and applying the source-file delta in a worker.',
    }),
    'summary-extraction': Object.freeze({
        title: 'Reading prebuilt unit summaries',
        completedLabel: 'unit summaries read',
        zeroDetail: 'Preparing to read the summaries embedded in the core archive.',
    }),
    projecting: Object.freeze({
        title: 'Updating changed unit summaries',
        completedLabel: 'unit summaries updated',
        zeroDetail: 'Checking whether any unit summaries need to be rebuilt.',
    }),
    publication: Object.freeze({
        title: 'Publishing the core unit catalog',
        completedLabel: 'publication steps complete',
        zeroDetail: 'Preparing to activate the verified core catalog.',
    }),
});

function indeterminatePhase(
    title: string,
    detail: string,
): CoreCatalogPhaseProgressView {
    return Object.freeze({ mode: 'indeterminate', title, detail });
}

function finishingCatalogCommit(): CoreCatalogPhaseProgressView {
    return indeterminatePhase(
        'Finishing application catalog setup',
        'The verified catalogs are installed. Search, filters, and workers are being committed together.',
    );
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const byteUnits = ['KB', 'MB', 'GB'] as const;
    let value = bytes / 1024;
    let unit: (typeof byteUnits)[number] = byteUnits[0];
    for (let index = 1; index < byteUnits.length && value >= 1024; index += 1) {
        value /= 1024;
        unit = byteUnits[index];
    }
    return `${Number(value.toFixed(value >= 10 ? 0 : 1))} ${unit}`;
}

export function projectCoreCatalogPhaseProgress(
    progress: StartupCoreCatalogProgress,
): CoreCatalogPhaseProgressView {
    if (progress.phase === 'complete') return finishingCatalogCommit();

    const copy = PHASE[progress.phase];
    const hasFiniteTotal = Number.isSafeInteger(progress.total) && progress.total > 0;
    const hasFiniteCompleted = Number.isSafeInteger(progress.completed)
        && progress.completed >= 0
        && progress.completed <= progress.total;
    if (!hasFiniteTotal || !hasFiniteCompleted) {
        return indeterminatePhase(
            copy.title,
            progress.total === 0 && progress.completed === 0
                ? copy.zeroDetail
                : 'The amount of work in this phase is not known yet.',
        );
    }

    const completed = progress.completed;
    let detail = `${completed} of ${progress.total} ${copy.completedLabel}`;
    const transferredBytes = progress.transferredBytes;
    if (progress.phase === 'archive'
        && transferredBytes !== undefined
        && Number.isSafeInteger(transferredBytes)
        && transferredBytes >= 0) {
        if (completed === 0 && transferredBytes === 0) {
            return indeterminatePhase(copy.title, 'Starting the immutable core archive transfer.');
        }
        detail = transferredBytes === completed
            ? `${formatBytes(completed)} of ${formatBytes(progress.total)} downloaded`
            : `${detail} · ${formatBytes(transferredBytes)} transferred`;
    }
    return Object.freeze({
        mode: 'determinate',
        title: copy.title,
        detail,
        completed,
        total: progress.total,
        percent: Math.round((completed / progress.total) * 100),
        ariaValueText: detail,
    });
}

/**
 * Projects post-bootstrap work into a thin non-blocking status bar. Percentages
 * remain local to the currently observed phase because parallel catalog work
 * cannot provide an honest combined ETA.
 */
export function projectBackgroundCatalogProgress(
    input: BackgroundCatalogProgressInput,
): BackgroundCatalogProgressView {
    const activeTask = [
        { state: input.runtimeCatalog, title: 'Preparing unit indexes' },
        { state: input.auxiliaryCatalog, title: 'Preparing auxiliary catalogs' },
    ].find(task => task.state?.status === 'running');
    const runtime = activeTask?.state;
    if (runtime?.status === 'running') {
        const valid = Number.isSafeInteger(runtime.total)
            && runtime.total > 0
            && Number.isSafeInteger(runtime.completed)
            && runtime.completed >= 0
            && runtime.completed <= runtime.total;
        if (!valid) {
            return Object.freeze({
                kind: 'progress',
                mode: 'indeterminate',
                title: activeTask!.title,
                detail: runtime.detail,
            });
        }
        return Object.freeze({
            kind: 'progress',
            mode: 'determinate',
            title: activeTask!.title,
            detail: runtime.detail,
            completed: runtime.completed,
            total: runtime.total,
            percent: Math.round((runtime.completed / runtime.total) * 100),
            ariaValueText: `${runtime.detail} (${runtime.completed} of ${runtime.total})`,
        });
    }
    const failedTask = [input.runtimeCatalog, input.auxiliaryCatalog]
        .find(state => state?.status === 'error');
    if (failedTask?.status === 'error') {
        return Object.freeze({
            kind: 'notice',
            tone: 'warning',
            title: 'Background task failed; unit summaries remain available',
            detail: failedTask.detail,
        });
    }

    const core = input.coreCatalog;
    switch (core.status) {
        case 'waiting':
            return Object.freeze({
                kind: 'progress',
                mode: 'indeterminate',
                title: 'Another tab is updating catalogs…',
                detail: 'This tab will switch after the shared complete bundle is committed.',
            });
        case 'loading':
            const title = input.dataReady ? 'Updating catalogs…' : 'Loading saved catalogs…';
            if (core.progress) {
                const phase = projectCoreCatalogPhaseProgress(core.progress);
                if (phase.mode === 'determinate') {
                    return Object.freeze({
                        kind: 'progress',
                        mode: 'determinate',
                        title,
                        detail: `${phase.title}: ${phase.detail}`,
                        completed: phase.completed,
                        total: phase.total,
                        percent: phase.percent,
                        ariaValueText: phase.ariaValueText,
                    });
                }
                return Object.freeze({
                    kind: 'progress',
                    mode: 'indeterminate',
                    title,
                    detail: `${phase.title}: ${phase.detail}`,
                });
            }
            return Object.freeze({
                kind: 'progress',
                mode: 'indeterminate',
                title,
                detail: input.dataReady
                    ? 'Checking the pinned catalog release without blocking the app.'
                    : 'Opening the local catalog database.',
            });
        case 'error':
            if (!input.dataReady) {
                return Object.freeze({
                    kind: 'notice',
                    tone: 'warning',
                    title: 'Catalog startup failed',
                    detail: core.error,
                });
            }
            return Object.freeze({
                kind: 'notice',
                tone: 'warning',
                title: 'Catalog refresh failed; saved data remains active',
                detail: 'The committed application data remains usable.',
            });
        case 'idle':
        case 'ready':
            return HIDDEN;
    }
}
