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
import { EntityUnitSummaryProjector, type UnitSummaryProjector } from '../src/app/services/unit-catalog/entity-summary-projector';
import { EquipmentRegistry } from '../src/app/models/equipment-lookup';
import { ArmorEquipment } from '../src/app/models/equipment.model';
import { nativeSourceHashCanary } from '../src/app/models/source-hash-canary';
import { generateCoreUnitAssets } from './generate-core-unit-assets';
import { parseMegaMekUnitFileMetadata } from './lib/megamek-unit-file-metadata';

const MEK_UUID = '019f583e-c1e4-7d03-a9cd-ff4cf5046746';
const TANK_UUID = '019f583e-dc22-7aca-a8e3-6788d5a89717';

test('publishes deterministic UUID files, a direct SHA-1 manifest, and one ZIP', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mekbay-units-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sources = path.join(root, 'sources');
  const output = path.join(root, 'generated');
  writeSources(sources);
  fs.writeFileSync(path.join(sources, 'vehicles', 'emplacement.blk'),
    `<UnitType>\nGunEmplacement\n</UnitType>\n<Name>Turret</Name>\n<UUID>${TANK_UUID}</UUID>`);
  fs.mkdirSync(path.join(sources, 'gunemplacements'));
  fs.writeFileSync(path.join(sources, 'gunemplacements', 'legacy.blk'), '<UnitType>Gun Emplacement</UnitType>');
  fs.writeFileSync(path.join(sources, 'meks', 'missing-metadata.mtf'), `UUID:${MEK_UUID}`);
  fs.mkdirSync(path.join(output, 'core-unit-manifests'), { recursive: true });
  fs.writeFileSync(path.join(output, 'core-unit-manifests', 'old.json'), '{}');
  fs.writeFileSync(path.join(output, 'core-units-manifest.json'), '{}');
  fs.writeFileSync(path.join(output, 'core-units.old.zip'), 'old');

  const warnings: string[] = [];
  const first = await generateCoreUnitAssets({ ...options(sources, output), warn: message => warnings.push(message) });
  const firstFiles = readTree(output);
  const second = await generateCoreUnitAssets(options(sources, output));
  const secondFiles = readTree(output);

  assert.deepEqual(secondFiles, firstFiles);
  assert.equal(first.manifestHash, second.manifestHash);
  assert.equal(first.archiveHash, second.archiveHash);
  assert.equal(first.manifestHash.length, 27);
  assert.equal(first.archiveHash.length, 27);
  assert.deepEqual(first.skippedFiles, [
    'gunemplacements/legacy.blk',
    'meks/invalid.mtf',
    'meks/missing-metadata.mtf',
    'vehicles/emplacement.blk',
  ]);
  assert.deepEqual(warnings, [
    '[Core Units] Skipping meks/invalid.mtf: missing or invalid UUID',
    '[Core Units] Skipping meks/missing-metadata.mtf: missing metadata',
  ]);

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
    Object.values(zip.files)
      .filter((entry) => !entry.dir)
      .map((entry) => entry.name)
      .sort(),
    [
      `${MEK_UUID}.mtf`,
      `${TANK_UUID}.blk`,
      CORE_UNIT_ARCHIVE_DEPENDENCY_BUNDLE_PATH,
      CORE_UNIT_ARCHIVE_SUMMARY_PATH,
    ].sort(),
  );
  const summaries = JSON.parse(await zip.file(CORE_UNIT_ARCHIVE_SUMMARY_PATH)!.async('string')) as UnitSummary[];
  assert.deepEqual(
    summaries.map((summary) => summary.uuid),
    [MEK_UUID, TANK_UUID],
  );
  assert.ok(summaries.every((summary) => summary.summaryVersion === UNIT_SUMMARY_VERSION));
  const dependencies = JSON.parse(await zip.file(CORE_UNIT_ARCHIVE_DEPENDENCY_BUNDLE_PATH)!.async('string')) as Record<
    string,
    unknown
  >;
  assert.deepEqual(Object.keys(dependencies).sort(), [
    'equipment',
    'factions',
    'quirks',
    'sourcebooks',
    'spriteManifest',
  ]);
  assert.equal(fs.existsSync(path.join(output, 'core-unit-manifests')), false);
  assert.equal(fs.existsSync(path.join(output, 'core-units-manifest.json')), false);
  assert.equal(fs.existsSync(path.join(output, 'core-units.old.zip')), false);
});

test('refuses duplicate UUIDs', async (t) => {
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

test('generated save canaries use the same normalization as runtime loading', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mekbay-unit-canary-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sources = path.join(root, 'sources');
  const output = path.join(root, 'generated');
  fs.mkdirSync(path.join(sources, 'meks'), { recursive: true });
  const sourcePath = path.join(sources, 'meks', 'test.mtf');
  const original = mek(MEK_UUID, 'Test');
  const generation = options(sources, output, 1);
  const armor = new ArmorEquipment({ id: 'Standard Armor', name: 'Standard', type: 'armor', armor: { type: 'STANDARD' }, tech: { base: 'All' } });
  generation.summaryGenerationContext.projector = new EntityUnitSummaryProjector(new EquipmentRegistry({ [armor.id]: armor }));
  const generate = async (source: string) => {
    fs.writeFileSync(sourcePath, source);
    const release = await generateCoreUnitAssets(generation);
    const zip = await JSZip.loadAsync(fs.readFileSync(path.join(output, path.basename(CORE_UNITS_ARCHIVE_PATH))));
    const [summary] = JSON.parse(await zip.file(CORE_UNIT_ARCHIVE_SUMMARY_PATH)!.async('string')) as UnitSummary[];
    assert.equal(summary.sourceHashCanary, await nativeSourceHashCanary(source, 'mtf'));
    assert.equal(summary.hash, sha1(Buffer.from(source)));
    assert.equal(await zip.file(`${MEK_UUID}.mtf`)!.async('string'), source);
    return { canary: summary.sourceHashCanary, hash: release.manifest.units[MEK_UUID as keyof typeof release.manifest.units].hash };
  };
  const first = await generate(original);
  const metadataOnly = await generate('# Comment\r\nGenerator:New generator\r\noverview:New unit description\r\n' + original.replaceAll('\n', '\r\n'));
  assert.equal(metadataOnly.canary, first.canary);
  assert.notEqual(metadataOnly.hash, first.hash);
  assert.notEqual((await generate(original.replace('Mass:50', 'Mass:55'))).canary, first.canary);
});

test('does not publish when the required unit population is missing', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mekbay-small-unit-set-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sources = path.join(root, 'sources');
  fs.mkdirSync(path.join(sources, 'meks'), { recursive: true });
  fs.writeFileSync(path.join(sources, 'meks', 'a.mtf'), mek(MEK_UUID, 'A'));
  await assert.rejects(generateCoreUnitAssets(options(sources, path.join(root, 'output'), 2)), /minimum is 2/u);
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

function projector(): UnitSummaryProjector {
  return {
    project: async (input) => ({
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
  fs.writeFileSync(
    path.join(root, 'vehicles', 'tank.blk'),
    [
      '<BlockVersion>1</BlockVersion>',
      '<UnitType>Tank</UnitType>',
      '<Name>Vedette</Name>',
      '<Model>V</Model>',
      `<UUID>${TANK_UUID}</UUID>`,
    ].join('\n'),
  );
  fs.writeFileSync(path.join(root, 'meks', 'invalid.mtf'), mek('invalid', 'Skip'));
}

function mek(uuid: string, chassis: string): string {
  return [`Chassis:${chassis}`, 'Model:T', 'Mass:50', `UUID:${uuid}`].join('\n');
}

function readTree(root: string): Record<string, Buffer> {
  const output: Record<string, Buffer> = {};
  const walk = (directory: string): void => {
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
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
