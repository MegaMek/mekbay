// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CoreUnitArchive, CoreUnitRelease } from './core-unit-archive';
import type { CoreUnitsManifest } from './core-unit-manifest';
import type { UnitFileName } from './unit-catalog.types';
import {
    CORE_CATALOG_ARCHIVE_SUMMARY_TRANSFER_CHUNK_SIZE,
    type CoreCatalogArchiveWorkerRequest,
    type CoreCatalogArchiveWorkerResponse,
} from './core-catalog-archive-worker-protocol';

export interface CoreCatalogArchiveWorkerResponseSink {
    postMessage(message: CoreCatalogArchiveWorkerResponse, transfer?: Transferable[]): void;
}

export interface CoreCatalogArchiveWorkerRuntimeOptions {
    readonly openRelease: (
        source: ArrayBuffer,
        checksum: string,
        manifest: CoreUnitsManifest,
    ) => Promise<CoreUnitRelease>;
    readonly openSourceArchive?: (source: ArrayBuffer, manifest: CoreUnitsManifest) => Promise<CoreUnitArchive>;
    readonly sink: CoreCatalogArchiveWorkerResponseSink;
    readonly yieldToEventLoop?: () => Promise<void>;
}

/** Message runtime kept separate from the Worker global for deterministic tests. */
export class CoreCatalogArchiveWorkerRuntime {
    private readonly activeRequestIds = new Set<number>();
    private archive?: CoreUnitArchive;
    private sessionId?: string;
    private opened = false;
    private opening = false;
    private ready = false;
    private closed = false;

    public constructor(private readonly options: CoreCatalogArchiveWorkerRuntimeOptions) {}

    public handleMessage(request: CoreCatalogArchiveWorkerRequest): void {
        if (this.closed || !request.sessionId) return;
        switch (request.type) {
            case 'open':
                void this.open(request.sessionId, request.source, request.checksum, request.manifest);
                return;
            case 'open-source':
                void this.openSource(request.sessionId, request.source, request.manifest);
                return;
            case 'extract':
                if (request.sessionId === this.sessionId) {
                    void this.extract(request.sessionId, request.requestId, request.file);
                }
                return;
            case 'compact-sources':
                if (request.sessionId === this.sessionId) {
                    void this.compact(request.sessionId, request.requestId, request.manifest, request.replacements);
                }
                return;
            case 'close':
                if (request.sessionId === this.sessionId) this.close();
                return;
        }
    }

    private async open(
        sessionId: string,
        source: ArrayBuffer,
        checksum: string,
        manifest: CoreUnitsManifest,
    ): Promise<void> {
        if (!this.beginOpen(sessionId, source)) return;
        this.send({ type: 'progress', sessionId, progress: { phase: 'archive-validation' } });
        try {
            const release = await this.options.openRelease(source, checksum, manifest);
            if (this.closed) return;
            this.archive = release.archive;
            const total = release.summaries.length;
            const chunkCount = Math.ceil(total / CORE_CATALOG_ARCHIVE_SUMMARY_TRANSFER_CHUNK_SIZE);
            this.send({ type: 'progress', sessionId, progress: { phase: 'dependency-transfer', completed: 0, total: 1 } });
            this.send({
                type: 'opened',
                sessionId,
                files: release.archive.files,
                summaryUnitCount: total,
                summaryChunkCount: chunkCount,
                dependencyBundle: release.dependencyBundle,
            });
            this.send({ type: 'progress', sessionId, progress: { phase: 'dependency-transfer', completed: 1, total: 1 } });
            this.send({ type: 'progress', sessionId, progress: { phase: 'summary-transfer', completed: 0, total } });
            for (let start = 0; start < total; start += CORE_CATALOG_ARCHIVE_SUMMARY_TRANSFER_CHUNK_SIZE) {
                if (this.closed) return;
                const units = release.summaries.slice(start, start + CORE_CATALOG_ARCHIVE_SUMMARY_TRANSFER_CHUNK_SIZE);
                this.send({
                    type: 'summary-chunk',
                    sessionId,
                    chunkIndex: start / CORE_CATALOG_ARCHIVE_SUMMARY_TRANSFER_CHUNK_SIZE,
                    chunkCount,
                    start,
                    units,
                });
                this.send({
                    type: 'progress',
                    sessionId,
                    progress: { phase: 'summary-transfer', completed: start + units.length, total },
                });
                await (this.options.yieldToEventLoop ?? yieldWorkerEventLoop)();
            }
            if (this.closed) return;
            this.finishOpen();
            this.send({ type: 'ready', sessionId, summaryChunkCount: chunkCount });
        } catch (error) {
            this.failOpen(sessionId, `Could not open core unit ZIP: ${describeError(error)}`);
        }
    }

    private async openSource(
        sessionId: string,
        source: ArrayBuffer,
        manifest: CoreUnitsManifest,
    ): Promise<void> {
        if (!this.options.openSourceArchive || !this.beginOpen(sessionId, source)) return;
        this.send({ type: 'progress', sessionId, progress: { phase: 'archive-validation' } });
        try {
            this.archive = await this.options.openSourceArchive(source, manifest);
            if (this.closed) return;
            this.send({ type: 'source-opened', sessionId, files: this.archive.files });
            this.finishOpen();
            this.send({ type: 'source-ready', sessionId });
        } catch (error) {
            this.failOpen(sessionId, `Could not open stored unit ZIP: ${describeError(error)}`);
        }
    }

    private beginOpen(sessionId: string, source: ArrayBuffer): boolean {
        if (this.opened || this.opening || this.ready || !(source instanceof ArrayBuffer)) {
            this.sendError(sessionId, 'protocol', 'Core catalog archive Worker received an invalid open request');
            return false;
        }
        this.sessionId = sessionId;
        this.opened = true;
        this.opening = true;
        return true;
    }

    private finishOpen(): void {
        this.opening = false;
        this.ready = true;
    }

    private failOpen(sessionId: string, message: string): void {
        this.opening = false;
        this.archive = undefined;
        this.sendError(sessionId, 'open', message);
    }

    private async extract(sessionId: string, requestId: number, file: UnitFileName): Promise<void> {
        if (!this.beginRequest(sessionId, requestId)) return;
        try {
            const bytes = await this.archive!.extract(file);
            if (!this.closed) this.send({ type: 'extracted', sessionId, requestId, bytes }, [bytes]);
        } catch (error) {
            if (!this.closed) this.sendError(sessionId, 'extract', `Could not extract unit: ${describeError(error)}`, requestId);
        } finally {
            this.activeRequestIds.delete(requestId);
        }
    }

    private async compact(
        sessionId: string,
        requestId: number,
        manifest: CoreUnitsManifest,
        replacements: Parameters<CoreUnitArchive['compactSources']>[1],
    ): Promise<void> {
        if (!this.beginRequest(sessionId, requestId)) return;
        try {
            const bytes = await this.archive!.compactSources(manifest, replacements);
            if (!this.closed) this.send({ type: 'compacted-sources', sessionId, requestId, bytes }, [bytes]);
        } catch (error) {
            if (!this.closed) this.sendError(sessionId, 'extract', `Could not update unit ZIP: ${describeError(error)}`, requestId);
        } finally {
            this.activeRequestIds.delete(requestId);
        }
    }

    private beginRequest(sessionId: string, requestId: number): boolean {
        if (!Number.isSafeInteger(requestId) || requestId < 1 || this.activeRequestIds.has(requestId)) {
            this.sendError(sessionId, 'protocol', 'Core catalog archive Worker received an invalid request id');
            return false;
        }
        if (!this.ready || !this.archive) {
            this.sendError(sessionId, 'extract', 'Core catalog archive Worker is not ready', requestId);
            return false;
        }
        this.activeRequestIds.add(requestId);
        return true;
    }

    private close(): void {
        this.closed = true;
        this.ready = false;
        this.archive = undefined;
        this.activeRequestIds.clear();
    }

    private send(message: CoreCatalogArchiveWorkerResponse, transfer?: Transferable[]): void {
        this.options.sink.postMessage(message, transfer);
    }

    private sendError(
        sessionId: string,
        scope: 'open' | 'extract' | 'protocol',
        message: string,
        requestId?: number,
    ): void {
        if (this.closed) return;
        this.send(requestId === undefined
            ? { type: 'error', sessionId, scope, message }
            : { type: 'error', sessionId, scope, message, requestId });
    }
}

function yieldWorkerEventLoop(): Promise<void> {
    return new Promise(resolve => globalThis.setTimeout(resolve, 0));
}

function describeError(error: unknown): string {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
