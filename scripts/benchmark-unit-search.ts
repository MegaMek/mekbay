// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import JSZip from 'jszip';

import { GameSystem } from '../src/app/models/common.model';
import { MULFACTION_EXTINCT, type MULFaction } from '../src/app/models/mulfactions.model';
import type { UnitSummary } from '../src/app/models/unit-summary.model';
import { EraIndexService } from '../src/app/services/era-index.service';
import { UnitSearchIndexService } from '../src/app/services/unit-search-index.service';
import {
    parseApplicationCatalogDependencyBundle,
    type ApplicationCatalogDependencyBundle,
} from '../src/app/services/unit-catalog/application-catalog-dependency-bundle';
import {
    CORE_UNIT_ARCHIVE_DEPENDENCY_BUNDLE_PATH,
    CORE_UNIT_ARCHIVE_SUMMARY_PATH,
    CORE_UNITS_ARCHIVE_PATH,
} from '../src/app/services/unit-catalog/core-unit-manifest';
import { parseSemanticQueryAST } from '../src/app/utils/semantic-filter-ast.util';
import { parseSearchQuery } from '../src/app/utils/search.util';
import { compareUnitsByName } from '../src/app/utils/sort.util';
import { executeUnitSearch } from '../src/app/utils/unit-search-executor.util';

interface BenchmarkCase {
    readonly name: string;
    readonly query: string;
    readonly gameSystem?: GameSystem;
}

const CASES: readonly BenchmarkCase[] = [
    { name: 'empty', query: '' },
    { name: 'broad-text', query: 'a' },
    { name: 'specific-text', query: 'atlas' },
    { name: 'equipment', query: 'equipment="Medium Laser"' },
    { name: 'equipment-quantity', query: 'equipment="LRM 5:>=2"' },
    { name: 'special', query: 'specials=TAG', gameSystem: GameSystem.AS },
    { name: 'special-numeric', query: 'specials="AC*/>=2/*"', gameSystem: GameSystem.AS },
    {
        name: 'nested',
        query: '(equipment="Medium Laser" AND bv>1000) OR (specials=TAG AND type=Tank)',
    },
    {
        name: 'nested-deep',
        query: '((type=Mek AND equipment="LRM 5") OR (type=Tank AND specials=CASE)) AND year>=3050',
    },
];

const repositoryRoot = path.resolve(__dirname, '..');
const iterations = readPositiveIntegerArgument('--iterations', 15);
const archivePath = path.resolve(
    readArgument('--archive') ?? path.join(repositoryRoot, 'public', ...CORE_UNITS_ARCHIVE_PATH.split('/')),
);

async function main(): Promise<void> {
    collectGarbage();
    const initialMemory = memorySnapshot();
    const { units, factions, eras } = await loadBenchmarkCorpus();
    collectGarbage();
    const corpusMemory = memorySnapshot();

    const index = new UnitSearchIndexService();
    const indexStartedAt = performance.now();
    const prepared = index.prepareCatalogIndexes(
        units,
        eras,
        factions,
        factions.find(faction => faction.id === MULFACTION_EXTINCT),
    );
    index.commitPreparedCatalogIndexes(prepared);
    const indexDurationMs = performance.now() - indexStartedAt;
    collectGarbage();
    const indexedMemory = memorySnapshot();

    verifyEquivalentResults(index, units);

    process.stdout.write(
        `Unit search benchmark: ${units.length.toLocaleString()} units, ${iterations} measured iterations\n`
        + `Retained JS memory (heap + array buffers): initial=${initialMemory.totalMiB.toFixed(1)} MiB, corpus=${corpusMemory.totalMiB.toFixed(1)} MiB, indexed=${indexedMemory.totalMiB.toFixed(1)} MiB, index delta=${(indexedMemory.totalMiB - corpusMemory.totalMiB).toFixed(1)} MiB\n`
        + `Indexed split: heap=${indexedMemory.heapMiB.toFixed(1)} MiB, array buffers=${indexedMemory.arrayBuffersMiB.toFixed(1)} MiB\n`
        + `Index: ${prepared.indexStats.filterKeys.toLocaleString()} keys, ${prepared.indexStats.filterValues.toLocaleString()} values, ${prepared.indexStats.memberships.toLocaleString()} memberships, built in ${indexDurationMs.toFixed(1)} ms\n\n`,
    );

    const rows = CASES.map(testCase => benchmarkCase(index, units, testCase));
    console.table(rows.map(row => ({
        case: row.name,
        results: row.resultCount,
        averageMs: row.averageMs.toFixed(2),
        medianMs: row.medianMs.toFixed(2),
        p95Ms: row.p95Ms.toFixed(2),
        stages: row.stages,
    })));
}

async function loadBenchmarkCorpus() {
    const archiveBytes = fs.readFileSync(archivePath);
    const archive = await JSZip.loadAsync(archiveBytes, { createFolders: false, checkCRC32: false });
    const summaryFile = archive.file(CORE_UNIT_ARCHIVE_SUMMARY_PATH);
    const dependencyFile = archive.file(CORE_UNIT_ARCHIVE_DEPENDENCY_BUNDLE_PATH);
    if (!summaryFile) throw new Error(`${archivePath} has no ${CORE_UNIT_ARCHIVE_SUMMARY_PATH}`);
    if (!dependencyFile) throw new Error(`${archivePath} has no ${CORE_UNIT_ARCHIVE_DEPENDENCY_BUNDLE_PATH}`);
    const [summaryText, dependencyBytes] = await Promise.all([
        summaryFile.async('string'),
        dependencyFile.async('uint8array'),
    ]);
    const units = JSON.parse(summaryText) as UnitSummary[];
    const dependencies: ApplicationCatalogDependencyBundle = parseApplicationCatalogDependencyBundle(dependencyBytes);
    const factions: MULFaction[] = dependencies.factions.factions.map(faction => ({
        ...faction,
        eras: Object.fromEntries(Object.entries(faction.eras).map(([eraId, unitIds]) => [
            eraId,
            unitIds instanceof Set ? unitIds : new Set(unitIds),
        ])),
    }));
    const eras = new EraIndexService().prepareFromFactions(factions).eras;
    return { units, factions, eras };
}

function benchmarkCase(index: UnitSearchIndexService, units: UnitSummary[], testCase: BenchmarkCase) {
    const execute = () => executeCase(index, units, testCase, true);

    for (let iteration = 0; iteration < 3; iteration++) execute();
    const durations: number[] = [];
    const stageTotals = new Map<string, number>();
    let resultCount = 0;
    for (let iteration = 0; iteration < iterations; iteration++) {
        const startedAt = performance.now();
        const result = execute();
        durations.push(performance.now() - startedAt);
        resultCount = result.results.length;
        for (const stage of result.telemetryStages) {
            stageTotals.set(stage.name, (stageTotals.get(stage.name) ?? 0) + stage.durationMs);
        }
    }

    durations.sort((left, right) => left - right);
    const averageMs = durations.reduce((total, duration) => total + duration, 0) / durations.length;
    const stages = Array.from(stageTotals, ([name, total]) => `${name}=${(total / iterations).toFixed(1)}`)
        .join(' ');
    return {
        name: testCase.name,
        resultCount,
        averageMs,
        medianMs: percentile(durations, 0.5),
        p95Ms: percentile(durations, 0.95),
        stages,
    };
}

function executeCase(
    index: UnitSearchIndexService,
    units: UnitSummary[],
    testCase: BenchmarkCase,
    useIndexes: boolean,
) {
    const gameSystem = testCase.gameSystem ?? GameSystem.CBT;
    const parsedQuery = parseSemanticQueryAST(testCase.query, gameSystem);
    const searchTokens = parseSearchQuery(parsedQuery.textSearch);
    return executeUnitSearch({
        units,
        parsedQuery,
        searchTokens,
        gameSystem,
        sortKey: '',
        sortDirection: 'asc',
        bvPvLimit: 0,
        forceTotalBvPv: 0,
        getAdjustedBV: unit => unit.bv,
        getAdjustedPV: unit => unit.as?.PV ?? 0,
        unitBelongsToEra: () => false,
        unitBelongsToFaction: () => false,
        unitBelongsToForcePack: () => false,
        getAllEraNames: () => [],
        getAllFactionNames: () => [],
        ...(useIndexes ? {
            getIndexedUnitIds: (filterKey: string, value: string) => index.getIndexedUnitIds(filterKey, value),
            getIndexedFilterValues: (filterKey: string) => index.getIndexedFilterValues(filterKey),
            getIndexedASSpecials: (unitUuid: UnitSummary['uuid']) => index.getIndexedASSpecials(unitUuid),
        } : {}),
    });
}

function verifyEquivalentResults(index: UnitSearchIndexService, units: UnitSummary[]): void {
    const naturallySorted = [...units].sort(compareUnitsByName).map(unit => unit.uuid);
    const rankSorted = [...units]
        .sort((left, right) => (left._searchNameRank ?? 0) - (right._searchNameRank ?? 0))
        .map(unit => unit.uuid);
    assert.deepEqual(rankSorted, naturallySorted, 'prepared name rank changed natural unit ordering');

    for (const testCase of CASES) {
        const indexed = executeCase(index, units, testCase, true).results.map(unit => unit.uuid);
        const scanned = executeCase(index, units, testCase, false).results.map(unit => unit.uuid);
        assert.deepEqual(indexed, scanned, `${testCase.name} indexed results differ from a full scan`);
    }
}

function percentile(sorted: readonly number[], fraction: number): number {
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

function memorySnapshot(): { heapMiB: number; arrayBuffersMiB: number; totalMiB: number } {
    const usage = process.memoryUsage();
    const heapMiB = usage.heapUsed / (1024 * 1024);
    const arrayBuffersMiB = usage.arrayBuffers / (1024 * 1024);
    return { heapMiB, arrayBuffersMiB, totalMiB: heapMiB + arrayBuffersMiB };
}

function collectGarbage(): void {
    if (typeof global.gc === 'function') global.gc();
}

function readArgument(name: string): string | undefined {
    const index = process.argv.indexOf(name);
    return index === -1 ? undefined : process.argv[index + 1];
}

function readPositiveIntegerArgument(name: string, fallback: number): number {
    const value = Number(readArgument(name));
    return Number.isInteger(value) && value > 0 ? value : fallback;
}

void main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
});
