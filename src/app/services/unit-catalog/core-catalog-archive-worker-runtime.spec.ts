// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { UNIT_SUMMARY_VERSION, type UnitSummary } from '../../models/unit-summary.model';
import type { ApplicationCatalogDependencyBundle } from './application-catalog-dependency-bundle';
import {
    CORE_CATALOG_ARCHIVE_SUMMARY_TRANSFER_CHUNK_SIZE,
    type CoreCatalogArchiveWorkerResponse,
} from './core-catalog-archive-worker-protocol';
import {
    CoreCatalogArchiveWorkerRuntime,
    type CoreCatalogArchiveWorkerResponseSink,
} from './core-catalog-archive-worker-runtime';
import type { CoreUnitsManifest } from './core-unit-manifest';
import type { CoreUnitArchive, CoreUnitRelease } from './core-unit-archive';
import {
    MM_DATA_UNIT_PROVIDER_ID,
    asSourceHash,
    asUnitUuid,
    makeUnitFileName,
} from './unit-catalog.types';

describe('CoreCatalogArchiveWorkerRuntime', () => {
    const sessionId = 'catalog-session';
    const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1');
    const hash = asSourceHash('AAAAAAAAAAAAAAAAAAAAAAAAAAA');
    const file = makeUnitFileName(uuid, 'mtf');
    const manifest: CoreUnitsManifest = { units: { [uuid]: { file, hash, format: 'mtf' } } };

    it('opens a release and streams summaries in bounded chunks', async () => {
        const responses: CoreCatalogArchiveWorkerResponse[] = [];
        const summaries = Array.from(
            { length: CORE_CATALOG_ARCHIVE_SUMMARY_TRANSFER_CHUNK_SIZE + 1 },
            () => summary(),
        );
        const runtime = runtimeFor(release(summaries), responses);

        runtime.handleMessage({
            type: 'open', sessionId, source: new ArrayBuffer(22), checksum: hash, manifest,
        });
        await settle();

        const opened = responses.find(response => response.type === 'opened');
        const chunks = responses.filter(response => response.type === 'summary-chunk');
        expect(opened).toEqual(jasmine.objectContaining({
            type: 'opened', summaryUnitCount: summaries.length, summaryChunkCount: 2,
        }));
        expect(chunks.length).toBe(2);
        expect(chunks.map(chunk => chunk.type === 'summary-chunk' ? chunk.units.length : 0))
            .toEqual([CORE_CATALOG_ARCHIVE_SUMMARY_TRANSFER_CHUNK_SIZE, 1]);
        expect(responses.at(-1)).toEqual({ type: 'ready', sessionId, summaryChunkCount: 2 });
    });

    it('extracts and compacts only after the archive is ready', async () => {
        const responses: CoreCatalogArchiveWorkerResponse[] = [];
        const extracted = new Uint8Array([1, 2, 3]).buffer;
        const compacted = new Uint8Array([4, 5, 6]).buffer;
        const archive = archiveFixture(extracted, compacted);
        const runtime = runtimeFor({ archive, summaries: [], dependencyBundle: dependencyBundle() }, responses);

        runtime.handleMessage({
            type: 'open', sessionId, source: new ArrayBuffer(22), checksum: hash, manifest,
        });
        runtime.handleMessage({ type: 'extract', sessionId, requestId: 1, file });
        expect(responses.find(response => response.type === 'error')).toEqual(jasmine.objectContaining({
            type: 'error', scope: 'extract', requestId: 1,
        }));

        await settle();
        runtime.handleMessage({ type: 'extract', sessionId, requestId: 2, file });
        runtime.handleMessage({
            type: 'compact-sources', sessionId, requestId: 3, manifest, replacements: [],
        });
        await settle();

        expect(responses.some(response => response.type === 'extracted'
            && response.requestId === 2 && response.bytes === extracted)).toBeTrue();
        expect(responses.some(response => response.type === 'compacted-sources'
            && response.requestId === 3 && response.bytes === compacted)).toBeTrue();
    });

    it('opens a stored source ZIP without summary-transfer metadata', async () => {
        const responses: CoreCatalogArchiveWorkerResponse[] = [];
        const archive = archiveFixture(new ArrayBuffer(1), new ArrayBuffer(22));
        const sink = sinkFor(responses);
        const runtime = new CoreCatalogArchiveWorkerRuntime({
            openRelease: async () => release([]),
            openSourceArchive: async () => archive,
            sink,
        });

        runtime.handleMessage({ type: 'open-source', sessionId, source: new ArrayBuffer(22), manifest });
        await settle();

        expect(responses).toEqual([
            { type: 'progress', sessionId, progress: { phase: 'archive-validation' } },
            { type: 'source-opened', sessionId, files: [file] },
            { type: 'source-ready', sessionId },
        ]);
    });

    it('reports a real archive-open failure', async () => {
        const responses: CoreCatalogArchiveWorkerResponse[] = [];
        const runtime = new CoreCatalogArchiveWorkerRuntime({
            openRelease: async () => { throw new Error('bad ZIP'); },
            sink: sinkFor(responses),
        });

        runtime.handleMessage({
            type: 'open', sessionId, source: new ArrayBuffer(22), checksum: hash, manifest,
        });
        await settle();

        expect(responses.at(-1)).toEqual(jasmine.objectContaining({
            type: 'error', scope: 'open', message: jasmine.stringMatching(/bad ZIP/u),
        }));
    });

    function runtimeFor(
        opened: CoreUnitRelease,
        responses: CoreCatalogArchiveWorkerResponse[],
    ): CoreCatalogArchiveWorkerRuntime {
        return new CoreCatalogArchiveWorkerRuntime({
            openRelease: async () => opened,
            sink: sinkFor(responses),
            yieldToEventLoop: async () => undefined,
        });
    }

    function archiveFixture(extracted: ArrayBuffer, compacted: ArrayBuffer): CoreUnitArchive {
        return {
            files: [file],
            extract: async () => extracted,
            compactSources: async () => compacted,
        };
    }
});

function sinkFor(responses: CoreCatalogArchiveWorkerResponse[]): CoreCatalogArchiveWorkerResponseSink {
    return { postMessage: message => responses.push(message) };
}

function release(summaries: readonly UnitSummary[]): CoreUnitRelease {
    const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1');
    const file = makeUnitFileName(uuid, 'mtf');
    return {
        archive: {
            files: [file],
            extract: async () => new ArrayBuffer(1),
            compactSources: async () => new ArrayBuffer(22),
        },
        summaries,
        dependencyBundle: dependencyBundle(),
    };
}

function summary(): UnitSummary {
    return {
        uuid: asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1'),
        provider: MM_DATA_UNIT_PROVIDER_ID,
        origin: 'megamek',
        hash: asSourceHash('AAAAAAAAAAAAAAAAAAAAAAAAAAA'),
        summaryVersion: UNIT_SUMMARY_VERSION,
    } as unknown as UnitSummary;
}

function dependencyBundle(): ApplicationCatalogDependencyBundle {
    return {
        equipment: {}, quirks: {}, sourcebooks: {}, factions: {},
        spriteManifest: { manifestDigest: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA', manifestText: '{}' },
    } as unknown as ApplicationCatalogDependencyBundle;
}

async function settle(): Promise<void> {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
}
