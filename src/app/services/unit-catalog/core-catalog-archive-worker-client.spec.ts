// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { UNIT_SUMMARY_VERSION, type UnitSummary } from '../../models/unit-summary.model';
import type { ApplicationCatalogDependencyBundle } from './application-catalog-dependency-bundle';
import {
    type CoreCatalogArchiveWorkerRequest,
    type CoreCatalogArchiveWorkerResponse,
} from './core-catalog-archive-worker-protocol';
import {
    CoreCatalogArchiveWorkerClientError,
    openCoreCatalogArchiveInWorker,
    openCoreCatalogSourceArchiveInWorker,
    type CoreCatalogArchiveWorkerLike,
} from './core-catalog-archive-worker-client';
import type { CoreUnitsManifest } from './core-unit-manifest';
import {
    MM_DATA_UNIT_PROVIDER_ID,
    asSourceHash,
    asUnitUuid,
    makeUnitFileName,
} from './unit-catalog.types';

describe('core catalog archive Worker client', () => {
    const sessionId = 'catalog-session';
    const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1');
    const hash = asSourceHash('AAAAAAAAAAAAAAAAAAAAAAAAAAA');
    const file = makeUnitFileName(uuid, 'mtf');
    const manifest: CoreUnitsManifest = { units: { [uuid]: { file, hash, format: 'mtf' } } };
    let worker: FakeWorker;
    let controller: AbortController;

    beforeEach(() => {
        worker = new FakeWorker();
        controller = new AbortController();
    });

    it('opens a release, assembles summary chunks, and proxies source requests', async () => {
        const progress = jasmine.createSpy('progress');
        const opening = openCoreCatalogArchiveInWorker(
            new ArrayBuffer(22),
            hash,
            manifest,
            options(progress),
        );

        expect(worker.posted[0].message).toEqual(jasmine.objectContaining({
            type: 'open', sessionId, checksum: hash, manifest,
        }));
        worker.emit({
            type: 'opened', sessionId, files: [file], summaryUnitCount: 1, summaryChunkCount: 1,
            dependencyBundle: dependencyBundle(),
        });
        worker.emit({
            type: 'summary-chunk', sessionId, chunkIndex: 0, chunkCount: 1, start: 0,
            units: [summary()],
        });
        worker.emit({ type: 'ready', sessionId, summaryChunkCount: 1 });
        const release = await opening;

        expect(release.summaries).toEqual([summary()]);
        expect(release.archive.files).toEqual([file]);

        const extraction = release.archive.extract(file);
        const extractRequest = worker.lastRequest('extract');
        const extracted = new Uint8Array([1, 2, 3]).buffer;
        worker.emit({
            type: 'extracted', sessionId, requestId: extractRequest.requestId, bytes: extracted,
        });
        expect(new Uint8Array(await extraction)).toEqual(new Uint8Array(extracted));

        const replacement = new Uint8Array([4, 5]).buffer;
        const compaction = release.archive.compactSources(manifest, [{ file, bytes: replacement }]);
        const compactRequest = worker.lastRequest('compact-sources');
        const compacted = new Uint8Array(22).buffer;
        worker.emit({
            type: 'compacted-sources', sessionId, requestId: compactRequest.requestId, bytes: compacted,
        });
        expect(await compaction).toBe(compacted);

        worker.emit({
            type: 'progress', sessionId,
            progress: { phase: 'summary-transfer', completed: 1, total: 1 },
        });
        expect(progress).toHaveBeenCalledOnceWith({
            phase: 'summary-transfer', completed: 1, total: 1,
        });

        release.dispose();
        expect(worker.terminated).toBeTrue();
    });

    it('opens a stored source archive without bootstrap summaries', async () => {
        const opening = openCoreCatalogSourceArchiveInWorker(
            new ArrayBuffer(22), manifest, options(),
        );

        expect(worker.posted[0].message.type).toBe('open-source');
        worker.emit({ type: 'source-opened', sessionId, files: [file] });
        worker.emit({ type: 'source-ready', sessionId });
        const source = await opening;

        expect(source.archive.files).toEqual([file]);
        source.dispose();
    });

    it('rejects a response from another session and terminates the Worker', async () => {
        const opening = openCoreCatalogArchiveInWorker(
            new ArrayBuffer(22), hash, manifest, options(),
        );

        worker.emit({
            type: 'progress', sessionId: 'foreign-session',
            progress: { phase: 'archive-validation' },
        });

        await expectAsync(opening).toBeRejectedWithError(
            CoreCatalogArchiveWorkerClientError,
            /wrong session/u,
        );
        expect(worker.terminated).toBeTrue();
    });

    it('does not create a Worker for an already-aborted request', async () => {
        controller.abort();
        const createWorker = jasmine.createSpy('createWorker').and.returnValue(worker);

        await expectAsync(openCoreCatalogArchiveInWorker(
            new ArrayBuffer(22), hash, manifest,
            { ...options(), createWorker },
        )).toBeRejectedWithError(DOMException, /cancelled/u);
        expect(createWorker).not.toHaveBeenCalled();
    });

    function options(onProgress?: jasmine.Spy): Parameters<typeof openCoreCatalogArchiveInWorker>[3] {
        return {
            createWorker: () => worker,
            signal: controller.signal,
            createSessionId: () => sessionId,
            inactivityTimeoutMs: 10_000,
            ...(onProgress ? { onProgress } : {}),
        };
    }
});

class FakeWorker implements CoreCatalogArchiveWorkerLike {
    public onmessage: ((event: MessageEvent<CoreCatalogArchiveWorkerResponse>) => void) | null = null;
    public onerror: ((event: ErrorEvent) => void) | null = null;
    public onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
    public readonly posted: {
        readonly message: CoreCatalogArchiveWorkerRequest;
        readonly transfer?: readonly Transferable[];
    }[] = [];
    public terminated = false;

    public postMessage(message: CoreCatalogArchiveWorkerRequest, transfer?: Transferable[]): void {
        this.posted.push({ message, ...(transfer ? { transfer } : {}) });
    }

    public terminate(): void {
        this.terminated = true;
    }

    public emit(message: CoreCatalogArchiveWorkerResponse): void {
        this.onmessage?.({ data: message } as MessageEvent<CoreCatalogArchiveWorkerResponse>);
    }

    public lastRequest<T extends CoreCatalogArchiveWorkerRequest['type']>(
        type: T,
    ): Extract<CoreCatalogArchiveWorkerRequest, { type: T }> {
        const request = [...this.posted].reverse().find(row => row.message.type === type)?.message;
        if (!request || request.type !== type) throw new Error(`Missing ${type} request`);
        return request as Extract<CoreCatalogArchiveWorkerRequest, { type: T }>;
    }
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
        equipment: {}, quirks: {}, sourcebooks: {}, eras: {}, factions: {},
        spriteManifest: { manifestDigest: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA', manifestText: '{}' },
    } as unknown as ApplicationCatalogDependencyBundle;
}
