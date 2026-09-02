// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Reproducible V2 equipment-status profile.
 *
 * Uses stable records from the checked-in units catalog, expands their component
 * and critical counts into the immutable status boundary, and measures both a
 * single query and complete unit/force projections. It deliberately does not
 * benchmark the legacy SVG/DOM runtime: Path C was selected for dependency
 * direction and that presentation graph is an expiring migration oracle.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { constants, PerformanceObserver } from 'node:perf_hooks';
import { platform, release } from 'node:os';
import type { EquipmentFlag } from '../src/app/models/equipment-flags.type';
import {
    RuntimeEquipmentStatusKernel,
    type EquipmentStatusUnitFamily,
    type RuntimeEquipmentCommittedState,
    type RuntimeStatusComponentDefinition,
    type RuntimeEquipmentStatusTopology,
} from '../src/app/models/runtime/equipment-status-kernel';
import type { CBTRuleset } from '../src/app/models/cbt-ruleset.model';

interface CatalogComponent {
    readonly id: string;
    readonly n?: string;
    readonly t?: string;
    readonly l?: string;
    readonly c?: string | number;
}

interface CatalogUnit {
    readonly uuid: string;
    readonly name: string;
    readonly type: string;
    readonly subtype?: string;
    readonly tons?: number;
    readonly comp?: readonly CatalogComponent[];
}

interface CatalogFixture {
    readonly version: number;
    readonly units: readonly CatalogUnit[];
}

interface ProfileFixture {
    readonly label: string;
    readonly unit: CatalogUnit;
    readonly rules: CBTRuleset;
    readonly family: EquipmentStatusUnitFamily;
    readonly engineHit: boolean;
    readonly topology: RuntimeEquipmentStatusTopology;
    readonly committed: RuntimeEquipmentCommittedState;
    readonly statusCallsPerRefresh: number;
}

interface Measurement {
    readonly scenario: string;
    readonly operation: string;
    readonly iterationsPerSample: number;
    readonly statusCallsPerOperation: number;
    readonly statusCallCount: number;
    readonly sampleDurationsMs: readonly number[];
    readonly p50Ms: number;
    readonly p95Ms: number;
    /** Node does not expose per-operation allocation counts without an inspector session. */
    readonly allocatedBytes: null;
    readonly heapGrowthBytesBeforeCollection: number;
    readonly minorGcEvents: number | null;
}

const repositoryRoot = resolve(__dirname, '..');
const args = process.argv.slice(2);
const catalogPath = resolve(argument('--catalog') ?? resolve(repositoryRoot, 'scripts', 'fixtures', 'units.json'));
const outputPath = argument('--output');
const warmupSamples = integerArgument('--warmup', 10);
const measuredSamples = integerArgument('--samples', 30);
const isolatedIterations = integerArgument('--isolated-iterations', 20_000);
const refreshIterations = integerArgument('--refresh-iterations', 300);

const fixtureNames = Object.freeze({
    smallCoreMek: 'BMLocust_LCT1V',
    largeCoreMek: 'BMAtlas_AS7A',
    totalWarfareMek: 'BMMadCat_Prime',
    tank: 'CVPumaAssaultTank_PAT001',
    vtol: 'CVFerretLightScoutVTOL',
    battleArmor: 'BAAchileusLightBattleArmor_DavidSqd4',
    infantry: 'CIClanAntiInfantry_ClanJadeFalconPolice',
});

let checksum = 0;
let minorGcEvents = 0;
let gcObservationAvailable = false;
const gcObserver = new PerformanceObserver(list => {
    gcObservationAvailable = true;
    for (const entry of list.getEntries()) {
        const detail = (entry as PerformanceEntry & { detail?: { kind?: number } }).detail;
        if (detail?.kind === constants.NODE_PERFORMANCE_GC_MINOR) minorGcEvents++;
    }
});
try {
    gcObserver.observe({ entryTypes: ['gc'] });
} catch {
    // Some runtimes do not expose GC performance entries; the result records null.
}

async function main(): Promise<void> {
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as CatalogFixture;
    if (!Number.isSafeInteger(catalog.version) || !Array.isArray(catalog.units)) {
        throw new Error(`Invalid unit catalog fixture: ${catalogPath}`);
    }
    const byName = new Map(catalog.units.map(unit => [unit.name, unit]));
    const fixture = (name: string): CatalogUnit => {
        const unit = byName.get(name);
        if (!unit?.uuid || !Array.isArray(unit.comp)) throw new Error(`Missing benchmark unit fixture: ${name}`);
        return unit;
    };

    const fixtures = [
        createFixture('small Core Mek', fixture(fixtureNames.smallCoreMek), 'core-2026', 'mek', false),
        createFixture('large Core Mek', fixture(fixtureNames.largeCoreMek), 'core-2026', 'mek', false),
        createFixture('Total Warfare Mek', fixture(fixtureNames.totalWarfareMek), 'total-warfare', 'mek', false),
        createFixture('Tank, intact engine', fixture(fixtureNames.tank), 'core-2026', 'vehicle', false),
        createFixture('Tank, engine hit', fixture(fixtureNames.tank), 'core-2026', 'vehicle', true),
        createFixture('VTOL, engine hit', fixture(fixtureNames.vtol), 'core-2026', 'vehicle', true),
        createFixture('Battle Armor', fixture(fixtureNames.battleArmor), 'core-2026', 'other', false),
        createFixture('direct-inventory Infantry', fixture(fixtureNames.infantry), 'core-2026', 'other', false),
    ];

    const largeMek = fixtures[1];
    const isolatedKernel = kernel(largeMek);
    const isolatedComponent = largeMek.topology.components.keys().next().value as string | undefined;
    if (!isolatedComponent) throw new Error(`${largeMek.unit.name} has no benchmark components`);

    const results: Measurement[] = [];
    results.push(await measure(
        'large Core Mek',
        'isolated component status',
        isolatedIterations,
        1,
        () => statusValue(isolatedKernel.component(isolatedComponent).status),
    ));
    for (const profileFixture of fixtures) {
        results.push(await measure(
            profileFixture.label,
            'complete headless inventory refresh',
            refreshIterations,
            profileFixture.statusCallsPerRefresh,
            () => refresh(profileFixture),
        ));
        results.push(await measure(
            profileFixture.label,
            'equipment-dialog row projection',
            refreshIterations,
            profileFixture.topology.components.size,
            () => dialogProjection(profileFixture),
        ));
    }
    const mixedCalls = fixtures.reduce((total, item) => total + item.statusCallsPerRefresh, 0);
    results.push(await measure(
        'representative mixed force',
        'complete headless force refresh',
        refreshIterations,
        mixedCalls,
        () => fixtures.reduce((total, item) => total + refresh(item), 0),
    ));

    const report = {
        schemaVersion: 1,
        benchmark: 'v2-equipment-status-kernel',
        generatedAt: new Date().toISOString(),
        candidate: candidateIdentity(),
        environment: {
            node: process.version,
            operatingSystem: `${platform()} ${release()}`,
            architecture: process.arch,
            mode: 'tsx source / Node.js',
            gcExposed: typeof exposedGc() === 'function',
        },
        config: {
            warmupSamples,
            measuredSamples,
            isolatedIterations,
            refreshIterations,
        },
        catalog: {
            path: relative(repositoryRoot, catalogPath).replaceAll('\\', '/'),
            version: catalog.version,
        },
        fixtures: fixtures.map(item => ({
            label: item.label,
            name: item.unit.name,
            uuid: item.unit.uuid,
            type: item.unit.type,
            subtype: item.unit.subtype,
            tons: item.unit.tons,
            rules: item.rules,
            family: item.family,
            engineHit: item.engineHit,
            components: item.topology.components.size,
            criticalSlots: item.topology.criticalSlots.size,
            statusCallsPerRefresh: item.statusCallsPerRefresh,
        })),
        results,
        checksum,
        interpretation: 'Architecture/maintainability baseline only; no legacy SVG performance claim.',
    };

    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (outputPath) {
        const absoluteOutput = resolve(outputPath);
        mkdirSync(dirname(absoluteOutput), { recursive: true });
        writeFileSync(absoluteOutput, json, 'utf8');
        console.log(`Wrote ${absoluteOutput}`);
    }
    console.log(json);
    gcObserver.disconnect();
}

function createFixture(
    label: string,
    unit: CatalogUnit,
    rules: CBTRuleset,
    family: EquipmentStatusUnitFamily,
    engineHit: boolean,
): ProfileFixture {
    const components = new Map<string, RuntimeStatusComponentDefinition>();
    const criticalSlots = new Map<string, {
        id: string;
        componentIds: readonly string[];
        locationId: string;
    }>();
    const componentState = new Map<string, 'disabled' | 'destroyed'>();
    const criticalState = new Map<string, { status: 'destroyed'; hits: number; armored: boolean }>();
    const locationState = new Map<string, 'disabled' | 'destroyed'>();

    (unit.comp ?? []).forEach((component, componentIndex) => {
        const componentId = `${unit.uuid}:component:${componentIndex}`;
        const locationIds = component.l?.split('/')
            .map(location => location.trim())
            .filter(Boolean) ?? [];
        const normalizedLocations = locationIds.length === 0 ? ['BODY'] : [...new Set(locationIds)];
        const criticalCount = family === 'mek'
            ? Math.max(0, Math.min(12, Number.parseInt(String(component.c ?? 0), 10) || 0))
            : 0;
        const criticalSlotIds = Array.from({ length: criticalCount }, (_, criticalIndex) =>
            `${unit.uuid}:critical:${componentIndex}:${criticalIndex}`
        );
        const flags = new Set<EquipmentFlag>();
        if (component.t === 'E') flags.add('F_ENERGY');
        if (component.t === 'B') flags.add('F_BALLISTIC');
        if (/autocannon|(?:^|[^a-z])ac(?:[^a-z]|$)/iu.test(`${component.id} ${component.n ?? ''}`)) flags.add('F_AC');
        components.set(componentId, { id: componentId, flags, locationIds: normalizedLocations, criticalSlotIds });
        criticalSlotIds.forEach((criticalId, criticalIndex) => {
            criticalSlots.set(criticalId, {
                id: criticalId,
                componentIds: [componentId],
                locationId: normalizedLocations[criticalIndex % normalizedLocations.length],
            });
            if ((componentIndex + criticalIndex) % 11 === 0) {
                criticalState.set(criticalId, { status: 'destroyed', hits: 1, armored: criticalIndex % 5 === 0 });
            }
        });
        if (componentIndex > 0 && componentIndex % 23 === 0) componentState.set(componentId, 'destroyed');
        else if (componentIndex > 0 && componentIndex % 17 === 0) componentState.set(componentId, 'disabled');
        normalizedLocations.forEach((location, locationIndex) => {
            if ((componentIndex + locationIndex) > 0 && (componentIndex + locationIndex) % 29 === 0) {
                locationState.set(location, 'disabled');
            }
        });
    });
    if (components.size === 0) throw new Error(`${unit.name} has no components`);

    const topology: RuntimeEquipmentStatusTopology = { components, criticalSlots };
    const committed: RuntimeEquipmentCommittedState = {
        components: componentState,
        criticalSlots: criticalState,
        locations: locationState,
        engineHit,
    };
    const statusCallsPerRefresh = [...components.values()]
        .reduce((total, component) => total + 1 + component.locationIds.length, 0);
    return { label, unit, rules, family, engineHit, topology, committed, statusCallsPerRefresh };
}

function kernel(fixture: ProfileFixture): RuntimeEquipmentStatusKernel {
    return new RuntimeEquipmentStatusKernel(fixture.topology, fixture.committed, {
        rules: fixture.rules,
        family: fixture.family,
    });
}

function refresh(fixture: ProfileFixture): number {
    const resolver = kernel(fixture);
    let result = 0;
    for (const [componentId, component] of fixture.topology.components) {
        result += statusValue(resolver.component(componentId).status);
        for (const locationId of component.locationIds) {
            result += statusValue(resolver.componentAtLocation(componentId, locationId).status);
        }
    }
    return result;
}

function dialogProjection(fixture: ProfileFixture): number {
    const resolver = kernel(fixture);
    const rowCounts = { available: 0, disabled: 0, destroyed: 0 };
    for (const componentId of fixture.topology.components.keys()) {
        rowCounts[resolver.component(componentId).status]++;
    }
    return rowCounts.available + (rowCounts.disabled * 3) + (rowCounts.destroyed * 7);
}

async function measure(
    scenario: string,
    operation: string,
    iterationsPerSample: number,
    statusCallsPerOperation: number,
    execute: () => number,
): Promise<Measurement> {
    for (let sample = 0; sample < warmupSamples; sample++) {
        for (let iteration = 0; iteration < iterationsPerSample; iteration++) checksum += execute();
    }
    const gc = exposedGc();
    gc?.();
    await eventLoopTurn();
    const heapBefore = process.memoryUsage().heapUsed;
    const minorBefore = minorGcEvents;
    const durations: number[] = [];
    for (let sample = 0; sample < measuredSamples; sample++) {
        const started = performance.now();
        for (let iteration = 0; iteration < iterationsPerSample; iteration++) checksum += execute();
        durations.push((performance.now() - started) / iterationsPerSample);
    }
    await eventLoopTurn();
    const heapAfter = process.memoryUsage().heapUsed;
    const minorAfter = minorGcEvents;
    const sorted = [...durations].sort((left, right) => left - right);
    return {
        scenario,
        operation,
        iterationsPerSample,
        statusCallsPerOperation,
        statusCallCount: measuredSamples * iterationsPerSample * statusCallsPerOperation,
        sampleDurationsMs: durations,
        p50Ms: percentile(sorted, 0.50),
        p95Ms: percentile(sorted, 0.95),
        allocatedBytes: null,
        heapGrowthBytesBeforeCollection: heapAfter - heapBefore,
        minorGcEvents: gcObservationAvailable ? minorAfter - minorBefore : null,
    };
}

function statusValue(status: 'available' | 'disabled' | 'destroyed'): number {
    return status === 'available' ? 1 : status === 'disabled' ? 3 : 7;
}

function percentile(sorted: readonly number[], fraction: number): number {
    const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
    return sorted[index] ?? 0;
}

function argument(name: string): string | undefined {
    const index = args.indexOf(name);
    return index < 0 ? undefined : args[index + 1];
}

function integerArgument(name: string, fallback: number): number {
    const raw = argument(name);
    if (raw === undefined) return fallback;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
    return parsed;
}

function exposedGc(): (() => void) | undefined {
    return (globalThis as typeof globalThis & { gc?: () => void }).gc;
}

function eventLoopTurn(): Promise<void> {
    return new Promise(resolveTurn => setImmediate(resolveTurn));
}

function candidateIdentity(): { commit: string; dirty: boolean } {
    try {
        const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
        const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: repositoryRoot, encoding: 'utf8' }).trim().length > 0;
        return { commit, dirty };
    } catch {
        return { commit: 'unknown', dirty: true };
    }
}

void main().catch(error => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
});
