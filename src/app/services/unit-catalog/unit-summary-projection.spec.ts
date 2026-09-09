// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { createEmptyUnit } from '../../testing/unit-test-helpers';
import { asSourceHash, asUnitUuid, makeUnitFileName, CUSTOM_UNIT_PROVIDER_ID } from './unit-catalog.types';
import type { UnitSummaryProjectionInput, UnitSummaryProjector } from './entity-summary-projector';
import { projectUnitSummaryBatches, type UnitSummaryProjectionWorker } from './unit-summary-projection';
import type { UnitSummaryProjectionDependencies, UnitSummaryProjectionOutcome,
    UnitSummaryProjectionWorkerRequest, UnitSummaryProjectionWorkerResponse } from './unit-summary-projection-worker-protocol';

const dependencies = {} as UnitSummaryProjectionDependencies;

function input(index: number): UnitSummaryProjectionInput {
    const uuid = asUnitUuid(`019f6767-0dcb-7bb8-992f-${String(index).padStart(12, '0')}`);
    return { entryKey: { origin: 'user', design: { provider: CUSTOM_UNIT_PROVIDER_ID, uuid },
        sourceRevision: asSourceHash('AAAAAAAAAAAAAAAAAAAAAAAAAAA') },
        file: makeUnitFileName(uuid, 'mtf'), format: 'mtf', bytes: new Uint32Array([index]).buffer };
}

function projected(unit: UnitSummaryProjectionInput): UnitSummaryProjectionOutcome {
    return { status: 'projected', value: { diagnostics: [], summary: createEmptyUnit({
        uuid: unit.entryKey.design.uuid, name: String(new Uint32Array(unit.bytes)[0]),
    }) } };
}

class FakeWorker implements UnitSummaryProjectionWorker {
    onmessage: UnitSummaryProjectionWorker['onmessage'] = null;
    onerror: UnitSummaryProjectionWorker['onerror'] = null;
    onmessageerror: UnitSummaryProjectionWorker['onmessageerror'] = null;
    readonly batches: UnitSummaryProjectionInput[][] = [];
    initializations = 0;
    terminated = false;
    respond = true;
    failInitialize = false;

    postMessage(message: UnitSummaryProjectionWorkerRequest, transfer: Transferable[] = []): void {
        const received = structuredClone(message, { transfer });
        if (received.type === 'initialize') {
            this.initializations++;
            queueMicrotask(() => this.send(this.failInitialize
                ? { type: 'error', message: 'Equipment unavailable' } : { type: 'ready' }));
        } else {
            this.batches.push([...received.units]);
            if (this.respond) setTimeout(() => this.send({ type: 'projected', requestId: received.requestId,
                outcomes: received.units.map(projected) }), this.batches.length % 2);
        }
    }

    terminate(): void { this.terminated = true; }
    private send(data: UnitSummaryProjectionWorkerResponse): void { this.onmessage?.({ data } as MessageEvent<UnitSummaryProjectionWorkerResponse>); }
}

describe('unit summary batch projection', () => {
    const projector = { project: async (unit: UnitSummaryProjectionInput) => {
        const result = projected(unit);
        if (result.status !== 'projected') throw new Error('Unexpected fixture error');
        return result.value;
    } } satisfies UnitSummaryProjector;

    it('bounds worker batches, preserves output order and keeps caller source buffers intact', async () => {
        const inputs = Array.from({ length: 513 }, (_, index) => input(index));
        const workers: FakeWorker[] = [];
        const progress = jasmine.createSpy('progress');
        const results = await projectUnitSummaryBatches(inputs.map(unit => async () => unit), {
            projector, dependencies, workers: { count: 4, createWorker: () => {
                const worker = new FakeWorker(); workers.push(worker); return worker;
            } },
        }, { signal: new AbortController().signal, onProgress: progress });
        expect(workers.length).toBe(4);
        expect(workers.every(worker => worker.initializations === 1 && worker.terminated)).toBeTrue();
        expect(workers.flatMap(worker => worker.batches).every(batch => batch.length <= 64)).toBeTrue();
        expect(results.map(result => result.status === 'projected' ? result.value.summary.name : 'error'))
            .toEqual(inputs.map((_, index) => String(index)));
        expect(inputs.every(unit => unit.bytes.byteLength === 4)).toBeTrue();
        expect(progress.calls.first().args[0]).toEqual({ completed: 0, total: 513 });
        expect(progress.calls.mostRecent().args[0]).toEqual({ completed: 513, total: 513 });
        expect(progress.calls.count()).toBeLessThan(12);
    });

    it('reuses the warm cooperative projector for up to eight edits and uses a worker for larger batches', async () => {
        const factory = jasmine.createSpy('factory').and.callFake(() => new FakeWorker());
        const context = { projector, dependencies, workers: { count: 4, createWorker: factory } };
        const options = { signal: new AbortController().signal };
        expect(await projectUnitSummaryBatches([], context, options)).toEqual([]);
        expect(factory).not.toHaveBeenCalled();
        const sources = Array.from({ length: 8 }, (_, index) => async () => input(index));
        expect(await projectUnitSummaryBatches(sources, context, options))
            .toEqual(await projectUnitSummaryBatches(sources, { projector, dependencies }, options));
        expect(factory).not.toHaveBeenCalled();
        await projectUnitSummaryBatches([...sources, async () => input(8)], context, options);
        expect(factory).toHaveBeenCalledTimes(1);
    });

    it('cancels an in-flight worker batch and terminates every worker', async () => {
        const worker = new FakeWorker(); worker.respond = false;
        const controller = new AbortController();
        const result = projectUnitSummaryBatches(Array.from({ length: 9 }, (_, index) => async () => input(index)), {
            projector, dependencies, workers: { count: 1, createWorker: () => worker },
        }, { signal: controller.signal });
        const rejection = expectAsync(result).toBeRejected();
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        controller.abort();
        await rejection;
        expect(worker.batches.length).toBe(1);
        expect(worker.terminated).toBeTrue();
    });

    it('fails the job and cleans up workers if initialization fails', async () => {
        const worker = new FakeWorker(); worker.failInitialize = true;
        await expectAsync(projectUnitSummaryBatches(Array.from({ length: 9 }, (_, index) => async () => input(index)), {
            projector, dependencies, workers: { count: 1, createWorker: () => worker },
        }, { signal: new AbortController().signal })).toBeRejectedWithError('Equipment unavailable');
        expect(worker.terminated).toBeTrue();
    });

    it('retains worker failures that arrive while the next native sources are loading', async () => {
        const worker = new FakeWorker();
        await expectAsync(projectUnitSummaryBatches(Array.from({ length: 9 }, () => async () => {
            worker.onerror?.({ message: 'Worker stopped' } as ErrorEvent);
            return input(0);
        }), {
            projector, dependencies, workers: { count: 1, createWorker: () => worker },
        }, { signal: new AbortController().signal })).toBeRejectedWithError('Worker stopped');
        expect(worker.batches).toEqual([]);
        expect(worker.terminated).toBeTrue();
    });

    it('keeps per-unit failures isolated in the cooperative fallback', async () => {
        const inputs = [input(0), input(1), input(2)];
        const results = await projectUnitSummaryBatches(inputs.map(unit => async () => unit), {
            dependencies, projector: { project: async unit => {
                if (unit === inputs[1]) throw new Error('Malformed custom design');
                return projector.project(unit);
            } },
        }, { signal: new AbortController().signal });
        expect(results.map(result => result.status)).toEqual(['projected', 'error', 'projected']);
        expect(results[1]).toEqual({ status: 'error', message: 'Malformed custom design' });
    });

    it('stops loading new sources after cancellation in the cooperative fallback', async () => {
        const controller = new AbortController();
        const later = jasmine.createSpy('later').and.resolveTo(input(1));
        await expectAsync(projectUnitSummaryBatches([async () => input(0), later], {
            dependencies, projector: { project: async unit => {
                controller.abort();
                return projector.project(unit);
            } },
        }, { signal: controller.signal })).toBeRejected();
        expect(later).not.toHaveBeenCalled();
    });
});
