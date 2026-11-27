// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import crypto from 'node:crypto';
import JSZip from 'jszip';
import {
    CORE_UNIT_ARCHIVE_DEPENDENCY_BUNDLE_PATH,
    CORE_UNIT_ARCHIVE_SUMMARY_PATH,
    CORE_UNITS_ARCHIVE_PATH,
    CORE_UNITS_MANIFEST_PATH,
    parseCoreUnitsManifest,
} from '../src/app/services/unit-catalog/core-unit-manifest';
import { isUnitSummaryArray } from '../src/app/services/unit-catalog/core-catalog-generation';
import { parseApplicationCatalogDependencyBundle } from '../src/app/services/unit-catalog/application-catalog-dependency-bundle';
import {
    REPOSITORY_ASSETS_MANIFEST_RELATIVE_PATH,
    assertRepositoryAssetsManifest,
} from './lib/repository-asset-manifest';

export interface DeployedCoreAssetsReport {
    readonly unitCount: number;
    readonly unitsManifestHash: string;
    readonly archiveHash: string;
}

export interface ValidateDeployedCoreAssetsOptions {
    readonly baseUrl: string;
    readonly fetchImpl?: typeof fetch;
}

export async function validateDeployedCoreAssets({
    baseUrl,
    fetchImpl = fetch,
}: ValidateDeployedCoreAssetsOptions): Promise<DeployedCoreAssetsReport> {
    const root = normalizedRoot(baseUrl);
    const assetsManifestBytes = await download(
        new URL(REPOSITORY_ASSETS_MANIFEST_RELATIVE_PATH, root),
        fetchImpl,
    );
    const assetsManifest = parseJson(assetsManifestBytes, 'assets-manifest.json');
    assertRepositoryAssetsManifest(assetsManifest);

    const unitsManifestHash = requiredHash(assetsManifest, CORE_UNITS_MANIFEST_PATH);
    const archiveHash = requiredHash(assetsManifest, CORE_UNITS_ARCHIVE_PATH);
    const [unitsManifestBytes, archiveBytes] = await Promise.all([
        downloadAndVerify(new URL(CORE_UNITS_MANIFEST_PATH, root), unitsManifestHash, fetchImpl),
        downloadAndVerify(new URL(CORE_UNITS_ARCHIVE_PATH, root), archiveHash, fetchImpl),
    ]);

    const unitsManifestJson = new TextDecoder().decode(unitsManifestBytes);
    const unitsManifest = parseCoreUnitsManifest(unitsManifestJson, unitsManifestHash);
    const zip = await JSZip.loadAsync(archiveBytes);
    const summariesFile = zip.file(CORE_UNIT_ARCHIVE_SUMMARY_PATH);
    const dependenciesFile = zip.file(CORE_UNIT_ARCHIVE_DEPENDENCY_BUNDLE_PATH);
    if (!summariesFile || !dependenciesFile) throw new Error('units.zip is missing its generated catalogs');

    const [summaries, dependencies] = await Promise.all([
        summariesFile.async('uint8array').then(bytes => parseJson(bytes, CORE_UNIT_ARCHIVE_SUMMARY_PATH)),
        dependenciesFile.async('uint8array').then(parseApplicationCatalogDependencyBundle),
    ]);
    if (!isUnitSummaryArray(summaries)) throw new Error('units.zip contains an invalid UnitSummary array');
    if (!dependencies) throw new Error('units.zip contains invalid application catalog dependencies');

    return {
        unitCount: Object.keys(unitsManifest.manifest.units).length,
        unitsManifestHash,
        archiveHash,
    };
}

async function downloadAndVerify(url: URL, expectedHash: string, fetchImpl: typeof fetch): Promise<Uint8Array> {
    const bytes = await download(url, fetchImpl);
    const actualHash = sha1(bytes);
    if (actualHash !== expectedHash) {
        throw new Error(`${url.pathname} SHA-1 mismatch: expected ${expectedHash}, got ${actualHash}`);
    }
    return bytes;
}

async function download(url: URL, fetchImpl: typeof fetch): Promise<Uint8Array> {
    const response = await fetchImpl(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
}

function parseJson(bytes: Uint8Array, label: string): unknown {
    try {
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
    } catch (error) {
        throw new Error(`${label} is invalid JSON`, { cause: error });
    }
}

function requiredHash(manifest: Readonly<Record<string, string>>, path: string): string {
    const value = manifest[path];
    if (!value) throw new Error(`assets-manifest.json does not list ${path}`);
    return value;
}

function sha1(bytes: Uint8Array): string {
    return crypto.createHash('sha1').update(bytes).digest('base64url');
}

function normalizedRoot(value: string): URL {
    const root = new URL(value);
    if (root.protocol !== 'https:' && root.protocol !== 'http:') {
        throw new Error('Deployment base URL must use HTTP(S)');
    }
    if (!root.pathname.endsWith('/')) root.pathname += '/';
    return root;
}

function cliBaseUrl(argv: readonly string[]): string {
    const index = argv.indexOf('--base-url');
    if (index < 0 || !argv[index + 1]) throw new Error('Usage: --base-url https://example.test/path/');
    return argv[index + 1];
}

if (require.main === module) {
    validateDeployedCoreAssets({ baseUrl: cliBaseUrl(process.argv.slice(2)) })
        .then(report => {
            console.log(`[Deploy] Verified ${report.unitCount} units (${report.archiveHash}).`);
        })
        .catch((error: unknown) => {
            console.error('[Deploy] Validation failed:', error);
            process.exitCode = 1;
        });
}
