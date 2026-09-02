// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import JSZip from 'jszip';
import { UNIT_SUMMARY_VERSION } from '../src/app/models/unit-summary.model';
import {
    CORE_UNIT_ARCHIVE_DEPENDENCY_BUNDLE_PATH,
    CORE_UNIT_ARCHIVE_SUMMARY_PATH,
    CORE_UNITS_ARCHIVE_PATH,
    CORE_UNITS_MANIFEST_PATH,
} from '../src/app/services/unit-catalog/core-unit-manifest';
import { REPOSITORY_ASSETS_MANIFEST_RELATIVE_PATH } from './lib/repository-asset-manifest';
import { validateDeployedCoreAssets } from './validate-deployed-core-assets';

const UUID = '019f583e-c1e4-7d03-a9cd-ff4cf5046746';
const UNIT_FILE = `${UUID}.mtf`;

test('validates the two manifests and units.zip with SHA-1', async () => {
    const fixture = await createFixture();
    const requested: string[] = [];
    const report = await validateDeployedCoreAssets({
        baseUrl: 'https://example.test/mekbay/',
        fetchImpl: fixture.fetch(requested),
    });

    assert.equal(report.unitCount, 1);
    assert.equal(report.unitsManifestHash, fixture.unitsManifestHash);
    assert.equal(report.archiveHash, fixture.archiveHash);
    assert.deepEqual(requested, [
        `https://example.test/mekbay/${REPOSITORY_ASSETS_MANIFEST_RELATIVE_PATH}`,
        `https://example.test/mekbay/${CORE_UNITS_MANIFEST_PATH}`,
        `https://example.test/mekbay/${CORE_UNITS_ARCHIVE_PATH}`,
    ]);
});

test('rejects an incomplete archive before opening it', async () => {
    const fixture = await createFixture();
    fixture.files.set(CORE_UNITS_ARCHIVE_PATH, fixture.files.get(CORE_UNITS_ARCHIVE_PATH)!.subarray(0, 20));
    await assert.rejects(
        validateDeployedCoreAssets({ baseUrl: 'https://example.test/', fetchImpl: fixture.fetch() }),
        /units\.zip SHA-1 mismatch/u,
    );
});

test('rejects a units manifest not named by assets-manifest', async () => {
    const fixture = await createFixture();
    fixture.files.set(REPOSITORY_ASSETS_MANIFEST_RELATIVE_PATH, Buffer.from(JSON.stringify({
        [CORE_UNITS_ARCHIVE_PATH]: fixture.archiveHash,
    })));
    await assert.rejects(
        validateDeployedCoreAssets({ baseUrl: 'https://example.test/', fetchImpl: fixture.fetch() }),
        /does not list.*units-manifest/u,
    );
});

async function createFixture() {
    const source = Buffer.from(`Version:1.3\nUUID:${UUID}\n`);
    const unitHash = sha1(source);
    const unitsManifest = Buffer.from(JSON.stringify({ [UNIT_FILE]: unitHash }));
    const unitsManifestHash = sha1(unitsManifest);
    const dependencies = {
        equipment: {}, quirks: {}, sourcebooks: {}, factions: {},
        spriteManifest: { manifestDigest: 'digest', manifestText: '{}' },
    };
    const summaries = [{
        uuid: UUID,
        provider: 'mm-data',
        origin: 'megamek',
        hash: unitHash,
        summaryVersion: UNIT_SUMMARY_VERSION,
    }];
    const zip = new JSZip();
    zip.file(UNIT_FILE, source);
    zip.file(CORE_UNIT_ARCHIVE_SUMMARY_PATH, JSON.stringify(summaries));
    zip.file(CORE_UNIT_ARCHIVE_DEPENDENCY_BUNDLE_PATH, JSON.stringify(dependencies));
    const archive = await zip.generateAsync({ type: 'nodebuffer' });
    const archiveHash = sha1(archive);
    const assetsManifest = Buffer.from(JSON.stringify({
        [CORE_UNITS_MANIFEST_PATH]: unitsManifestHash,
        [CORE_UNITS_ARCHIVE_PATH]: archiveHash,
    }));
    const files = new Map<string, Uint8Array>([
        [REPOSITORY_ASSETS_MANIFEST_RELATIVE_PATH, assetsManifest],
        [CORE_UNITS_MANIFEST_PATH, unitsManifest],
        [CORE_UNITS_ARCHIVE_PATH, archive],
    ]);
    return {
        files,
        unitsManifestHash,
        archiveHash,
        fetch: (requested: string[] = []): typeof fetch => (async (input: string | URL | Request) => {
            const url = new URL(String(input));
            requested.push(url.href);
            const path = url.pathname.replace(/^\/mekbay\//u, '').replace(/^\//u, '');
            const bytes = files.get(path);
            return bytes ? new Response(Buffer.from(bytes), { status: 200 }) : new Response('', { status: 404 });
        }) as typeof fetch,
    };
}

function sha1(bytes: Uint8Array): string {
    return crypto.createHash('sha1').update(bytes).digest('base64url');
}
