// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { UnitSummaryProjectionInput, UnitSummaryProjector } from './entity-summary-projector';
import {
    UNIT_SUMMARY_PROJECTION_BATCH_SIZE,
    type UnitSummaryProjectionDependencies,
    type UnitSummaryProjectionOutcome,
    type UnitSummaryProjectionWorkerRequest,
    type UnitSummaryProjectionWorkerResponse,
} from './unit-summary-projection-worker-protocol';

/** Loading is lazy so a rebuild never queues the entire native catalog in workers. */
export type UnitSummaryProjectionSource = () => Promise<UnitSummaryProjectionInput>;

export interface UnitSummaryProjectionProgress {
    readonly completed: number;
    readonly total: number;
}

export interface UnitSummaryProjectionWorker {
    onmessage: ((event: MessageEvent<UnitSummaryProjectionWorkerResponse>) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
    onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
    postMessage(message: UnitSummaryProjectionWorkerRequest, transfer?: Transferable[]): void;
    terminate(): void;
}

export interface UnitSummaryProjectionWorkers {
    readonly createWorker: () => UnitSummaryProjectionWorker;
    readonly count: number;
}

export interface UnitSummaryProjectionOptions {
    readonly signal: AbortSignal;
    readonly onProgress?: (progress: UnitSummaryProjectionProgress) => void;
}

export interface UnitSummaryProjectionContext {
    readonly projector: UnitSummaryProjector;
    readonly dependencies: UnitSummaryProjectionDependencies;
    readonly workers?: UnitSummaryProjectionWorkers | null;
}

export async function projectUnitSummary(
    projector: UnitSummaryProjector,
    input: UnitSummaryProjectionInput,
): Promise<UnitSummaryProjectionOutcome> {
    try {
        return { status: 'projected', value: await projector.project(input) };
    } catch (error) {
        return { status: 'error', message: error instanceof Error ? error.message : String(error) };
    }
}

/** One bounded execution path for both core and custom summary rebuilds. */
export async function projectUnitSummaryBatches(
    sources: readonly UnitSummaryProjectionSource[],
    context: UnitSummaryProjectionContext,
    options: UnitSummaryProjectionOptions,
): Promise<readonly UnitSummaryProjectionOutcome[]> {
    options.signal.throwIfAborted();
    const outcomes = new Array<UnitSummaryProjectionOutcome>(sources.length);
    let completed = 0;
    let lastProgressAt = -Infinity;
    const progress = (): void => {
        const now = performance.now();
        if (completed !== sources.length && now - lastProgressAt < 100) return;
        lastProgressAt = now;
        try { options.onProgress?.({ completed, total: sources.length }); } catch {}
    };
    progress();
    if (sources.length === 0) return outcomes;

    // A warm projector is cheaper than worker startup for a handful of edits.
    // Reuse the same cooperative fallback; bulk rebuilds still use workers.
    if (!context.workers || sources.length <= 8) {
        let yieldedAt = performance.now();
        for (let index = 0; index < sources.length; index++) {
            options.signal.throwIfAborted();
            const unit = await sources[index]();
            options.signal.throwIfAborted();
            outcomes[index] = await projectUnitSummary(context.projector, unit);
            completed++;
            progress();
            if (performance.now() - yieldedAt >= 8 && completed < sources.length) {
                await new Promise<void>(resolve => setTimeout(resolve, 0));
                yieldedAt = performance.now();
            }
        }
        options.signal.throwIfAborted();
        return outcomes;
    }

    const cancellation = new AbortController();
    const cancel = (): void => cancellation.abort(options.signal.reason);
    options.signal.addEventListener('abort', cancel, { once: true });
    const clients: ProjectionWorkerClient[] = [];
    let cursor = 0;
    try {
        const count = Math.min(Math.max(1, Math.min(4, context.workers.count)),
            Math.ceil(sources.length / UNIT_SUMMARY_PROJECTION_BATCH_SIZE));
        await Promise.all(Array.from({ length: count }, async () => {
            const client = new ProjectionWorkerClient(context.workers!.createWorker(), cancellation.signal);
            clients.push(client);
            await client.initialize(context.dependencies);
            for (;;) {
                cancellation.signal.throwIfAborted();
                const start = cursor;
                if (start >= sources.length) return;
                cursor += UNIT_SUMMARY_PROJECTION_BATCH_SIZE;
                const units = await Promise.all(sources.slice(start, cursor).map(load => load()));
                cancellation.signal.throwIfAborted();
                const projected = await client.project(units);
                for (let offset = 0; offset < projected.length; offset++) outcomes[start + offset] = projected[offset];
                completed += projected.length;
                progress();
            }
        }));
        options.signal.throwIfAborted();
        return outcomes;
    } finally {
        cancellation.abort();
        for (const client of clients) client.dispose();
        options.signal.removeEventListener('abort', cancel);
    }
}

class ProjectionWorkerClient {
    private nextRequestId = 1;
    private failure?: Error;
    private pending?: {
        readonly requestId: number;
        readonly resolve: (response: UnitSummaryProjectionWorkerResponse) => void;
        readonly reject: (error: unknown) => void;
    };
    private readonly onAbort = (): void => this.pending?.reject(this.signal.reason);

    constructor(private readonly worker: UnitSummaryProjectionWorker, private readonly signal: AbortSignal) {
        const fail = (error: Error): void => {
            this.failure = error;
            this.pending?.reject(error);
        };
        worker.onmessage = ({ data }) => {
            if (data.type === 'error') fail(new Error(data.message));
            else if ((data.type === 'ready' && this.pending?.requestId === 0)
                || (data.type === 'projected' && data.requestId === this.pending?.requestId)) this.pending?.resolve(data);
        };
        worker.onerror = event => fail(new Error(event.message || 'Unit summary worker failed'));
        worker.onmessageerror = () => fail(new Error('Could not read unit summary worker results'));
        signal.addEventListener('abort', this.onAbort);
    }

    async initialize(dependencies: UnitSummaryProjectionDependencies): Promise<void> {
        const { equipment, quirks, sourcebooks, spriteManifest } = dependencies;
        await this.request({ type: 'initialize', dependencies: { equipment, quirks, sourcebooks, spriteManifest } }, 0);
    }

    async project(units: readonly UnitSummaryProjectionInput[]): Promise<readonly UnitSummaryProjectionOutcome[]> {
        // Source buffers may belong to the custom source cache and must remain usable.
        const detached = units.map(unit => ({ ...unit, bytes: unit.bytes.slice(0) }));
        const requestId = this.nextRequestId++;
        const response = await this.request({ type: 'project', requestId, units: detached }, requestId,
            detached.map(unit => unit.bytes));
        if (response.type !== 'projected' || response.outcomes.length !== units.length) {
            throw new Error('Unit summary worker returned an incomplete batch');
        }
        return response.outcomes;
    }

    dispose(): void {
        this.signal.removeEventListener('abort', this.onAbort);
        this.worker.onmessage = null;
        this.worker.onerror = null;
        this.worker.onmessageerror = null;
        this.worker.terminate();
    }

    private request(message: UnitSummaryProjectionWorkerRequest, requestId: number,
        transfer: Transferable[] = []): Promise<UnitSummaryProjectionWorkerResponse> {
        this.signal.throwIfAborted();
        if (this.failure) throw this.failure;
        return new Promise((resolve, reject) => {
            const finish = (): void => {
                clearTimeout(timeout);
                this.pending = undefined;
            };
            const timeout = setTimeout(() => this.pending?.reject(new Error('Unit summary worker timed out')), 120_000);
            this.pending = {
                requestId,
                resolve: response => { finish(); resolve(response); },
                reject: error => { finish(); reject(error); },
            };
            try { this.worker.postMessage(message, transfer); } catch (error) { this.pending.reject(error); }
        });
    }
}
