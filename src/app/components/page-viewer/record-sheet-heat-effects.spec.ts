// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { recordSheetHeatEffects } from '../../models/runtime/heat-effect-presentation';
import { renderRecordSheetHeatEffects } from './record-sheet-heat-effects';

describe('record-sheet heat effects', () => {
    it('derives heat activation and supersession from rules even when SVG hints are false or absent', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.innerHTML = `<text class="heatEffect" heat="8" h-shutdown="999">False label</text>
            <text class="heatEffect" heat="13">No metadata</text>
            <text class="heatEffect hot surpassed" heat="99" h-fire="1">Invented effect</text>`;
        renderRecordSheetHeatEffects(svg, recordSheetHeatEffects('mek', 13));
        expect(svg.querySelector('[heat="8"]')?.classList.contains('surpassed')).toBeTrue();
        expect(svg.querySelector('[heat="13"]')?.classList.contains('hot')).toBeTrue();
        expect(svg.querySelector('[heat="13"]')?.classList.contains('surpassed')).toBeFalse();
        expect(svg.querySelector('[heat="99"]')?.classList.contains('hot')).toBeFalse();
        renderRecordSheetHeatEffects(svg, recordSheetHeatEffects('mek', 0));
        expect(svg.querySelectorAll('.hot, .surpassed').length).toBe(0);
    });
});
