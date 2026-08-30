// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { buildHeatSummaryRows } from './heat-summary.util';

describe('buildHeatSummaryRows', () => {
    it('lists each source and only the cooling actually consumed', () => {
        expect(buildHeatSummaryRows([
            { id: 'movement', label: 'Movement', value: 2 },
            { id: 'weapons', label: 'Weapons', value: 12 },
            { id: 'damaged-engine', label: 'Damaged Engine', value: 5 },
        ], 10, 10, 13)).toEqual([
            { id: 'movement', label: 'Movement', value: 2, kind: 'source' },
            { id: 'weapons', label: 'Weapons', value: 12, kind: 'source' },
            { id: 'damaged-engine', label: 'Engine', value: 5, kind: 'source' },
            { id: 'heat-sink', label: 'Sink', value: -10, kind: 'sink' },
        ]);
    });

    it('labels unused sink capacity without implying heat below zero', () => {
        expect(buildHeatSummaryRows([], 28, 22, 0)).toEqual([
            { id: 'heat-sink', label: 'Sink (28)', value: -22, kind: 'sink' },
        ]);
    });

    it('groups marked equipment only for compact summaries', () => {
        const sources = [
            { id: 'nova', label: 'Nova CEWS', value: 2, group: 'Equipment' },
            { id: 'damaged-engine', label: 'Damaged Engine', value: 5 },
            { id: 'stealth', label: 'Stealth', value: 10, group: 'Equipment' },
        ];

        expect(buildHeatSummaryRows(sources, 0, 0, 17).map(row => row.label))
            .toEqual(['Nova CEWS', 'Engine', 'Stealth']);
        expect(buildHeatSummaryRows(sources, 0, 0, 17, { groupSources: true })).toEqual([
            { id: 'equipment', label: 'Equipment', value: 12, kind: 'source' },
            { id: 'damaged-engine', label: 'Engine', value: 5, kind: 'source' },
        ]);
    });
});
