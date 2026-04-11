/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import type {
    UnitSearchWorkerCorpusSnapshot,
    UnitSearchWorkerCorpusVersion,
    UnitSearchWorkerErrorMessage,
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
}

export class UnitSearchWorkerClient {
    private readonly createWorker: () => SearchWorkerLike;
    private readonly onResult: (result: UnitSearchWorkerResultMessage) => void;
    private readonly onError: (message: string) => void;
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
    }

    submit(snapshot: UnitSearchWorkerCorpusSnapshot, request: UnitSearchWorkerQueryRequest): void {
        if (this.failed) {
            throw new Error('Search worker client is disabled');
        }

        const worker = this.ensureWorker();
        this.latestSnapshot = snapshot;
        this.pendingRequest = request;
        this.latestRequestedRevision = request.revision;

        if (this.readyCorpusVersion === snapshot.corpusVersion) {
            worker.postMessage({ type: 'execute', request });
            return;
        }

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
            case 'ready':
                this.readyCorpusVersion = message.corpusVersion;
                if (this.initializingCorpusVersion === message.corpusVersion) {
                    this.initializingCorpusVersion = null;
                }
                this.flushPendingRequest();
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