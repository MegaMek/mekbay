// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { renderRecordSheetPips } from './record-sheet-dom';
import { RecordSheetDamageHighlights } from '../../utils/sheets/record-sheet-damage-highlights';

describe('renderRecordSheetPips', () => {
    let highlights: RecordSheetDamageHighlights;
    beforeEach(() => { highlights = new RecordSheetDamageHighlights(); });
    afterEach(() => highlights.destroy());
    it('renders pending damage, commit, pending repair, and repair with production classes', () => {
        const pips = Array.from({ length: 4 }, () =>
            document.createElementNS('http://www.w3.org/2000/svg', 'circle'));

        renderRecordSheetPips(highlights, pips, 4, 4, 4);
        expect(classes(pips)).toEqual([[], [], [], []]);

        renderRecordSheetPips(highlights, pips, 4, 4, 2, true);
        expect(classes(pips)).toEqual([
            ['damaged', 'fresh', 'pending'],
            ['damaged', 'fresh', 'pending'],
            [],
            [],
        ]);

        renderRecordSheetPips(highlights, pips, 4, 2, 2, true);
        expect(classes(pips)).toEqual([
            ['damaged'],
            ['damaged'],
            [],
            [],
        ]);

        renderRecordSheetPips(highlights, pips, 4, 2, 3, true);
        expect(classes(pips)).toEqual([
            ['damaged'],
            ['fresh', 'pending'],
            [],
            [],
        ]);

        renderRecordSheetPips(highlights, pips, 4, 3, 3, true);
        expect(classes(pips)).toEqual([
            ['damaged'],
            [],
            [],
            [],
        ]);
    });

    it('hides surplus authored pips without retaining stale state', () => {
        const pips = Array.from({ length: 3 }, () =>
            document.createElementNS('http://www.w3.org/2000/svg', 'circle'));
        pips[2].classList.add('damaged', 'pending');

        renderRecordSheetPips(highlights, pips, 2, 2, 2);

        expect(pips.map(pip => pip.style.display)).toEqual(['', '', 'none']);
        expect(pips[2].classList.contains('damaged')).toBeFalse();
        expect(pips[2].classList.contains('pending')).toBeFalse();
    });
});

function classes(pips: readonly SVGElement[]): string[][] {
    return pips.map(pip => [...pip.classList].sort());
}
