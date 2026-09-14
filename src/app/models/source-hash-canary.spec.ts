// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    asSourceHashCanary,
    nativeSourceHashCanary,
    sourceHashCanary,
    sourceHashCanaryChanged,
} from './source-hash-canary';

describe('source hash canary', () => {
    it('uses four leading base64url characters', () => {
        expect(sourceHashCanary('k8zQ01234567890123456789012')).toBe(asSourceHashCanary('k8zQ'));
    });

    it('reports only an actual canary mismatch', () => {
        expect(sourceHashCanaryChanged(
            asSourceHashCanary('k8zQ'),
            asSourceHashCanary('k8zQ'),
        )).toBeFalse();
        expect(sourceHashCanaryChanged(
            asSourceHashCanary('k8zQ'),
            asSourceHashCanary('AbCd'),
        )).toBeTrue();
        expect(sourceHashCanaryChanged(undefined, asSourceHashCanary('AbCd'))).toBeFalse();
    });

    it('ignores MTF comments, generator metadata, BOM and line endings but detects unit changes', async () => {
        const source = 'chassis:Atlas\nmodel:AS7-D\nMass:100\n';
        const baseline = await nativeSourceHashCanary(source, 'mtf');
        expect(await nativeSourceHashCanary('\uFEFF# comment\r\nGenerator:MekBay 1.0\r\n' + source.replaceAll('\n', '\r\n'), 'mtf')).toBe(baseline);
        expect(await nativeSourceHashCanary(source.replace('100', '95'), 'mtf')).not.toBe(baseline);
    });

    it('ignores BLK comments and generator blocks while preserving values, order and duplicates', async () => {
        const source = '<name>\nTank\n</name>\n<armor>\n10\n20\n</armor>\n';
        const baseline = await nativeSourceHashCanary(source, 'blk');
        expect(await nativeSourceHashCanary('\uFEFF# comment\r\n<Generator>\r\nMekBay 1.0\r\n</Generator>\r\n' + source.replaceAll('\n', '\r\n'), 'blk')).toBe(baseline);
        expect(await nativeSourceHashCanary(source.replace('10\n20', '20\n10'), 'blk')).not.toBe(baseline);
        expect(await nativeSourceHashCanary(source + '<name>\nOther Tank\n</name>', 'blk')).not.toBe(baseline);
        expect(await nativeSourceHashCanary(source.replace('Tank', '# a value, not a comment'), 'blk')).not.toBe(baseline);
    });

    it('ignores native fluff and artwork while retaining gameplay fields', async () => {
        const mtf = 'Chassis:Atlas\nMass:100\n';
        const mtfFluff = 'overview:New history\nmanufacturer:New manufacturer\nnotes:New notes\nsystemmode:ENGINE:New name\nfluffimage:image\niconpath:new/path\n';
        expect(await nativeSourceHashCanary(mtf + mtfFluff, 'mtf')).toBe(await nativeSourceHashCanary(mtf, 'mtf'));
        const slots = mtf + 'Left Arm:\nManufacturer:Equipment name\n';
        expect(await nativeSourceHashCanary(slots, 'mtf')).not.toBe(await nativeSourceHashCanary(slots.replace('Equipment name', 'Other equipment'), 'mtf'));
        const blk = '<Name>\nTank\n</Name>\n<armor>\n20\n</armor>\n';
        const blkFluff = '<overview>\nNew description\n# literal prose\n</overview>\n<systemModels>\nENGINE:New name\n</systemModels>\n<length>\n12 meters\n</length>\n<fluffimage>\nimage\n</fluffimage>\n';
        expect(await nativeSourceHashCanary(blk + blkFluff, 'blk')).toBe(await nativeSourceHashCanary(blk, 'blk'));
        expect(await nativeSourceHashCanary(blk.replace('20', '21') + blkFluff, 'blk')).not.toBe(await nativeSourceHashCanary(blk, 'blk'));
    });
});
