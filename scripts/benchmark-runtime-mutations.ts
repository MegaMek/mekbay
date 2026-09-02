// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Reproducible direct-Mek mutation profile.
 *
 * Each measured mutation is immediately reversed outside the timer. This keeps
 * the sparse runtime representative while excluding fixture construction and
 * cleanup from the result. Two paths are reported: the rules/runtime reducer
 * alone and the same mutation followed by a complete record-sheet projection.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { platform, release } from 'node:os';
import { clearLine, cursorTo } from 'node:readline';
import { emptyCBTEncounterSnapshot } from '../src/app/models/runtime/encounter-runtime';
import { projectMekRecordSheet } from '../src/app/models/runtime/mek-record-sheet';
import type { UnitConditionKey } from '../src/app/models/unit-condition.model';
import {
    createDirectMekRuntimeFixture,
    type DirectMekRuntimeFixture,
} from '../src/app/models/runtime/testing/direct-mek-runtime-fixture';
import type {
    CBTUnitCommand,
    CBTUnitInstance,
} from '../src/app/models/runtime/unit-instance';

type CBTUnitCommandBody = CBTUnitCommand;

interface MutationContext {
    readonly fixture: DirectMekRuntimeFixture;
    readonly instance: CBTUnitInstance;
}

interface MutationScenario {
    readonly name: string;
    readonly prepare?: (context: MutationContext) => void;
    readonly mutate: (context: MutationContext) => void;
    readonly restore: (context: MutationContext) => void;
}

interface Measurement {
    readonly operation: string;
    readonly path: 'runtime reducer' | 'runtime + record-sheet projection';
    readonly iterationsPerSample: number;
    readonly sampleCount: number;
    readonly p50Ms: number;
    readonly p95Ms: number;
    readonly averageMs: number;
    readonly minimumMs: number;
    readonly maximumMs: number;
}

class BenchmarkProgress {
    private completedSamples = 0;
    private lineOpen = false;

    public constructor(private readonly totalSamples: number) {}

    public update(
        scenario: MutationScenario,
        path: Measurement['path'],
        sampleIndex: number,
        phaseSamples: readonly number[],
    ): void {
        this.completedSamples++;
        const measured = sampleIndex >= warmupSamples;
        const phaseSample = measured ? sampleIndex - warmupSamples + 1 : sampleIndex + 1;
        const phaseTotal = measured ? measuredSamples : warmupSamples;
        const completedFraction = this.completedSamples / this.totalSamples;
        const barWidth = 12;
        const completedWidth = Math.floor(completedFraction * barWidth);
        const minimum = Math.min(...phaseSamples);
        const maximum = Math.max(...phaseSamples);
        const average = mean(phaseSamples);
        const phase = measured ? 'S' : 'W';
        const compactPath = path === 'runtime reducer' ? 'R' : 'P';
        const line = `[${'#'.repeat(completedWidth)}${'-'.repeat(barWidth - completedWidth)}] `
            + `${(completedFraction * 100).toFixed(1).padStart(5)}% `
            + `${this.completedSamples}/${this.totalSamples} ${compactPath} `
            + `${phase}${phaseSample}/${phaseTotal} `
            + `min/avg/max=${minimum.toFixed(4)}/${average.toFixed(4)}/${maximum.toFixed(4)}ms `
            + scenario.name;

        if (!process.stdout.isTTY) {
            if (sampleIndex === warmupSamples + measuredSamples - 1) console.log(line);
            return;
        }
        clearLine(process.stdout, 0);
        cursorTo(process.stdout, 0);
        process.stdout.write(fitToTerminal(line));
        this.lineOpen = true;
    }

    public finish(): void {
        if (!this.lineOpen) return;
        process.stdout.write('\n');
        this.lineOpen = false;
    }
}

const args = process.argv.slice(2);
const warmupSamples = integerArgument('--warmup', 5);
const measuredSamples = integerArgument('--samples', 20);
const runtimeIterations = integerArgument('--runtime-iterations', 250);
const projectedIterations = integerArgument('--projected-iterations', 30);
const operationFilter = argument('--operation')?.trim().toLocaleLowerCase();
const outputPath = argument('--output');
const fixture = createDirectMekRuntimeFixture();
const armorFace = required([...fixture.index.armorFaces.values()]
    .find(candidate => candidate.maximumPoints > 2), 'armor face');
const internalLocation = required([...fixture.index.locations.values()]
    .find(candidate => candidate.code === 'CT' && candidate.internalPoints > 2), 'internal location');
const conditionLocation = required([...fixture.index.locations.values()]
    .find(candidate => candidate.code === 'LA'), 'condition location');
const criticalSlot = required([...fixture.index.slots.values()]
    .find(candidate => candidate.componentIds.every(componentId => {
        const component = fixture.index.components.get(componentId);
        return component?.kind !== 'equipment'
            || component.mount.equipmentId !== 'Test Ammo';
    })), 'critical slot');
const ammo = fixture.equipmentComponent('Test Ammo');
const ammoLoadout = fixture.instance.query().ammoLoadout(ammo.id);
const encounter = emptyCBTEncounterSnapshot();

let instanceSequence = 0;
let checksum = 0;

const scenarios: readonly MutationScenario[] = Object.freeze([
    reversible('configure ammunition',
        context => dispatch(context.instance, {
            type: 'configure-ammo-source',
            componentId: ammo.id,
            munitionKey: ammoLoadout.munitionKey,
            remaining: ammoLoadout.capacity - 1,
        }),
        context => dispatch(context.instance, {
            type: 'configure-ammo-source',
            componentId: ammo.id,
            munitionKey: ammoLoadout.munitionKey,
            remaining: ammoLoadout.capacity,
        })),
    reversible('consume ammunition',
        context => dispatch(context.instance, {
            type: 'spend-ammo', componentId: ammo.id, amount: 1,
        }),
        context => dispatch(context.instance, {
            type: 'configure-ammo-source',
            componentId: ammo.id,
            munitionKey: ammoLoadout.munitionKey,
            remaining: ammoLoadout.capacity,
        })),
    reversible('destroy critical slot',
        context => dispatch(context.instance, {
            type: 'hit-critical', slotId: criticalSlot.id, hits: 1, target: 'pending',
        }),
        context => dispatch(context.instance, {
            type: 'repair-critical', slotId: criticalSlot.id, hits: 1, target: 'pending',
        })),
    reversible('damage armor',
        context => dispatch(context.instance, {
            type: 'damage-armor', faceId: armorFace.id, amount: 1, target: 'pending',
        }),
        context => dispatch(context.instance, {
            type: 'repair-armor', faceId: armorFace.id, amount: 1, target: 'pending',
        })),
    reversible('damage internal structure',
        context => dispatch(context.instance, {
            type: 'damage-internal', locationId: internalLocation.id, amount: 1, target: 'pending',
        }),
        context => dispatch(context.instance, {
            type: 'repair-internal', locationId: internalLocation.id, amount: 1, target: 'pending',
        })),
    reversible('set movement type and distance',
        context => dispatch(context.instance, movement('walk', 1)),
        context => dispatch(context.instance, { type: 'clear-mek-movement' })),
    {
        name: 'change movement distance',
        prepare: context => dispatch(context.instance, movement('walk', 1)),
        mutate: context => dispatch(context.instance, movement('walk', 2)),
        restore: context => dispatch(context.instance, movement('walk', 1)),
    },
    reversible('set committed heat',
        context => dispatch(context.instance, { type: 'set-heat', heat: 5 }),
        context => dispatch(context.instance, { type: 'set-heat', heat: 0 })),
    reversible('set pending heat',
        context => dispatch(context.instance, { type: 'set-pending-heat', heat: 5 }),
        context => dispatch(context.instance, { type: 'set-pending-heat', heat: null })),
    locationCondition('set NARC location condition', 'narc'),
    locationCondition('set flooded location condition', 'flooded'),
    locationCondition('set blown-off location condition', 'blown-off'),
    reversible('declare shutdown action',
        context => dispatch(context.instance, {
            type: 'declare-mek-action', action: { schemaVersion: 1, kind: 'shutdown' },
        }),
        context => {
            dispatch(context.instance, { type: 'dismiss-mek-pilot-checks' });
            dispatch(context.instance, { type: 'clear-mek-action' });
            dispatch(context.instance, { type: 'set-mek-shutdown-state', shutdown: false });
        }),
    reversible('set shutdown state',
        context => dispatch(context.instance, { type: 'set-mek-shutdown-state', shutdown: true }),
        context => dispatch(context.instance, { type: 'set-mek-shutdown-state', shutdown: false })),
    unitCondition('set prone condition', 'prone'),
    unitCondition('set swarmed condition', 'swarmed'),
    unitCondition('set jammed condition', 'jammed'),
]);

async function main(): Promise<void> {
    const results: Measurement[] = [];
    const selectedScenarios = operationFilter === undefined
        ? scenarios
        : scenarios.filter(scenario => scenario.name.toLocaleLowerCase().includes(operationFilter));
    if (selectedScenarios.length === 0) {
        throw new Error(`No mutation operation matches ${JSON.stringify(operationFilter)}`);
    }
    const progress = new BenchmarkProgress(
        selectedScenarios.length * 2 * (warmupSamples + measuredSamples),
    );
    try {
        for (const scenario of selectedScenarios) {
            results.push(measure(scenario, 'runtime reducer', runtimeIterations, progress));
            results.push(measure(
                scenario,
                'runtime + record-sheet projection',
                projectedIterations,
                progress,
            ));
        }
    } finally {
        progress.finish();
    }
    const report = Object.freeze({
        schemaVersion: 1,
        benchmark: 'direct-mek-runtime-mutations',
        generatedAt: new Date().toISOString(),
        environment: Object.freeze({
            node: process.version,
            operatingSystem: `${platform()} ${release()}`,
            architecture: process.arch,
            mode: 'tsx source / Node.js',
        }),
        config: Object.freeze({
            warmupSamples,
            measuredSamples,
            runtimeIterations,
            projectedIterations,
        }),
        fixture: Object.freeze({
            name: fixture.entity.displayName(),
            components: fixture.index.components.size,
            criticalSlots: fixture.index.slots.size,
            locations: fixture.index.locations.size,
        }),
        results: Object.freeze(results),
        checksum,
    });
    console.table(results.map(result => ({
        operation: result.operation,
        path: result.path,
        p50_ms: result.p50Ms.toFixed(4),
        p95_ms: result.p95Ms.toFixed(4),
        avg_ms: result.averageMs.toFixed(4),
        min_ms: result.minimumMs.toFixed(4),
        max_ms: result.maximumMs.toFixed(4),
    })));
    if (outputPath) {
        const absoluteOutput = resolve(outputPath);
        mkdirSync(dirname(absoluteOutput), { recursive: true });
        writeFileSync(absoluteOutput, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
        console.log(`Wrote ${absoluteOutput}`);
    }
}

function measure(
    scenario: MutationScenario,
    path: Measurement['path'],
    iterations: number,
    progress: BenchmarkProgress,
): Measurement {
    const warmups: number[] = [];
    const samples: number[] = [];
    for (let sample = 0; sample < warmupSamples + measuredSamples; sample++) {
        const context = createContext(scenario);
        let measuredDuration = 0;
        for (let iteration = 0; iteration < iterations; iteration++) {
            const start = performance.now();
            scenario.mutate(context);
            if (path === 'runtime + record-sheet projection') projectSheet(context);
            measuredDuration += performance.now() - start;
            scenario.restore(context);
        }
        const durationPerIteration = measuredDuration / iterations;
        checksum += context.instance.revision();
        const phaseSamples = sample < warmupSamples ? warmups : samples;
        phaseSamples.push(durationPerIteration);
        // Keep progress I/O outside the timed mutation and projection window.
        progress.update(scenario, path, sample, phaseSamples);
    }
    const sorted = [...samples].sort((left, right) => left - right);
    return Object.freeze({
        operation: scenario.name,
        path,
        iterationsPerSample: iterations,
        sampleCount: measuredSamples,
        p50Ms: percentile(sorted, 0.5),
        p95Ms: percentile(sorted, 0.95),
        averageMs: mean(samples),
        minimumMs: sorted[0]!,
        maximumMs: sorted.at(-1)!,
    });
}

function createContext(scenario: MutationScenario): MutationContext {
    const context = Object.freeze({
        fixture,
        instance: fixture.createInstance(`unit:runtime-benchmark:${++instanceSequence}`),
    });
    scenario.prepare?.(context);
    return context;
}

function dispatch(instance: CBTUnitInstance, body: CBTUnitCommandBody): void {
    const result = instance.dispatch(body);
    if (!result.accepted) {
        throw new Error(`Benchmark command ${body.type} rejected`);
    }
}

function projectSheet(context: MutationContext): void {
    const state = context.instance.snapshot();
    const sheet = projectMekRecordSheet(
        context.fixture.entity,
        context.fixture.index,
        context.instance.ruleset(),
        state,
        context.instance.query(),
        encounter,
        null,
    );
    checksum += sheet.locations.length + sheet.criticalSlots.length + sheet.stateRevision;
}

function reversible(
    name: string,
    mutate: MutationScenario['mutate'],
    restore: MutationScenario['restore'],
): MutationScenario {
    return Object.freeze({ name, mutate, restore });
}

function locationCondition(
    name: string,
    condition: 'narc' | 'flooded' | 'blown-off',
): MutationScenario {
    return reversible(name,
        context => dispatch(context.instance, {
            type: 'set-location-condition',
            locationId: conditionLocation.id,
            condition,
            value: 1,
            target: 'pending',
        }),
        context => dispatch(context.instance, {
            type: 'set-location-condition',
            locationId: conditionLocation.id,
            condition,
            value: 0,
            target: 'pending',
        }));
}

function unitCondition(name: string, condition: UnitConditionKey): MutationScenario {
    return reversible(name,
        context => dispatch(context.instance, { type: 'set-condition', condition, active: true }),
        context => dispatch(context.instance, { type: 'set-condition', condition, active: false }));
}

function movement(mode: 'walk', distance: number): CBTUnitCommandBody {
    return {
        type: 'declare-mek-movement',
        declaration: Object.freeze({
            schemaVersion: 1,
            mode,
            distance,
            boosterComponentIds: Object.freeze([]),
        }),
    };
}

function percentile(sorted: readonly number[], fraction: number): number {
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!;
}

function mean(values: readonly number[]): number {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function fitToTerminal(line: string): string {
    const width = process.stdout.columns;
    if (width === undefined || line.length < width) return line;
    return `${line.slice(0, Math.max(0, width - 4))}...`;
}

function argument(name: string): string | undefined {
    const index = args.indexOf(name);
    return index < 0 ? undefined : args[index + 1];
}

function integerArgument(name: string, fallback: number): number {
    const raw = argument(name);
    if (raw === undefined) return fallback;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }
    return parsed;
}

function required<T>(value: T | undefined, label: string): T {
    if (value === undefined) {
        throw new Error(`Direct Mek benchmark fixture is missing ${label}`);
    }
    return value;
}

void main();
