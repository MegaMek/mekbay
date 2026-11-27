// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { UnitSummary } from '../../models/unit-summary.model';
import { uuidv4 } from '../../utils/uuid.util';
import type { ApplicationCatalogDependencyBundle } from './application-catalog-dependency-bundle';
import type { CoreUnitArchive, CoreUnitSourceReplacement } from './core-unit-archive';
import type { CoreUnitsManifest } from './core-unit-manifest';
import {
    CORE_CATALOG_ARCHIVE_SUMMARY_TRANSFER_CHUNK_SIZE,
    type CoreCatalogArchiveWorkerProgress,
    type CoreCatalogArchiveWorkerRequest,
    type CoreCatalogArchiveWorkerResponse,
} from './core-catalog-archive-worker-protocol';
import type { UnitFileName } from './unit-catalog.types';

export interface CoreCatalogArchiveWorkerLike {
    onmessage: ((event: MessageEvent<CoreCatalogArchiveWorkerResponse>) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
    onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
    postMessage(message: CoreCatalogArchiveWorkerRequest, transfer?: Transferable[]): void;
    terminate(): void;
}

export type CoreCatalogArchiveWorkerFactory = () => CoreCatalogArchiveWorkerLike;

export interface OpenCoreCatalogArchiveInWorkerOptions {
    readonly createWorker: CoreCatalogArchiveWorkerFactory;
    readonly signal: AbortSignal;
    readonly onProgress?: (progress: CoreCatalogArchiveWorkerProgress) => void;
    readonly createSessionId?: () => string;
    readonly inactivityTimeoutMs?: number;
}

export interface WorkerBackedCoreRelease {
    readonly archive: CoreUnitArchive;
    readonly summaries: readonly UnitSummary[];
    readonly dependencyBundle: ApplicationCatalogDependencyBundle;
    dispose(): void;
}

export interface WorkerBackedCoreSourceArchive {
    readonly archive: CoreUnitArchive;
    dispose(): void;
}

export class CoreCatalogArchiveWorkerClientError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = 'CoreCatalogArchiveWorkerClientError';
    }
}

interface PendingBytes {
    readonly resolve: (bytes: ArrayBuffer) => void;
    readonly reject: (error: unknown) => void;
}

const DEFAULT_WORKER_INACTIVITY_TIMEOUT_MS = 120_000;

export function openCoreCatalogArchiveInWorker(
    source: ArrayBuffer,
    checksum: string,
    manifest: CoreUnitsManifest,
    options: OpenCoreCatalogArchiveInWorkerOptions,
): Promise<WorkerBackedCoreRelease> {
    if (options.signal.aborted) return Promise.reject(abortError());
    return new CoreCatalogArchiveWorkerClient(manifest, options, checksum).open(source) as Promise<WorkerBackedCoreRelease>;
}

export function openCoreCatalogSourceArchiveInWorker(
    source: ArrayBuffer,
    manifest: CoreUnitsManifest,
    options: OpenCoreCatalogArchiveInWorkerOptions,
): Promise<WorkerBackedCoreSourceArchive> {
    if (options.signal.aborted) return Promise.reject(abortError());
    return new CoreCatalogArchiveWorkerClient(manifest, options).open(source) as Promise<WorkerBackedCoreSourceArchive>;
}

class CoreCatalogArchiveWorkerClient {
    private readonly worker: CoreCatalogArchiveWorkerLike;
    private readonly sessionId: string;
    private readonly allowedFiles: ReadonlySet<UnitFileName>;
    private readonly pending = new Map<number, PendingBytes>();
    private readonly summaryUnits: UnitSummary[] = [];
    private readonly inactivityTimeoutMs: number;
    private openResolve?: (value: WorkerBackedCoreRelease | WorkerBackedCoreSourceArchive) => void;
    private openReject?: (error: unknown) => void;
    private dependencyBundle?: ApplicationCatalogDependencyBundle;
    private files?: readonly UnitFileName[];
    private expectedSummaryCount?: number;
    private expectedChunkCount?: number;
    private nextChunk = 0;
    private nextRequestId = 1;
    private opened = false;
    private ready = false;
    private disposed = false;
    private terminalError?: Error;
    private inactivityTimer?: ReturnType<typeof globalThis.setTimeout>;

    public constructor(
        private readonly manifest: CoreUnitsManifest,
        private readonly options: OpenCoreCatalogArchiveInWorkerOptions,
        private readonly checksum?: string,
    ) {
        this.worker = options.createWorker();
        this.sessionId = options.createSessionId?.() ?? uuidv4();
        if (!this.sessionId) throw new Error('Core catalog archive Worker session id cannot be empty');
        this.inactivityTimeoutMs = options.inactivityTimeoutMs ?? DEFAULT_WORKER_INACTIVITY_TIMEOUT_MS;
        if (!Number.isFinite(this.inactivityTimeoutMs) || this.inactivityTimeoutMs <= 0) {
            throw new Error('Core catalog archive Worker inactivity timeout must be positive');
        }
        this.allowedFiles = new Set(Object.values(manifest.units).map(entry => entry.file));
        this.worker.onmessage = event => this.handleMessage(event.data);
        this.worker.onerror = event => this.fail(new CoreCatalogArchiveWorkerClientError(
            event.message || 'Core catalog archive Worker failed',
        ));
        this.worker.onmessageerror = () => this.fail(new CoreCatalogArchiveWorkerClientError(
            'Core catalog archive Worker returned an unreadable response',
        ));
        options.signal.addEventListener('abort', this.handleAbort, { once: true });
    }

    public open(source: ArrayBuffer): Promise<WorkerBackedCoreRelease | WorkerBackedCoreSourceArchive> {
        const result = new Promise<WorkerBackedCoreRelease | WorkerBackedCoreSourceArchive>((resolve, reject) => {
            this.openResolve = resolve;
            this.openReject = reject;
        });
        this.refreshWatchdog();
        try {
            this.worker.postMessage(this.checksum === undefined
                ? { type: 'open-source', sessionId: this.sessionId, source, manifest: this.manifest }
                : { type: 'open', sessionId: this.sessionId, source, checksum: this.checksum, manifest: this.manifest },
            [source]);
        } catch (error) {
            this.fail(new CoreCatalogArchiveWorkerClientError(`Could not transfer unit ZIP: ${describeError(error)}`));
        }
        return result;
    }

    private readonly handleAbort = (): void => this.fail(abortError());

    private handleMessage(message: CoreCatalogArchiveWorkerResponse): void {
        if (this.disposed) return;
        try {
            if (!message || message.sessionId !== this.sessionId) {
                throw new CoreCatalogArchiveWorkerClientError('Core catalog archive Worker returned the wrong session');
            }
            this.refreshWatchdog();
            switch (message.type) {
                case 'progress':
                    this.options.onProgress?.(message.progress);
                    return;
                case 'opened':
                    this.handleOpened(message);
                    return;
                case 'source-opened':
                    this.handleSourceOpened(message.files);
                    return;
                case 'summary-chunk':
                    this.handleSummaryChunk(message);
                    return;
                case 'ready':
                    this.handleReady(message.summaryChunkCount);
                    return;
                case 'source-ready':
                    this.handleSourceReady();
                    return;
                case 'extracted':
                case 'compacted-sources':
                    this.handleBytes(message.requestId, message.bytes);
                    return;
                case 'error':
                    this.handleWorkerError(message);
                    return;
            }
        } catch (error) {
            this.fail(error instanceof Error ? error : new CoreCatalogArchiveWorkerClientError(describeError(error)));
        }
    }

    private handleOpened(message: Extract<CoreCatalogArchiveWorkerResponse, { type: 'opened' }>): void {
        if (this.checksum === undefined || this.opened || this.ready
            || !validTransferCounts(message.summaryUnitCount, message.summaryChunkCount)) {
            throw new CoreCatalogArchiveWorkerClientError('Core catalog archive Worker returned invalid metadata');
        }
        this.files = this.acceptFiles(message.files);
        this.dependencyBundle = message.dependencyBundle;
        this.expectedSummaryCount = message.summaryUnitCount;
        this.expectedChunkCount = message.summaryChunkCount;
        this.opened = true;
    }

    private handleSourceOpened(files: readonly UnitFileName[]): void {
        if (this.checksum !== undefined || this.opened || this.ready) {
            throw new CoreCatalogArchiveWorkerClientError('Core catalog source Worker opened more than once');
        }
        this.files = this.acceptFiles(files);
        this.opened = true;
    }

    private acceptFiles(files: readonly UnitFileName[]): readonly UnitFileName[] {
        if (new Set(files).size !== files.length || files.some(file => !this.allowedFiles.has(file))) {
            throw new CoreCatalogArchiveWorkerClientError('Core catalog archive Worker returned unknown unit files');
        }
        return Object.freeze([...files]);
    }

    private handleSummaryChunk(message: Extract<CoreCatalogArchiveWorkerResponse, { type: 'summary-chunk' }>): void {
        if (!this.opened || this.ready || this.expectedSummaryCount === undefined || this.expectedChunkCount === undefined
            || message.chunkIndex !== this.nextChunk || message.chunkCount !== this.expectedChunkCount
            || message.start !== this.summaryUnits.length || message.units.length < 1
            || message.units.length > CORE_CATALOG_ARCHIVE_SUMMARY_TRANSFER_CHUNK_SIZE
            || message.start + message.units.length > this.expectedSummaryCount) {
            throw new CoreCatalogArchiveWorkerClientError('Core catalog archive Worker returned an invalid summary chunk');
        }
        this.summaryUnits.push(...message.units);
        this.nextChunk += 1;
    }

    private handleReady(chunkCount: number): void {
        if (this.checksum === undefined || !this.opened || this.ready || !this.files || !this.dependencyBundle
            || this.expectedSummaryCount === undefined || this.expectedChunkCount === undefined
            || chunkCount !== this.expectedChunkCount || this.nextChunk !== this.expectedChunkCount
            || this.summaryUnits.length !== this.expectedSummaryCount) {
            throw new CoreCatalogArchiveWorkerClientError('Core catalog archive Worker completed an incomplete transfer');
        }
        this.ready = true;
        this.resolveOpen(Object.freeze({
            archive: this.createArchive(),
            summaries: Object.freeze(this.summaryUnits),
            dependencyBundle: this.dependencyBundle,
            dispose: () => this.dispose(),
        }));
    }

    private handleSourceReady(): void {
        if (this.checksum !== undefined || !this.opened || this.ready || !this.files) {
            throw new CoreCatalogArchiveWorkerClientError('Core catalog source Worker completed an invalid open');
        }
        this.ready = true;
        this.resolveOpen(Object.freeze({ archive: this.createArchive(), dispose: () => this.dispose() }));
    }

    private resolveOpen(value: WorkerBackedCoreRelease | WorkerBackedCoreSourceArchive): void {
        this.refreshWatchdog();
        this.openResolve?.(value);
        this.openResolve = undefined;
        this.openReject = undefined;
    }

    private createArchive(): CoreUnitArchive {
        if (!this.files) throw new CoreCatalogArchiveWorkerClientError('Unit ZIP population is unavailable');
        return Object.freeze({
            files: this.files,
            extract: (file: UnitFileName) => this.requestBytes({
                type: 'extract', sessionId: this.sessionId, requestId: 0, file,
            }),
            compactSources: (
                manifest: CoreUnitsManifest,
                replacements: readonly CoreUnitSourceReplacement[],
            ) => this.compactSources(manifest, replacements),
        });
    }

    private requestBytes(request: Extract<CoreCatalogArchiveWorkerRequest, { type: 'extract' }>): Promise<ArrayBuffer> {
        if (!this.allowedFiles.has(request.file)) {
            return Promise.reject(new CoreCatalogArchiveWorkerClientError(`Core catalog unit is unavailable: ${request.file}`));
        }
        return this.postBytesRequest({ ...request, requestId: this.takeRequestId() });
    }

    private compactSources(
        manifest: CoreUnitsManifest,
        replacements: readonly CoreUnitSourceReplacement[],
    ): Promise<ArrayBuffer> {
        const captured = replacements.map(replacement => ({ file: replacement.file, bytes: replacement.bytes.slice(0) }));
        return this.postBytesRequest({
            type: 'compact-sources',
            sessionId: this.sessionId,
            requestId: this.takeRequestId(),
            manifest,
            replacements: captured,
        }, captured.map(replacement => replacement.bytes));
    }

    private takeRequestId(): number {
        const id = this.nextRequestId++;
        if (!Number.isSafeInteger(this.nextRequestId)) throw new CoreCatalogArchiveWorkerClientError('Worker request limit reached');
        return id;
    }

    private postBytesRequest(
        request: Extract<CoreCatalogArchiveWorkerRequest, { type: 'extract' | 'compact-sources' }>,
        transfer?: Transferable[],
    ): Promise<ArrayBuffer> {
        if (this.disposed || this.terminalError || !this.ready) {
            return Promise.reject(this.terminalError ?? new CoreCatalogArchiveWorkerClientError('Worker is not ready'));
        }
        const result = new Promise<ArrayBuffer>((resolve, reject) => this.pending.set(request.requestId, { resolve, reject }));
        try {
            this.worker.postMessage(request, transfer);
            this.refreshWatchdog();
            return result;
        } catch (error) {
            this.pending.delete(request.requestId);
            return Promise.reject(new CoreCatalogArchiveWorkerClientError(`Could not request ZIP content: ${describeError(error)}`));
        }
    }

    private handleBytes(requestId: number, bytes: ArrayBuffer): void {
        const pending = this.pending.get(requestId);
        if (!pending || !(bytes instanceof ArrayBuffer)) {
            throw new CoreCatalogArchiveWorkerClientError('Core catalog archive Worker returned invalid bytes');
        }
        this.pending.delete(requestId);
        pending.resolve(bytes);
        this.refreshWatchdog();
    }

    private handleWorkerError(message: Extract<CoreCatalogArchiveWorkerResponse, { type: 'error' }>): void {
        const error = new CoreCatalogArchiveWorkerClientError(message.message);
        if (message.scope === 'extract' && message.requestId !== undefined) {
            const pending = this.pending.get(message.requestId);
            if (!pending) throw new CoreCatalogArchiveWorkerClientError('Worker rejected an unknown request');
            this.pending.delete(message.requestId);
            pending.reject(error);
            this.refreshWatchdog();
        } else {
            this.fail(error);
        }
    }

    private refreshWatchdog(): void {
        if (this.inactivityTimer !== undefined) globalThis.clearTimeout(this.inactivityTimer);
        if (this.disposed || (this.ready && this.pending.size === 0)) return;
        this.inactivityTimer = globalThis.setTimeout(() => this.fail(new CoreCatalogArchiveWorkerClientError(
            `Core catalog archive Worker made no progress for ${this.inactivityTimeoutMs} ms`,
        )), this.inactivityTimeoutMs);
    }

    private fail(error: Error): void {
        if (this.disposed) return;
        this.terminalError = error;
        this.disposed = true;
        if (this.inactivityTimer !== undefined) globalThis.clearTimeout(this.inactivityTimer);
        this.options.signal.removeEventListener('abort', this.handleAbort);
        this.worker.onmessage = null;
        this.worker.onerror = null;
        this.worker.onmessageerror = null;
        this.worker.terminate();
        this.openReject?.(error);
        this.openResolve = undefined;
        this.openReject = undefined;
        for (const pending of this.pending.values()) pending.reject(error);
        this.pending.clear();
    }

    private dispose(): void {
        this.fail(new CoreCatalogArchiveWorkerClientError('Core catalog archive Worker has been disposed'));
    }
}

function validTransferCounts(unitCount: number, chunkCount: number): boolean {
    return Number.isSafeInteger(unitCount) && unitCount >= 0
        && Number.isSafeInteger(chunkCount)
        && chunkCount === Math.ceil(unitCount / CORE_CATALOG_ARCHIVE_SUMMARY_TRANSFER_CHUNK_SIZE);
}

function abortError(): DOMException {
    return new DOMException('Core catalog archive work was cancelled', 'AbortError');
}

function describeError(error: unknown): string {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
