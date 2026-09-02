// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import JSZip from 'jszip';
import { UNIT_SUMMARY_VERSION, type UnitSummary } from '../src/app/models/unit-summary.model';
import {
    CORE_UNIT_ARCHIVE_DEPENDENCY_BUNDLE_PATH,
    CORE_UNIT_ARCHIVE_SUMMARY_PATH,
    CORE_UNITS_ARCHIVE_PATH,
    CORE_UNITS_MANIFEST_PATH,
} from '../src/app/services/unit-catalog/core-unit-manifest';
import type { ApplicationCatalogDependencyBundle } from '../src/app/services/unit-catalog/application-catalog-dependency-bundle';
import type { CoreUnitSummaryProjector } from '../src/app/services/unit-catalog/entity-summary-projector';
import { generateCoreUnitAssets } from './generate-core-unit-assets';

const MEK_UUID = '019f583e-c1e4-7d03-a9cd-ff4cf5046746';
const TANK_UUID = '019f583e-dc22-7aca-a8e3-6788d5a89717';

test('publishes deterministic UUID files, a direct SHA-1 manifest, and one ZIP', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mekbay-units-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const sources = path.join(root, 'sources');
    const output = path.join(root, 'generated');
    writeSources(sources);
    fs.mkdirSync(path.join(output, 'core-unit-manifests'), { recursive: true });
    fs.writeFileSync(path.join(output, 'core-unit-manifests', 'old.json'), '{}');
    fs.writeFileSync(path.join(output, 'core-units-manifest.json'), '{}');
    fs.writeFileSync(path.join(output, 'core-units.old.zip'), 'old');

    const first = await generateCoreUnitAssets(options(sources, output));
    const firstFiles = readTree(output);
    const second = await generateCoreUnitAssets(options(sources, output));
    const secondFiles = readTree(output);

    assert.deepEqual(secondFiles, firstFiles);
    assert.equal(first.manifestHash, second.manifestHash);
    assert.equal(first.archiveHash, second.archiveHash);
    assert.equal(first.manifestHash.length, 27);
    assert.equal(first.archiveHash.length, 27);
    assert.deepEqual(first.skippedFiles, ['meks/invalid.mtf']);

    const manifestBytes = fs.readFileSync(path.join(output, path.basename(CORE_UNITS_MANIFEST_PATH)));
    const manifest = JSON.parse(manifestBytes.toString('utf8')) as Record<string, string>;
    assert.deepEqual(Object.keys(manifest), [`${MEK_UUID}.mtf`, `${TANK_UUID}.blk`]);
    assert.equal(sha1(manifestBytes), first.manifestHash);
    for (const [file, hash] of Object.entries(manifest)) {
        assert.equal(hash.length, 27);
        assert.equal(sha1(fs.readFileSync(path.join(output, 'units', file))), hash);
    }

    const zip = await JSZip.loadAsync(fs.readFileSync(path.join(output, path.basename(CORE_UNITS_ARCHIVE_PATH))));
    assert.deepEqual(
        Object.values(zip.files).filter(entry => !entry.dir).map(entry => entry.name).sort(),
        [
            `${MEK_UUID}.mtf`,
            `${TANK_UUID}.blk`,
            CORE_UNIT_ARCHIVE_DEPENDENCY_BUNDLE_PATH,
            CORE_UNIT_ARCHIVE_SUMMARY_PATH,
        ].sort(),
    );
    const summaries = JSON.parse(await zip.file(CORE_UNIT_ARCHIVE_SUMMARY_PATH)!.async('string')) as UnitSummary[];
    assert.deepEqual(summaries.map(summary => summary.uuid), [MEK_UUID, TANK_UUID]);
    assert.ok(summaries.every(summary => summary.summaryVersion === UNIT_SUMMARY_VERSION));
    const dependencies = JSON.parse(
        await zip.file(CORE_UNIT_ARCHIVE_DEPENDENCY_BUNDLE_PATH)!.async('string'),
    ) as Record<string, unknown>;
    assert.deepEqual(Object.keys(dependencies).sort(), [
        'equipment', 'eras', 'factions', 'quirks', 'sheets', 'sourcebooks', 'spriteManifest',
    ]);
    assert.equal(fs.existsSync(path.join(output, 'core-unit-manifests')), false);
    assert.equal(fs.existsSync(path.join(output, 'core-units-manifest.json')), false);
    assert.equal(fs.existsSync(path.join(output, 'core-units.old.zip')), false);
});

test('refuses duplicate UUIDs', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mekbay-duplicate-unit-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const sources = path.join(root, 'sources');
    fs.mkdirSync(path.join(sources, 'meks'), { recursive: true });
    fs.writeFileSync(path.join(sources, 'meks', 'a.mtf'), mek(MEK_UUID, 'A'));
    fs.writeFileSync(path.join(sources, 'meks', 'b.mtf'), mek(MEK_UUID, 'B'));
    await assert.rejects(
        generateCoreUnitAssets(options(sources, path.join(root, 'output'), 1)),
        /Duplicate core unit UUID/u,
    );
});

test('does not publish when the required unit population is missing', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mekbay-small-unit-set-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const sources = path.join(root, 'sources');
    fs.mkdirSync(path.join(sources, 'meks'), { recursive: true });
    fs.writeFileSync(path.join(sources, 'meks', 'a.mtf'), mek(MEK_UUID, 'A'));
    await assert.rejects(
        generateCoreUnitAssets(options(sources, path.join(root, 'output'), 2)),
        /minimum is 2/u,
    );
});

function options(sources: string, output: string, minimumUnitCount = 2) {
    return {
        unitFilesRoot: sources,
        assetsRoot: output,
        minimumUnitCount,
        summaryGenerationContext: {
            projector: projector(),
            dependencyBundle: dependencies(),
        },
        log: () => undefined,
        warn: () => undefined,
    };
}

function projector(): CoreUnitSummaryProjector {
    return {
        project: async input => ({
            summary: {
                uuid: input.entryKey.design.uuid,
                provider: input.entryKey.design.provider,
                origin: input.entryKey.origin,
                hash: input.entryKey.sourceRevision,
                summaryVersion: UNIT_SUMMARY_VERSION,
                loadIssues: [],
            } as unknown as UnitSummary,
            diagnostics: [],
        }),
    };
}

function dependencies(): ApplicationCatalogDependencyBundle {
    return {
        equipment: {} as ApplicationCatalogDependencyBundle['equipment'],
        quirks: {} as ApplicationCatalogDependencyBundle['quirks'],
        sourcebooks: {} as ApplicationCatalogDependencyBundle['sourcebooks'],
        factions: {} as ApplicationCatalogDependencyBundle['factions'],
        spriteManifest: { manifestDigest: 'digest' as never, manifestText: '{}' },
    };
}

function writeSources(root: string): void {
    fs.mkdirSync(path.join(root, 'meks'), { recursive: true });
    fs.mkdirSync(path.join(root, 'vehicles'), { recursive: true });
    fs.writeFileSync(path.join(root, 'meks', 'mek.mtf'), mek(MEK_UUID, 'Atlas'));
    fs.writeFileSync(path.join(root, 'vehicles', 'tank.blk'), [
        '<BlockVersion>1</BlockVersion>',
        '<UnitType>Tank</UnitType>',
        '<Name>Vedette</Name>',
        '<Model>V</Model>',
        `<UUID>${TANK_UUID}</UUID>`,
    ].join('\n'));
    fs.writeFileSync(path.join(root, 'meks', 'invalid.mtf'), mek('invalid', 'Skip'));
}

function mek(uuid: string, chassis: string): string {
    return [`Chassis:${chassis}`, 'Model:T', 'Mass:50', `UUID:${uuid}`].join('\n');
}

function readTree(root: string): Record<string, Buffer> {
    const output: Record<string, Buffer> = {};
    const walk = (directory: string): void => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const fullPath = path.join(directory, entry.name);
            if (entry.isDirectory()) walk(fullPath);
            else output[path.relative(root, fullPath).replaceAll('\\', '/')] = fs.readFileSync(fullPath);
        }
    };
    walk(root);
    return output;
}

function sha1(bytes: Uint8Array): string {
    return crypto.createHash('sha1').update(bytes).digest('base64url');
}
