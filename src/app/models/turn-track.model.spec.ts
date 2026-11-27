// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { turnTrackShownTurn } from './turn-track.model';

describe('turn track', () => {
    it('moves its two tables on in turn, so this turn and the table before it always show', () => {
        const shown = (currentTurn: number, perTable: number) => [1, perTable, perTable + 1, 2 * perTable]
            .map(column => turnTrackShownTurn(column, currentTurn, perTable));
        // The velocity record's tables of ten.
        expect(shown(1, 10)).toEqual([1, 10, 11, 20]);
        expect(shown(20, 10)).toEqual([1, 10, 11, 20]);
        expect(shown(21, 10)).toEqual([21, 30, 11, 20]);
        expect(shown(30, 10)).toEqual([21, 30, 11, 20]);
        expect(shown(31, 10)).toEqual([21, 30, 31, 40]);
        expect(shown(41, 10)).toEqual([41, 50, 31, 40]);
        // The VTOL Elevation Track's tables of fifteen.
        expect(shown(30, 15)).toEqual([1, 15, 16, 30]);
        expect(shown(31, 15)).toEqual([31, 45, 16, 30]);
        expect(shown(46, 15)).toEqual([31, 45, 46, 60]);
    });
});
