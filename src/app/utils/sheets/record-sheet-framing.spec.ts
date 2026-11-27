// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { createRoot, drawClusterHitsReference } from './record-sheet-svg-rendering';

describe('Record-sheet framing', () => {
    let svg: SVGSVGElement;

    beforeEach(() => {
        svg = createRoot(600, 800, 'frame-test');
        document.body.appendChild(svg);
    });

    afterEach(() => svg.remove());

    it('draws one cluster cell per roll for every rack across table profiles', () => {
        for (const [width, height, rackCount, presentation] of [
            [382.1, 110.7, 4, 'auto'],
            [576.149, 148.504, 4, 'auto'],
            [576.149, 148.504, 29, 'auto'],
            [576.15, 113.7, 4, 'full-width'],
            [154.6, 96.048, 4, 'auto'],
        ] as const) {
            drawClusterHitsReference(svg, { x: 0, y: 0, width, height },
                Array.from({ length: rackCount }, (_, index) => index + 2), presentation);
            const frame = svg.lastElementChild as SVGGElement;
            expect(frame.querySelectorAll('[data-cluster-rack]').length).toBe(11 * rackCount);
        }
    });
});
