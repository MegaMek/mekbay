// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import JSZip from 'jszip';
import { EquipmentRegistry } from '../src/app/models/equipment-lookup';
import {
    createEquipment,
    type EquipmentMap,
    type RawEquipmentData,
} from '../src/app/models/equipment.model';
import { equipmentCatalogEntriesIncludingSupplements } from '../src/app/models/equipment-catalog-supplements';
import type { Quirks } from '../src/app/models/quirks.model';
import type { Eras } from '../src/app/models/eras.model';
import type { RawMULFactions } from '../src/app/models/mulfactions.model';
import type { Sourcebook, Sourcebooks } from '../src/app/models/sourcebook.model';
import type { UnitSummary } from '../src/app/models/unit-summary.model';
import { uuidv4 } from '../src/app/utils/uuid.util';
import {
    isReusableCoreSummary,
    isUnitSummaryArray,
    prepareUnitSummaryArray,
} from '../src/app/services/unit-catalog/core-catalog-generation';
import {
    CORE_UNIT_ARCHIVE_DEPENDENCY_BUNDLE_PATH,
    CORE_UNIT_ARCHIVE_SUMMARY_PATH,
    CORE_UNITS_ARCHIVE_PATH,
    CORE_UNITS_MANIFEST_PATH,
    parseCoreUnitsManifest,
    type CoreUnitsManifest,
} from '../src/app/services/unit-catalog/core-unit-manifest';
import {
    buildApplicationCatalogDependencyBundle,
    parseApplicationCatalogDependencyBundle,
    serializeApplicationCatalogDependencyBundle,
    type ApplicationCatalogDependencyBundle,
} from '../src/app/services/unit-catalog/application-catalog-dependency-bundle';
import {
    EntityCoreUnitSummaryProjector,
    type CoreUnitSummaryProjector,
} from '../src/app/services/unit-catalog/entity-summary-projector';
import {
    asSourceHash,
    asUnitUuid,
    makeUnitFileName,
    MM_DATA_UNIT_PROVIDER_ID,
    type NativeUnitFormat,
    type SourceHash,
    type UnitFileName,
    type UnitUuid,
} from '../src/app/services/unit-catalog/unit-catalog.types';
import { createUnitSpriteAssignmentContextFromManifestText } from '../src/app/utils/unit-sprite-assignment-resolver';
import { createUnitIconResolver } from '../src/app/utils/unit-sprite-resolver';
import { UnitSummaryBuilder } from '../src/app/utils/unit-summary-builder';
import { isUuidV7, parseMegaMekUnitFileMetadata } from './lib/megamek-unit-file-metadata';
import { listUnitFilesRecursive } from './lib/unit-file-discovery';

const {
    loadOptionalEnvFile,
    resolveMmDataRoot,
} = require('./lib/script-paths') as {
    loadOptionalEnvFile(projectRoot: string, options?: { logPrefix?: string }): string | undefined;
    resolveMmDataRoot(projectRoot: string): string;
};
const { writeDeterministicFile } = require('./lib/deterministic-output') as typeof import('./lib/deterministic-output');

export const MIN_GENERATED_CORE_UNIT_COUNT = 5_000;
export const DEFAULT_SUMMARY_PROJECTION_CONCURRENCY = 4;

const MAX_RELEASE_EQUIPMENT_BYTES = 64 * 1_024 * 1_024;
const MAX_RELEASE_QUIRKS_BYTES = 8 * 1_024 * 1_024;
const MAX_RELEASE_ERAS_BYTES = 16 * 1_024 * 1_024;
const MAX_RELEASE_FACTIONS_BYTES = 64 * 1_024 * 1_024;
const ZIP_ENTRY_DATE = new Date('1984-01-01T00:00:00.000Z');
const OWNED_STAGE_PREFIX = '.core-unit-assets-stage-';

export interface CoreUnitSummaryGenerationContext {
    readonly projector: CoreUnitSummaryProjector;
    readonly dependencyBundle: ApplicationCatalogDependencyBundle;
}

export interface CoreUnitAssetGenerationOptions {
    readonly unitFilesRoot: string;
    readonly assetsRoot: string;
    readonly minimumUnitCount?: number;
    /** Explicit bounded seam for tests; release generation derives this from production catalogs. */
    readonly summaryGenerationContext?: CoreUnitSummaryGenerationContext;
    readonly summaryProjectionConcurrency?: number;
    readonly projectRoot?: string;
    readonly log?: (message: string) => void;
    readonly warn?: (message: string) => void;
}

export interface CoreUnitAssetGenerationReport {
    readonly manifest: CoreUnitsManifest;
    readonly manifestHash: SourceHash;
    readonly archiveHash: SourceHash;
    readonly skippedFiles: readonly string[];
}

interface UnitArtifact {
    readonly uuid: UnitUuid;
    readonly format: NativeUnitFormat;
    readonly file: UnitFileName;
    readonly hash: SourceHash;
    readonly bytes: Buffer;
}

function sha1(bytes: Buffer | string): SourceHash {
    return asSourceHash(crypto.createHash('sha1').update(bytes).digest('base64url'));
}

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function assertNativeFormatPath(
    unitFilesRoot: string,
    filePath: string,
    format: NativeUnitFormat,
): void {
    const relativePath = path.relative(unitFilesRoot, filePath);
    const isMekDirectory = relativePath.split(path.sep)[0]?.toLowerCase() === 'meks';
    if (format === 'mtf' && !isMekDirectory) {
        throw new Error(`MTF unit file must be under the meks directory: ${filePath}`);
    }
    if (format === 'blk' && isMekDirectory) {
        throw new Error(`BLK unit file is forbidden under the meks directory: ${filePath}`);
    }
}

function assertNativeFormat(format: NativeUnitFormat, unitType: string, filePath: string): void {
    if (format === 'mtf' && unitType !== 'Mek') {
        throw new Error(`Non-Mek unit ${filePath} uses forbidden MTF format (${unitType})`);
    }
    if (format === 'blk' && unitType === 'Mek') {
        throw new Error(`Mek unit ${filePath} uses forbidden BLK format`);
    }
}

function discoverArtifacts(
    unitFilesRoot: string,
    warn: (message: string) => void,
): { artifacts: UnitArtifact[]; skippedFiles: string[] } {
    const artifactByUuid = new Map<UnitUuid, UnitArtifact>();
    const skippedFiles: string[] = [];

    for (const filePath of listUnitFilesRecursive(unitFilesRoot)) {
        const format: NativeUnitFormat = path.extname(filePath).toLowerCase() === '.mtf' ? 'mtf' : 'blk';
        assertNativeFormatPath(unitFilesRoot, filePath, format);
        const bytes = fs.readFileSync(filePath);
        const metadata = parseMegaMekUnitFileMetadata(bytes.toString('utf8'), filePath, unitFilesRoot);
        const rawUuid = metadata?.uuid?.trim().toLowerCase();

        if (!metadata || !isUuidV7(rawUuid)) {
            const relativePath = path.relative(unitFilesRoot, filePath).split(path.sep).join('/');
            skippedFiles.push(relativePath);
            warn(`[Core Units] Skipping ${relativePath}: missing or invalid UUID`);
            continue;
        }

        assertNativeFormat(format, metadata.unitType, filePath);
        const uuid = asUnitUuid(rawUuid);
        if (artifactByUuid.has(uuid)) throw new Error(`Duplicate core unit UUID ${uuid}: ${filePath}`);
        artifactByUuid.set(uuid, Object.freeze({
            uuid,
            format,
            file: makeUnitFileName(uuid, format),
            hash: sha1(bytes),
            bytes,
        }));
    }

    return {
        artifacts: [...artifactByUuid.values()].sort((left, right) => compareText(left.uuid, right.uuid)),
        skippedFiles: skippedFiles.sort(compareText),
    };
}

function buildManifest(artifacts: readonly UnitArtifact[]): {
    readonly manifest: CoreUnitsManifest;
    readonly json: string;
    readonly hash: SourceHash;
} {
    const wire: Record<string, string> = {};
    for (const artifact of artifacts) wire[artifact.file] = artifact.hash;
    const json = JSON.stringify(wire);
    const hash = sha1(json);
    const manifest = parseCoreUnitsManifest(json, hash).manifest;
    return Object.freeze({ manifest, json, hash });
}

function parseJson<T>(bytes: Buffer, label: string): T {
    try {
        return JSON.parse(bytes.toString('utf8')) as T;
    } catch (error) {
        throw new Error(`Invalid ${label} JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPlaytestEquipment(
    internalName: string,
    equipment: RawEquipmentData['equipment'][string],
): boolean {
    return [internalName, equipment?.id, equipment?.name]
        .some(name => typeof name === 'string' && name.toLowerCase().includes('playtest'));
}

async function createProductionSummaryGenerationContext(
    projectRoot: string,
    assetsRoot: string,
): Promise<CoreUnitSummaryGenerationContext> {
    const sourcebooksPath = path.join(assetsRoot, 'sourcebooks.json');
    const staticCatalogRoot = path.join(projectRoot, 'public', 'online-assets', 'static');
    const equipmentPath = path.join(staticCatalogRoot, 'equipment.json');
    const quirksPath = path.join(staticCatalogRoot, 'quirks.json');
    const erasPath = path.join(staticCatalogRoot, 'eras.json');
    const factionsPath = path.join(staticCatalogRoot, 'factions.json');
    const spriteManifestPath = path.join(assetsRoot, 'sprites', 'unit-icons.json');
    for (const requiredPath of [
        sourcebooksPath,
        equipmentPath,
        quirksPath,
        erasPath,
        factionsPath,
        spriteManifestPath,
    ]) {
        if (!fs.existsSync(requiredPath)) throw new Error(`Core summary generation input is missing: ${requiredPath}`);
    }

    const equipmentBytes = fs.readFileSync(equipmentPath);
    const quirksBytes = fs.readFileSync(quirksPath);
    const erasBytes = fs.readFileSync(erasPath);
    const factionsBytes = fs.readFileSync(factionsPath);
    if (equipmentBytes.byteLength > MAX_RELEASE_EQUIPMENT_BYTES
        || quirksBytes.byteLength > MAX_RELEASE_QUIRKS_BYTES
        || erasBytes.byteLength < 1
        || erasBytes.byteLength > MAX_RELEASE_ERAS_BYTES
        || factionsBytes.byteLength < 1
        || factionsBytes.byteLength > MAX_RELEASE_FACTIONS_BYTES) {
        throw new Error('Repository-authored catalog input exceeds its byte ceiling');
    }

    const sourcebooksBytes = fs.readFileSync(sourcebooksPath);
    const equipmentRaw = parseJson<RawEquipmentData>(equipmentBytes, 'equipment.json');
    const quirksRaw = parseJson<Quirks>(quirksBytes, 'quirks.json');
    const sourcebooksRaw = parseJson<unknown>(sourcebooksBytes, 'sourcebooks.json');
    const erasRaw = parseJson<Eras>(erasBytes, 'eras.json');
    const factionsRaw = parseJson<RawMULFactions>(factionsBytes, 'factions.json');
    if (!isRecord(equipmentRaw) || !isRecord(equipmentRaw.equipment)
        || Object.keys(equipmentRaw.equipment).length < 4_000) {
        throw new Error('Core summary equipment catalog is missing or implausibly small');
    }
    if (!isRecord(quirksRaw) || !Array.isArray(quirksRaw.quirks) || quirksRaw.quirks.length < 70) {
        throw new Error('Core summary quirks catalog is missing or implausibly small');
    }
    if (!Array.isArray(sourcebooksRaw) || sourcebooksRaw.length < 100) {
        throw new Error('Core summary sourcebook catalog is missing or implausibly small');
    }
    const equipment: EquipmentMap = {};
    for (const [internalName, raw] of equipmentCatalogEntriesIncludingSupplements(equipmentRaw.equipment)) {
        if (!isPlaytestEquipment(internalName, raw)) equipment[internalName] = createEquipment(raw);
    }
    const equipmentRegistry = new EquipmentRegistry(equipment);
    const quirks = new Map(quirksRaw.quirks.map(quirk => [quirk.key, quirk] as const));
    const sourcebooks = new Map((sourcebooksRaw as Sourcebook[]).map(book => [book.abbrev, book] as const));

    const spriteManifestText = fs.readFileSync(spriteManifestPath, 'utf8');
    const spriteAssignments = await createUnitSpriteAssignmentContextFromManifestText({
        provider: MM_DATA_UNIT_PROVIDER_ID,
        manifestText: spriteManifestText,
    });
    const sourcebookCatalog: Sourcebooks = {
        assetHash: sha1(sourcebooksBytes),
        sourcebooks: sourcebooksRaw as Sourcebook[],
    };
    const quirksCatalog: Quirks = {
        version: quirksRaw.version,
        assetHash: sha1(quirksBytes),
        quirks: quirksRaw.quirks,
    };
    const erasCatalog: Eras = {
        version: erasRaw.version,
        assetHash: sha1(erasBytes),
        eras: erasRaw.eras,
    };
    const factionsCatalog: RawMULFactions = {
        version: factionsRaw.version,
        assetHash: sha1(factionsBytes),
        factions: factionsRaw.factions,
    };
    const dependencyBundle = await buildApplicationCatalogDependencyBundle({
        equipment: equipmentRaw,
        quirks: quirksCatalog,
        sourcebooks: sourcebookCatalog,
        eras: erasCatalog,
        factions: factionsCatalog,
        spriteManifest: {
            manifestDigest: spriteAssignments.manifestDigest,
            manifestText: spriteManifestText,
        },
    });

    return Object.freeze({
        projector: new EntityCoreUnitSummaryProjector(equipmentRegistry, {
            parseOptions: {
                sourcebookResolver: abbrev => sourcebooks.get(abbrev),
                quirkResolver: key => quirks.get(key),
            },
            summaryBuilder: new UnitSummaryBuilder(createUnitIconResolver(spriteAssignments.assignments)),
        }),
        dependencyBundle,
    });
}

function exactArrayBuffer(bytes: Buffer): ArrayBuffer {
    return Uint8Array.from(bytes).buffer;
}

async function projectUnitSummaries(
    artifacts: readonly UnitArtifact[],
    context: CoreUnitSummaryGenerationContext,
    concurrency: number,
): Promise<readonly UnitSummary[]> {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 32) {
        throw new Error('Summary projection concurrency must be an integer from 1 to 32');
    }
    const summaries = new Array<UnitSummary>(artifacts.length);
    let cursor = 0;
    const worker = async (): Promise<void> => {
        for (;;) {
            const index = cursor++;
            if (index >= artifacts.length) return;
            const artifact = artifacts[index];
            const entryKey = {
                origin: 'megamek' as const,
                design: { provider: MM_DATA_UNIT_PROVIDER_ID, uuid: artifact.uuid },
                sourceRevision: artifact.hash,
            };
            const projected = await context.projector.project({
                entryKey,
                format: artifact.format,
                file: artifact.file,
                bytes: exactArrayBuffer(artifact.bytes),
            });
            if (!isReusableCoreSummary(projected.summary, entryKey)) {
                throw new Error(`Core summary projection changed source identity for ${artifact.uuid}`);
            }
            summaries[index] = projected.summary;
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, artifacts.length) }, () => worker()));
    return prepareUnitSummaryArray(summaries);
}

async function createArchive(
    artifacts: readonly UnitArtifact[],
    summaries: readonly UnitSummary[],
    dependencyBundleBytes: Uint8Array,
): Promise<Buffer> {
    const zip = new JSZip();
    for (const artifact of artifacts) {
        zip.file(artifact.file, artifact.bytes, {
            date: ZIP_ENTRY_DATE,
            createFolders: false,
            unixPermissions: '644',
        });
    }
    zip.file(CORE_UNIT_ARCHIVE_SUMMARY_PATH, JSON.stringify(summaries), {
        date: ZIP_ENTRY_DATE,
        createFolders: false,
        unixPermissions: '644',
    });
    zip.file(CORE_UNIT_ARCHIVE_DEPENDENCY_BUNDLE_PATH, dependencyBundleBytes, {
        date: ZIP_ENTRY_DATE,
        createFolders: false,
        unixPermissions: '644',
    });
    return zip.generateAsync({
        type: 'nodebuffer',
        platform: 'UNIX',
        streamFiles: true,
        compression: 'DEFLATE',
        compressionOptions: { level: 9 },
    });
}

function createStageDirectory(assetsRoot: string): string {
    fs.mkdirSync(assetsRoot, { recursive: true });
    return fs.mkdtempSync(path.join(assetsRoot, OWNED_STAGE_PREFIX));
}

function removeStageDirectory(stageRoot: string, assetsRoot: string): void {
    const relative = path.relative(path.resolve(assetsRoot), path.resolve(stageRoot));
    if (path.isAbsolute(relative) || relative.includes(path.sep) || !relative.startsWith(OWNED_STAGE_PREFIX)) {
        throw new Error(`Refusing to remove non-owned staging directory: ${stageRoot}`);
    }
    fs.rmSync(stageRoot, { recursive: true, force: true });
}

function writeStagedOutputs(
    stageRoot: string,
    artifacts: readonly UnitArtifact[],
    archiveBytes: Buffer,
    manifestJson: string,
): void {
    for (const artifact of artifacts) {
        writeDeterministicFile(path.join(stageRoot, 'units', artifact.file), artifact.bytes);
    }
    writeDeterministicFile(path.join(stageRoot, path.basename(CORE_UNITS_ARCHIVE_PATH)), archiveBytes);
    writeDeterministicFile(path.join(stageRoot, path.basename(CORE_UNITS_MANIFEST_PATH)), manifestJson);
}

async function validateStagedOutputs(
    stageRoot: string,
    artifacts: readonly UnitArtifact[],
    manifestJson: string,
    manifestHash: SourceHash,
    expectedSummaries: readonly UnitSummary[],
    expectedDependencyBundle: ApplicationCatalogDependencyBundle,
): Promise<void> {
    const parsedManifest = parseCoreUnitsManifest(manifestJson, manifestHash);
    if (Object.keys(parsedManifest.manifest.units).length !== artifacts.length) {
        throw new Error('Units manifest does not cover every generated unit');
    }
    for (const artifact of artifacts) {
        const direct = fs.readFileSync(path.join(stageRoot, 'units', artifact.file));
        if (!direct.equals(artifact.bytes) || sha1(direct) !== artifact.hash) {
            throw new Error(`Direct unit output differs from ${artifact.file}`);
        }
    }

    const archiveBytes = fs.readFileSync(path.join(stageRoot, path.basename(CORE_UNITS_ARCHIVE_PATH)));
    const zip = await JSZip.loadAsync(archiveBytes, { checkCRC32: true });
    const expectedFiles = [
        ...artifacts.map(artifact => artifact.file),
        CORE_UNIT_ARCHIVE_SUMMARY_PATH,
        CORE_UNIT_ARCHIVE_DEPENDENCY_BUNDLE_PATH,
    ].sort();
    const actualFiles = Object.values(zip.files).filter(entry => !entry.dir).map(entry => entry.name).sort();
    if (!isDeepStrictEqual(actualFiles, expectedFiles)) throw new Error('Generated ZIP has unexpected members');
    for (const artifact of artifacts) {
        const archived = await zip.file(artifact.file)!.async('nodebuffer');
        if (!archived.equals(artifact.bytes)) throw new Error(`ZIP member differs from ${artifact.file}`);
    }

    const summaries = parseJson<unknown>(
        await zip.file(CORE_UNIT_ARCHIVE_SUMMARY_PATH)!.async('nodebuffer'),
        CORE_UNIT_ARCHIVE_SUMMARY_PATH,
    );
    if (!isUnitSummaryArray(summaries) || !isDeepStrictEqual(summaries, expectedSummaries)) {
        throw new Error('Embedded UnitSummary array differs from generated summaries');
    }
    const dependencyBundle = await parseApplicationCatalogDependencyBundle(
        await zip.file(CORE_UNIT_ARCHIVE_DEPENDENCY_BUNDLE_PATH)!.async('nodebuffer'),
    );
    if (!isDeepStrictEqual(dependencyBundle, expectedDependencyBundle)) {
        throw new Error('Embedded dependency bundle differs from the generated bundle');
    }
}

function publishFile(sourcePath: string, targetPath: string): void {
    const bytes = fs.readFileSync(sourcePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    if (fs.existsSync(targetPath) && fs.readFileSync(targetPath).equals(bytes)) return;
    const temporaryPath = `${targetPath}.tmp-${process.pid}-${uuidv4()}`;
    writeDeterministicFile(temporaryPath, bytes);
    fs.renameSync(temporaryPath, targetPath);
}

function publishStagedOutputs(
    stageRoot: string,
    assetsRoot: string,
    artifacts: readonly UnitArtifact[],
): void {
    removeObsoleteUnitAssets(assetsRoot);
    const unitsRoot = path.join(assetsRoot, 'units');
    const keep = new Set(artifacts.map(artifact => artifact.file));
    fs.mkdirSync(unitsRoot, { recursive: true });
    for (const artifact of artifacts) {
        publishFile(path.join(stageRoot, 'units', artifact.file), path.join(unitsRoot, artifact.file));
    }
    for (const name of fs.readdirSync(unitsRoot)) {
        const candidate = path.join(unitsRoot, name);
        if (fs.statSync(candidate).isFile() && /\.(?:mtf|blk)$/u.test(name) && !keep.has(name as UnitFileName)) {
            fs.unlinkSync(candidate);
        }
    }
    publishFile(
        path.join(stageRoot, path.basename(CORE_UNITS_ARCHIVE_PATH)),
        path.join(assetsRoot, path.basename(CORE_UNITS_ARCHIVE_PATH)),
    );
    // The manifest is the release commit point and is published last.
    publishFile(
        path.join(stageRoot, path.basename(CORE_UNITS_MANIFEST_PATH)),
        path.join(assetsRoot, path.basename(CORE_UNITS_MANIFEST_PATH)),
    );
}

function removeObsoleteUnitAssets(assetsRoot: string): void {
    for (const name of fs.readdirSync(assetsRoot)) {
        if (name === 'core-units-manifest.json' || /^core-units\..+\.zip$/u.test(name)) {
            const filePath = path.join(assetsRoot, name);
            if (fs.statSync(filePath).isFile()) fs.unlinkSync(filePath);
        }
    }
    const oldManifests = path.join(assetsRoot, 'core-unit-manifests');
    if (fs.existsSync(oldManifests)) fs.rmSync(oldManifests, { recursive: true, force: true });
}

export async function generateCoreUnitAssets(
    options: CoreUnitAssetGenerationOptions,
): Promise<CoreUnitAssetGenerationReport> {
    const unitFilesRoot = path.resolve(options.unitFilesRoot);
    const assetsRoot = path.resolve(options.assetsRoot);
    const log = options.log ?? console.log;
    const warn = options.warn ?? console.warn;
    const stageRoot = createStageDirectory(assetsRoot);

    try {
        const { artifacts, skippedFiles } = discoverArtifacts(unitFilesRoot, warn);
        const minimum = options.minimumUnitCount ?? MIN_GENERATED_CORE_UNIT_COUNT;
        if (artifacts.length < minimum) {
            throw new Error(`Refusing to publish ${artifacts.length} core units; minimum is ${minimum}`);
        }

        log(`[Core Units] Packaging ${artifacts.length} UUID-named native unit files...`);
        const projectRoot = path.resolve(options.projectRoot ?? path.join(__dirname, '..'));
        const context = options.summaryGenerationContext
            ?? await createProductionSummaryGenerationContext(projectRoot, assetsRoot);
        const serializedBundle = await serializeApplicationCatalogDependencyBundle(context.dependencyBundle);
        const summaries = await projectUnitSummaries(
            artifacts,
            context,
            options.summaryProjectionConcurrency ?? DEFAULT_SUMMARY_PROJECTION_CONCURRENCY,
        );
        const archiveBytes = await createArchive(artifacts, summaries, serializedBundle.bytes);
        const manifest = buildManifest(artifacts);
        writeStagedOutputs(stageRoot, artifacts, archiveBytes, manifest.json);
        await validateStagedOutputs(
            stageRoot,
            artifacts,
            manifest.json,
            manifest.hash,
            summaries,
            serializedBundle.bundle,
        );
        publishStagedOutputs(stageRoot, assetsRoot, artifacts);

        const archiveHash = sha1(archiveBytes);
        const rawBytes = artifacts.reduce((total, artifact) => total + artifact.bytes.byteLength, 0);
        log(
            `[Core Units] Published ${artifacts.length} units, ${rawBytes} raw bytes, `
            + `${archiveBytes.byteLength} ZIP bytes (${archiveHash}).`,
        );
        return Object.freeze({
            manifest: manifest.manifest,
            manifestHash: manifest.hash,
            archiveHash,
            skippedFiles: Object.freeze(skippedFiles),
        });
    } finally {
        removeStageDirectory(stageRoot, assetsRoot);
    }
}

async function main(): Promise<void> {
    const projectRoot = path.resolve(__dirname, '..');
    loadOptionalEnvFile(projectRoot, { logPrefix: 'Core Units' });
    const mmDataRoot = resolveMmDataRoot(projectRoot);
    await generateCoreUnitAssets({
        unitFilesRoot: path.join(mmDataRoot, 'data', 'mekfiles'),
        assetsRoot: path.join(projectRoot, 'public', 'online-assets', 'generated'),
    });
}

if (require.main === module) {
    main().catch((error: unknown) => {
        console.error('[Core Units] Error:', error);
        process.exitCode = 1;
    });
}
