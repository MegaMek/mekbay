// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBipedMekEntity } from '../../models/entity/testing/test-entities';
import { drawMekHitLocationAndClusterPanel, drawMekPunchKickPanel } from './layouts/mek-record-sheet-layout';
import { addFrame, createRoot, drawClusterHitsReference } from './record-sheet-svg-rendering';
import { RECORD_SHEET_FONT } from './record-sheet-typography';
import { SvgFrameUtil } from './svg-frame.util';

describe('Record-sheet framing', () => {
    let svg: SVGSVGElement;

    beforeEach(() => {
        svg = createRoot(600, 800, 'frame-test');
        document.body.appendChild(svg);
    });

    afterEach(() => svg.remove());

    it('grows auto headers to a limit, then compresses only overflowing titles', () => {
        const widths: number[] = [];
        for (const title of ['A', 'MEDIUM TITLE', 'A MUCH LONGER TITLE THAT EXCEEDS THE HEADER WIDTH']) {
            const frame = SvgFrameUtil.createSVGFrame(title, 300, 60, { maxHeaderWidth: 180 });
            svg.appendChild(frame);
            const text = frame.querySelector<SVGTextElement>('.svg-frame-title')!;
            const ribbon = text.parentElement!.querySelector('path')!.getBBox();
            widths.push(ribbon.width);
            expect(text.textContent).toBe(title);
            expect(text.getBBox().width).toBeLessThan(ribbon.width);
            if (title.startsWith('A MUCH')) {
                expect(text.getAttribute('lengthAdjust')).toBe('spacingAndGlyphs');
                expect(ribbon.width).toBeCloseTo(180, 3);
            } else {
                expect(text.hasAttribute('textLength')).toBeFalse();
            }
        }
        expect(widths[0]).toBeLessThan(widths[1]);
        expect(widths[1]).toBeLessThan(widths[2]);
    });

    it('keeps full-width headers spanning the frame when a tab limit is supplied', () => {
        const frame = SvgFrameUtil.createSVGFrame('TITLE', 300, 60, {
            maxHeaderWidth: 100, fullWidthHeader: true,
        });
        svg.appendChild(frame);
        const title = frame.querySelector('.svg-frame-title')!;
        expect(title.parentElement!.querySelector('path')!.getBBox().width).toBeGreaterThan(280);
    });

    it('keeps full-width titles centered with equal side gaps, including named header profiles', () => {
        for (const variant of ['panel', 'nested'] as const) {
            for (const width of [145.6, 300]) {
                const frame = addFrame(svg, 'GROUND MAP STRAIGHT MOVEMENT',
                    { x: 0, y: 0, width, height: 60 }, { fullWidthHeader: true, variant });
                const border = frame.querySelector<SVGPathElement>(':scope > path[stroke="#000"]')!.getBBox();
                const title = frame.querySelector<SVGTextElement>('.svg-frame-title')!;
                const header = title.parentNode as SVGGElement;
                const ribbon = header.querySelector('path')!.getBBox();
                const offset = header.transform.baseVal.consolidate()!.matrix.e;
                const leftGap = offset + ribbon.x - border.x;
                const rightGap = border.x + border.width - offset - ribbon.x - ribbon.width;
                expect(leftGap).withContext(`${variant}, width ${width}`).toBeCloseTo(rightGap, 3);
                expect(Number(title.getAttribute('x'))).toBeCloseTo(ribbon.x + ribbon.width / 2, 3);
                expect(title.getBBox().width).toBeLessThan(ribbon.width);
            }
        }
    });

    it('uses the same panel strokes for cluster, hit-location and physical tables', () => {
        const box = { x: 0, y: 0, width: 145.6, height: 123 };
        const entity = new TestBipedMekEntity();
        drawClusterHitsReference(svg, box, [15]);
        drawMekHitLocationAndClusterPanel(svg, entity, box);
        drawMekPunchKickPanel(svg, entity, box);
        const frames = [...svg.querySelectorAll('.referenceTable')];
        expect(frames.length).toBe(3);
        for (const frame of frames) {
            expect(frame.querySelector(':scope > path[stroke="#000"]')!.getAttribute('stroke-width')).toBe('1.932');
            expect(frame.querySelector(':scope > path[stroke="#c7c7c7"]')!.getAttribute('stroke-width')).toBe('5.2');
        }
    });

    it('keeps cluster frames and header spacing unscaled across table profiles', () => {
        for (const [width, height, rackCount, presentation] of [
            [382.1, 110.7, 4, 'auto'],
            [576.149, 148.504, 4, 'auto'],
            [576.149, 148.504, 29, 'auto'],
            [576.15, 113.7, 4, 'full-width'],
            [154.6, 96.048, 4, 'auto'],
        ] as const) {
            for (const [sx, sy] of [[1, 1], [0.97, 1.07]]) {
                drawClusterHitsReference(svg, { x: 0, y: 0, width: width * sx, height: height * sy },
                    Array.from({ length: rackCount }, (_, index) => index + 2), presentation);
                const frame = svg.lastElementChild as SVGGElement;
                const transform = frame.transform.baseVal.consolidate()!.matrix;
                expect(transform.a).toBe(1);
                expect(transform.d).toBe(1);
                const title = frame.querySelector<SVGTextElement>('.svg-frame-title')!;
                const header = title.parentNode as SVGGElement;
                expect(header.transform.baseVal.consolidate()!.matrix.f).toBe(3);
                const ribbon = header.querySelector('path')!.getBoundingClientRect();
                const rollHeading = frame.lastElementChild!.querySelector('text')!.getBoundingClientRect();
                expect(ribbon.bottom).toBeLessThan(rollHeading.top);
                expect(frame.querySelectorAll('[data-cluster-rack]').length).toBe(11 * rackCount);
                const table = frame.lastElementChild as SVGGElement;
                const tableTransform = table.transform.baseVal.consolidate()!.matrix;
                expect(tableTransform.a).toBe(1);
                expect(tableTransform.d).toBe(1);
                for (const number of table.querySelectorAll('text')) {
                    expect(Number(number.getAttribute('font-size'))).toBeGreaterThanOrEqual(RECORD_SHEET_FONT.small);
                    expect(number.hasAttribute('textLength')).toBeFalse();
                }
            }
        }
    });

    it('uses a fixed thin stroke for nested frames and preserves their requested bounds', () => {
        const frame = SvgFrameUtil.createSVGFrame('', 200, 60, { variant: 'nested', showHeader: false });
        svg.appendChild(frame);
        const paths = frame.querySelectorAll('path');
        expect(paths.length).toBe(1);
        expect(paths[0].getAttribute('stroke-width')).toBe('0.966');
        expect(paths[0].getBBox().width).toBeCloseTo(200, 3);
        expect(paths[0].getBBox().height).toBeCloseTo(60, 3);
        expect(frame.querySelector('.svg-frame-title')).toBeNull();
    });
});
