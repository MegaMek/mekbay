// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Reproducible direct-Mek sparse-edit pipeline profile.
 *
 * Each scenario is a state-restoring cycle. Every transition in that cycle is
 * measured, including repairs and clears that older versions treated as free
 * cleanup. Independent cohorts measure the sparse reducer with no downstream
 * rebuild and the full dependency-aware battle-value + record-sheet pipeline.
 * SVG/DOM binding remains a browser concern and is intentionally out of scope.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { platform, release } from 'node:os';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { clearLine, cursorTo } from 'node:readline';
import type { ComponentId } from '../src/app/models/entity/entity-identifiers';
import type { AttackerTargetingEdit } from '../src/app/models/runtime/attacker-targeting-state';
import { BOMBAST_LASER_CHARGING_STATE } from '../src/app/models/runtime/component-bombast-laser';
import { PPC_CAPACITOR_CHARGING_STATE } from '../src/app/models/runtime/component-ppc-capacitor';
import { commandMayChangeBaseBattleValue } from '../src/app/models/runtime/cbt-force-mek-mutation-impact';
import {
    asEncounterTargetId,
    emptyCBTEncounterSnapshot,
    type TargetRegistrySnapshot,
} from '../src/app/models/runtime/encounter-runtime';
import { MEK_TORSO_CRIPPLING_RULE_CHECK_KEY } from '../src/app/models/runtime/mek-destruction-state-v2';
import {
    projectMekRecordSheet,
    type MekRecordSheetBattleValueSnapshot,
} from '../src/app/models/runtime/mek-record-sheet';
import {
    SHIELD_ACTIVE_MODE,
    SHIELD_INACTIVE_MODE,
} from '../src/app/models/runtime/component-shield-mode';
import {
    createDirectBombastRuntimeFixture,
    createDirectBoobyTrapRuntimeFixture,
    createDirectCoolantPodRuntimeFixture,
    createDirectMekRuntimeFixture,
    createDirectModularArmorRuntimeFixture,
    createDirectShieldRuntimeFixture,
    type DirectMekRuntimeFixture,
} from '../src/app/models/runtime/testing/direct-mek-runtime-fixture';
import type {
    CBTUnitCommand,
    CBTUnitInstance,
} from '../src/app/models/runtime/unit-instance';

const REQUIRED_COMMAND_TYPES = Object.freeze({
    'damage-armor': true,
    'repair-armor': true,
    'damage-internal': true,
    'repair-internal': true,
    'hit-critical': true,
    'repair-critical': true,
    'apply-mek-blow-off': true,
    'apply-mek-critical-roll': true,
    'set-system-critical-level': true,
    'set-component-status': true,
    'damage-shield': true,
    'repair-shield': true,
    'set-component-mode': true,
    'detonate-booby-trap': true,
    'set-stealth-state': true,
    'toggle-gauss-power': true,
    'set-component-jammed': true,
    'edit-escalating-failure': true,
    'set-ppc-capacitor-charge': true,
    'set-bombast-laser-charge': true,
    'edit-c3-emergency-master': true,
    'configure-ammo-source': true,
    'spend-ammo': true,
    'activate-coolant-pod': true,
    'fire-weapons': true,
    'set-heat': true,
    'set-pending-heat': true,
    'set-heatsinks-off': true,
    'apply-heat': true,
    'set-condition': true,
    'set-mek-shutdown-state': true,
    'resolve-mek-rule-check': true,
    'set-location-condition': true,
    'set-crew-state': true,
    'declare-mek-movement': true,
    'clear-mek-movement': true,
    'declare-mek-action': true,
    'clear-mek-action': true,
    'prepare-mek-stand': true,
    'resolve-mek-stand-attempt': true,
    'adjust-mek-stand-attempts': true,
    'resolve-mek-pilot-check': true,
    'dismiss-mek-pilot-checks': true,
    'dismiss-mek-automatic-falls': true,
    'replace-turn-state': true,
    'set-pending-fall-consequences': true,
    'reset-turn-state': true,
    'end-phase': true,
    'mark-end-turn-heat-staged': true,
    'end-turn': true,
    'commit-pending': true,
    'cancel-pending': true,
} satisfies Readonly<Record<CBTUnitCommand['type'], true>>);

const REQUIRED_TARGETING_EDIT_KINDS = Object.freeze({
    'set-component-selection': true,
    'set-component-selections': true,
    'set-action-selection': true,
    'set-component-ammo': true,
    'set-component-ammos': true,
    'set-target-facts': true,
} satisfies Readonly<Record<AttackerTargetingEdit['kind'], true>>);

type TargetingMutationKey = `edit-attacker-targeting:${AttackerTargetingEdit['kind']}`;
type EscalatingFailureMutationKey = `edit-escalating-failure:${'select-sequence' | 'set-status'}`;
type C3EmergencyMasterMutationKey = `edit-c3-emergency-master:${
    'toggle-requested' | 'select-operating-turns' | 'ensure-active-started' | 'settle-active-end-turn'
}`;
type RuntimeMutationKey = keyof typeof REQUIRED_COMMAND_TYPES
    | TargetingMutationKey
    | EscalatingFailureMutationKey
    | C3EmergencyMasterMutationKey
    | 'fire-selected-weapons'
    | 'set-equipment-row-order'
    | 'install-attacker-targeting-reconciliation';

const BENCHMARK_PIPELINES = Object.freeze(['runtime-only', 'full-sheet'] as const);
type BenchmarkPipeline = typeof BENCHMARK_PIPELINES[number];

const REQUIRED_MUTATIONS: readonly RuntimeMutationKey[] = Object.freeze([
    ...Object.keys(REQUIRED_COMMAND_TYPES) as CBTUnitCommand['type'][],
    ...Object.keys(REQUIRED_TARGETING_EDIT_KINDS)
        .map(kind => `edit-attacker-targeting:${kind}` as TargetingMutationKey),
    'edit-escalating-failure:select-sequence',
    'edit-escalating-failure:set-status',
    'edit-c3-emergency-master:toggle-requested',
    'edit-c3-emergency-master:select-operating-turns',
    'edit-c3-emergency-master:ensure-active-started',
    'edit-c3-emergency-master:settle-active-end-turn',
    'fire-selected-weapons',
    'set-equipment-row-order',
    'install-attacker-targeting-reconciliation',
]);

interface BenchmarkFixture {
    readonly label: string;
    readonly runtime: DirectMekRuntimeFixture;
}

interface MutationContext {
    readonly fixture: DirectMekRuntimeFixture;
    readonly instance: CBTUnitInstance;
    readonly targetRegistry: TargetRegistrySnapshot;
}

interface MutationImpact {
    readonly baseBattleValueChanged: boolean;
}

interface MutationStep {
    readonly name: string;
    readonly mutations: readonly RuntimeMutationKey[];
    readonly execute: (context: MutationContext) => MutationImpact;
}

interface MutationScenario {
    readonly category: string;
    readonly name: string;
    readonly fixture: BenchmarkFixture;
    readonly repeat: 'cycle' | 'fresh-instance';
    readonly targetRegistry?: TargetRegistrySnapshot;
    readonly prepare?: (context: MutationContext) => void;
    readonly steps: readonly MutationStep[];
}

interface TimingSamples {
    readonly runtimeReducer: number[];
    readonly runtimeBattleValue: number[];
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

interface ScenarioTimingSamples {
    readonly scenario: MutationScenario;
    readonly pipeline: BenchmarkPipeline;
    readonly warmups: readonly TimingSamples[];
    readonly measured: readonly TimingSamples[];
}

interface Measurement {
    readonly category: string;
    readonly scenario: string;
    readonly operation: string;
    readonly fixture: string;
    readonly mutations: readonly RuntimeMutationKey[];
    readonly iterationsPerSample: number;
    readonly sampleCount: number;
    readonly baseBattleValueRecalculated: boolean;
    readonly runtimeOnly: TimingDistribution;
    readonly runtimeReducer: TimingDistribution;
    readonly runtimeBattleValue: TimingDistribution;
    readonly recordSheetProjection: TimingDistribution;
    readonly endToEnd: TimingDistribution;
}

interface PreparedMutationContext {
    readonly context: MutationContext;
    readonly battleValue: MekRecordSheetBattleValueSnapshot | null;
}

const args = process.argv.slice(2);
const warmupSamples = integerArgument('--warmup', 3);
const measuredSamples = integerArgument('--samples', 20);
const iterationsPerSample = integerArgument('--iterations', 1);
const operationFilter = argument('--operation')?.trim().toLocaleLowerCase();
const outputPath = argument('--output');
const emptyTargetRegistry = emptyCBTEncounterSnapshot();
const baseBattleValueChanged = Object.freeze({ baseBattleValueChanged: true });
const baseBattleValueUnchanged = Object.freeze({ baseBattleValueChanged: false });
const pristineBattleValueByFixture = new WeakMap<DirectMekRuntimeFixture, number | null>();

let instanceSequence = 0;
let checksum = 0;

class BenchmarkProgress {
    private completedUpdates = 0;
    private lastRenderedAt = Number.NEGATIVE_INFINITY;
    private lineOpen = false;

    public constructor(private readonly totalUpdates: number) {}

    public update(
        label: string,
        sampleIndex: number,
        phaseSamples: readonly number[],
    ): void {
        this.completedUpdates++;
        const measured = sampleIndex >= warmupSamples;
        const finalMeasuredSample = sampleIndex === warmupSamples + measuredSamples - 1;
        if (!process.stdout.isTTY && !finalMeasuredSample) return;
        const renderedAt = performance.now();
        const finalUpdate = this.completedUpdates === this.totalUpdates;
        if (process.stdout.isTTY && !finalUpdate && renderedAt - this.lastRenderedAt < 100) return;
        this.lastRenderedAt = renderedAt;

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
            console.log(line);
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
    assertExhaustiveCoverage(allScenarios);
    const selectedScenarios = operationFilter === undefined
        ? allScenarios
        : allScenarios.filter(scenario => scenarioMatches(scenario, operationFilter));
    if (selectedScenarios.length === 0) {
        throw new Error(`No benchmark category, scenario, or operation matches ${JSON.stringify(operationFilter)}`);
    }

    const operationCount = selectedScenarios.reduce((total, scenario) => total + scenario.steps.length, 0);
    const progress = new BenchmarkProgress(
        operationCount * BENCHMARK_PIPELINES.length * (warmupSamples + measuredSamples),
    );
    const started = performance.now();
    const results: Measurement[] = [];
    console.log(
        `Profiling ${operationCount} operations in ${selectedScenarios.length} mutation workflows `
        + `across ${BENCHMARK_PIPELINES.join(' + ')} pipelines; `
        + `${warmupSamples} warmup + ${measuredSamples} measured samples x ${iterationsPerSample} edits. `
        + 'Live min/avg/max is end-to-end milliseconds per edit.',
    );
    console.log(`Coverage assertion: ${REQUIRED_MUTATIONS.length}/${REQUIRED_MUTATIONS.length} mutation lanes.`);
    try {
        results.push(...measureScenarios(selectedScenarios, progress));
    } finally {
        progress.finish();
    }
    const elapsedMs = performance.now() - started;

    console.table(results.map(result => ({
        category: result.category,
        scenario: result.scenario,
        operation: result.operation,
        runtime_only_avg_ms: result.runtimeOnly.averageMs.toFixed(4),
        runtime_avg_ms: result.runtimeReducer.averageMs.toFixed(4),
        bv_avg_ms: result.runtimeBattleValue.averageMs.toFixed(4),
        sheet_avg_ms: result.recordSheetProjection.averageMs.toFixed(4),
        total_min_ms: result.endToEnd.minimumMs.toFixed(4),
        total_avg_ms: result.endToEnd.averageMs.toFixed(4),
        total_p95_ms: result.endToEnd.p95Ms.toFixed(4),
        total_max_ms: result.endToEnd.maximumMs.toFixed(4),
    })));
    console.log(`Completed in ${(elapsedMs / 1000).toFixed(2)}s; checksum ${checksum}.`);

    if (outputPath) {
        const report = Object.freeze({
            schemaVersion: 5,
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
                pipelines: BENCHMARK_PIPELINES,
                sampleOrder: 'deterministically shuffled pipeline/workflow pairs',
            }),
            coverage: Object.freeze({
                categories: Object.freeze([...new Set(selectedScenarios.map(scenario => scenario.category))]),
                scenarioCount: selectedScenarios.length,
                operationCount,
                exhaustiveMutationCount: REQUIRED_MUTATIONS.length,
                coveredMutations: Object.freeze([...REQUIRED_MUTATIONS]),
                exhaustiveness: 'all direct Mek sparse-mutation entrypoints and discriminated mutation variants',
                parameterCoverage: 'representative valid transitions, not the Cartesian product of payloads and runtime states',
                scope: 'paired runtime-only and full-sheet cohorts over the direct sparse reducer; full-sheet adds dependency-aware runtime BV refresh and complete headless model projection',
                excluded: Object.freeze([
                    'SVG/DOM binding and paint',
                    'dialogs and pointer interaction',
                    'async force history/publication',
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

function measureScenarios(
    scenarios: readonly MutationScenario[],
    progress: BenchmarkProgress,
): readonly Measurement[] {
    const profiles: readonly ScenarioTimingSamples[] = scenarios.flatMap(scenario =>
        BENCHMARK_PIPELINES.map(pipeline => Object.freeze({
            scenario,
            pipeline,
            warmups: scenario.steps.map(() => timingSamples()),
            measured: scenario.steps.map(() => timingSamples()),
        })));
    const totalSampleCount = warmupSamples + measuredSamples;

    for (let sampleIndex = 0; sampleIndex < totalSampleCount; sampleIndex++) {
        for (const profile of shuffledProfiles(profiles, sampleIndex)) {
            measureScenarioSample(profile, sampleIndex, progress);
        }
    }

    return Object.freeze(scenarios.flatMap(scenario => scenario.steps.map((step, index) => {
        const runtimeOnlyProfile = required(profiles.find(profile =>
            profile.scenario === scenario && profile.pipeline === 'runtime-only'), 'runtime-only timing profile');
        const fullSheetProfile = required(profiles.find(profile =>
            profile.scenario === scenario && profile.pipeline === 'full-sheet'), 'full-sheet timing profile');
        const runtimeOnlySamples = runtimeOnlyProfile.measured[index]!;
        const fullSheetSamples = fullSheetProfile.measured[index]!;
        return Object.freeze({
            category: scenario.category,
            scenario: scenario.name,
            operation: step.name,
            fixture: scenario.fixture.label,
            mutations: step.mutations,
            iterationsPerSample,
            sampleCount: measuredSamples,
            baseBattleValueRecalculated: fullSheetSamples.runtimeBattleValue.some(duration => duration > 0),
            runtimeOnly: distribution(runtimeOnlySamples.runtimeReducer),
            runtimeReducer: distribution(fullSheetSamples.runtimeReducer),
            runtimeBattleValue: distribution(fullSheetSamples.runtimeBattleValue),
            recordSheetProjection: distribution(fullSheetSamples.recordSheetProjection),
            endToEnd: distribution(fullSheetSamples.endToEnd),
        });
    })));
}

function measureScenarioSample(
    profile: ScenarioTimingSamples,
    sampleIndex: number,
    progress: BenchmarkProgress,
): void {
    const { scenario, pipeline } = profile;
    let prepared = createPipelineContext(scenario, pipeline);
    const current = scenario.steps.map(() => ({
        runtimeReducer: 0,
        runtimeBattleValue: 0,
        recordSheetProjection: 0,
        endToEnd: 0,
    }));

    for (let iteration = 0; iteration < iterationsPerSample; iteration++) {
        if (iteration > 0 && scenario.repeat === 'fresh-instance') {
            prepared = createPipelineContext(scenario, pipeline);
        }
        scenario.steps.forEach((step, stepIndex) => {
            const { context } = prepared;
            const beforeRevision = context.instance.revision();
            const totalStarted = performance.now();
            const impact = step.execute(context);
            const runtimeFinished = performance.now();
            if (context.instance.revision() === beforeRevision) {
                throw new Error(`${scenario.name} / ${step.name} did not change sparse runtime state`);
            }
            let runtimeBattleValue = 0;
            let projectionDuration = 0;
            let pipelineFinished = runtimeFinished;
            if (pipeline === 'full-sheet') {
                let battleValue = required(prepared.battleValue, 'full-sheet battle-value snapshot');
                if (impact.baseBattleValueChanged) {
                    const battleValueStarted = performance.now();
                    battleValue = refreshRuntimeBattleValue(context, battleValue);
                    prepared = Object.freeze({ context, battleValue });
                    runtimeBattleValue = performance.now() - battleValueStarted;
                }
                const projectionStarted = performance.now();
                projectSheet(context, battleValue);
                pipelineFinished = performance.now();
                projectionDuration = pipelineFinished - projectionStarted;
            }
            const sample = current[stepIndex]!;
            sample.runtimeReducer += runtimeFinished - totalStarted;
            sample.runtimeBattleValue += runtimeBattleValue;
            sample.recordSheetProjection += projectionDuration;
            sample.endToEnd += pipelineFinished - totalStarted;
        });
    }

    scenario.steps.forEach((step, stepIndex) => {
        const values = current[stepIndex]!;
        const destination = sampleIndex < warmupSamples
            ? profile.warmups[stepIndex]!
            : profile.measured[stepIndex]!;
        destination.runtimeReducer.push(values.runtimeReducer / iterationsPerSample);
        destination.runtimeBattleValue.push(values.runtimeBattleValue / iterationsPerSample);
        destination.recordSheetProjection.push(values.recordSheetProjection / iterationsPerSample);
        destination.endToEnd.push(values.endToEnd / iterationsPerSample);
        progress.update(`[${pipeline}] ${scenario.name}: ${step.name}`, sampleIndex, destination.endToEnd);
    });
}

function shuffledProfiles(
    profiles: readonly ScenarioTimingSamples[],
    sampleIndex: number,
): readonly ScenarioTimingSamples[] {
    const shuffled = [...profiles];
    let state = (0x9e3779b9 ^ (sampleIndex + 1)) >>> 0;
    for (let index = shuffled.length - 1; index > 0; index--) {
        state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
        const swapIndex = state % (index + 1);
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
    }
    return shuffled;
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
        Object.freeze({ label: 'booby-trap direct Mek', runtime: createDirectBoobyTrapRuntimeFixture() }),
        Object.freeze({ label: 'Bombast direct Mek', runtime: createDirectBombastRuntimeFixture() }),
        Object.freeze({ label: 'coolant-pod direct Mek', runtime: createDirectCoolantPodRuntimeFixture() }),
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
    const boobyTrap = required(fixtures.find(profile => profile.label === 'booby-trap direct Mek'), 'booby-trap fixture');
    const bombastFixture = required(fixtures.find(profile => profile.label === 'Bombast direct Mek'), 'Bombast fixture');
    const coolantFixture = required(fixtures.find(profile => profile.label === 'coolant-pod direct Mek'), 'coolant fixture');
    const fixture = standard.runtime;
    const armorFace = required([...fixture.index.armorFaces.values()]
        .find(candidate => candidate.maximumPoints > 2), 'armor face');
    const internalLocation = required([...fixture.index.locations.values()]
        .find(candidate => candidate.code === 'CT' && candidate.internalPoints > 2), 'internal location');
    const conditionLocation = required([...fixture.index.locations.values()]
        .find(candidate => candidate.code === 'LA'), 'condition location');
    const leftTorso = required([...fixture.index.locations.values()]
        .find(candidate => candidate.code === 'LT'), 'left torso');
    const leftLeg = required([...fixture.index.locations.values()]
        .find(candidate => candidate.code === 'LL'), 'left leg');
    const ac = fixture.equipmentComponent('Test AC');
    const totalWarfareAc = totalWarfare.runtime.equipmentComponent('Test AC');
    const laser = fixture.equipmentComponent('ISMediumLaser');
    const hag = fixture.equipmentComponent('Test HAG');
    const stealth = fixture.equipmentComponent('Test Stealth');
    const ppc = fixture.equipmentComponent('Test PPC');
    const ppcCapacitor = fixture.equipmentComponent('Test PPC Capacitor');
    const c3EmergencyMaster = fixture.equipmentComponent('Test C3 Emergency Master');
    const masc = fixture.equipmentComponent('Test MASC');
    const artemisLauncher = fixture.equipmentComponent('Test Artemis Launcher');
    const artemisAmmo = fixture.equipmentComponent('Test Artemis Ammo');
    const artemisLoadout = fixture.instance.query().ammoLoadout(artemisAmmo.id);
    const trap = boobyTrap.runtime.equipmentComponent('Test Booby Trap');
    const bombast = bombastFixture.runtime.equipmentComponent('Test Bombast Laser');
    const coolantPod = coolantFixture.runtime.equipmentComponent('Test Coolant Pod');
    const ammo = fixture.equipmentComponent('Test Ammo');
    const ammoLoadout = fixture.instance.query().ammoLoadout(ammo.id);
    const criticalSlot = required([...fixture.index.slots.values()]
        .find(candidate => candidate.componentIds.includes(ac.id)), 'equipment critical slot');
    const crew = required([...fixture.index.crewPositions.values()][0], 'crew position');
    const intrinsicAction = required(fixture.index.intrinsicActions[0], 'intrinsic action');
    const legActuatorSlot = required([...totalWarfare.runtime.index.slots.values()].find(candidate =>
        totalWarfare.runtime.index.locations.get(candidate.locationId)?.code === 'LL'
        && candidate.componentIds.some(componentId => {
            const component = totalWarfare.runtime.index.components.get(componentId);
            return component?.kind === 'system' && component.systemType === 'Foot Actuator';
        })), 'Total Warfare leg-actuator slot');
    const targetId = asEncounterTargetId('target:runtime-benchmark');
    const targetRegistry: TargetRegistrySnapshot = Object.freeze({
        revision: 1,
        targets: Object.freeze([Object.freeze({
            id: targetId,
            letter: 'A',
            name: 'Benchmark target',
            color: '#123456',
            unitType: 'mek-biped' as const,
        })]),
    });
    const scenarios: MutationScenario[] = [];

    for (const target of ['pending', 'committed'] as const) {
        scenarios.push(
            pairScenario(`${target} armor track`, 'damage tracks', standard,
                coveredCommandStep('damage armor', 'damage-armor', () => ({
                    type: 'damage-armor', faceId: armorFace.id, amount: 1, target,
                })),
                coveredCommandStep('repair armor', 'repair-armor', () => ({
                    type: 'repair-armor', faceId: armorFace.id, amount: 1, target,
                }))),
            pairScenario(`${target} internal track`, 'damage tracks', standard,
                coveredCommandStep('damage internal structure', 'damage-internal', () => ({
                    type: 'damage-internal', locationId: internalLocation.id, amount: 1, target,
                })),
                coveredCommandStep('repair internal structure', 'repair-internal', () => ({
                    type: 'repair-internal', locationId: internalLocation.id, amount: 1, target,
                }))),
            pairScenario(`${target} critical track`, 'damage tracks', standard,
                coveredCommandStep('hit critical slot', 'hit-critical', () => ({
                    type: 'hit-critical', slotId: criticalSlot.id, hits: 1, target,
                })),
                coveredCommandStep('repair critical slot', 'repair-critical', () => ({
                    type: 'repair-critical', slotId: criticalSlot.id, hits: 1, target,
                }))),
            pairScenario(`${target} Sensors system track`, 'damage tracks', standard,
                coveredCommandStep('set system critical level', 'set-system-critical-level', () => ({
                    type: 'set-system-critical-level', system: 'Sensors', level: 1, target,
                })),
                commandStep('clear system critical level', () => ({
                    type: 'set-system-critical-level', system: 'Sensors', level: 0, target,
                }))),
            pairScenario(`${target} component status`, 'equipment state', standard,
                coveredCommandStep('disable component', 'set-component-status', () => ({
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
                coveredCommandStep(`set ${condition}`, 'set-location-condition', () => ({
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
            coveredCommandStep('spend ammunition', 'spend-ammo', () => ({
                type: 'spend-ammo', componentId: ammo.id, amount: 1,
            })),
            coveredCommandStep('refill ammunition', 'configure-ammo-source', () => ({
                type: 'configure-ammo-source',
                componentId: ammo.id,
                munitionKey: ammoLoadout.munitionKey,
                remaining: ammoLoadout.capacity,
            }))),
        pairScenario('rapid-fire mode', 'equipment state', standard,
            coveredCommandStep('select Rapid mode', 'set-component-mode', () => ({
                type: 'set-component-mode', componentId: ac.id, mode: 'Rapid',
            })),
            commandStep('select Single mode', () => ({
                type: 'set-component-mode', componentId: ac.id, mode: 'Single',
            }))),
        pairScenario('rapid-fire jam state', 'equipment state', totalWarfare,
            coveredCommandStep('jam component', 'set-component-jammed', () => ({
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
            repeat: 'cycle',
            steps: Object.freeze([
                targetingActionStep('select physical action', intrinsicAction.id, { kind: 'selected' }),
                targetingActionStep('clear physical action', intrinsicAction.id, null),
            ]),
        }),
        pairScenario('committed heat', 'heat and crew', standard,
            coveredCommandStep('set committed heat', 'set-heat', () => ({ type: 'set-heat', heat: 5 })),
            commandStep('clear committed heat', () => ({ type: 'set-heat', heat: 0 }))),
        pairScenario('pending heat override', 'heat and crew', standard,
            coveredCommandStep('set pending heat', 'set-pending-heat', () => ({ type: 'set-pending-heat', heat: 5 })),
            commandStep('clear pending heat', () => ({ type: 'set-pending-heat', heat: null }))),
        pairScenario('disabled heat sinks', 'heat and crew', standard,
            coveredCommandStep('disable one heat sink', 'set-heatsinks-off', () => ({
                type: 'set-heatsinks-off', heatsinksOff: 1,
            })),
            commandStep('enable all heat sinks', () => ({ type: 'set-heatsinks-off', heatsinksOff: 0 }))),
        Object.freeze({
            category: 'heat and crew',
            name: 'pending heat application',
            fixture: standard,
            repeat: 'cycle',
            steps: Object.freeze([
                commandStep('stage heat', () => ({ type: 'set-pending-heat', heat: 5 })),
                coveredCommandStep('apply staged heat', 'apply-heat', () => ({
                    type: 'apply-heat', policy: 'manual',
                })),
                commandStep('reset applied heat', () => ({ type: 'set-heat', heat: 0 })),
            ]),
        }),
        pairScenario('crew wounds', 'heat and crew', standard,
            coveredCommandStep('wound crew', 'set-crew-state', () => ({
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
            coveredCommandStep(`set ${condition}`, 'set-condition', () => ({
                type: 'set-condition', condition, active: true,
            })),
            commandStep(`clear ${condition}`, () => ({
                type: 'set-condition', condition, active: false,
            })),
        ));
    }
    scenarios.push(
        pairScenario('movement declaration', 'unit and movement state', standard,
            coveredCommandStep('declare walk', 'declare-mek-movement', () => movement('walk', 1)),
            coveredCommandStep('clear movement', 'clear-mek-movement', () => ({ type: 'clear-mek-movement' }))),
        pairScenario('movement distance edit', 'unit and movement state', standard,
            commandStep('increase movement distance', () => movement('walk', 2)),
            commandStep('restore movement distance', () => movement('walk', 1)),
            context => dispatch(context.instance, movement('walk', 1))),
        pairScenario('manual shutdown state', 'unit and movement state', standard,
            coveredCommandStep('shut down', 'set-mek-shutdown-state', () => ({
                type: 'set-mek-shutdown-state', shutdown: true,
            })),
            commandStep('start up', () => ({ type: 'set-mek-shutdown-state', shutdown: false }))),
        Object.freeze({
            category: 'phase boundaries',
            name: 'commit pending armor',
            fixture: standard,
            repeat: 'cycle',
            steps: Object.freeze([
                commandStep('stage pending armor damage', () => ({
                    type: 'damage-armor', faceId: armorFace.id, amount: 1, target: 'pending',
                })),
                coveredCommandStep('commit pending overlay', 'commit-pending', () => ({
                    type: 'commit-pending',
                })),
                commandStep('repair committed armor', () => ({
                    type: 'repair-armor', faceId: armorFace.id, amount: 1, target: 'committed',
                })),
            ]),
        }),
        Object.freeze({
            category: 'phase boundaries',
            name: 'cancel pending armor',
            fixture: standard,
            repeat: 'cycle',
            steps: Object.freeze([
                commandStep('stage pending armor damage', () => ({
                    type: 'damage-armor', faceId: armorFace.id, amount: 1, target: 'pending',
                })),
                coveredCommandStep('cancel pending overlay', 'cancel-pending', () => ({
                    type: 'cancel-pending',
                })),
            ]),
        }),
        Object.freeze({
            category: 'phase boundaries',
            name: 'end phase with pending armor',
            fixture: standard,
            repeat: 'cycle',
            steps: Object.freeze([
                commandStep('stage pending armor damage', () => ({
                    type: 'damage-armor', faceId: armorFace.id, amount: 1, target: 'pending',
                })),
                coveredCommandStep('end phase', 'end-phase', () => ({ type: 'end-phase' })),
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

    scenarios.push(
        isolatedScenario('location blow-off automation', 'damage automation', standard,
            coveredCommandStep('apply arm blow-off', 'apply-mek-blow-off', () => ({
                type: 'apply-mek-blow-off', locationId: conditionLocation.id, target: 'pending',
            }))),
        isolatedScenario('critical-roll automation', 'damage automation', standard,
            coveredCommandStep('apply critical roll', 'apply-mek-critical-roll', () => ({
                type: 'apply-mek-critical-roll',
                locationId: criticalSlot.locationId,
                results: criticalDice(criticalSlot.slotIndex),
                target: 'pending',
            }))),
        isolatedScenario('booby-trap detonation', 'equipment lifecycle', boobyTrap,
            coveredCommandStep('detonate booby trap', 'detonate-booby-trap', () => ({
                type: 'detonate-booby-trap', componentId: trap.id,
            }))),
        isolatedScenario('stealth transition', 'equipment lifecycle', standard,
            coveredCommandStep('begin enabling stealth', 'set-stealth-state', () => ({
                type: 'set-stealth-state', componentId: stealth.id, state: 'enabling',
            }))),
        pairScenario('Gauss power toggle', 'equipment lifecycle', standard,
            coveredCommandStep('power down Gauss', 'toggle-gauss-power', () => ({
                type: 'toggle-gauss-power', componentId: hag.id,
            })),
            commandStep('power up Gauss', () => ({
                type: 'toggle-gauss-power', componentId: hag.id,
            }))),
        isolatedScenario('escalating-failure sequence', 'equipment lifecycle', standard,
            coveredCommandStep(
                'select first failure sequence',
                'edit-escalating-failure',
                () => ({
                    type: 'edit-escalating-failure',
                    componentId: masc.id,
                    edit: { kind: 'select-sequence', index: 0 },
                }),
                'edit-escalating-failure:select-sequence',
            )),
        pairScenario('escalating-failure status', 'equipment lifecycle', standard,
            coveredCommandStep(
                'disable escalating component',
                'edit-escalating-failure',
                () => ({
                    type: 'edit-escalating-failure',
                    componentId: masc.id,
                    edit: { kind: 'set-status', status: 'disabled' },
                }),
                'edit-escalating-failure:set-status',
            ),
            commandStep('enable escalating component', () => ({
                type: 'edit-escalating-failure',
                componentId: masc.id,
                edit: { kind: 'set-status', status: 'available' },
            }))),
        pairScenario('PPC capacitor charge', 'equipment lifecycle', standard,
            coveredCommandStep('charge PPC capacitor', 'set-ppc-capacitor-charge', () => ({
                type: 'set-ppc-capacitor-charge',
                capacitorId: ppcCapacitor.id,
                weaponId: ppc.id,
                state: PPC_CAPACITOR_CHARGING_STATE,
            })),
            commandStep('discharge PPC capacitor', () => ({
                type: 'set-ppc-capacitor-charge',
                capacitorId: ppcCapacitor.id,
                weaponId: ppc.id,
                state: null,
            }))),
        pairScenario('Bombast Laser charge', 'equipment lifecycle', bombastFixture,
            coveredCommandStep('charge Bombast Laser', 'set-bombast-laser-charge', () => ({
                type: 'set-bombast-laser-charge',
                componentId: bombast.id,
                state: BOMBAST_LASER_CHARGING_STATE,
            })),
            commandStep('discharge Bombast Laser', () => ({
                type: 'set-bombast-laser-charge', componentId: bombast.id, state: null,
            }))),
        isolatedScenario('C3 emergency-master request', 'equipment lifecycle', standard,
            coveredCommandStep(
                'turn off emergency master request',
                'edit-c3-emergency-master',
                () => ({
                    type: 'edit-c3-emergency-master',
                    componentId: c3EmergencyMaster.id,
                    edit: { kind: 'toggle-requested', turningOn: false },
                }),
                'edit-c3-emergency-master:toggle-requested',
            )),
        isolatedScenario('C3 emergency-master turn selection', 'equipment lifecycle', standard,
            coveredCommandStep(
                'select emergency master turn',
                'edit-c3-emergency-master',
                () => ({
                    type: 'edit-c3-emergency-master',
                    componentId: c3EmergencyMaster.id,
                    edit: { kind: 'select-operating-turns', turns: 2 },
                }),
                'edit-c3-emergency-master:select-operating-turns',
            )),
        isolatedScenario('C3 emergency-master activation', 'equipment lifecycle', standard,
            coveredCommandStep(
                'start active emergency master',
                'edit-c3-emergency-master',
                () => ({
                    type: 'edit-c3-emergency-master',
                    componentId: c3EmergencyMaster.id,
                    edit: { kind: 'ensure-active-started', endpointRole: 'master' },
                }),
                'edit-c3-emergency-master:ensure-active-started',
            )),
        isolatedScenario('C3 emergency-master settlement', 'equipment lifecycle', standard,
            coveredCommandStep(
                'settle active emergency master',
                'edit-c3-emergency-master',
                () => ({
                    type: 'edit-c3-emergency-master',
                    componentId: c3EmergencyMaster.id,
                    edit: { kind: 'settle-active-end-turn', endpointRole: 'master' },
                }),
                'edit-c3-emergency-master:settle-active-end-turn',
            ),
            context => dispatch(context.instance, {
                type: 'edit-c3-emergency-master',
                componentId: c3EmergencyMaster.id,
                edit: { kind: 'ensure-active-started', endpointRole: 'master' },
            })),
        isolatedScenario('coolant-pod activation', 'equipment lifecycle', coolantFixture,
            coveredCommandStep('activate coolant pod', 'activate-coolant-pod', () => ({
                type: 'activate-coolant-pod', componentId: coolantPod.id,
            }))),
        isolatedScenario('direct weapon-fire mutation', 'weapon fire', standard,
            coveredCommandStep('fire Medium Laser', 'fire-weapons', () => ({
                type: 'fire-weapons',
                selections: [{ weaponId: laser.id }],
                heatPolicy: 'automatic',
            }))),
        isolatedScenario('forced-withdrawal rule check', 'rules and pilot checks', standard,
            mutationStep('resolve torso crippling check', ['resolve-mek-rule-check'], context => {
                const check = required(
                    context.instance.query().mekRuleCheck(MEK_TORSO_CRIPPLING_RULE_CHECK_KEY),
                    'torso crippling rule check',
                );
                dispatch(context.instance, {
                    type: 'resolve-mek-rule-check',
                    key: MEK_TORSO_CRIPPLING_RULE_CHECK_KEY,
                    token: check.token,
                    outcome: 'failed',
                });
            }),
            context => dispatch(context.instance, {
                type: 'damage-internal',
                locationId: leftTorso.id,
                amount: leftTorso.internalPoints,
                target: 'committed',
            })),
        isolatedScenario('action declaration', 'unit and movement state', standard,
            coveredCommandStep('declare shutdown action', 'declare-mek-action', () => ({
                type: 'declare-mek-action',
                action: { schemaVersion: 1, kind: 'shutdown' },
            }))),
        isolatedScenario('action clearing', 'unit and movement state', standard,
            coveredCommandStep('clear declared action', 'clear-mek-action', () => ({
                type: 'clear-mek-action',
            })),
            context => {
                dispatch(context.instance, { type: 'set-mek-shutdown-state', shutdown: true });
                dispatch(context.instance, {
                    type: 'declare-mek-action', action: { schemaVersion: 1, kind: 'startup' },
                });
            }),
        isolatedScenario('standing preparation', 'rules and pilot checks', standard,
            coveredCommandStep('prepare standing attempt', 'prepare-mek-stand', () => ({
                type: 'prepare-mek-stand',
            })),
            context => dispatch(context.instance, {
                type: 'set-condition', condition: 'prone', active: true,
            })),
        isolatedScenario('standing resolution', 'rules and pilot checks', standard,
            coveredCommandStep('resolve failed standing attempt', 'resolve-mek-stand-attempt', () => ({
                type: 'resolve-mek-stand-attempt',
                carefulStand: false,
                evidence: { dice: [1, 1], claimedOutcome: 'failed' },
            })),
            context => {
                dispatch(context.instance, { type: 'set-condition', condition: 'prone', active: true });
                dispatch(context.instance, { type: 'prepare-mek-stand' });
            }),
        isolatedScenario('standing-attempt adjustment', 'rules and pilot checks', standard,
            coveredCommandStep('decrement standing attempts', 'adjust-mek-stand-attempts', () => ({
                type: 'adjust-mek-stand-attempts', delta: -1,
            })),
            context => {
                dispatch(context.instance, { type: 'set-condition', condition: 'prone', active: true });
                dispatch(context.instance, { type: 'prepare-mek-stand' });
                dispatch(context.instance, {
                    type: 'resolve-mek-stand-attempt',
                    carefulStand: false,
                    evidence: { dice: [1, 1], claimedOutcome: 'failed' },
                });
            }),
        isolatedScenario('pilot-check resolution', 'rules and pilot checks', totalWarfare,
            mutationStep('resolve generated pilot check', ['resolve-mek-pilot-check'], context => {
                const check = required(
                    context.instance.query().mekPilotChecks().find(candidate => candidate.status === 'pending'),
                    'pending pilot check',
                );
                dispatch(context.instance, {
                    type: 'resolve-mek-pilot-check',
                    checkId: check.checkId,
                    evidence: { dice: [6, 6], claimedOutcome: 'success' },
                });
            }),
            context => dispatch(context.instance, {
                type: 'hit-critical', slotId: legActuatorSlot.id, hits: 1, target: 'committed',
            })),
        isolatedScenario('pilot-check dismissal', 'rules and pilot checks', totalWarfare,
            mutationStep('dismiss generated pilot check', ['dismiss-mek-pilot-checks'], context => {
                const check = required(
                    context.instance.query().mekPilotChecks().find(candidate => candidate.status === 'pending'),
                    'pending pilot check',
                );
                dispatch(context.instance, {
                    type: 'dismiss-mek-pilot-checks', checkIds: [check.checkId],
                });
            }),
            context => dispatch(context.instance, {
                type: 'hit-critical', slotId: legActuatorSlot.id, hits: 1, target: 'committed',
            })),
        isolatedScenario('automatic-fall dismissal', 'rules and pilot checks', standard,
            coveredCommandStep('dismiss automatic fall', 'dismiss-mek-automatic-falls', () => ({
                type: 'dismiss-mek-automatic-falls',
            })),
            context => dispatch(context.instance, {
                type: 'damage-internal',
                locationId: leftLeg.id,
                amount: leftLeg.internalPoints,
                target: 'committed',
            })),
        isolatedScenario('complete turn-state replacement', 'turn boundaries', standard,
            coveredCommandStep('replace airborne turn state', 'replace-turn-state', context => ({
                type: 'replace-turn-state',
                turn: { ...context.instance.query().turnState(), airborne: true },
            }))),
        pairScenario('pending fall consequences', 'turn boundaries', standard,
            coveredCommandStep('set pending fall consequences', 'set-pending-fall-consequences', () => ({
                type: 'set-pending-fall-consequences',
                pending: {
                    eventId: 'fall:runtime-benchmark',
                    totalDamage: 10,
                    hitArcLabel: 'Front',
                    applyPilotHits: true,
                    forceSeatbeltFailure: false,
                    seatbeltPositionIds: [crew.id],
                    headHits: 1,
                    stage: 'head-hits',
                },
            })),
            commandStep('clear pending fall consequences', () => ({
                type: 'set-pending-fall-consequences', pending: null,
            }))),
        isolatedScenario('turn-state reset', 'turn boundaries', standard,
            coveredCommandStep('reset turn state', 'reset-turn-state', () => ({
                type: 'reset-turn-state',
            })),
            context => dispatch(context.instance, {
                type: 'replace-turn-state',
                turn: { ...context.instance.query().turnState(), airborne: true },
            })),
        isolatedScenario('end-turn heat checkpoint', 'turn boundaries', standard,
            coveredCommandStep('mark heat staged', 'mark-end-turn-heat-staged', () => ({
                type: 'mark-end-turn-heat-staged',
            })),
            context => dispatch(context.instance, { type: 'end-phase', endTurnBoundary: true })),
        isolatedScenario('turn settlement', 'turn boundaries', standard,
            coveredCommandStep('end turn', 'end-turn', () => ({
                type: 'end-turn', policy: 'automatic',
            }))),
        pairScenario('bulk weapon targeting selection', 'targeting state', standard,
            attackerTargetingEditStep('select multiple weapons', 'set-component-selections', () => ({
                kind: 'set-component-selections',
                componentIds: [laser.id, ac.id],
                selection: { kind: 'selected' },
            })),
            attackerTargetingEditStep('clear multiple weapons', 'set-component-selections', () => ({
                kind: 'set-component-selections', componentIds: [laser.id, ac.id], selection: null,
            }))),
        pairScenario('weapon ammunition targeting', 'targeting state', standard,
            attackerTargetingEditStep('select weapon ammunition', 'set-component-ammo', () => ({
                kind: 'set-component-ammo',
                componentId: artemisLauncher.id,
                ammo: {
                    munitionKey: artemisLoadout.munitionKey,
                    preferredSourceId: artemisAmmo.id,
                },
            })),
            attackerTargetingEditStep('clear weapon ammunition', 'set-component-ammo', () => ({
                kind: 'set-component-ammo', componentId: artemisLauncher.id, ammo: null,
            }))),
        pairScenario('bulk weapon ammunition targeting', 'targeting state', standard,
            attackerTargetingEditStep('select multiple weapon ammunitions', 'set-component-ammos', () => ({
                kind: 'set-component-ammos',
                updates: [
                    {
                        componentId: ac.id,
                        ammo: { munitionKey: ammoLoadout.munitionKey, preferredSourceId: ammo.id },
                    },
                    {
                        componentId: artemisLauncher.id,
                        ammo: {
                            munitionKey: artemisLoadout.munitionKey,
                            preferredSourceId: artemisAmmo.id,
                        },
                    },
                ],
            })),
            attackerTargetingEditStep('clear multiple weapon ammunitions', 'set-component-ammos', () => ({
                kind: 'set-component-ammos',
                updates: [
                    { componentId: ac.id, ammo: null },
                    { componentId: artemisLauncher.id, ammo: null },
                ],
            }))),
        Object.freeze({
            category: 'targeting state',
            name: 'target-local facts',
            fixture: standard,
            repeat: 'cycle',
            targetRegistry,
            steps: Object.freeze([
                attackerTargetingEditStep('set target distance', 'set-target-facts', () => ({
                    kind: 'set-target-facts', targetId, facts: { distance: 3 },
                })),
                attackerTargetingEditStep('clear target facts', 'set-target-facts', () => ({
                    kind: 'set-target-facts', targetId, facts: null,
                })),
            ]),
        }),
        isolatedScenario('selected-weapon fire', 'weapon fire', standard,
            mutationStep('fire selected weapon', ['fire-selected-weapons'], context => {
                const result = context.instance.dispatchSelectedWeaponFire({
                    type: 'fire-selected-weapons', heatPolicy: 'automatic',
                }, context.targetRegistry, false, false);
                if (!result.accepted) throw new Error('Selected-weapon fire benchmark was rejected');
            }, true),
            context => {
                const result = context.instance.dispatchAttackerTargeting({
                    type: 'edit-attacker-targeting',
                    edit: {
                        kind: 'set-component-selection',
                        componentId: laser.id,
                        selection: { kind: 'selected' },
                    },
                }, context.targetRegistry, false);
                if (!result.accepted) throw new Error('Selected-fire setup was rejected');
            }),
        pairScenario('equipment-row presentation order', 'presentation state', standard,
            mutationStep('reorder ranged equipment', ['set-equipment-row-order'], context => {
                const result = context.instance.setEquipmentRowOrder('ranged', [1, 0], 2, false);
                if (!result.accepted) throw new Error('Equipment-row ordering benchmark was rejected');
            }),
            mutationStep('restore ranged equipment order', ['set-equipment-row-order'], context => {
                const result = context.instance.setEquipmentRowOrder('ranged', [0, 1], 2, false);
                if (!result.accepted) throw new Error('Equipment-row ordering benchmark was rejected');
            })),
        isolatedScenario('targeting reconciliation install', 'targeting state', standard,
            mutationStep(
                'plan and install targeting reconciliation',
                ['install-attacker-targeting-reconciliation'],
                context => {
                    const plan = required(
                        context.instance.planAttackerTargetingReconciliation(emptyTargetRegistry, false),
                        'attacker-targeting reconciliation plan',
                    );
                    context.instance.installAttackerTargetingReconciliation(plan);
                },
            ),
            context => {
                const result = context.instance.dispatchAttackerTargeting({
                    type: 'edit-attacker-targeting',
                    edit: {
                        kind: 'set-component-selection',
                        componentId: laser.id,
                        selection: { kind: 'target', targetId },
                    },
                }, context.targetRegistry, false);
                if (!result.accepted) throw new Error('Targeting-reconciliation setup was rejected');
            },
            targetRegistry),
    );

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
                coveredCommandStep(`damage shield ${track}`, 'damage-shield', () => ({
                    type: 'damage-shield', componentId: shield.id, track, amount: 1, target,
                })),
                coveredCommandStep(`repair shield ${track}`, 'repair-shield', () => ({
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
        repeat: 'cycle',
        ...(prepare === undefined ? {} : { prepare }),
        steps: Object.freeze([forward, reverse]),
    });
}

function isolatedScenario(
    name: string,
    category: string,
    fixture: BenchmarkFixture,
    step: MutationStep,
    prepare?: MutationScenario['prepare'],
    targetRegistry?: TargetRegistrySnapshot,
): MutationScenario {
    return Object.freeze({
        name,
        category,
        fixture,
        repeat: 'fresh-instance',
        ...(prepare === undefined ? {} : { prepare }),
        ...(targetRegistry === undefined ? {} : { targetRegistry }),
        steps: Object.freeze([step]),
    });
}

function commandStep(
    name: string,
    command: (context: MutationContext) => CBTUnitCommand,
): MutationStep {
    return Object.freeze({
        name,
        mutations: Object.freeze([]),
        execute: (context: MutationContext) => {
            const value = command(context);
            dispatch(context.instance, value);
            return commandMayChangeBaseBattleValue(value)
                ? baseBattleValueChanged
                : baseBattleValueUnchanged;
        },
    });
}

function coveredCommandStep<T extends CBTUnitCommand['type']>(
    name: string,
    mutation: T,
    command: (context: MutationContext) => Extract<CBTUnitCommand, { readonly type: T }>,
    ...additionalMutations: readonly RuntimeMutationKey[]
): MutationStep {
    return Object.freeze({
        name,
        mutations: Object.freeze([mutation, ...additionalMutations]),
        execute: (context: MutationContext) => {
            const value = command(context);
            dispatch(context.instance, value);
            return commandMayChangeBaseBattleValue(value)
                ? baseBattleValueChanged
                : baseBattleValueUnchanged;
        },
    });
}

function mutationStep(
    name: string,
    mutations: readonly RuntimeMutationKey[],
    execute: (context: MutationContext) => void,
    changesBaseBattleValue = false,
): MutationStep {
    return Object.freeze({
        name,
        mutations: Object.freeze([...mutations]),
        execute: (context: MutationContext) => {
            execute(context);
            return changesBaseBattleValue ? baseBattleValueChanged : baseBattleValueUnchanged;
        },
    });
}

function attackerTargetingEditStep<K extends AttackerTargetingEdit['kind']>(
    name: string,
    kind: K,
    edit: (context: MutationContext) => Extract<AttackerTargetingEdit, { readonly kind: K }>,
): MutationStep {
    return mutationStep(name, [`edit-attacker-targeting:${kind}`], context => {
        const result = context.instance.dispatchAttackerTargeting({
            type: 'edit-attacker-targeting',
            edit: edit(context),
        }, context.targetRegistry, false);
        if (!result.accepted) throw new Error(`Benchmark targeting operation ${name} was rejected`);
    });
}

function targetingStep(
    name: string,
    componentId: ComponentId,
    selection: { readonly kind: 'selected' } | null,
): MutationStep {
    return attackerTargetingEditStep(name, 'set-component-selection', () => ({
        kind: 'set-component-selection', componentId, selection,
    }));
}

function targetingActionStep(
    name: string,
    actionId: string,
    selection: { readonly kind: 'selected' } | null,
): MutationStep {
    return attackerTargetingEditStep(name, 'set-action-selection', () => ({
        kind: 'set-action-selection',
        target: { kind: 'intrinsic', actionId },
        selection,
    }));
}

function createContext(scenario: MutationScenario): MutationContext {
    return Object.freeze({
        fixture: scenario.fixture.runtime,
        instance: scenario.fixture.runtime.createInstance(`unit:runtime-benchmark:${++instanceSequence}`),
        targetRegistry: scenario.targetRegistry ?? emptyTargetRegistry,
    });
}

function createPreparedContext(scenario: MutationScenario): MutationContext {
    const context = createContext(scenario);
    scenario.prepare?.(context);
    return context;
}

function createPipelineContext(
    scenario: MutationScenario,
    pipeline: BenchmarkPipeline,
): PreparedMutationContext {
    return pipeline === 'full-sheet'
        ? createMeasuredContext(scenario)
        : Object.freeze({ context: createPreparedContext(scenario), battleValue: null });
}

function createMeasuredContext(scenario: MutationScenario): PreparedMutationContext {
    const context = createPreparedContext(scenario);
    return Object.freeze({
        context,
        battleValue: Object.freeze({
            pristine: pristineBattleValue(context.fixture),
            current: context.instance.query().currentBaseBattleValue(),
            adjusted: null,
        }),
    });
}

function pristineBattleValue(fixture: DirectMekRuntimeFixture): number | null {
    const cached = pristineBattleValueByFixture.get(fixture);
    if (cached !== undefined) return cached;
    let value: number | null;
    try {
        value = fixture.entity.battleValue();
    } catch {
        value = null;
    }
    pristineBattleValueByFixture.set(fixture, value);
    return value;
}

function refreshRuntimeBattleValue(
    context: MutationContext,
    previous: MekRecordSheetBattleValueSnapshot,
): MekRecordSheetBattleValueSnapshot {
    return Object.freeze({
        ...previous,
        current: context.instance.query().currentBaseBattleValue(),
    });
}

function dispatch(instance: CBTUnitInstance, command: CBTUnitCommand): void {
    const result = instance.dispatch(command);
    if (!result.accepted) throw new Error(`Benchmark command ${command.type} was rejected`);
}

function projectSheet(
    context: MutationContext,
    battleValue: MekRecordSheetBattleValueSnapshot,
): void {
    const state = context.instance.snapshot();
    const sheet = projectMekRecordSheet(
        context.fixture.entity,
        context.fixture.index,
        context.instance.ruleset(),
        state,
        context.instance.query(),
        context.targetRegistry,
        battleValue,
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

function criticalDice(slotIndex: number): readonly number[] {
    return slotIndex < 6 ? [1, slotIndex + 1] : [4, slotIndex - 5];
}

function timingSamples(): TimingSamples {
    return {
        runtimeReducer: [],
        runtimeBattleValue: [],
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

function assertExhaustiveCoverage(scenarios: readonly MutationScenario[]): void {
    const covered = new Set(scenarios.flatMap(scenario =>
        scenario.steps.flatMap(step => step.mutations)));
    const missing = REQUIRED_MUTATIONS.filter(mutation => !covered.has(mutation));
    if (missing.length > 0) {
        throw new Error(`Benchmark mutation coverage is incomplete: ${missing.join(', ')}`);
    }
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

function required<T>(value: T | null | undefined, label: string): T {
    if (value === undefined || value === null) {
        throw new Error(`Direct Mek benchmark fixture is missing ${label}`);
    }
    return value;
}

try {
    main();
} catch (error) {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
}
