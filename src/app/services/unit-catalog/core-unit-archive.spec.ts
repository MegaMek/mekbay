// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import JSZip from 'jszip';

import { UNIT_SUMMARY_VERSION, type UnitSummary } from '../../models/unit-summary.model';
import { sha1Base64Url } from '../../utils/sha1.util';
import {
    serializeApplicationCatalogDependencyBundle,
    type ApplicationCatalogDependencyBundle,
} from './application-catalog-dependency-bundle';
import {
    CORE_UNIT_ARCHIVE_DEPENDENCY_BUNDLE_PATH,
    CORE_UNIT_ARCHIVE_SUMMARY_PATH,
    type CoreUnitsManifest,
} from './core-unit-manifest';
import {
    CoreUnitArchiveError,
    createCoreUnitSourceArchive,
    openCoreUnitRelease,
    openStoredCoreUnitArchive,
} from './core-unit-archive';
import {
    MM_DATA_UNIT_PROVIDER_ID,
    asSourceHash,
    asUnitUuid,
    makeUnitFileName,
    type SourceHash,
    type UnitUuid,
} from './unit-catalog.types';

describe('core unit archive', () => {
    const first = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1');
    const second = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e2');
    const firstBytes = new TextEncoder().encode('first unit').buffer;
    const secondBytes = new TextEncoder().encode('second unit').buffer;

    it('creates and reopens a compact local source ZIP by UUID filename', async () => {
        const manifest = await makeManifest([[first, firstBytes], [second, secondBytes]]);
        const bytes = await createCoreUnitSourceArchive(manifest, [
            { file: manifest.units[first].file, bytes: firstBytes },
            { file: manifest.units[second].file, bytes: secondBytes },
        ]);
        const archive = await openStoredCoreUnitArchive(bytes, manifest);

        expect(archive.files).toEqual([
            manifest.units[first].file,
            manifest.units[second].file,
        ].sort());
        expect(new Uint8Array(await archive.extract(manifest.units[first].file)))
            .toEqual(new Uint8Array(firstBytes));
    });

    it('requires every desired source when creating the local ZIP', async () => {
        const manifest = await makeManifest([[first, firstBytes], [second, secondBytes]]);

        await expectAsync(createCoreUnitSourceArchive(manifest, [
            { file: manifest.units[first].file, bytes: firstBytes },
        ])).toBeRejectedWithError(CoreUnitArchiveError, /without every unit/u);
    });

    it('validates a downloaded ZIP once and reads its bootstrap data', async () => {
        const manifest = await makeManifest([[first, firstBytes]]);
        const summary = makeSummary(first, manifest.units[first].hash);
        const zip = new JSZip();
        zip.file(manifest.units[first].file, firstBytes);
        zip.file(CORE_UNIT_ARCHIVE_SUMMARY_PATH, JSON.stringify([summary]));
        zip.file(
            CORE_UNIT_ARCHIVE_DEPENDENCY_BUNDLE_PATH,
            serializeApplicationCatalogDependencyBundle(dependencyBundle()).bytes,
        );
        zip.file('harmless-extra.txt', 'ignored');
        const bytes = await zip.generateAsync({ type: 'arraybuffer' });
        const checksum = await sha1Base64Url(bytes);

        const release = await openCoreUnitRelease(bytes, checksum, manifest);

        expect(release.summaries).toEqual([summary]);
        expect(release.dependencyBundle).toEqual(dependencyBundle());
        expect(release.archive.files).toEqual([manifest.units[first].file]);
    });

    it('rejects a truncated or mismatched download checksum', async () => {
        const manifest = await makeManifest([[first, firstBytes]]);

        await expectAsync(openCoreUnitRelease(
            new Uint8Array([1, 2, 3]).buffer,
            'AAAAAAAAAAAAAAAAAAAAAAAAAAA',
            manifest,
        )).toBeRejectedWithError(CoreUnitArchiveError, /corrupt or incomplete/u);
    });

    it('removes obsolete files and installs replacements while compacting', async () => {
        const current = await makeManifest([[first, firstBytes], [second, secondBytes]]);
        const currentBytes = await createCoreUnitSourceArchive(current, [
            { file: current.units[first].file, bytes: firstBytes },
            { file: current.units[second].file, bytes: secondBytes },
        ]);
        const replacement = new TextEncoder().encode('replacement').buffer;
        const next = await makeManifest([[second, replacement]]);
        const archive = await openStoredCoreUnitArchive(currentBytes, current);

        const compacted = await archive.compactSources(next, [
            { file: next.units[second].file, bytes: replacement },
        ]);
        const reopened = await openStoredCoreUnitArchive(compacted, next);

        expect(reopened.files).toEqual([next.units[second].file]);
        expect(new Uint8Array(await reopened.extract(next.units[second].file)))
            .toEqual(new Uint8Array(replacement));
    });
});

async function makeManifest(
    sources: readonly (readonly [UnitUuid, ArrayBuffer])[],
): Promise<CoreUnitsManifest> {
    const units = {} as Record<UnitUuid, CoreUnitsManifest['units'][UnitUuid]>;
    for (const [uuid, bytes] of sources) {
        const hash = asSourceHash(await sha1Base64Url(bytes));
        units[uuid] = Object.freeze({ file: makeUnitFileName(uuid, 'mtf'), hash, format: 'mtf' });
    }
    return Object.freeze({ units: Object.freeze(units) });
}

function makeSummary(uuid: UnitUuid, hash: SourceHash): UnitSummary {
    return {
        uuid,
        provider: MM_DATA_UNIT_PROVIDER_ID,
        origin: 'megamek',
        hash,
        summaryVersion: UNIT_SUMMARY_VERSION,
        entityType: 'Mek',
        loadIssues: [],
        rulesRefs: [],
        name: 'Test Unit',
    } as unknown as UnitSummary;
}

function dependencyBundle(): ApplicationCatalogDependencyBundle {
    return {
        equipment: {}, quirks: {}, sourcebooks: {}, eras: {}, factions: {},
        spriteManifest: { manifestDigest: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA', manifestText: '{}' },
    } as unknown as ApplicationCatalogDependencyBundle;
}
