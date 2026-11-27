// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    parseCoreUnitsManifest,
    planCoreCatalogDiff,
    type CoreUnitsManifest,
} from './core-unit-manifest';
import { buildStoredCoreContent, validateNativeUnitSource } from './native-unit-source';
import {
    asSourceHash,
    asUnitUuid,
    makeUnitFileName,
    type UnitUuid,
} from './unit-catalog.types';

describe('core units manifest', () => {
    const first = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1');
    const second = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e2');
    const third = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e3');
    const firstHash = asSourceHash('AAAAAAAAAAAAAAAAAAAAAAAAAAA');
    const secondHash = asSourceHash('EEEEEEEEEEEEEEEEEEEEEEEEEEA');
    const thirdHash = asSourceHash('IIIIIIIIIIIIIIIIIIIIIIIIIIA');

    it('parses the direct filename-to-SHA-1 map', () => {
        const json = JSON.stringify({
            [makeUnitFileName(first, 'mtf')]: firstHash,
            [makeUnitFileName(second, 'blk')]: secondHash,
        });

        const stored = parseCoreUnitsManifest(json, thirdHash);

        expect(stored.hash).toBe(thirdHash);
        expect(stored.manifest.units[first]).toEqual({
            file: makeUnitFileName(first, 'mtf'), hash: firstHash, format: 'mtf',
        });
        expect(stored.manifest.units[second].format).toBe('blk');
    });

    it('rejects empty, malformed, duplicate, and non-UUID filenames', () => {
        expect(() => parseCoreUnitsManifest('{}', firstHash)).toThrowError(/population/u);
        expect(() => parseCoreUnitsManifest('{', firstHash)).toThrowError(/valid JSON/u);
        expect(() => parseCoreUnitsManifest(JSON.stringify({ 'unit.mtf': firstHash }), firstHash))
            .toThrowError(/Invalid units manifest entry/u);
    });

    it('chooses individual downloads only within the configured threshold', () => {
        const active = manifest({
            [first]: entry(first, 'mtf', firstHash),
            [second]: entry(second, 'blk', secondHash),
        });
        const desired = manifest({
            [first]: entry(first, 'mtf', firstHash),
            [second]: entry(second, 'blk', thirdHash),
            [third]: entry(third, 'blk', secondHash),
        });
        const firstFile = makeUnitFileName(first, 'mtf');
        const plan = planCoreCatalogDiff(desired, active, new Set([firstFile]), 2);

        expect(plan.strategy).toBe('individual');
        expect(plan.missingFiles).toEqual([
            makeUnitFileName(second, 'blk'),
            makeUnitFileName(third, 'blk'),
        ]);
        expect(plan.addedUuids).toEqual([third]);
        expect(plan.changedUuids).toEqual([second]);
        expect(planCoreCatalogDiff(desired, active, new Set([firstFile]), 1).strategy).toBe('archive');
    });

    it('binds validated bytes to the UUID filename and supplied hash', async () => {
        const bytes = new TextEncoder().encode(`uuid:${first}\nchassis:Atlas\n`).buffer;
        const manifestEntry = entry(first, 'mtf', firstHash);

        const stored = await buildStoredCoreContent(first, manifestEntry, bytes);

        expect(stored.file).toBe(makeUnitFileName(first, 'mtf'));
        expect(stored.hash).toBe(firstHash);
        expect(stored.bytes).not.toBe(bytes);
    });

    it('rejects Mek BLK and embedded UUID mismatches', async () => {
        const mekBlk = new TextEncoder().encode(
            `<UUID>${first}</UUID><UnitType>Mek</UnitType><Name>Bad</Name>`,
        ).buffer;
        await expectAsync(validateNativeUnitSource(first, 'blk', mekBlk)).toBeRejectedWithError(/must use MTF/u);

        const mtf = new TextEncoder().encode(`uuid:${second}\nchassis:Atlas\n`).buffer;
        await expectAsync(validateNativeUnitSource(first, 'mtf', mtf)).toBeRejectedWithError(/does not match/u);
    });
});

function entry(
    uuid: UnitUuid,
    format: 'mtf' | 'blk',
    hash: ReturnType<typeof asSourceHash>,
): CoreUnitsManifest['units'][UnitUuid] {
    return { file: makeUnitFileName(uuid, format), hash, format };
}

function manifest(units: CoreUnitsManifest['units']): CoreUnitsManifest {
    return { units };
}
