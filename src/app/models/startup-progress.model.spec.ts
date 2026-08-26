// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
    projectBackgroundCatalogProgress,
    projectCoreCatalogPhaseProgress,
    type StartupCoreCatalogPhase,
} from './startup-progress.model';

describe('projectCoreCatalogPhaseProgress', () => {
    for (const [phase, title] of [
        ['local-database', 'Opening the local catalog database'],
        ['local-generation', 'Opening the saved catalog generation'],
        ['local-bundle', 'Preparing saved catalog members'],
        ['dependency-cache', 'Checking saved catalog inputs'],
        ['dependency-fetch', 'Preparing required catalog data'],
        ['dependency-validation', 'Preparing catalog members in parallel'],
        ['dependency-staging', 'Staging changed catalogs'],
        ['manifest', 'Verifying the pinned core release'],
        ['archive', 'Preparing the core unit ZIP'],
        ['archive-compaction', 'Saving the units-only core ZIP'],
        ['summary-extraction', 'Reading prebuilt unit summaries'],
        ['projecting', 'Updating changed unit summaries'],
        ['publication', 'Publishing the core unit catalog'],
    ] as const satisfies readonly (readonly [Exclude<StartupCoreCatalogPhase, 'complete'>, string])[]) {
        it(`projects exact ${phase} phase counts`, () => {
            const view = projectCoreCatalogPhaseProgress({ phase, completed: 2, total: 5 });

            expect(view.mode).toBe('determinate');
            expect(view.title).toBe(title);
            if (view.mode !== 'determinate') return;
            expect(view.completed).toBe(2);
            expect(view.total).toBe(5);
            expect(view.percent).toBe(40);
            expect(view.ariaValueText).toContain('2 of 5');
        });
    }

    it('names all seven saved bundle members instead of presenting an unexplained 7/7', () => {
        const zero = projectCoreCatalogPhaseProgress({
            phase: 'local-bundle', completed: 0, total: 7,
        });
        expect(zero).toEqual(jasmine.objectContaining({
            mode: 'determinate',
            title: 'Preparing saved catalog members',
            detail: '0 of 7 saved catalog members ready',
        }));

        const unknown = projectCoreCatalogPhaseProgress({
            phase: 'local-bundle', completed: 0, total: 0,
        });
        expect(unknown).toEqual(jasmine.objectContaining({
            mode: 'indeterminate',
            detail: 'Preparing equipment, quirks, sourcebooks, eras, factions, sheets, and sprites.',
        }));
    });

    it('formats immutable archive byte transfer progress', () => {
        expect(projectCoreCatalogPhaseProgress({
            phase: 'archive',
            completed: 1024 * 1024,
            total: 4 * 1024 * 1024,
            transferredBytes: 1024 * 1024,
        })).toEqual(jasmine.objectContaining({
            mode: 'determinate',
            detail: '1 MB of 4 MB downloaded',
            percent: 25,
        }));
    });

    it('does not render malformed counts as a percentage', () => {
        for (const progress of [
            { phase: 'projecting' as const, completed: 0, total: Number.NaN },
            { phase: 'projecting' as const, completed: 6, total: 5 },
            { phase: 'projecting' as const, completed: 1.5, total: 5 },
        ]) {
            expect(projectCoreCatalogPhaseProgress(progress)).toEqual(jasmine.objectContaining({
                mode: 'indeterminate',
                detail: 'The amount of work in this phase is not known yet.',
            }));
        }
    });
});

describe('projectBackgroundCatalogProgress', () => {
    it('shows cold-start work in the same thin non-blocking status surface', () => {
        expect(projectBackgroundCatalogProgress({
            dataReady: false,
            coreCatalog: {
                status: 'loading',
                availableUnits: 0,
                progress: { phase: 'local-generation', completed: 0, total: 1 },
            },
        })).toEqual(jasmine.objectContaining({
            kind: 'progress',
            mode: 'determinate',
            title: 'Loading saved catalogs…',
            detail: 'Opening the saved catalog generation: 0 of 1 saved catalog generations opened',
        }));
    });

    it('does not describe local loading as a remote update before data is ready', () => {
        expect(projectBackgroundCatalogProgress({
            dataReady: false,
            coreCatalog: { status: 'loading', availableUnits: 0 },
        })).toEqual({
            kind: 'progress',
            mode: 'indeterminate',
            title: 'Loading saved catalogs…',
            detail: 'Opening the local catalog database.',
        });
    });

    it('projects exact phase-local progress while saved data remains usable', () => {
        expect(projectBackgroundCatalogProgress({
            dataReady: true,
            coreCatalog: {
                status: 'loading',
                availableUnits: 10_990,
                progress: { phase: 'projecting', completed: 25, total: 100 },
            },
        })).toEqual({
            kind: 'progress',
            mode: 'determinate',
            title: 'Updating catalogs…',
            detail: 'Updating changed unit summaries: 25 of 100 unit summaries updated',
            completed: 25,
            total: 100,
            percent: 25,
            ariaValueText: '25 of 100 unit summaries updated',
        });
    });

    it('distinguishes another-tab publication from this tab background work', () => {
        expect(projectBackgroundCatalogProgress({
            dataReady: false,
            coreCatalog: { status: 'waiting', availableUnits: 0, reason: 'catalog-leader' },
        })).toEqual(jasmine.objectContaining({
            kind: 'progress',
            mode: 'indeterminate',
            title: 'Another tab is updating catalogs…',
        }));
    });

    it('reports a cold-start failure without claiming saved data remains active', () => {
        expect(projectBackgroundCatalogProgress({
            dataReady: false,
            coreCatalog: { status: 'error', availableUnits: 0, error: 'corrupt' },
        })).toEqual({
            kind: 'notice',
            tone: 'warning',
            title: 'Catalog startup failed',
            detail: 'corrupt',
        });
    });

    it('keeps a post-readiness refresh failure non-blocking', () => {
        expect(projectBackgroundCatalogProgress({
            dataReady: true,
            coreCatalog: { status: 'error', availableUnits: 10_990, error: 'HTTP 404' },
        })).toEqual({
            kind: 'notice',
            tone: 'warning',
            title: 'Catalog refresh failed; saved data remains active',
            detail: 'The committed application data remains usable.',
        });
    });

    it('hides after all observed work settles', () => {
        expect(projectBackgroundCatalogProgress({
            dataReady: true,
            coreCatalog: { status: 'ready', availableUnits: 10_990 },
        })).toEqual({ kind: 'hidden' });
    });

    it('prioritizes runtime index progress once stored summaries are usable', () => {
        expect(projectBackgroundCatalogProgress({
            dataReady: true,
            coreCatalog: { status: 'ready', availableUnits: 10_990 },
            runtimeCatalog: {
                status: 'running',
                completed: 2,
                total: 4,
                detail: 'Prepared summary filters and availability memberships',
            },
        })).toEqual({
            kind: 'progress',
            mode: 'determinate',
            title: 'Preparing unit indexes',
            detail: 'Prepared summary filters and availability memberships',
            completed: 2,
            total: 4,
            percent: 50,
            ariaValueText: 'Prepared summary filters and availability memberships (2 of 4)',
        });
    });
});
