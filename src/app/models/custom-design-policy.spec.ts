// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { compressCustomDesign, decompressCustomDesign, planEmbeddedDesigns, compressEmbeddedCustomDesigns, decompressEmbeddedCustomDesigns, MAX_EMBEDDED_CUSTOM_DESIGNS, MAX_EMBEDDED_CUSTOM_EXPANDED_BYTES, CustomDesignCapacityError } from './custom-design-policy';
import { asUnitUuid } from '../services/unit-catalog/unit-catalog.types';
import { MAX_UNIT_SOURCE_BYTES } from '../services/unit-catalog/core-unit-manifest';
import { inflate } from 'pako';

const uuid = (index: number) => asUnitUuid(`019f6767-0dcb-7bb8-992f-${String(index).padStart(12, '0')}`);
const design = (index: number) => ({ uuid: uuid(index), source: { format: 'mtf' as const, source: `uuid:${uuid(index)}\nchassis:Test\nmodel:Revision ${index}\n${'Left Arm:\n-Empty-\n'.repeat(30)}` } });

describe('force custom design storage policy', () => {
    it('deduplicates preview tuples with pinned designs and keeps them outside the compressed sources', () => {
        const original = { ...design(1), source: { ...design(1).source,
            preview: ['Mad Cat', 'Custom A', 'Timber Wolf', 'meks/custom.png'] as const } };
        const revised = { ...original, source: { ...original.source, source: original.source.source + '\nrevision',
            preview: ['Mad Cat', 'Custom B', 'Timber Wolf', 'meks/revised.png'] as const } };
        const plan = planEmbeddedDesigns([original, revised, original]);
        expect(plan.indexes).toEqual([0, 1, 0]);
        expect(plan.compressed!.previews).toEqual([original.source.preview, revised.source.preview]);
        expect(decompressEmbeddedCustomDesigns(plan.compressed)).toEqual([original, revised]);
        const packedSources = new TextDecoder().decode(inflate(Uint8Array.from(atob(plan.compressed!.data), c => c.charCodeAt(0))));
        expect(packedSources).not.toContain('preview');
        expect(packedSources).not.toContain('meks/custom.png');
        expect(() => decompressEmbeddedCustomDesigns({ ...plan.compressed, previews: [] })).toThrowError(/match/);
    });
    it('stores one compressed source for 100 instances of the same design', () => {
        const source = design(1);
        const plan = planEmbeddedDesigns(Array.from({ length: 100 }, () => source));
        expect(plan.designs.length).toBe(1);
        expect(plan.indexes).toEqual(Array(100).fill(0));
        expect(decompressEmbeddedCustomDesigns(plan.compressed)).toEqual([source]);
        expect(JSON.stringify(plan.compressed).length).toBeLessThan(source.source.source.length / 2);
    });
    it('rejects the twenty-first distinct revision and embeds all designs up to the limit', () => {
        const sources = Array.from({ length: MAX_EMBEDDED_CUSTOM_DESIGNS + 1 }, (_, i) => design(i + 1));
        expect(() => planEmbeddedDesigns(sources)).toThrowError(CustomDesignCapacityError);
        const allowed = sources.slice(1);
        const plan = planEmbeddedDesigns([...allowed, allowed[0]]);
        expect(plan.designs.length).toBe(MAX_EMBEDDED_CUSTOM_DESIGNS);
        expect(plan.indexes).toEqual([...allowed.map((_, index) => index), 0]);
        expect(planEmbeddedDesigns([design(1), { ...design(1), source: { format: 'mtf', source: design(1).source.source + '\nchanged' } }]).designs.length).toBe(2);
    });
    it('compresses the complete force table together and retains an exact small index', () => {
        const designs = Array.from({ length: MAX_EMBEDDED_CUSTOM_DESIGNS }, (_, i) => design(i + 1));
        const plan = planEmbeddedDesigns(designs);
        expect(decompressEmbeddedCustomDesigns(plan.compressed)).toEqual(designs);
        expect(plan.compressed?.encoding).toBe('deflate');
        const individual = designs.map(d => compressCustomDesign(d.uuid, d.source));
        expect(JSON.stringify(plan.compressed).length).toBeLessThan(JSON.stringify(individual).length / 2);
    });
    it('rejects combined blocks with excessive counts, duplicate designs, oversized sources or excessive expansion', () => {
        expect(() => decompressEmbeddedCustomDesigns(compressEmbeddedCustomDesigns(Array.from({ length: MAX_EMBEDDED_CUSTOM_DESIGNS + 1 }, (_, i) => design(i + 1))))).toThrow();
        expect(() => decompressEmbeddedCustomDesigns(compressEmbeddedCustomDesigns([design(1), design(1)]))).toThrowError(/Duplicate/);
        expect(() => decompressEmbeddedCustomDesigns(compressEmbeddedCustomDesigns([{ uuid: uuid(1), source: { format: 'mtf', source: 'x'.repeat(MAX_UNIT_SOURCE_BYTES + 1) } }]))).toThrow();
        const huge = compressCustomDesign(uuid(1), { format: 'mtf', source: 'x'.repeat(MAX_EMBEDDED_CUSTOM_EXPANDED_BYTES + 1) });
        expect(() => decompressEmbeddedCustomDesigns({ encoding: 'deflate', data: huge.data })).toThrowError(/size limit/);
        expect(() => decompressEmbeddedCustomDesigns({ encoding: 'deflate', data: 'broken' })).toThrow();
    });
    it('rejects an oversized combined table without dropping any designs', () => {
        const random = new Uint8Array(155000);
        for (let offset = 0; offset < random.length; offset += 65536) crypto.getRandomValues(random.subarray(offset, offset + 65536));
        let text = ''; for (let offset = 0; offset < random.length; offset += 8192) text += String.fromCharCode(...random.subarray(offset, offset + 8192));
        const large = { uuid: uuid(1), source: { format: 'mtf' as const, source: 'uuid:' + uuid(1) + '\nmodel:' + btoa(text) } };
        expect(() => planEmbeddedDesigns([large, design(2)])).toThrowError(CustomDesignCapacityError);
    });

    it('rejects invalid compressed data and bounds inflated data before allocating a complete source', () => {
        expect(() => decompressCustomDesign({ ...compressCustomDesign(uuid(1), design(1).source), data: 'not base64!' })).toThrow();
        const bomb = compressCustomDesign(uuid(1), { format: 'mtf', source: 'X'.repeat(MAX_UNIT_SOURCE_BYTES + 1) });
        expect(() => decompressCustomDesign(bomb)).toThrowError(/size limit/);
    });
});
