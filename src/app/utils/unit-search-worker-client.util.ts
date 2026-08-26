// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type {
    UnitSearchWorkerCorpusSnapshot,
    UnitSearchWorkerCorpusVersion,
    UnitSearchWorkerErrorMessage,
    UnitSearchWorkerProgressMessage,
    UnitSearchWorkerQueryRequest,
    UnitSearchWorkerResponseMessage,
    UnitSearchWorkerResultMessage,
} from './unit-search-worker-protocol.util';

export interface SearchWorkerLike {
    onmessage: ((event: MessageEvent<UnitSearchWorkerResponseMessage>) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
    postMessage(message: unknown): void;
    terminate(): void;
}

interface UnitSearchWorkerClientOptions {
    createWorker: () => SearchWorkerLike;
    onResult: (result: UnitSearchWorkerResultMessage) => void;
    onError: (message: string) => void;
    onReady?: (corpusVersion: UnitSearchWorkerCorpusVersion) => void;
    onProgress?: (progress: UnitSearchWorkerProgressMessage) => void;
}

export class UnitSearchWorkerClient {
    private readonly createWorker: () => SearchWorkerLike;
    private readonly onResult: (result: UnitSearchWorkerResultMessage) => void;
    private readonly onError: (message: string) => void;
    private readonly onReady?: (corpusVersion: UnitSearchWorkerCorpusVersion) => void;
    private readonly onProgress?: (progress: UnitSearchWorkerProgressMessage) => void;
    private worker: SearchWorkerLike | null = null;
    private readyCorpusVersion: UnitSearchWorkerCorpusVersion | null = null;
    private initializingCorpusVersion: UnitSearchWorkerCorpusVersion | null = null;
    private latestSnapshot: UnitSearchWorkerCorpusSnapshot | null = null;
    private pendingRequest: UnitSearchWorkerQueryRequest | null = null;
    private latestRequestedRevision = 0;
    private failed = false;

    constructor(options: UnitSearchWorkerClientOptions) {
        this.createWorker = options.createWorker;
        this.onResult = options.onResult;
        this.onError = options.onError;
        this.onReady = options.onReady;
        this.onProgress = options.onProgress;
    }

    isReadyFor(corpusVersion: UnitSearchWorkerCorpusVersion): boolean {
        return this.readyCorpusVersion === corpusVersion;
    }

    submit(snapshot: UnitSearchWorkerCorpusSnapshot | null, request: UnitSearchWorkerQueryRequest): void {
        if (this.failed) {
            throw new Error('Search worker client is disabled');
        }

        const worker = this.ensureWorker();
        this.pendingRequest = request;
        this.latestRequestedRevision = request.revision;

        if (this.readyCorpusVersion === request.corpusVersion) {
            worker.postMessage({ type: 'execute', request });
            return;
        }

        if (!snapshot || snapshot.corpusVersion !== request.corpusVersion) {
            throw new Error(`Search worker corpus ${request.corpusVersion} is not ready and no exact snapshot was supplied`);
        }

        this.latestSnapshot = snapshot;

        if (this.initializingCorpusVersion !== snapshot.corpusVersion) {
            this.initializingCorpusVersion = snapshot.corpusVersion;
            worker.postMessage({ type: 'init', snapshot });
        }
    }

    dispose(): void {
        this.worker?.terminate();
        this.worker = null;
        this.pendingRequest = null;
        this.latestSnapshot = null;
        this.initializingCorpusVersion = null;
        this.readyCorpusVersion = null;
    }

    private ensureWorker(): SearchWorkerLike {
        if (!this.worker) {
            this.worker = this.createWorker();
            this.worker.onmessage = event => this.handleMessage(event.data);
            this.worker.onerror = event => {
                this.failed = true;
                this.onError(event.message || 'Search worker failed');
            };
        }

        return this.worker;
    }

    private handleMessage(message: UnitSearchWorkerResponseMessage): void {
        switch (message.type) {
            case 'progress':
                this.onProgress?.(message);
                return;
            case 'ready':
                this.readyCorpusVersion = message.corpusVersion;
                if (this.initializingCorpusVersion === message.corpusVersion) {
                    this.initializingCorpusVersion = null;
                }
                this.onReady?.(message.corpusVersion);
                this.flushPendingRequest();
                if (this.latestSnapshot?.corpusVersion === message.corpusVersion) {
                    // The worker now owns its structured clone. Do not keep a
                    // second compact corpus alive on the main thread.
                    this.latestSnapshot = null;
                }
                return;
            case 'result':
                if (message.revision !== this.latestRequestedRevision) {
                    return;
                }
                if (message.corpusVersion !== this.readyCorpusVersion) {
                    return;
                }
                this.onResult(message);
                return;
            case 'error':
                this.handleWorkerError(message);
                return;
        }
    }

    private flushPendingRequest(): void {
        if (!this.worker || !this.pendingRequest || !this.latestSnapshot) {
            return;
        }

        if (this.latestSnapshot.corpusVersion !== this.readyCorpusVersion) {
            if (this.initializingCorpusVersion !== this.latestSnapshot.corpusVersion) {
                this.initializingCorpusVersion = this.latestSnapshot.corpusVersion;
                this.worker.postMessage({ type: 'init', snapshot: this.latestSnapshot });
            }
            return;
        }

        this.worker.postMessage({ type: 'execute', request: this.pendingRequest });
    }

    private handleWorkerError(message: UnitSearchWorkerErrorMessage): void {
        this.failed = true;
        this.onError(message.message);
    }
}
