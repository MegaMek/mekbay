// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

/**
 * Characterization for the fluff-image resolver through the production entity
 * summary route. `unit-images.json` is
 * deliberately imported only by this
 * test: production derives image paths from `images.json` at runtime.
 *
 * Usage:
 *   npm run test:presentation-catalog-fixtures
 *   npm run test:presentation-catalog-fixtures -- --limit 100
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import crypto from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { EquipmentRegistry } from '../src/app/models/equipment-lookup';
import {
  createEquipment,
  type EquipmentMap,
  type RawEquipmentData,
} from '../src/app/models/equipment.model';
import type { Quirk, Quirks } from '../src/app/models/quirks.model';
import type { Sourcebook } from '../src/app/models/sourcebook.model';
import { nativeCapabilityForEntityType } from '../src/app/models/entity/codec-capabilities';
import { EntityCoreUnitSummaryProjector } from '../src/app/services/unit-catalog/entity-summary-projector';
import {
  parseCoreUnitsManifest,
  type CoreUnitsManifest,
} from '../src/app/services/unit-catalog/core-unit-manifest';
import {
  MM_DATA_UNIT_PROVIDER_ID,
  asUnitUuid,
  type CoreCatalogEntryKey,
  type UnitUuid,
} from '../src/app/services/unit-catalog/unit-catalog.types';
import {
  buildFluffImageIndex,
  fluffImageFactsFromUnitSummary,
  parseFluffImageCatalog,
  resolveFluffImage,
} from '../src/app/utils/fluff-image-resolver';
import {
  createUnitSpriteAssignmentContextFromManifestText,
} from '../src/app/utils/unit-sprite-assignment-resolver';
import { createUnitIconResolver } from '../src/app/utils/unit-sprite-resolver';
import { UnitSummaryBuilder } from '../src/app/utils/unit-summary-builder';

interface LegacyUnitOracle {
  readonly uuid: string;
  readonly name: string;
  readonly unitFile: string;
  readonly dpt: number;
}

interface Failure {
  readonly uuid?: string;
  readonly unitFile?: string;
  readonly message: string;
}

const PROJECT_ROOT = path.resolve(__dirname, '..');
const FIXTURE_ROOT = path.join(PROJECT_ROOT, 'scripts', 'testdata', 'presentation-catalogs');
const ASSETS_ROOT = path.join(PROJECT_ROOT, 'public', 'online-assets', 'generated');
const UNIT_ASSETS_ROOT = path.join(ASSETS_ROOT, 'units');
const MAX_REPORTED_FAILURES = 30;
const SPRITE_ROOT = path.join(PROJECT_ROOT, 'public', 'online-assets', 'generated', 'sprites');

async function main(): Promise<void> {
  const imagePaths = parseFluffImageCatalog(readJson('images.json.gz'), {
    minimumEntryCount: 2_000,
  });
  const imageIndex = buildFluffImageIndex(imagePaths);
  const expectedImages = validateImageOracle(readJson('unit-images.json.gz'));
  const units = validateUnitOracle(readJson('presentation-units-oracle.json.gz'));
  const manifest = await loadCoreManifest();

  const failures: Failure[] = [];
  validateUuidSets(units, expectedImages, failures);
  validateManifestCoverage(units, manifest, failures);
  const manifestTotal = Object.keys(manifest.units).length;
  if (failures.length > 0) finish(failures, 0, manifestTotal, units.length, imagePaths.length, 0);

  const manifestUuids = Object.keys(manifest.units).sort() as UnitUuid[];
  const limit = readLimit(process.argv.slice(2), manifestUuids.length);
  const equipmentRegistry = loadEquipmentRegistry();
  const sourcebooks = loadSourcebooks();
  const quirks = loadQuirks();
  const spriteAssignments = await loadSpriteAssignments();
  const projector = new EntityCoreUnitSummaryProjector(equipmentRegistry, {
    parseOptions: {
      sourcebookResolver: abbrev => sourcebooks.get(abbrev),
      quirkResolver: key => quirks.get(key),
    },
    summaryBuilder: new UnitSummaryBuilder(createUnitIconResolver(
      spriteAssignments.assignments,
    )),
  });
  const oracleByUuid = new Map(units.map(unit => [unit.uuid, unit] as const));

  let checked = 0;
  let gameplayReady = 0;
  for (const uuid of manifestUuids.slice(0, limit)) {
    const entry = manifest.units[uuid];
    const unit = oracleByUuid.get(uuid);
    try {
      const sourcePath = resolveGeneratedUnitFile(entry.file);
      const source = fs.readFileSync(sourcePath);
      const actualHash = sha1(source);
      if (actualHash !== entry.hash) {
        throw new Error(`content hash ${actualHash} does not match ${entry.hash}`);
      }
      const entryKey: CoreCatalogEntryKey = {
        origin: 'megamek',
        design: { provider: MM_DATA_UNIT_PROVIDER_ID, uuid },
        sourceRevision: entry.hash,
      };
      const { summary } = await projector.project({
        entryKey,
        format: entry.format,
        file: entry.file,
        bytes: Uint8Array.from(source).buffer,
      });
      if (
        summary.uuid !== uuid
        || summary.provider !== MM_DATA_UNIT_PROVIDER_ID
        || summary.origin !== 'megamek'
        || summary.hash !== entry.hash
      ) {
        throw new Error('projected summary does not preserve exact manifest identity/source evidence');
      }
      nativeCapabilityForEntityType(summary.entityType);
      gameplayReady++;
      if (!summary.baseChassis || !summary.name || !summary.entityType) {
        throw new Error('projected summary is not total');
      }
      if (Object.prototype.hasOwnProperty.call(summary, 'fluff')
        || Object.prototype.hasOwnProperty.call(summary, 'sheets')) {
        throw new Error('summary persisted native-source fluff or sheet paths');
      }

      if (unit && summary.dpt !== unit.dpt) {
        failures.push({
          uuid,
          unitFile: unit.unitFile,
          message: `DPT mismatch: expected ${unit.dpt}, received ${summary.dpt}`,
        });
      }
      const actualImage = resolveFluffImage(fluffImageFactsFromUnitSummary(summary), imageIndex)?.path;
      const expectedImage = expectedImages.get(uuid);
      if (unit && actualImage !== expectedImage) {
        failures.push({
          uuid,
          unitFile: unit.unitFile,
          message: `image mismatch: expected ${quote(expectedImage)}, received ${quote(actualImage)}`,
        });
      }
    } catch (error) {
      failures.push({
        uuid,
        unitFile: unit?.unitFile ?? entry.file,
        message: `parse/resolution failed: ${errorMessage(error)}`,
      });
    }
    checked++;
    if (checked % 1_000 === 0) process.stdout.write(`Checked ${checked}/${limit} units\n`);
  }

  if (limit === manifestUuids.length && gameplayReady !== manifestUuids.length) {
    failures.push({
      message: `capability population mismatch: expected ${manifestUuids.length}, received ${gameplayReady}`,
    });
  }
  finish(failures, checked, manifestTotal, units.length, imagePaths.length, gameplayReady);
}

async function loadSpriteAssignments(): Promise<Awaited<ReturnType<typeof createUnitSpriteAssignmentContextFromManifestText>>> {
  const spriteManifestText = fs.readFileSync(path.join(SPRITE_ROOT, 'unit-icons.json'), 'utf8');
  return createUnitSpriteAssignmentContextFromManifestText({
    provider: MM_DATA_UNIT_PROVIDER_ID,
    manifestText: spriteManifestText,
  });
}

async function loadCoreManifest(): Promise<CoreUnitsManifest> {
  const manifestPath = path.join(ASSETS_ROOT, 'units-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Generated core manifest is missing: ${manifestPath}`);
  }
  const raw = fs.readFileSync(manifestPath);
  return parseCoreUnitsManifest(raw.toString('utf8'), sha1(raw)).manifest;
}

function validateUuidSets(
  units: readonly LegacyUnitOracle[],
  images: ReadonlyMap<string, string>,
  failures: Failure[],
): void {
  const unitUuids = new Set(units.map(unit => unit.uuid));
  for (const uuid of images.keys()) {
    if (!unitUuids.has(uuid)) failures.push({ uuid, message: 'unit-images.json UUID is absent from units.json' });
  }
}

function validateManifestCoverage(
  units: readonly LegacyUnitOracle[],
  manifest: CoreUnitsManifest,
  failures: Failure[],
): void {
  const manifestUuids = new Set(Object.keys(manifest.units));
  for (const unit of units) {
    if (!manifestUuids.has(unit.uuid)) {
      failures.push({ uuid: unit.uuid, unitFile: unit.unitFile, message: 'legacy fixture UUID is absent from the current core manifest' });
    }
  }
}

function validateUnitOracle(value: unknown): readonly LegacyUnitOracle[] {
  if (!isObject(value) || !Array.isArray(value['units'])) {
    throw new Error('units.json must contain a units array');
  }
  const seen = new Set<string>();
  return value['units'].map((entry, index) => {
    if (!isObject(entry)) throw new Error(`units.json units[${index}] must be an object`);
    const uuid = asUnitUuid(requiredString(entry['uuid'], `units[${index}].uuid`));
    if (seen.has(uuid)) throw new Error(`units.json repeats UUID ${uuid}`);
    seen.add(uuid);
    return {
      uuid,
      name: requiredString(entry['name'], `units[${index}].name`),
      unitFile: requiredString(entry['unitFile'], `units[${index}].unitFile`),
      dpt: requiredNumber(entry['dpt'], `units[${index}].dpt`),
    };
  });
}

function validateImageOracle(value: unknown): ReadonlyMap<string, string> {
  if (!isObject(value)) throw new Error('unit-images.json must be an object');
  return new Map(Object.entries(value).map(([rawUuid, rawPath]) => {
    const uuid = asUnitUuid(rawUuid);
    return [uuid, requiredString(rawPath, `unit-images.json[${uuid}]`)] as const;
  }));
}

function loadEquipmentRegistry(): EquipmentRegistry {
  const raw = readJson('equipment2.json.gz') as RawEquipmentData;
  if (!isObject(raw) || !isObject(raw.equipment)) {
    throw new Error('equipment2.json must contain an equipment object');
  }
  const equipment: EquipmentMap = {};
  for (const [internalName, value] of Object.entries(raw.equipment)) {
    equipment[internalName] = createEquipment(value);
  }
  return new EquipmentRegistry(equipment);
}

function loadSourcebooks(): ReadonlyMap<string, Sourcebook> {
  const value = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'online-assets', 'generated', 'sourcebooks.json'), 'utf8')) as unknown;
  if (!Array.isArray(value)) throw new Error('sourcebooks.json must be an array');
  const sourcebooks = value as Sourcebook[];
  return new Map(sourcebooks.map(sourcebook => [sourcebook.abbrev, sourcebook]));
}

function loadQuirks(): ReadonlyMap<string, Quirk> {
  const value = readJson('quirks.json.gz') as Quirks;
  if (!isObject(value) || !Array.isArray(value.quirks)) {
    throw new Error('quirks.json must contain a quirks array');
  }
  return new Map(value.quirks.map(quirk => [quirk.key, quirk]));
}

function resolveGeneratedUnitFile(file: string): string {
  const resolved = path.resolve(UNIT_ASSETS_ROOT, file);
  const relative = path.relative(UNIT_ASSETS_ROOT, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative) || relative !== file) {
    throw new Error('unit filename escapes the generated unit asset root');
  }
  return resolved;
}

function sha1(bytes: Uint8Array): string {
  return crypto.createHash('sha1').update(bytes).digest('base64url');
}

function readJson(fileName: string): unknown {
  return JSON.parse(readFixtureText(fileName)) as unknown;
}

function readFixtureText(fileName: string): string {
  const filePath = path.join(FIXTURE_ROOT, fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required fixture is missing: ${filePath}`);
  }
  return gunzipSync(fs.readFileSync(filePath)).toString('utf8');
}

function readLimit(args: readonly string[], maximum: number): number {
  const index = args.indexOf('--limit');
  if (index < 0) return maximum;
  const limit = Number(args[index + 1]);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximum) {
    throw new Error(`--limit must be an integer in the range 1..${maximum}`);
  }
  return limit;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} must be a nonempty string`);
  return value;
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${field} must be a finite number`);
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function quote(value: string | undefined): string {
  return value === undefined ? '<none>' : JSON.stringify(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function finish(
  failures: readonly Failure[],
  checked: number,
  manifestTotal: number,
  legacyTotal: number,
  imageCount: number,
  gameplayReady: number,
): never {
  if (failures.length > 0) {
    for (const failure of failures.slice(0, MAX_REPORTED_FAILURES)) {
      const identity = [failure.uuid, failure.unitFile].filter(Boolean).join(' ');
      process.stderr.write(`${identity}: ${failure.message}\n`);
    }
    if (failures.length > MAX_REPORTED_FAILURES) {
      process.stderr.write(`... ${failures.length - MAX_REPORTED_FAILURES} additional failures omitted\n`);
    }
    throw new Error(`Presentation catalog fixture gate failed with ${failures.length} mismatch(es)`);
  }
  process.stdout.write(
    `PASS: ${checked}/${manifestTotal} current manifest entries projected one at a time `
      + `(${gameplayReady} projected); `
      + `${legacyTotal} legacy unit-oracle mappings and `
      + `${imageCount} image paths match their fixtures.\n`,
  );
  process.exit(0);
}

void main().catch(error => {
  process.stderr.write(`${errorMessage(error)}\n`);
  process.exitCode = 1;
});
