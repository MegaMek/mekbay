import { GameSystem } from '../models/common.model';
import { UnitSearchWorkerClient, type SearchWorkerLike } from './unit-search-worker-client.util';
import type {
    UnitSearchWorkerCorpusSnapshot,
    UnitSearchWorkerQueryRequest,
    UnitSearchWorkerResponseMessage,
    UnitSearchWorkerResultMessage,
} from './unit-search-worker-protocol.util';

class FakeSearchWorker implements SearchWorkerLike {
    onmessage: ((event: MessageEvent<UnitSearchWorkerResponseMessage>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    readonly messages: unknown[] = [];

    postMessage(message: unknown): void {
        this.messages.push(message);
    }

    terminate(): void {
        return;
    }

    emit(message: UnitSearchWorkerResponseMessage): void {
        this.onmessage?.({ data: message } as MessageEvent<UnitSearchWorkerResponseMessage>);
    }
}

function createSnapshot(version: string): UnitSearchWorkerCorpusSnapshot {
    return {
        corpusVersion: version,
        units: [],
        indexes: {
            era: {},
            faction: {},
        },
        factionEraIndex: {},
        megaMekAvailability: {
            all: {
                unitNames: [],
                bySource: {},
                byRarity: {},
            },
            eras: {},
            factions: {},
            eraFactions: {},
            extinctUnitNames: [],
            extinctByEra: {},
        },
    };
}

function createRequest(revision: number, version: string): UnitSearchWorkerQueryRequest {
    return {
        revision,
        corpusVersion: version,
        executionQuery: '',
        telemetryQuery: '',
        gameSystem: GameSystem.CLASSIC,
        availabilitySource: 'mul',
        sortKey: '',
        sortDirection: 'asc',
        bvPvLimit: 0,
        forceTotalBvPv: 0,
        pilotGunnerySkill: 4,
        pilotPilotingSkill: 5,
    };
}

describe('UnitSearchWorkerClient', () => {
    it('initializes the worker before dispatching the latest query', () => {
        const worker = new FakeSearchWorker();
        const results: UnitSearchWorkerResultMessage[] = [];
        const client = new UnitSearchWorkerClient({
            createWorker: () => worker,
            onResult: result => results.push(result),
            onError: () => fail('Unexpected worker error'),
        });

        client.submit(createSnapshot('1:0'), createRequest(1, '1:0'));

        expect(worker.messages).toEqual([
            jasmine.objectContaining({ type: 'init' }),
        ]);

        worker.emit({ type: 'ready', corpusVersion: '1:0' });

        expect(worker.messages).toEqual([
            jasmine.objectContaining({ type: 'init' }),
            jasmine.objectContaining({ type: 'execute' }),
        ]);
        expect(results).toEqual([]);
    });

    it('drops stale results and only forwards the latest revision', () => {
        const worker = new FakeSearchWorker();
        const results: UnitSearchWorkerResultMessage[] = [];
        const client = new UnitSearchWorkerClient({
            createWorker: () => worker,
            onResult: result => results.push(result),
            onError: () => fail('Unexpected worker error'),
        });

        client.submit(createSnapshot('1:0'), createRequest(1, '1:0'));
        worker.emit({ type: 'ready', corpusVersion: '1:0' });
        client.submit(createSnapshot('1:0'), createRequest(2, '1:0'));

        worker.emit({
            type: 'result',
            revision: 1,
            corpusVersion: '1:0',
            telemetryQuery: 'old',
            unitNames: [],
            stages: [],
            totalMs: 1,
            unitCount: 10,
            isComplex: false,
        });
        worker.emit({
            type: 'result',
            revision: 2,
            corpusVersion: '1:0',
            telemetryQuery: 'new',
            unitNames: [],
            stages: [],
            totalMs: 1,
            unitCount: 10,
            isComplex: false,
        });

        expect(results.length).toBe(1);
        expect(results[0]?.revision).toBe(2);
        expect(results[0]?.telemetryQuery).toBe('new');
    });
});