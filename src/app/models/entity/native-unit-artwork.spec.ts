// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { extractNativeUnitArtwork, hasEmbeddedUnitArtwork } from './native-unit-artwork';
import { decodeUnitArtwork, encodeUnitImage, normalizeUnitImage } from '../../utils/unit-artwork.util';
import { compressCustomDesign, compressEmbeddedCustomDesigns } from '../custom-design-policy';
import { asUnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import { createConstructionEntity } from '../../construction/domain/construction-factory';
import { createTestEquipmentRegistry } from './testing/test-equipment-registry';
import { encodeNativeEntity } from './write-entity';
import { parseEntity } from './parse-entity';

describe('native unit artwork boundary', () => {
    it('strips every MTF image field, retaining other bytes and the last image', () => {
        const extracted = extractNativeUnitArtwork('Version:1.0\r\nfluffimage:first\r\nChassis:Atlas\r\n FLUFFIMAGE : last\r\nicon:icon-data', 'mtf');
        expect(extracted).toEqual({ source: 'Version:1.0\r\nChassis:Atlas\r\n', images: { fluff: 'last', icon: 'icon-data' } });
        expect(extractNativeUnitArtwork(extracted.source, 'mtf').source).toBe(extracted.source);
    });
    it('strips BLK images with mixed case, wrapped base64, duplicates, and adjacent tags', () => {
        const extracted = extractNativeUnitArtwork('<name>\nAtlas\n</name>\n<FluffImage>\na b\nc\n</fluffimage>\n<icon>123</icon><fluffimage>last</fluffimage>', 'blk');
        expect(extracted).toEqual({ source: '<name>\nAtlas\n</name>\n', images: { fluff: 'last', icon: '123' } });
        expect(() => extractNativeUnitArtwork('<fluffimage>unterminated', 'blk')).toThrowError(/unterminated/);
    });
    it('does not rewrite prose or image-free native sources', () => {
        for (const format of ['mtf', 'blk'] as const) {
            const source = 'notes:See fluffimage: examples\r\n\r\n';
            expect(extractNativeUnitArtwork(source, format)).toEqual({ source, images: {} });
        }
    });
    it('blocks image-bearing sources at standalone and force compression boundaries', () => {
        const uuid = asUnitUuid(crypto.randomUUID());
        for (const source of [{ format: 'mtf' as const, source: 'fluffimage:' }, { format: 'blk' as const, source: '<icon>bad</icon>' }]) {
            expect(() => compressCustomDesign(uuid, source)).toThrowError(/artwork/);
            expect(() => compressEmbeddedCustomDesigns([{ uuid, source }])).toThrowError(/artwork/);
        }
    });
    it('normalizes raster art to bounded PNG and round-trips both native export formats', async () => {
        const canvas = document.createElement('canvas'); canvas.width = 2560; canvas.height = 80;
        canvas.getContext('2d')!.fillRect(0, 0, 50, 50);
        const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!)));
        const png = await normalizeUnitImage(blob);
        const bitmap = await createImageBitmap(png);
        expect(png.type).toBe('image/png'); expect(bitmap.width).toBe(2048); bitmap.close();
        const encoded = await encodeUnitImage(png);
        const registry = createTestEquipmentRegistry();
        for (const kind of ['Biped', 'Tank'] as const) {
            const format = kind === 'Biped' ? 'mtf' : 'blk';
            const entity = createConstructionEntity(kind, registry);
            const original = encodeNativeEntity(entity);
            entity.fluffImageEncoded.set(encoded); entity.iconEncoded.set(encoded);
            const exported = encodeNativeEntity(entity);
            expect(hasEmbeddedUnitArtwork(exported, format)).toBeTrue();
            const parsed = parseEntity(exported, `test.${format}`, registry).entity;
            expect(parsed.fluffImageEncoded()).toBe(encoded); expect(parsed.iconEncoded()).toBe(encoded);
            const extracted = extractNativeUnitArtwork(exported, format);
            // Native writers may leave the blank separator that preceded their exported image blocks.
            expect(extracted.source.split('\n').filter(line => line.trim())).toEqual(original.split('\n').filter(line => line.trim()));
            const restored = await decodeUnitArtwork(extracted.images);
            expect(restored.warnings).toEqual([]);
            expect(restored.artwork?.fluff?.type).toBe('image/png');
            expect(restored.artwork?.icon?.size).toBeGreaterThan(0);
        }
    });
    it('removes malformed or non-image bytes without rejecting an otherwise usable design', async () => {
        const result = await decodeUnitArtwork({ fluff: 'not%base64', icon: btoa('not an image') });
        expect(result.artwork).toBeNull(); expect(result.warnings.length).toBe(2);
        await expectAsync(normalizeUnitImage(new Blob([new Uint8Array(8 * 1024 * 1024 + 1)]))).toBeRejectedWithError(/8 MB/);
    });
});
