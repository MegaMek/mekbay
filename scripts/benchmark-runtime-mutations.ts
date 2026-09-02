// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Reproducible direct-Mek sparse-edit pipeline profile.
 *
 * Each scenario is a state-restoring cycle. Every transition in that cycle is
 * measured, including repairs and clears that older versions treated as free
 * cleanup. One pass records reducer, complete record-sheet model projection,
 * and end-to-end edit latency without repeating the mutation for each path.
 * SVG/DOM binding remains a browser concern and is intentionally out of scope.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { platform, release } from 'node:os';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { clearLine, cursorTo } from 'node:readline';
import type { ComponentId } from '../src/app/models/entity/entity-identifiers';
import { emptyCBTEncounterSnapshot } from '../src/app/models/runtime/encounter-runtime';
import { projectMekRecordSheet } from '../src/app/models/runtime/mek-record-sheet';
import {
    SHIELD_ACTIVE_MODE,
    SHIELD_INACTIVE_MODE,
} from '../src/app/models/runtime/component-shield-mode';
import {
    createDirectMekRuntimeFixture,
    createDirectModularArmorRuntimeFixture,
    createDirectShieldRuntimeFixture,
    type DirectMekRuntimeFixture,
} from '../src/app/models/runtime/testing/direct-mek-runtime-fixture';
import type {
    CBTUnitCommand,
    CBTUnitInstance,
} from '../src/app/models/runtime/unit-instance';

interface BenchmarkFixture {
    readonly label: string;
    readonly runtime: DirectMekRuntimeFixture;
}

interface MutationContext {
    readonly fixture: DirectMekRuntimeFixture;
    readonly instance: CBTUnitInstance;
}

interface MutationStep {
    readonly name: string;
    readonly execute: (context: MutationContext) => void;
}

interface MutationScenario {
    readonly category: string;
    readonly name: string;
    readonly fixture: BenchmarkFixture;
    readonly prepare?: (context: MutationContext) => void;
    readonly steps: readonly MutationStep[];
}

interface TimingSamples {
    readonly runtimeReducer: number[];
    readonly recordSheetProjection: number[];
    readonly endToEnd: number[];
}

interface TimingDistribution {
    readonly sampleDurationsMs: readonly number[];
    readonly minimumMs: number;
    readonly averageMs: number;
    readonly p50Ms: number;
    readonly p95Ms: number;
    readonly maximumMs: number;
}

interface Measurement {
    readonly category: string;
    readonly scenario: string;
    readonly operation: string;
    readonly fixture: string;
    readonly iterationsPerSample: number;
    readonly sampleCount: number;
    readonly runtimeReducer: TimingDistribution;
    readonly recordSheetProjection: TimingDistribution;
    readonly endToEnd: TimingDistribution;
}

const args = process.argv.slice(2);
const warmupSamples = integerArgument('--warmup', 2);
const measuredSamples = integerArgument('--samples', 10);
const iterationsPerSample = integerArgument('--iterations', 5);
const operationFilter = argument('--operation')?.trim().toLocaleLowerCase();
const outputPath = argument('--output');
const encounter = emptyCBTEncounterSnapshot();

let instanceSequence = 0;
let checksum = 0;

class BenchmarkProgress {
    private completedUpdates = 0;
    private lineOpen = false;

    public constructor(private readonly totalUpdates: number) {}

    public update(
        label: string,
        sampleIndex: number,
        phaseSamples: readonly number[],
    ): void {
        this.completedUpdates++;
        const measured = sampleIndex >= warmupSamples;
        const phaseSample = measured ? sampleIndex - warmupSamples + 1 : sampleIndex + 1;
        const phaseTotal = measured ? measuredSamples : warmupSamples;
        const completedFraction = this.completedUpdates / this.totalUpdates;
        const barWidth = 12;
        const completedWidth = Math.floor(completedFraction * barWidth);
        const phase = measured ? 'S' : 'W';
        const line = `[${'#'.repeat(completedWidth)}${'-'.repeat(barWidth - completedWidth)}] `
            + `${(completedFraction * 100).toFixed(1).padStart(5)}% `
            + `${this.completedUpdates}/${this.totalUpdates} ${phase}${phaseSample}/${phaseTotal} `
            + `min/avg/max=${Math.min(...phaseSamples).toFixed(4)}`
            + `/${mean(phaseSamples).toFixed(4)}`
            + `/${Math.max(...phaseSamples).toFixed(4)}ms ${label}`;

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

function main(): void {
    const fixtures = createFixtures();
    const allScenarios = createScenarios(fixtures);
    const selectedScenarios = operationFilter === undefined
        ? allScenarios
        : allScenarios.filter(scenario => scenarioMatches(scenario, operationFilter));
    if (selectedScenarios.length === 0) {
        throw new Error(`No benchmark category, scenario, or operation matches ${JSON.stringify(operationFilter)}`);
    }

    const operationCount = selectedScenarios.reduce((total, scenario) => total + scenario.steps.length, 0);
    const progress = new BenchmarkProgress(
        operationCount * (warmupSamples + measuredSamples),
    );
    const started = performance.now();
    const results: Measurement[] = [];
    console.log(
        `Profiling ${operationCount} operations in ${selectedScenarios.length} state-restoring cycles; `
        + `${warmupSamples} warmup + ${measuredSamples} measured samples x ${iterationsPerSample} edits. `
        + 'Live min/avg/max is end-to-end milliseconds per edit.',
    );
    try {
        for (const scenario of selectedScenarios) {
            results.push(...measureScenario(scenario, progress));
        }
    } finally {
        progress.finish();
    }
    const elapsedMs = performance.now() - started;

    console.table(results.map(result => ({
        category: result.category,
        scenario: result.scenario,
        operation: result.operation,
        runtime_avg_ms: result.runtimeReducer.averageMs.toFixed(4),
        sheet_avg_ms: result.recordSheetProjection.averageMs.toFixed(4),
        total_min_ms: result.endToEnd.minimumMs.toFixed(4),
        total_avg_ms: result.endToEnd.averageMs.toFixed(4),
        total_p95_ms: result.endToEnd.p95Ms.toFixed(4),
        total_max_ms: result.endToEnd.maximumMs.toFixed(4),
    })));
    console.log(`Completed in ${(elapsedMs / 1000).toFixed(2)}s; checksum ${checksum}.`);

    if (outputPath) {
        const report = Object.freeze({
            schemaVersion: 2,
            benchmark: 'direct-mek-sparse-edit-pipeline',
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
                iterationsPerSample,
                operationFilter: operationFilter ?? null,
            }),
            coverage: Object.freeze({
                categories: Object.freeze([...new Set(selectedScenarios.map(scenario => scenario.category))]),
                scenarioCount: selectedScenarios.length,
                operationCount,
                scope: 'direct sparse runtime reducer plus complete headless record-sheet model projection',
                excluded: Object.freeze([
                    'SVG/DOM binding and paint',
                    'dialogs and pointer interaction',
                    'async force history/publication',
                    'irreversible randomized automation outcomes',
                ]),
            }),
            fixtures: Object.freeze(fixtures.map(profile => Object.freeze({
                label: profile.label,
                name: profile.runtime.entity.displayName(),
                components: profile.runtime.index.components.size,
                criticalSlots: profile.runtime.index.slots.size,
                locations: profile.runtime.index.locations.size,
            }))),
            elapsedMs,
            results: Object.freeze(results),
            checksum,
        });
        const absoluteOutput = resolve(outputPath);
        mkdirSync(dirname(absoluteOutput), { recursive: true });
        writeFileSync(absoluteOutput, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
        console.log(`Wrote ${absoluteOutput}`);
    }
}

function measureScenario(
    scenario: MutationScenario,
    progress: BenchmarkProgress,
): readonly Measurement[] {
    const warmups = scenario.steps.map(() => timingSamples());
    const measured = scenario.steps.map(() => timingSamples());
    const totalSampleCount = warmupSamples + measuredSamples;

    for (let sampleIndex = 0; sampleIndex < totalSampleCount; sampleIndex++) {
        const context = createContext(scenario);
        scenario.prepare?.(context);
        const current = scenario.steps.map(() => ({
            runtimeReducer: 0,
            recordSheetProjection: 0,
            endToEnd: 0,
        }));

        for (let iteration = 0; iteration < iterationsPerSample; iteration++) {
            scenario.steps.forEach((step, stepIndex) => {
                const beforeRevision = context.instance.revision();
                const totalStarted = performance.now();
                step.execute(context);
                const runtimeFinished = performance.now();
                if (context.instance.revision() === beforeRevision) {
                    throw new Error(`${scenario.name} / ${step.name} did not change sparse runtime state`);
                }
                projectSheet(context);
                const projectionFinished = performance.now();
                const sample = current[stepIndex]!;
                sample.runtimeReducer += runtimeFinished - totalStarted;
                sample.recordSheetProjection += projectionFinished - runtimeFinished;
                sample.endToEnd += projectionFinished - totalStarted;
            });
        }

        scenario.steps.forEach((step, stepIndex) => {
            const values = current[stepIndex]!;
            const destination = sampleIndex < warmupSamples ? warmups[stepIndex]! : measured[stepIndex]!;
            destination.runtimeReducer.push(values.runtimeReducer / iterationsPerSample);
            destination.recordSheetProjection.push(values.recordSheetProjection / iterationsPerSample);
            destination.endToEnd.push(values.endToEnd / iterationsPerSample);
            progress.update(
                `${scenario.name}: ${step.name}`,
                sampleIndex,
                destination.endToEnd,
            );
        });
    }

    return Object.freeze(scenario.steps.map((step, index) => {
        const samples = measured[index]!;
        return Object.freeze({
            category: scenario.category,
            scenario: scenario.name,
            operation: step.name,
            fixture: scenario.fixture.label,
            iterationsPerSample,
            sampleCount: measuredSamples,
            runtimeReducer: distribution(samples.runtimeReducer),
            recordSheetProjection: distribution(samples.recordSheetProjection),
            endToEnd: distribution(samples.endToEnd),
        });
    }));
}

function createFixtures(): readonly BenchmarkFixture[] {
    return Object.freeze([
        Object.freeze({ label: 'standard direct Mek', runtime: createDirectMekRuntimeFixture() }),
        Object.freeze({
            label: 'Total Warfare direct Mek',
            runtime: createDirectMekRuntimeFixture('total-warfare'),
        }),
        Object.freeze({ label: 'medium-shield direct Mek', runtime: createDirectShieldRuntimeFixture() }),
        Object.freeze({ label: 'modular-armor direct Mek', runtime: createDirectModularArmorRuntimeFixture() }),
    ]);
}

function createScenarios(fixtures: readonly BenchmarkFixture[]): readonly MutationScenario[] {
    const standard = required(fixtures.find(profile => profile.label === 'standard direct Mek'), 'standard fixture');
    const totalWarfare = required(
        fixtures.find(profile => profile.label === 'Total Warfare direct Mek'),
        'Total Warfare fixture',
    );
    const shield = required(fixtures.find(profile => profile.label === 'medium-shield direct Mek'), 'shield fixture');
    const modular = required(fixtures.find(profile => profile.label === 'modular-armor direct Mek'), 'modular fixture');
    const fixture = standard.runtime;
    const armorFace = required([...fixture.index.armorFaces.values()]
        .find(candidate => candidate.maximumPoints > 2), 'armor face');
    const internalLocation = required([...fixture.index.locations.values()]
        .find(candidate => candidate.code === 'CT' && candidate.internalPoints > 2), 'internal location');
    const conditionLocation = required([...fixture.index.locations.values()]
        .find(candidate => candidate.code === 'LA'), 'condition location');
    const ac = fixture.equipmentComponent('Test AC');
    const totalWarfareAc = totalWarfare.runtime.equipmentComponent('Test AC');
    const laser = fixture.equipmentComponent('ISMediumLaser');
    const ammo = fixture.equipmentComponent('Test Ammo');
    const ammoLoadout = fixture.instance.query().ammoLoadout(ammo.id);
    const criticalSlot = required([...fixture.index.slots.values()]
        .find(candidate => candidate.componentIds.includes(ac.id)), 'equipment critical slot');
    const crew = required([...fixture.index.crewPositions.values()][0], 'crew position');
    const intrinsicAction = required(fixture.index.intrinsicActions[0], 'intrinsic action');
    const scenarios: MutationScenario[] = [];

    for (const target of ['pending', 'committed'] as const) {
        scenarios.push(
            pairScenario(`${target} armor track`, 'damage tracks', standard,
                commandStep('damage armor', () => ({
                    type: 'damage-armor', faceId: armorFace.id, amount: 1, target,
                })),
                commandStep('repair armor', () => ({
                    type: 'repair-armor', faceId: armorFace.id, amount: 1, target,
                }))),
            pairScenario(`${target} internal track`, 'damage tracks', standard,
                commandStep('damage internal structure', () => ({
                    type: 'damage-internal', locationId: internalLocation.id, amount: 1, target,
                })),
                commandStep('repair internal structure', () => ({
                    type: 'repair-internal', locationId: internalLocation.id, amount: 1, target,
                }))),
            pairScenario(`${target} critical track`, 'damage tracks', standard,
                commandStep('hit critical slot', () => ({
                    type: 'hit-critical', slotId: criticalSlot.id, hits: 1, target,
                })),
                commandStep('repair critical slot', () => ({
                    type: 'repair-critical', slotId: criticalSlot.id, hits: 1, target,
                }))),
            pairScenario(`${target} Sensors system track`, 'damage tracks', standard,
                commandStep('set system critical level', () => ({
                    type: 'set-system-critical-level', system: 'Sensors', level: 1, target,
                })),
                commandStep('clear system critical level', () => ({
                    type: 'set-system-critical-level', system: 'Sensors', level: 0, target,
                }))),
            pairScenario(`${target} component status`, 'equipment state', standard,
                commandStep('disable component', () => ({
                    type: 'set-component-status', componentId: laser.id, status: 'disabled', target,
                })),
                commandStep('clear component override', () => ({
                    type: 'set-component-status', componentId: laser.id, status: 'available', target,
                }))),
        );
        for (const condition of ['narc', 'flooded', 'blown-off'] as const) {
            scenarios.push(pairScenario(
                `${target} ${condition} location condition`,
                'location conditions',
                standard,
                commandStep(`set ${condition}`, () => ({
                    type: 'set-location-condition',
                    locationId: conditionLocation.id,
                    condition,
                    value: 1,
                    target,
                })),
                commandStep(`clear ${condition}`, () => ({
                    type: 'set-location-condition',
                    locationId: conditionLocation.id,
                    condition,
                    value: 0,
                    target,
                })),
            ));
        }
    }

    scenarios.push(
        pairScenario('ammunition count', 'equipment state', standard,
            commandStep('spend ammunition', () => ({
                type: 'spend-ammo', componentId: ammo.id, amount: 1,
            })),
            commandStep('refill ammunition', () => ({
                type: 'configure-ammo-source',
                componentId: ammo.id,
                munitionKey: ammoLoadout.munitionKey,
                remaining: ammoLoadout.capacity,
            }))),
        pairScenario('rapid-fire mode', 'equipment state', standard,
            commandStep('select Rapid mode', () => ({
                type: 'set-component-mode', componentId: ac.id, mode: 'Rapid',
            })),
            commandStep('select Single mode', () => ({
                type: 'set-component-mode', componentId: ac.id, mode: 'Single',
            }))),
        pairScenario('rapid-fire jam state', 'equipment state', totalWarfare,
            commandStep('jam component', () => ({
                type: 'set-component-jammed', componentId: totalWarfareAc.id, jammed: true,
            })),
            commandStep('clear component jam', () => ({
                type: 'set-component-jammed', componentId: totalWarfareAc.id, jammed: false,
            })),
            context => dispatch(context.instance, {
                type: 'set-component-mode', componentId: totalWarfareAc.id, mode: 'Rapid',
            })),
        pairScenario('weapon targeting selection', 'targeting state', standard,
            targetingStep('select weapon', laser.id, { kind: 'selected' }),
            targetingStep('clear weapon selection', laser.id, null)),
        Object.freeze({
            category: 'targeting state',
            name: 'physical-action targeting selection',
            fixture: standard,
            steps: Object.freeze([
                targetingActionStep('select physical action', intrinsicAction.id, { kind: 'selected' }),
                targetingActionStep('clear physical action', intrinsicAction.id, null),
            ]),
        }),
        pairScenario('committed heat', 'heat and crew', standard,
            commandStep('set committed heat', () => ({ type: 'set-heat', heat: 5 })),
            commandStep('clear committed heat', () => ({ type: 'set-heat', heat: 0 }))),
        pairScenario('pending heat override', 'heat and crew', standard,
            commandStep('set pending heat', () => ({ type: 'set-pending-heat', heat: 5 })),
            commandStep('clear pending heat', () => ({ type: 'set-pending-heat', heat: null }))),
        pairScenario('disabled heat sinks', 'heat and crew', standard,
            commandStep('disable one heat sink', () => ({ type: 'set-heatsinks-off', heatsinksOff: 1 })),
            commandStep('enable all heat sinks', () => ({ type: 'set-heatsinks-off', heatsinksOff: 0 }))),
        Object.freeze({
            category: 'heat and crew',
            name: 'pending heat application',
            fixture: standard,
            steps: Object.freeze([
                commandStep('stage heat', () => ({ type: 'set-pending-heat', heat: 5 })),
                commandStep('apply staged heat', () => ({ type: 'apply-heat', policy: 'manual' })),
                commandStep('reset applied heat', () => ({ type: 'set-heat', heat: 0 })),
            ]),
        }),
        pairScenario('crew wounds', 'heat and crew', standard,
            commandStep('wound crew', () => ({
                type: 'set-crew-state', positionId: crew.id,
                wounds: 1, unconscious: false, ejected: false,
            })),
            commandStep('heal crew', () => ({
                type: 'set-crew-state', positionId: crew.id,
                wounds: 0, unconscious: false, ejected: false,
            }))),
        pairScenario('crew consciousness', 'heat and crew', standard,
            commandStep('set crew unconscious', () => ({
                type: 'set-crew-state', positionId: crew.id,
                wounds: 0, unconscious: true, ejected: false,
            })),
            commandStep('set crew conscious', () => ({
                type: 'set-crew-state', positionId: crew.id,
                wounds: 0, unconscious: false, ejected: false,
            }))),
    );

    for (const condition of ['prone', 'swarmed', 'jammed'] as const) {
        scenarios.push(pairScenario(
            `${condition} unit condition`,
            'unit and movement state',
            standard,
            commandStep(`set ${condition}`, () => ({
                type: 'set-condition', condition, active: true,
            })),
            commandStep(`clear ${condition}`, () => ({
                type: 'set-condition', condition, active: false,
            })),
        ));
    }
    scenarios.push(
        pairScenario('movement declaration', 'unit and movement state', standard,
            commandStep('declare walk', () => movement('walk', 1)),
            commandStep('clear movement', () => ({ type: 'clear-mek-movement' }))),
        pairScenario('movement distance edit', 'unit and movement state', standard,
            commandStep('increase movement distance', () => movement('walk', 2)),
            commandStep('restore movement distance', () => movement('walk', 1)),
            context => dispatch(context.instance, movement('walk', 1))),
        pairScenario('manual shutdown state', 'unit and movement state', standard,
            commandStep('shut down', () => ({ type: 'set-mek-shutdown-state', shutdown: true })),
            commandStep('start up', () => ({ type: 'set-mek-shutdown-state', shutdown: false }))),
        Object.freeze({
            category: 'phase boundaries',
            name: 'commit pending armor',
            fixture: standard,
            steps: Object.freeze([
                commandStep('stage pending armor damage', () => ({
                    type: 'damage-armor', faceId: armorFace.id, amount: 1, target: 'pending',
                })),
                commandStep('commit pending overlay', () => ({ type: 'commit-pending' })),
                commandStep('repair committed armor', () => ({
                    type: 'repair-armor', faceId: armorFace.id, amount: 1, target: 'committed',
                })),
            ]),
        }),
        Object.freeze({
            category: 'phase boundaries',
            name: 'cancel pending armor',
            fixture: standard,
            steps: Object.freeze([
                commandStep('stage pending armor damage', () => ({
                    type: 'damage-armor', faceId: armorFace.id, amount: 1, target: 'pending',
                })),
                commandStep('cancel pending overlay', () => ({ type: 'cancel-pending' })),
            ]),
        }),
        Object.freeze({
            category: 'phase boundaries',
            name: 'end phase with pending armor',
            fixture: standard,
            steps: Object.freeze([
                commandStep('stage pending armor damage', () => ({
                    type: 'damage-armor', faceId: armorFace.id, amount: 1, target: 'pending',
                })),
                commandStep('end phase', () => ({ type: 'end-phase' })),
                commandStep('repair committed armor', () => ({
                    type: 'repair-armor', faceId: armorFace.id, amount: 1, target: 'committed',
                })),
            ]),
        }),
    );

    addShieldScenarios(scenarios, shield);
    addModularArmorScenarios(scenarios, modular);
    scenarios.push(pairScenario(
        'representative populated sparse state',
        'sparse-state scaling',
        standard,
        commandStep('disable one heat sink', () => ({ type: 'set-heatsinks-off', heatsinksOff: 1 })),
        commandStep('enable all heat sinks', () => ({ type: 'set-heatsinks-off', heatsinksOff: 0 })),
        context => {
            dispatch(context.instance, {
                type: 'damage-armor', faceId: armorFace.id, amount: 1, target: 'pending',
            });
            dispatch(context.instance, {
                type: 'damage-internal', locationId: internalLocation.id, amount: 1, target: 'pending',
            });
            dispatch(context.instance, {
                type: 'hit-critical', slotId: criticalSlot.id, hits: 1, target: 'pending',
            });
            dispatch(context.instance, {
                type: 'spend-ammo', componentId: ammo.id, amount: 1,
            });
            dispatch(context.instance, { type: 'set-heat', heat: 5 });
            dispatch(context.instance, { type: 'set-condition', condition: 'prone', active: true });
            dispatch(context.instance, {
                type: 'set-location-condition', locationId: conditionLocation.id,
                condition: 'narc', value: 1, target: 'pending',
            });
            dispatch(context.instance, {
                type: 'set-crew-state', positionId: crew.id,
                wounds: 1, unconscious: false, ejected: false,
            });
        },
    ));

    return Object.freeze(scenarios);
}

function addShieldScenarios(
    scenarios: MutationScenario[],
    fixture: BenchmarkFixture,
): void {
    const shield = fixture.runtime.equipmentComponent('Test Medium Shield');
    for (const target of ['pending', 'committed'] as const) {
        for (const track of ['absorption', 'capacity'] as const) {
            scenarios.push(pairScenario(
                `${target} shield ${track} track`,
                'shield state',
                fixture,
                commandStep(`damage shield ${track}`, () => ({
                    type: 'damage-shield', componentId: shield.id, track, amount: 1, target,
                })),
                commandStep(`repair shield ${track}`, () => ({
                    type: 'repair-shield', componentId: shield.id, track, amount: 1, target,
                })),
            ));
        }
    }
    scenarios.push(pairScenario(
        'shield mode',
        'shield state',
        fixture,
        commandStep('raise shield', () => ({
            type: 'set-component-mode', componentId: shield.id, mode: SHIELD_ACTIVE_MODE,
        })),
        commandStep('lower shield', () => ({
            type: 'set-component-mode', componentId: shield.id, mode: SHIELD_INACTIVE_MODE,
        })),
    ));
}

function addModularArmorScenarios(
    scenarios: MutationScenario[],
    fixture: BenchmarkFixture,
): void {
    const modularArmor = fixture.runtime.equipmentComponent('Test Modular Armor');
    const slot = required([...fixture.runtime.index.slots.values()]
        .find(candidate => candidate.componentIds.includes(modularArmor.id)), 'modular-armor slot');
    const face = required([...fixture.runtime.index.armorFaces.values()]
        .find(candidate => candidate.locationId === slot.locationId && candidate.face === 'front'),
        'modular-armor location face');
    for (const target of ['pending', 'committed'] as const) {
        scenarios.push(pairScenario(
            `${target} modular-armor absorption`,
            'modular armor state',
            fixture,
            commandStep('damage modular armor', () => ({
                type: 'damage-armor', faceId: face.id, amount: 1, target,
            })),
            commandStep('repair modular armor', () => ({
                type: 'repair-armor', faceId: face.id, amount: 1, target,
            })),
        ));
    }
}

function pairScenario(
    name: string,
    category: string,
    fixture: BenchmarkFixture,
    forward: MutationStep,
    reverse: MutationStep,
    prepare?: MutationScenario['prepare'],
): MutationScenario {
    return Object.freeze({
        name,
        category,
        fixture,
        ...(prepare === undefined ? {} : { prepare }),
        steps: Object.freeze([forward, reverse]),
    });
}

function commandStep(
    name: string,
    command: (context: MutationContext) => CBTUnitCommand,
): MutationStep {
    return Object.freeze({
        name,
        execute: (context: MutationContext) => dispatch(context.instance, command(context)),
    });
}

function targetingStep(
    name: string,
    componentId: ComponentId,
    selection: { readonly kind: 'selected' } | null,
): MutationStep {
    return Object.freeze({
        name,
        execute: (context: MutationContext) => {
            const result = context.instance.dispatchAttackerTargeting({
                type: 'edit-attacker-targeting',
                edit: { kind: 'set-component-selection', componentId, selection },
            }, encounter, false);
            if (!result.accepted) throw new Error(`Benchmark targeting operation ${name} was rejected`);
        },
    });
}

function targetingActionStep(
    name: string,
    actionId: string,
    selection: { readonly kind: 'selected' } | null,
): MutationStep {
    return Object.freeze({
        name,
        execute: (context: MutationContext) => {
            const result = context.instance.dispatchAttackerTargeting({
                type: 'edit-attacker-targeting',
                edit: {
                    kind: 'set-action-selection',
                    target: { kind: 'intrinsic', actionId },
                    selection,
                },
            }, encounter, false);
            if (!result.accepted) throw new Error(`Benchmark targeting operation ${name} was rejected`);
        },
    });
}

function createContext(scenario: MutationScenario): MutationContext {
    return Object.freeze({
        fixture: scenario.fixture.runtime,
        instance: scenario.fixture.runtime.createInstance(`unit:runtime-benchmark:${++instanceSequence}`),
    });
}

function dispatch(instance: CBTUnitInstance, command: CBTUnitCommand): void {
    const result = instance.dispatch(command);
    if (!result.accepted) throw new Error(`Benchmark command ${command.type} was rejected`);
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

function movement(mode: 'walk', distance: number): CBTUnitCommand {
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

function timingSamples(): TimingSamples {
    return {
        runtimeReducer: [],
        recordSheetProjection: [],
        endToEnd: [],
    };
}

function distribution(samples: readonly number[]): TimingDistribution {
    const sorted = [...samples].sort((left, right) => left - right);
    return Object.freeze({
        sampleDurationsMs: Object.freeze([...samples]),
        minimumMs: sorted[0]!,
        averageMs: mean(samples),
        p50Ms: percentile(sorted, 0.5),
        p95Ms: percentile(sorted, 0.95),
        maximumMs: sorted.at(-1)!,
    });
}

function percentile(sorted: readonly number[], fraction: number): number {
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!;
}

function mean(values: readonly number[]): number {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function scenarioMatches(scenario: MutationScenario, filter: string): boolean {
    return scenario.category.toLocaleLowerCase().includes(filter)
        || scenario.name.toLocaleLowerCase().includes(filter)
        || scenario.steps.some(step => step.name.toLocaleLowerCase().includes(filter));
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
    if (value === undefined) throw new Error(`Direct Mek benchmark fixture is missing ${label}`);
    return value;
}

try {
    main();
} catch (error) {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
}
