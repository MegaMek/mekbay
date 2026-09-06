// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { appendRecordSheetAmmoProfile, updateRecordSheetAmmoProfile } from './record-sheet-ammo-rendering';

describe('record sheet ammo SVG rendering', () => {
    const namespace = 'http://www.w3.org/2000/svg';
    const entries = Array<string>(6).fill('(AC/5) 20');
    let attached: SVGSVGElement[];

    beforeEach(() => attached = []);
    afterEach(() => attached.forEach(svg => svg.remove()));

    function fixture(inventory = false) {
        const svg = document.createElementNS(namespace, 'svg');
        const before = document.createElementNS(namespace, 'g');
        before.setAttribute('data-ammo-before', '');
        svg.appendChild(before);
        let inventoryGroup: SVGGElement | undefined;
        if (inventory) {
            inventoryGroup = document.createElementNS(namespace, 'g');
            inventoryGroup.setAttribute('data-ammo-inventory', '');
            inventoryGroup.setAttribute('data-top', '20');
            inventoryGroup.setAttribute('data-bottom', '180');
            inventoryGroup.setAttribute('data-content-bottom', '180');
            svg.appendChild(inventoryGroup);
        }
        const context = document.createElement('canvas').getContext('2d')!;
        context.font = 'normal normal 8px Roboto, Arial, sans-serif';
        const width = context.measureText(`Ammo: ${entries.slice(0, 3).join(', ')},`).width * 0.9;
        return { svg, before, inventory: inventoryGroup, options: { x: 10, y: 190, width, fontSize: 8, lineHeight: 12 } };
    }

    function attach(svg: SVGSVGElement): void {
        document.body.appendChild(svg);
        attached.push(svg);
    }

    function naturalWidth(line: SVGTextElement): number {
        const naturalLine = line.cloneNode(true) as SVGTextElement;
        naturalLine.removeAttribute('textLength');
        naturalLine.removeAttribute('lengthAdjust');
        line.parentElement!.appendChild(naturalLine);
        const width = naturalLine.getComputedTextLength();
        naturalLine.remove();
        return width;
    }

    it('compresses every balanced row by the same acceptable ratio', () => {
        const { svg, options } = fixture();
        attach(svg);
        const profile = appendRecordSheetAmmoProfile(svg, entries, options);
        const lines = [...profile.querySelectorAll<SVGTextElement>('text')];
        const naturalWidths = lines.map(naturalWidth);
        const ratios = lines.map((line, index) => Number(line.getAttribute('textLength')) / naturalWidths[index]);

        expect(lines.length).toBe(2);
        expect(naturalWidths[0]).not.toBeCloseTo(naturalWidths[1], 1);
        for (let index = 0; index < lines.length; index++) {
            expect(lines[index].getAttribute('lengthAdjust')).toBe('spacingAndGlyphs');
            expect(ratios[index]).toBeCloseTo(0.9, 3);
            expect(ratios[index]).toBeGreaterThanOrEqual(0.82);
            expect(Number(lines[index].getAttribute('textLength'))).toBeLessThanOrEqual(options.width);
        }
        expect(lines.map(line => line.textContent).join(' ')).toBe(`Ammo: ${entries.join(', ')}`);
    });

    it('creates no text or reserved height for an empty ammo profile', () => {
        const { svg, before, options } = fixture();
        const profile = appendRecordSheetAmmoProfile(svg, [], options);

        expect(profile.childElementCount).toBe(0);
        expect(before.transform.baseVal.consolidate()!.matrix.f).toBe(0);
    });

    it('keeps the entire interactive ammo area clickable as row count changes', () => {
        const { svg, options } = fixture();
        svg.setAttribute('width', '300');
        svg.setAttribute('height', '250');
        svg.style.position = 'fixed';
        svg.style.left = '0';
        svg.style.top = '0';
        attach(svg);
        const profile = appendRecordSheetAmmoProfile(svg, [], options);
        updateRecordSheetAmmoProfile(profile, entries, true);
        const hitArea = profile.querySelector<SVGRectElement>('rect')!;
        const bounds = hitArea.getBoundingClientRect();
        expect(bounds.height).toBe(24);
        expect(bounds.width).toBeCloseTo(options.width, 3);
        // The right edge and interline gap must receive clicks even without text underneath.
        expect(document.elementFromPoint(bounds.right - 1, bounds.top + 12)).toBe(hitArea);

        updateRecordSheetAmmoProfile(profile, ['(MG) 100'], true);
        expect(profile.querySelector('rect')!.getAttribute('height')).toBe('12');
        updateRecordSheetAmmoProfile(profile, [], true);
        expect(profile.childElementCount).toBe(0);
        updateRecordSheetAmmoProfile(profile, entries);
        expect(profile.querySelector('rect')).toBeNull();
    });

    it('adds and removes rows without stale compression or cumulative layout drift', () => {
        const { svg, before, options } = fixture();
        const profile = appendRecordSheetAmmoProfile(svg, [], options);

        for (let cycle = 0; cycle < 3; cycle++) {
            updateRecordSheetAmmoProfile(profile, entries);
            const rows = [...profile.querySelectorAll<SVGTextElement>('text')];
            expect(rows.length).toBe(2);
            expect(before.transform.baseVal.consolidate()!.matrix.f).toBe(-24);
            expect(rows.map(row => Number(row.getAttribute('y')))).toEqual([178, 190]);

            updateRecordSheetAmmoProfile(profile, ['(MG) 100']);
            const shortRow = profile.querySelector('text')!;
            expect(profile.childElementCount).toBe(1);
            expect(shortRow.textContent).toBe('Ammo: (MG) 100');
            expect(shortRow.hasAttribute('textLength')).toBeFalse();
            expect(shortRow.hasAttribute('lengthAdjust')).toBeFalse();
            expect(before.transform.baseVal.consolidate()!.matrix.f).toBe(-12);

            updateRecordSheetAmmoProfile(profile, []);
            expect(profile.childElementCount).toBe(0);
            expect(before.transform.baseVal.consolidate()!.matrix.f).toBe(0);
        }
    });

    it('fits optional inventory above ammo and restores its original geometry when ammo disappears', () => {
        const { svg, before, inventory, options } = fixture(true);
        const profile = appendRecordSheetAmmoProfile(svg, [], options);
        const initialTransform = inventory!.getAttribute('transform');

        for (let cycle = 0; cycle < 3; cycle++) {
            updateRecordSheetAmmoProfile(profile, entries);
            const matrix = inventory!.transform.baseVal.consolidate()!.matrix;
            expect(20 * matrix.d + matrix.f).toBeCloseTo(20, 4);
            expect(180 * matrix.d + matrix.f).toBeCloseTo(156, 4);
            expect(before.transform.baseVal.consolidate()!.matrix.f).toBe(-24);

            updateRecordSheetAmmoProfile(profile, []);
            expect(inventory!.getAttribute('transform')).toBe(initialTransform);
            expect(before.transform.baseVal.consolidate()!.matrix.f).toBe(0);
        }
    });

    it('produces identical rows and compression when detached and attached', () => {
        const { svg, options } = fixture();
        const profile = appendRecordSheetAmmoProfile(svg, entries, options);
        const detachedOutput = profile.outerHTML;

        attach(svg);
        updateRecordSheetAmmoProfile(profile, entries);

        expect(profile.outerHTML).toBe(detachedOutput);
        expect(profile.querySelectorAll('text').length).toBe(2);
    });
});
