// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { UNIT_SUMMARY_VERSION, type UnitSummary } from '../src/app/models/unit-summary.model';
import { isUnitSummaryArray } from '../src/app/services/unit-catalog/core-catalog-generation';
import {
    CORE_UNIT_ARCHIVE_DEPENDENCY_BUNDLE_PATH,
    CORE_UNIT_ARCHIVE_SUMMARY_PATH,
    CORE_UNITS_ARCHIVE_PATH,
    CORE_UNITS_MANIFEST_PATH,
    parseCoreUnitsManifest,
} from '../src/app/services/unit-catalog/core-unit-manifest';
import { parseApplicationCatalogDependencyBundle } from '../src/app/services/unit-catalog/application-catalog-dependency-bundle';
import { MM_DATA_UNIT_PROVIDER_ID } from '../src/app/services/unit-catalog/unit-catalog.types';
import { REPOSITORY_ASSETS_MANIFEST_RELATIVE_PATH } from './lib/repository-asset-manifest';

async function main(): Promise<void> {
    const publicRoot = path.resolve(__dirname, '..', 'public');
    const manifestPath = path.join(publicRoot, ...CORE_UNITS_MANIFEST_PATH.split('/'));
    const archivePath = path.join(publicRoot, ...CORE_UNITS_ARCHIVE_PATH.split('/'));
    const manifestBytes = fs.readFileSync(manifestPath);
    const archiveBytes = fs.readFileSync(archivePath);
    const manifestHash = sha1(manifestBytes);
    const stored = parseCoreUnitsManifest(manifestBytes.toString('utf8'), manifestHash);
    verifyRepositoryHashes(publicRoot, manifestHash, sha1(archiveBytes));

    const zip = await JSZip.loadAsync(archiveBytes);
    const summaryFile = zip.file(CORE_UNIT_ARCHIVE_SUMMARY_PATH);
    const dependencyFile = zip.file(CORE_UNIT_ARCHIVE_DEPENDENCY_BUNDLE_PATH);
    assert.ok(summaryFile, `units.zip has no ${CORE_UNIT_ARCHIVE_SUMMARY_PATH}`);
    assert.ok(dependencyFile, `units.zip has no ${CORE_UNIT_ARCHIVE_DEPENDENCY_BUNDLE_PATH}`);
    const summaries = JSON.parse(await summaryFile.async('string')) as unknown;
    assert.ok(isUnitSummaryArray(summaries), 'units.zip contains an invalid UnitSummary array');
    parseApplicationCatalogDependencyBundle(await dependencyFile.async('uint8array'));

    const manifestUnits = stored.manifest.units;
    assert.equal(summaries.length, Object.keys(manifestUnits).length, 'summary and manifest counts differ');
    const seen = new Set<string>();
    let mtf = 0;
    let blk = 0;
    for (const summary of summaries) {
        verifySummary(summary, manifestUnits, zip, seen);
        manifestUnits[summary.uuid].format === 'mtf' ? mtf++ : blk++;
    }
    process.stdout.write(`PASS: ${summaries.length} summaries (${mtf} MTF, ${blk} BLK), all at version ${UNIT_SUMMARY_VERSION}.\n`);
}

function verifySummary(
    summary: UnitSummary,
    units: ReturnType<typeof parseCoreUnitsManifest>['manifest']['units'],
    zip: JSZip,
    seen: Set<string>,
): void {
    assert.equal(seen.has(summary.uuid), false, `duplicate summary UUID ${summary.uuid}`);
    seen.add(summary.uuid);
    const entry = units[summary.uuid];
    assert.ok(entry, `summary ${summary.uuid} is absent from units-manifest.json`);
    assert.equal(summary.provider, MM_DATA_UNIT_PROVIDER_ID);
    assert.equal(summary.origin, 'megamek');
    assert.equal(summary.hash, entry.hash, `${summary.uuid} source hash differs`);
    assert.equal(summary.summaryVersion, UNIT_SUMMARY_VERSION);
    assert.ok(zip.file(entry.file), `units.zip has no ${entry.file}`);
}

function verifyRepositoryHashes(publicRoot: string, manifestHash: string, archiveHash: string): void {
    const pathName = path.join(publicRoot, ...REPOSITORY_ASSETS_MANIFEST_RELATIVE_PATH.split('/'));
    if (!fs.existsSync(pathName)) return;
    const assets = JSON.parse(fs.readFileSync(pathName, 'utf8')) as Record<string, string>;
    assert.equal(assets[CORE_UNITS_MANIFEST_PATH], manifestHash, 'assets manifest has the wrong units manifest hash');
    assert.equal(assets[CORE_UNITS_ARCHIVE_PATH], archiveHash, 'assets manifest has the wrong ZIP hash');
}

function sha1(bytes: Uint8Array): string {
    return crypto.createHash('sha1').update(bytes).digest('base64url');
}

void main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
});
