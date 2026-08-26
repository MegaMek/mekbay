// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import JSZip from 'jszip';

import type { UnitSummary } from '../../models/unit-summary.model';
import { sha1Base64Url } from '../../utils/sha1.util';
import {
    parseApplicationCatalogDependencyBundle,
    type ApplicationCatalogDependencyBundle,
} from './application-catalog-dependency-bundle';
import { isUnitSummaryArray } from './core-catalog-generation';
import {
    CORE_UNIT_ARCHIVE_DEPENDENCY_BUNDLE_PATH,
    CORE_UNIT_ARCHIVE_SUMMARY_PATH,
    type CoreUnitsManifest,
} from './core-unit-manifest';
import type { UnitFileName } from './unit-catalog.types';

export class CoreUnitArchiveError extends Error {
    public constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'CoreUnitArchiveError';
    }
}

export interface CoreUnitArchive {
    readonly files: readonly UnitFileName[];
    extract(file: UnitFileName): Promise<ArrayBuffer>;
    compactSources(
        manifest: CoreUnitsManifest,
        replacements: readonly CoreUnitSourceReplacement[],
    ): Promise<ArrayBuffer>;
}

export interface CoreUnitSourceReplacement {
    readonly file: UnitFileName;
    readonly bytes: ArrayBuffer;
}

export interface CoreUnitRelease {
    readonly archive: CoreUnitArchive;
    readonly summaries: readonly UnitSummary[];
    readonly dependencyBundle: ApplicationCatalogDependencyBundle;
}

/** Creates the first local ZIP after a small, individual-file installation. */
export async function createCoreUnitSourceArchive(
    manifest: CoreUnitsManifest,
    sources: readonly CoreUnitSourceReplacement[],
): Promise<ArrayBuffer> {
    const desired = desiredFiles(manifest);
    const seen = new Set<UnitFileName>();
    const zip = new JSZip();
    for (const source of sources) {
        if (!desired.has(source.file) || seen.has(source.file)) {
            throw new CoreUnitArchiveError(`Duplicate or unknown unit source: ${source.file}`);
        }
        seen.add(source.file);
        addUnitSource(zip, source);
    }
    if (seen.size !== desired.size) throw new CoreUnitArchiveError('Cannot create the local ZIP without every unit');
    return generateZip(zip);
}

/**
 * Opens a newly downloaded release. The supplied whole-file SHA-1 is the only
 * corruption/incomplete-download checksum; JSZip only has to read the ZIP.
 */
export async function openCoreUnitRelease(
    source: ArrayBuffer,
    expectedChecksum: string,
    manifest: CoreUnitsManifest,
): Promise<CoreUnitRelease> {
    if (await sha1Base64Url(source) !== expectedChecksum) {
        throw new CoreUnitArchiveError('Unit ZIP is corrupt or incomplete');
    }
    const zip = await openZip(source);
    const [summaryBytes, dependencyBytes] = await Promise.all([
        extract(zip, CORE_UNIT_ARCHIVE_SUMMARY_PATH),
        extract(zip, CORE_UNIT_ARCHIVE_DEPENDENCY_BUNDLE_PATH),
    ]);
    const [summaries, dependencyBundle] = await Promise.all([
        parseEmbeddedSummaries(summaryBytes),
        parseApplicationCatalogDependencyBundle(dependencyBytes),
    ]);
    return Object.freeze({
        archive: createArchive(zip, manifest),
        summaries,
        dependencyBundle,
    });
}

/** Opens the local cache without re-hashing it on every normal startup. */
export async function openStoredCoreUnitArchive(
    source: ArrayBuffer,
    manifest: CoreUnitsManifest,
): Promise<CoreUnitArchive> {
    return createArchive(await openZip(source), manifest);
}

async function openZip(source: ArrayBuffer): Promise<JSZip> {
    try {
        return await JSZip.loadAsync(source, { createFolders: false, checkCRC32: false });
    } catch (error) {
        throw new CoreUnitArchiveError('Unit ZIP is corrupt or incomplete', { cause: error });
    }
}

function createArchive(zip: JSZip, manifest: CoreUnitsManifest): CoreUnitArchive {
    const files = Object.freeze(Object.values(manifest.units).map(entry => entry.file).sort());
    const desired = new Set(files);
    return Object.freeze({
        files,
        extract: (file: UnitFileName): Promise<ArrayBuffer> => {
            if (!desired.has(file)) return Promise.reject(new CoreUnitArchiveError(`Unit is unavailable: ${file}`));
            return extract(zip, file);
        },
        compactSources: async (
            nextManifest: CoreUnitsManifest,
            replacements: readonly CoreUnitSourceReplacement[],
        ): Promise<ArrayBuffer> => {
            const nextFiles = desiredFiles(nextManifest);
            for (const name of Object.keys(zip.files)) {
                if (!nextFiles.has(name as UnitFileName)) zip.remove(name);
            }
            const replaced = new Set<UnitFileName>();
            for (const replacement of replacements) {
                if (!nextFiles.has(replacement.file) || replaced.has(replacement.file)) {
                    throw new CoreUnitArchiveError(`Duplicate or unknown unit replacement: ${replacement.file}`);
                }
                replaced.add(replacement.file);
                addUnitSource(zip, replacement);
            }
            return generateZip(zip);
        },
    });
}

function desiredFiles(manifest: CoreUnitsManifest): ReadonlySet<UnitFileName> {
    return new Set(Object.values(manifest.units).map(entry => entry.file));
}

function addUnitSource(zip: JSZip, source: CoreUnitSourceReplacement): void {
    zip.file(source.file, source.bytes, {
        binary: true,
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
        date: new Date('1980-01-01T00:00:00.000Z'),
        createFolders: false,
    });
}

async function generateZip(zip: JSZip): Promise<ArrayBuffer> {
    return zip.generateAsync({
        type: 'arraybuffer',
        platform: 'UNIX',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
        streamFiles: false,
        comment: '',
    });
}

async function extract(zip: JSZip, path: string): Promise<ArrayBuffer> {
    const file = zip.file(path);
    if (!file || file.dir) throw new CoreUnitArchiveError(`Unit ZIP member is unavailable: ${path}`);
    try {
        return await file.async('arraybuffer');
    } catch (error) {
        throw new CoreUnitArchiveError(`Could not read unit ZIP member: ${path}`, { cause: error });
    }
}

async function parseEmbeddedSummaries(source: ArrayBuffer): Promise<readonly UnitSummary[]> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(source));
    } catch (error) {
        throw new CoreUnitArchiveError('Bootstrap UnitSummary JSON is unreadable', { cause: error });
    }
    if (!isUnitSummaryArray(parsed)) throw new CoreUnitArchiveError('Bootstrap UnitSummary JSON has an unsupported shape');
    return Object.freeze(parsed);
}
